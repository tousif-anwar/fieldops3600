using System.Security.Claims;
using FieldOps.Core;
using FieldOps.ServiceHost;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Npgsql;
using Xunit;

namespace FieldOps.Tests;

[Collection("PostgreSQL")]
[Trait("Category", "Integration")]
public sealed class ContractLifecyclePostgresTests(PostgresFixture fixture)
{
    private static readonly DateTimeOffset Now = new(2026, 1, 15, 12, 0, 0, TimeSpan.Zero);

    [Fact]
    public async Task FutureRenewalCanConfigureAPlanButCannotActivateBeforeItsEffectiveInstant()
    {
        var (connection, source) = await Seed();
        var starts = source.ExpiresAtUtc!.Value;
        Assert.True(starts > Now.AddDays(1));
        ContractRenewalView renewal;
        await using (var db = PostgresFixture.Db(connection, "customers"))
            renewal = Body<ContractRenewalView>(await ContractLifecycleApi.Renew(source.Id,
                new(Guid.NewGuid(), source.Version, starts, starts.AddYears(1), "Renewal plan agreed in advance"),
                db, Actor(), new FixedClock(Now), default));

        Guid lineId;
        await using (var db = PostgresFixture.Db(connection, "customers"))
            lineId = await db.ContractLines.Where(x => x.ContractId == renewal.RenewedContractId).Select(x => x.Id).SingleAsync();
        var remote = new RemoteServices(new NoRemote(), new ConfigurationBuilder().Build());
        var firstDue = DateOnly.FromDateTime(starts.UtcDateTime);
        ContractView planned;
        await using (var db = PostgresFixture.Db(connection, "customers"))
            planned = Body<ContractView>(await ContractApi.CreatePlan(new(Guid.NewGuid(), renewal.RenewedContractId,
                lineId, null, "Monthly", firstDue, firstDue.AddYears(1).AddDays(-1)),
                db, remote, Actor(), new FixedClock(Now), default));
        Assert.Equal("Draft", planned.Status);
        Assert.Equal(firstDue, Assert.Single(planned.Plans).NextDueDate);

        await using (var db = PostgresFixture.Db(connection, "customers"))
        {
            var failure = await Assert.ThrowsAsync<DomainException>(() => ContractApi.ChangeStatus(planned.Id,
                new(Guid.NewGuid(), planned.Id, planned.Version, "Active", "Attempted activation before its start"),
                db, Actor(), new FixedClock(starts.AddTicks(-1)), default));
            Assert.Equal(409, failure.Status);
        }
        await using (var db = PostgresFixture.Db(connection, "customers"))
        {
            var persisted = await db.Contracts.SingleAsync(x => x.Id == planned.Id);
            Assert.Equal("Draft", persisted.Status);
            Assert.Equal(planned.Version, persisted.Version);
            var active = Body<ContractView>(await ContractApi.ChangeStatus(planned.Id,
                new(Guid.NewGuid(), planned.Id, planned.Version, "Active", "Activate at the agreed effective instant"),
                db, Actor(), new FixedClock(starts), default));
            Assert.Equal("Active", active.Status);
            Assert.Equal(planned.Version + 1, active.Version);
        }
        await using var verify = PostgresFixture.Db(connection, "customers");
        var old = await verify.Contracts.SingleAsync(x => x.Id == source.Id);
        Assert.Equal(source.Version, old.Version);
        Assert.Equal(source.ExpiresAtUtc, old.ExpiresAtUtc);
        Assert.Single(await verify.MaintenancePlans.ToArrayAsync());
    }

