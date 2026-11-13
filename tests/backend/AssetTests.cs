using FieldOps.Core;
using FieldOps.ServiceHost;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Xunit;

namespace FieldOps.Tests;

public sealed class AssetRuleTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 5, 12, 0, 0, TimeSpan.Zero);

    public static Asset Valid()
    {
        var asset = new Asset
        {
            Name = "Synthetic Rooftop Unit", AssetType = "HVAC", Manufacturer = "Northwind", Model = "RTU-24",
            SerialNumber = "SN-0001", Criticality = "High", TeamId = "north", CustomerId = Guid.NewGuid(),
            ServiceLocationId = Guid.NewGuid(), CustomerVersion = 1, InstalledAtUtc = Now.AddYears(-2),
            WarrantyEndUtc = Now.AddYears(1), CreatedAtUtc = Now, UpdatedAtUtc = Now
        };
        asset.LocationHistory.Add(new AssetLocationChange
        {
            AssetId = asset.Id, CustomerId = asset.CustomerId, ServiceLocationId = asset.ServiceLocationId,
            CustomerVersion = 1, EffectiveFromUtc = Now, Reason = "Registered"
        });
        return asset;
    }

    [Fact]
    public void WarrantyAndInstallationInvariantsAreEnforced()
    {
        var asset = Valid();
        asset.WarrantyEndUtc = asset.InstalledAtUtc.AddDays(-1);
        Assert.Throws<DomainException>(() => AssetRules.Validate(asset, Now));
        asset.WarrantyEndUtc = Now.AddYears(1);
        asset.InstalledAtUtc = Now.AddDays(2);
        Assert.Throws<DomainException>(() => AssetRules.Validate(asset, Now));
    }

    [Fact]
    public void LocationHistoryMustMatchCurrentIdentity()
    {
        var asset = Valid();
        asset.ServiceLocationId = Guid.NewGuid();
        Assert.Throws<DomainException>(() => AssetRules.Validate(asset, Now));
        asset.LocationHistory.Clear();
        Assert.Throws<DomainException>(() => AssetRules.Validate(asset, Now));
    }

    [Theory]
    [InlineData("SN 100")]
    [InlineData("SN#100")]
    [InlineData("x")]
    public void SerialNumbersRejectUnsupportedCharacters(string serial)
    {
        var asset = Valid(); asset.SerialNumber = serial;
        Assert.Throws<DomainException>(() => AssetRules.Validate(asset, Now));
    }

    [Fact]
    public void SelfParentAndUnknownClassificationsAreRejected()
    {
        var asset = Valid(); asset.ParentAssetId = asset.Id;
        Assert.Throws<DomainException>(() => AssetRules.Validate(asset, Now));
        asset.ParentAssetId = null; asset.AssetType = "Elevator";
        Assert.Throws<DomainException>(() => AssetRules.Validate(asset, Now));
    }
}

[Collection("PostgreSQL")]
[Trait("Category", "Integration")]
public sealed class AssetPostgresTests(PostgresFixture fixture)
{
    private static Asset NewAsset() => AssetRuleTests.Valid();

