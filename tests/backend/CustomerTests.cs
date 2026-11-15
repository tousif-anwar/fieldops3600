using FieldOps.Core;
using System.Security.Cryptography;
using System.Text;
using FieldOps.ServiceHost;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Xunit;

namespace FieldOps.Tests;

public sealed class CustomerRuleTests
{
    public static Customer Valid() => new()
    {
        DisplayName = "Synthetic Customer", CreatedAtUtc = DateTimeOffset.UtcNow, UpdatedAtUtc = DateTimeOffset.UtcNow,
        Locations = [new() { Name = "Synthetic Site", AddressLine1 = "100 Example Avenue", City = "Boston", Region = "MA", PostalCode = "02101" }]
    };

    [Fact]
    public void CommunicationPreferenceRequiresExplicitCorrespondingConsent()
    {
        var customer = Valid();
        customer.Contacts.Add(new() { FullName = "Synthetic Contact", Email = "contact@example.invalid", EmailConsent = false });
        customer.PreferredChannel = "Email";
        Assert.Throws<DomainException>(() => CustomerRules.Validate(customer));
        customer.Contacts[0].EmailConsent = true; CustomerRules.Validate(customer);
        customer.Contacts[0].Email = null;
        Assert.Throws<DomainException>(() => CustomerRules.Validate(customer));
    }

    [Fact]
    public void PrimaryContactAndActiveLocationInvariantsAreEnforced()
    {
        var customer = Valid();
        customer.Contacts = [new() { FullName = "Contact One", Phone = "+1 555 0101", IsPrimary = true }, new() { FullName = "Contact Two", Phone = "+1 555 0102", IsPrimary = true }];
        Assert.Throws<DomainException>(() => CustomerRules.Validate(customer));
        customer.Contacts[1].IsPrimary = false; CustomerRules.Validate(customer);
        customer.Locations[0].Status = "Archived";
        Assert.Throws<DomainException>(() => CustomerRules.Validate(customer));
        customer.Status = "Archived"; CustomerRules.Validate(customer);
    }

    [Theory]
    [InlineData("bad email")]
    [InlineData("Display Name <valid@example.invalid>")]
    public void ContactEmailCannotBeAnInvalidOrDisplayAddress(string email)
    {
        var customer = Valid(); customer.Contacts.Add(new() { FullName = "Synthetic Contact", Email = email });
        Assert.Throws<DomainException>(() => CustomerRules.Validate(customer));
    }
}