    [Fact]
    public async Task RenewalRaceReplaysOneDraftAndPreservesOldTermsAndImmutableEvidence()
    {
        var (connection, source) = await Seed(contract =>
        {
            contract.Plans.Add(ContractLifecycleTests.Plan(contract, new(2026, 1, 31)));
            contract.Usage.Add(new ContractUsage
            {
                ContractId = contract.Id, ContractLineId = contract.Lines[0].Id,
                WorkOrderId = Guid.NewGuid(), VisitsUsed = 1, PartsCost = 12m, OccurredAtUtc = Now
            });
        });
        var request = new RenewContract(Guid.NewGuid(), source.Version, source.ExpiresAtUtc!.Value,
            source.ExpiresAtUtc.Value.AddYears(1), "Annual renewal accepted");
        async Task<ContractRenewalView> Execute()
        {
            await using var db = PostgresFixture.Db(connection, "customers");
            return Body<ContractRenewalView>(await ContractLifecycleApi.Renew(source.Id, request, db, Actor(), new FixedClock(Now), default));
        }
        var results = await Task.WhenAll(Execute(), Execute());
        Assert.Equal(results[0], results[1]);

        await using (var db = PostgresFixture.Db(connection, "customers"))
        {
            var old = await db.Contracts.Include(x => x.Lines).Include(x => x.Plans).Include(x => x.Usage).SingleAsync(x => x.Id == source.Id);
            var renewed = await db.Contracts.Include(x => x.Lines).Include(x => x.Plans).Include(x => x.Usage).Include(x => x.Visits)
                .SingleAsync(x => x.Id == results[0].RenewedContractId);
            Assert.Equal(source.Version, old.Version);
            Assert.Equal(source.EffectiveFromUtc, old.EffectiveFromUtc);
            Assert.Equal(source.ExpiresAtUtc, old.ExpiresAtUtc);
            Assert.Equal(source.Lines[0].Id, old.Lines[0].Id);
            Assert.Single(old.Usage);
            Assert.Single(old.Plans);
            Assert.Equal("Draft", renewed.Status);
            Assert.NotEqual(old.Lines[0].Id, renewed.Lines[0].Id);
            Assert.Empty(renewed.Plans);
            Assert.Empty(renewed.Usage);
            Assert.Empty(renewed.Visits);
            Assert.Equal(2, await db.Contracts.CountAsync());
            Assert.Equal(1, await db.ContractRenewals.CountAsync());
            Assert.Equal(1, await db.Receipts.CountAsync());
            Assert.Equal(2, await db.ContractEvents.CountAsync());
            Assert.Equal(2, await db.Outbox.CountAsync());
            var history = Assert.IsType<Ok<ContractRenewalView[]>>(await ContractLifecycleApi.History(source.Id, db, Actor(), default)).Value!;
            Assert.Equal(results[0], Assert.Single(history));
            var outbox = await db.Outbox.ToArrayAsync();
            Assert.All(outbox, row =>
            {
                var audit = Json.Read<AuditEvent>(row.Body);
                Assert.Equal("manager-01", audit.ActorId);
                Assert.Equal("OperationsManager", audit.ActorRole);
                Assert.Equal(Guid.Empty, audit.WorkOrderId);
                Assert.Equal("north", audit.EventPayload.GetProperty("teamId").GetString());
            });
        }

        await using (var db = PostgresFixture.Db(connection, "customers"))
        {
            var changed = await Assert.ThrowsAsync<DomainException>(() => ContractLifecycleApi.Renew(source.Id,
                request with { Reason = "Different request using the same operation" }, db, Actor(), new FixedClock(Now), default));
            Assert.Equal(409, changed.Status);
        }
        await using (var db = PostgresFixture.Db(connection, "customers"))
        {
            var duplicate = await Assert.ThrowsAsync<DomainException>(() => ContractLifecycleApi.Renew(source.Id,
                request with { OperationId = Guid.NewGuid() }, db, Actor(), new FixedClock(Now), default));
            Assert.Equal(409, duplicate.Status);
        }
        await using (var db = PostgresFixture.Db(connection, "customers"))
        {
            var forbidden = await Assert.ThrowsAsync<DomainException>(() => ContractLifecycleApi.Renew(source.Id,
                request, db, Actor("south"), new FixedClock(Now), default));
            Assert.Equal(404, forbidden.Status);
        }
        await using (var db = PostgresFixture.Db(connection, "customers"))
        {
            var evidence = await db.ContractRenewals.SingleAsync();
            evidence.Reason = "Forbidden rewrite";
            await Assert.ThrowsAsync<InvalidOperationException>(() => db.SaveChangesAsync());
            db.ChangeTracker.Clear();
            foreach (var sql in new[]
                     {
                         "UPDATE contract_renewals SET \"Reason\"='forbidden rewrite'",
                         "DELETE FROM contract_renewals", "TRUNCATE contract_renewals"
                     })
            {
                var forbidden = await Assert.ThrowsAsync<PostgresException>(() => db.Database.ExecuteSqlRawAsync(sql));
                Assert.Equal("P0001", forbidden.SqlState);
            }
        }
    }