    [Fact]
    public async Task MigrationEnforcesLocalForeignKeysSerialUniquenessAndAppendOnlyHistory()
    {
        var cs = await fixture.Database("assets", false);
        await using var db = PostgresFixture.Db(cs, "assets");
        await SchemaMigrator.Apply(db);
        await SchemaMigrator.Apply(db);
        var asset = NewAsset();
        db.Assets.Add(asset);
        await db.SaveChangesAsync();

        var foreignKeys = await db.Database.SqlQueryRaw<int>("SELECT count(*)::integer AS \"Value\" FROM pg_constraint WHERE contype='f' AND connamespace='public'::regnamespace").SingleAsync();
        Assert.Equal(3, foreignKeys);

        var duplicate = await Assert.ThrowsAsync<PostgresException>(() => db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO assets("Id","CustomerId","ServiceLocationId","CustomerVersion","TeamId","Name","AssetType","Manufacturer","Model","SerialNumber","Criticality","Status","InstalledAtUtc","Version","CreatedAtUtc","UpdatedAtUtc")
            VALUES(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),1,'north','Synthetic Duplicate','HVAC','Northwind','RTU-24','sn-0001','High','Active',now(),1,now(),now())
            """));
        Assert.Equal("23505", duplicate.SqlState);

        var orphan = await Assert.ThrowsAsync<PostgresException>(() => db.Database.ExecuteSqlRawAsync("""
            INSERT INTO asset_location_history("Id","AssetId","CustomerId","ServiceLocationId","CustomerVersion","EffectiveFromUtc","Reason")
            VALUES(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),1,now(),'Registered')
            """));
        Assert.Equal("23503", orphan.SqlState);

        await Assert.ThrowsAsync<PostgresException>(() => db.Database.ExecuteSqlRawAsync("DELETE FROM asset_location_history"));
        db.AssetChanges.Add(new AssetChange
        {
            AssetId = asset.Id, Version = 1, Action = "AssetRegistered.v1", ActorId = "system",
            ActorRole = "System", CorrelationId = "synthetic", OccurredAtUtc = DateTimeOffset.UtcNow
        });
        await db.SaveChangesAsync();
        await Assert.ThrowsAsync<PostgresException>(() => db.Database.ExecuteSqlRawAsync("DELETE FROM asset_changes"));
        await Assert.ThrowsAsync<PostgresException>(() => db.Database.ExecuteSqlRawAsync("TRUNCATE asset_changes"));
    }

    [Fact]
    public async Task AssetVersionOutboxAndHistoryCommitTogetherAndRejectStaleWriters()
    {
        var cs = await fixture.Database("assets", false);
        await using (var migrate = PostgresFixture.Db(cs, "assets")) await SchemaMigrator.Apply(migrate);
        var asset = NewAsset();
        await using (var setup = PostgresFixture.Db(cs, "assets")) { setup.Assets.Add(asset); await setup.SaveChangesAsync(); }

        await using var first = PostgresFixture.Db(cs, "assets");
        await using var second = PostgresFixture.Db(cs, "assets");
        var a = await first.Assets.Include(x => x.LocationHistory).SingleAsync();
        var b = await second.Assets.Include(x => x.LocationHistory).SingleAsync();
        foreach (var pair in new[] { (Db: first, Entity: a), (Db: second, Entity: b) })
        {
            pair.Entity.Name = "Synthetic Changed"; pair.Entity.Version++;
            var audit = EventFactory.Create(null, "assets", "AssetUpdated.v1", Guid.Empty, new { assetId = asset.Id, teamId = "north", version = 2 }, 2, DateTimeOffset.UtcNow);
            pair.Db.Enqueue(audit);
            pair.Db.AssetChanges.Add(new AssetChange
            {
                Id = audit.EventId, AssetId = asset.Id, Version = 2, Action = audit.EventType, ActorId = "system",
                ActorRole = "System", CorrelationId = audit.CorrelationId, OccurredAtUtc = DateTimeOffset.UtcNow
            });
        }
        await first.SaveChangesAsync();
        var rejected = await Assert.ThrowsAnyAsync<DbUpdateException>(() => second.SaveChangesAsync());
        Assert.True(rejected is DbUpdateConcurrencyException || rejected.InnerException is PostgresException { SqlState: "23505" });

        await using var inspect = PostgresFixture.Db(cs, "assets");
        Assert.Single(await inspect.Outbox.ToListAsync());
        Assert.Single(await inspect.AssetChanges.ToListAsync());
        Assert.Equal(2, (await inspect.Assets.SingleAsync()).Version);
    }

    [Fact]
    public async Task HierarchyForeignKeyPreventsMissingParentsAndAllowsNestedEquipment()
    {
        var cs = await fixture.Database("assets", false);
        await using var db = PostgresFixture.Db(cs, "assets");
        await SchemaMigrator.Apply(db);
        var parent = NewAsset(); var child = NewAsset();
        child.CustomerId = parent.CustomerId; child.ServiceLocationId = parent.ServiceLocationId; child.SerialNumber = "SN-0002";
        child.LocationHistory[0].CustomerId = parent.CustomerId; child.LocationHistory[0].ServiceLocationId = parent.ServiceLocationId;
        child.ParentAssetId = parent.Id;
        db.Assets.AddRange(parent, child);
        await db.SaveChangesAsync();
        Assert.Equal(parent.Id, (await db.Assets.SingleAsync(x => x.Id == child.Id)).ParentAssetId);

        var missing = await Assert.ThrowsAsync<PostgresException>(() => db.Database.ExecuteSqlRawAsync("""
            INSERT INTO assets("Id","CustomerId","ServiceLocationId","CustomerVersion","ParentAssetId","TeamId","Name","AssetType","Manufacturer","Model","SerialNumber","Criticality","Status","InstalledAtUtc","Version","CreatedAtUtc","UpdatedAtUtc")
            VALUES(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),1,gen_random_uuid(),'north','Synthetic Orphan','HVAC','Northwind','RTU-24','SN-0003','High','Active',now(),1,now(),now())
            """));
        Assert.Equal("23503", missing.SqlState);
    }
}