[Collection("PostgreSQL")]
[Trait("Category", "Integration")]
public sealed class CustomerPostgresTests(PostgresFixture fixture)
{
    [Fact]
    public async Task CustomerMigrationCreatesOwnedForeignKeysAndEnforcesConsentAndPrimaryContact()
    {
        var cs = await fixture.Database("customers", false);
        await using var db = PostgresFixture.Db(cs, "customers");
        await SchemaMigrator.Apply(db); await SchemaMigrator.Apply(db);
        var customer = CustomerRuleTests.Valid(); db.Customers.Add(customer); await db.SaveChangesAsync();
        db.CustomerContacts.Add(new() { CustomerId = customer.Id, FullName = "Synthetic Contact", Email = "contact@example.invalid", IsPrimary = true, ConsentUpdatedAtUtc = DateTimeOffset.UtcNow });
        await db.SaveChangesAsync();
        var foreignKeys = await db.Database.SqlQueryRaw<int>("SELECT count(*)::integer AS \"Value\" FROM pg_constraint WHERE contype='f' AND connamespace='public'::regnamespace").SingleAsync();
        // The original customer relations remain, and the contract migration adds its own
        // customer/agreement foreign keys. ContractPostgresTests covers those explicitly.
        Assert.True(foreignKeys >= 3);
        var orphan = await Assert.ThrowsAsync<PostgresException>(() => db.Database.ExecuteSqlRawAsync("""
            INSERT INTO customer_contacts("Id","CustomerId","FullName","Phone","IsPrimary","EmailConsent","PhoneConsent","ConsentUpdatedAtUtc")
            VALUES(gen_random_uuid(),gen_random_uuid(),'Synthetic Orphan','5550101',false,false,false,now())
            """));
        Assert.Equal("23503", orphan.SqlState);
        var primary = await Assert.ThrowsAsync<PostgresException>(() => db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO customer_contacts("Id","CustomerId","FullName","Phone","IsPrimary","EmailConsent","PhoneConsent","ConsentUpdatedAtUtc")
            VALUES(gen_random_uuid(),{customer.Id},'Synthetic Second','5550102',true,false,false,now())
            """));
        Assert.Equal("23505", primary.SqlState);
        var consent = await Assert.ThrowsAsync<PostgresException>(() => db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO customer_contacts("Id","CustomerId","FullName","Phone","IsPrimary","EmailConsent","PhoneConsent","ConsentUpdatedAtUtc")
            VALUES(gen_random_uuid(),{customer.Id},'Synthetic No Email','5550103',false,true,false,now())
            """));
        Assert.Equal("23514", consent.SqlState);
    }

    [Fact]
    public async Task CustomerVersionOutboxAndImmutableHistoryCommitTogether()
    {
        var cs = await fixture.Database("customers", false);
        await using (var migrate = PostgresFixture.Db(cs, "customers")) await SchemaMigrator.Apply(migrate);
        var customer = CustomerRuleTests.Valid();
        await using (var setup = PostgresFixture.Db(cs, "customers")) { setup.Customers.Add(customer); await setup.SaveChangesAsync(); }
        await using var first = PostgresFixture.Db(cs, "customers"); await using var second = PostgresFixture.Db(cs, "customers");
        var a = await first.Customers.SingleAsync(); var b = await second.Customers.SingleAsync();
        foreach (var pair in new[] { (Db: first, Entity: a), (Db: second, Entity: b) })
        {
            pair.Entity.DisplayName = "Synthetic Changed"; pair.Entity.Version++;
            var audit = EventFactory.Create(null, "customers", "CustomerUpdated.v1", Guid.Empty, new { customerId = customer.Id, teamId = "north", version = 2 }, 2, DateTimeOffset.UtcNow);
            pair.Db.Enqueue(audit); pair.Db.CustomerChanges.Add(new() { Id = audit.EventId, CustomerId = customer.Id, Version = 2, Action = audit.EventType, ActorId = "system", ActorRole = "System", CorrelationId = audit.CorrelationId, OccurredAtUtc = audit.OccurredAtUtc });
        }
        await first.SaveChangesAsync();
        var rejected = await Assert.ThrowsAnyAsync<DbUpdateException>(() => second.SaveChangesAsync());
        Assert.True(rejected is DbUpdateConcurrencyException || rejected.InnerException is PostgresException { SqlState: "23505" });
        await using var inspect = PostgresFixture.Db(cs, "customers");
        Assert.Single(await inspect.Outbox.ToListAsync()); Assert.Single(await inspect.CustomerChanges.ToListAsync());
        Assert.Equal(2, (await inspect.Customers.SingleAsync()).Version);
        await Assert.ThrowsAsync<PostgresException>(() => inspect.Database.ExecuteSqlRawAsync("DELETE FROM customer_changes"));
    }

    [Fact]
    public async Task WorkOrderUpgradePreservesHistoricalSnapshotsAndRejectsHalfReferences()
    {
        var cs = await fixture.Database("work-orders", false);
        // Install the existing migration prefix, insert a pre-registry record, then
        // apply the actual immutable full migration stream as a normal upgrade.
        await using var db = PostgresFixture.Db(cs, "work-orders");
        var assembly = typeof(SchemaMigrator).Assembly;
        await db.Database.ExecuteSqlRawAsync("CREATE TABLE fieldops_schema_migrations(migration_id text PRIMARY KEY,sha256 text NOT NULL,applied_at_utc timestamptz NOT NULL DEFAULT now())");
        foreach (var suffix in new[] { "001_initial.sql", "002_data_integrity.sql" })
        {
            using var reader = new StreamReader(assembly.GetManifestResourceStream("work-orders." + suffix)!);
            var sql = SchemaMigrator.Normalize(await reader.ReadToEndAsync()); await db.Database.ExecuteSqlRawAsync(sql);
            var digest = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(sql)));
            await db.Database.ExecuteSqlInterpolatedAsync($"INSERT INTO fieldops_schema_migrations(migration_id,sha256) VALUES({"work-orders." + suffix},{digest})");
        }
        var id = Guid.NewGuid();
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO work_orders("Id","Number","Title","CustomerName","SiteAddress","ServiceCategory","Priority","Status","TeamId","CreatedAtUtc","Version")
            VALUES({id},'WO-LEGACY','Synthetic Legacy Order','Original Customer Snapshot','Original Address Snapshot','HVAC','Normal','Created','north',now(),1)
            """);
        await SchemaMigrator.Apply(db); await SchemaMigrator.Apply(db);
        var historical = await db.WorkOrders.SingleAsync();
        Assert.Equal("Original Customer Snapshot", historical.CustomerName); Assert.Equal("Original Address Snapshot", historical.SiteAddress);
        Assert.Null(historical.CustomerId); Assert.Null(historical.CustomerVersion); Assert.Contains("Pre-registry", historical.UnregisteredCustomerReason);
        var half = await Assert.ThrowsAsync<PostgresException>(() => db.Database.ExecuteSqlInterpolatedAsync($"UPDATE work_orders SET \"CustomerId\"={Guid.NewGuid()} WHERE \"Id\"={id}"));
        Assert.Equal("23514", half.SqlState);
        var missingException = await Assert.ThrowsAsync<PostgresException>(() => db.Database.ExecuteSqlInterpolatedAsync($"UPDATE work_orders SET \"UnregisteredCustomerReason\"=NULL WHERE \"Id\"={id}"));
        Assert.Equal("23514", missingException.SqlState);
    }
}