    [Fact]
    public async Task ConcurrentWorkersExpireGenerateAndMissOnceWithSystemAuditAndOutbox()
    {
        var (connection, source) = await Seed(contract =>
        {
            var plan = ContractLifecycleTests.Plan(contract, new(2026, 1, 31));
            plan.EndsOn = new(2026, 3, 31);
            contract.Plans.Add(plan);
            contract.Visits.Add(ContractLifecycleTests.Visit(contract, new(2026, 1, 31)));
            var linked = ContractLifecycleTests.Visit(contract, new(2026, 1, 1));
            linked.WorkOrderId = Guid.NewGuid();
            contract.Visits.Add(linked);
        });
        Guid expiredId;
        await using (var db = PostgresFixture.Db(connection, "customers"))
        {
            var expired = ContractLifecycleTests.Contract();
            expired.CustomerId = source.CustomerId;
            expired.Status = "Suspended";
            expired.ExpiresAtUtc = Now;
            expired.Visits.Add(ContractLifecycleTests.Visit(expired, new(2026, 1, 12)));
            db.Contracts.Add(expired);
            await db.SaveChangesAsync();
            expiredId = expired.Id;
        }
        var policy = new ContractLifecyclePolicy(true, 90, 1);
        async Task<ContractLifecycleSweep> Sweep()
        {
            await using var db = PostgresFixture.Db(connection, "customers");
            return await ContractLifecycleProcessor.Run(db, new FixedClock(Now), policy);
        }
        var results = await Task.WhenAll(Sweep(), Sweep());
        Assert.Equal(1, results.Sum(x => x.Expired));
        Assert.Equal(2, results.Sum(x => x.Generated));
        Assert.Equal(1, results.Sum(x => x.Missed));

        DateTimeOffset priorUpdated;
        int priorVersion;
        await using (var db = PostgresFixture.Db(connection, "customers"))
        {
            var current = await db.Contracts.Include(x => x.Plans).Include(x => x.Visits).SingleAsync(x => x.Id == source.Id);
            var expired = await db.Contracts.Include(x => x.Visits).SingleAsync(x => x.Id == expiredId);
            Assert.Equal("Expired", expired.Status);
            Assert.Equal("Missed", Assert.Single(expired.Visits).Status);
            Assert.Equal(4, current.Visits.Count);
            Assert.Equal(1, current.Visits.Count(x => x.DueDate == new DateOnly(2026, 1, 31)));
            Assert.Equal("Pending", Assert.Single(current.Visits, x => x.WorkOrderId != null).Status);
            var plan = Assert.Single(current.Plans);
            Assert.False(plan.Active);
            Assert.Equal(31, plan.AnchorDay);
            Assert.Equal(new DateOnly(2026, 4, 30), plan.NextDueDate);
            Assert.Equal(3, await db.ContractEvents.CountAsync());
            Assert.Equal(3, await db.Outbox.CountAsync());
            Assert.All(await db.ContractEvents.ToArrayAsync(), x =>
            {
                Assert.Equal("system", x.ActorId);
                Assert.Equal("System", x.ActorRole);
            });
            Assert.All(await db.Outbox.ToArrayAsync(), x =>
            {
                var audit = Json.Read<AuditEvent>(x.Body);
                Assert.Equal("system", audit.ActorId);
                Assert.Equal("System", audit.ActorRole);
                Assert.Equal(Guid.Empty, audit.WorkOrderId);
            });
            priorUpdated = current.UpdatedAtUtc;
            priorVersion = current.Version;
        }
        await using (var db = PostgresFixture.Db(connection, "customers"))
            Assert.Equal(new ContractLifecycleSweep(0, 0, 0),
                await ContractLifecycleProcessor.Run(db, new FixedClock(Now.AddMinutes(1)), policy));
        await using (var db = PostgresFixture.Db(connection, "customers"))
        {
            var unchanged = await db.Contracts.SingleAsync(x => x.Id == source.Id);
            Assert.Equal(priorUpdated, unchanged.UpdatedAtUtc);
            Assert.Equal(priorVersion, unchanged.Version);
            Assert.Equal(3, await db.ContractEvents.CountAsync());
            Assert.Equal(3, await db.Outbox.CountAsync());
        }
    }

    [Fact]
    public async Task MissingGracePolicyAndDisabledWorkerLeavePendingVisitsUntouched()
    {
        var (connection, source) = await Seed(contract => contract.Visits.Add(ContractLifecycleTests.Visit(contract, new(2026, 1, 1))));
        await using (var db = PostgresFixture.Db(connection, "customers"))
        {
            Assert.Equal(new ContractLifecycleSweep(0, 0, 0),
                await ContractLifecycleProcessor.Run(db, new FixedClock(Now), new()));
            Assert.Equal(new ContractLifecycleSweep(0, 0, 0),
                await ContractLifecycleProcessor.Run(db, new FixedClock(Now), new(true, 30)));
        }
        await using var verify = PostgresFixture.Db(connection, "customers");
        Assert.Equal("Pending", (await verify.MaintenanceVisits.SingleAsync()).Status);
        Assert.Equal(source.Version, (await verify.Contracts.SingleAsync()).Version);
        Assert.Empty(await verify.ContractEvents.ToArrayAsync());
        Assert.Empty(await verify.Outbox.ToArrayAsync());
    }

    [Fact]
    public async Task AdditiveMigrationBackfillsExistingPlanAnchorAndRetainsNullableLegacyCompatibility()
    {
        var connection = await fixture.Database("customers", false);
        await using var db = PostgresFixture.Db(connection, "customers");
        var assembly = typeof(SchemaMigrator).Assembly;
        await db.Database.OpenConnectionAsync();
        async Task Apply(string name)
        {
            using var reader = new StreamReader(assembly.GetManifestResourceStream(name)!);
            await using var command = new NpgsqlCommand(await reader.ReadToEndAsync(), (NpgsqlConnection)db.Database.GetDbConnection());
            await command.ExecuteNonQueryAsync();
        }
        foreach (var name in assembly.GetManifestResourceNames().Where(x => x.StartsWith("customers.", StringComparison.Ordinal) &&
                     string.CompareOrdinal(x, "customers.004") < 0).Order(StringComparer.Ordinal))
            await Apply(name);
        var customer = Guid.NewGuid();
        var contract = Guid.NewGuid();
        var line = Guid.NewGuid();
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO customers("Id","DisplayName","CustomerType","PreferredChannel","TeamId","Status","Version","CreatedAtUtc","UpdatedAtUtc")
              VALUES({customer},'Legacy recurrence','Commercial','None','north','Active',1,{Now},{Now});
            INSERT INTO maintenance_contracts("Id","TeamId","CustomerId","Status","EffectiveFromUtc","TimeZoneId","CoversAllAssets","Version","CreatedAtUtc","UpdatedAtUtc")
              VALUES({contract},'north',{customer},'Active',{Now},'UTC',true,1,{Now},{Now});
            INSERT INTO contract_lines("Id","ContractId","ServiceType","LaborCovered","PartsCovered","IncludedVisits","PartsAllowance","Active")
              VALUES({line},{contract},'HVAC',true,false,0,0,true);
            INSERT INTO maintenance_plans("Id","ContractId","ContractLineId","Frequency","IntervalMonths","NextDueDate","Active","Version")
              VALUES(gen_random_uuid(),{contract},{line},'Monthly',1,DATE '2026-01-31',true,1);
            """);
        await Apply("customers.004_contract_lifecycle.sql");
        Assert.Equal(31, (await db.MaintenancePlans.SingleAsync()).AnchorDay);
        await db.Database.ExecuteSqlRawAsync("UPDATE maintenance_plans SET \"AnchorDay\"=NULL");
        var invalid = await Assert.ThrowsAsync<PostgresException>(() =>
            db.Database.ExecuteSqlRawAsync("UPDATE maintenance_plans SET \"AnchorDay\"=32"));
        Assert.Equal("23514", invalid.SqlState);
    }

    private async Task<(string Connection, MaintenanceContract Source)> Seed(Action<MaintenanceContract>? configure = null)
    {
        var connection = await fixture.Database("customers", false);
        await using var db = PostgresFixture.Db(connection, "customers");
        await SchemaMigrator.Apply(db);
        var contract = ContractLifecycleTests.Contract();
        db.Customers.Add(new Customer
        {
            Id = contract.CustomerId, TeamId = contract.TeamId, DisplayName = "Lifecycle test customer",
            Status = "Active", CreatedAtUtc = Now, UpdatedAtUtc = Now
        });
        configure?.Invoke(contract);
        db.Contracts.Add(contract);
        await db.SaveChangesAsync();
        return (connection, contract);
    }

    private static T Body<T>(IResult result) => Json.Read<T>(Assert.IsType<ContentHttpResult>(result).ResponseContent!);
    private static DefaultHttpContext Actor(string team = "north") => new()
    {
        User = new ClaimsPrincipal(new ClaimsIdentity([
            new Claim("sub", "manager-01"), new Claim("team_id", team), new Claim(ClaimTypes.Role, "OperationsManager")
        ], "test"))
    };
    private sealed class FixedClock(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }
    private sealed class NoRemote : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => throw new InvalidOperationException("No remote call expected in this test.");
    }
}
