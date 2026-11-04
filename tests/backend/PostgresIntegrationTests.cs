using FieldOps.Core;
using FieldOps.ServiceHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Npgsql;
using Testcontainers.PostgreSql;
using Xunit;

namespace FieldOps.Tests;

public sealed class PostgresFixture : IAsyncLifetime
{
    public PostgreSqlContainer Container { get; } = new PostgreSqlBuilder().WithImage("postgres:18-alpine").WithDatabase("fieldops_tests").WithUsername("test_owner").WithPassword(Guid.NewGuid().ToString("N")).Build();
    public Task InitializeAsync() => Container.StartAsync();
    public Task DisposeAsync() => Container.DisposeAsync().AsTask();
    public async Task<string> Database(string role, bool initialize = true)
    {
        var name = "test_" + Guid.NewGuid().ToString("N");
        await using var connection = new NpgsqlConnection(Container.GetConnectionString()); await connection.OpenAsync();
        await using var command = new NpgsqlCommand($"CREATE DATABASE {name}", connection); await command.ExecuteNonQueryAsync();
        var cs = new NpgsqlConnectionStringBuilder(Container.GetConnectionString()) { Database = name }.ConnectionString;
        await using var db = Db(cs, role); if (initialize) await db.Database.EnsureCreatedAsync(); return cs;
    }
    public static ServiceDb Db(string cs, string role) => new(new DbContextOptionsBuilder<ServiceDb>().UseNpgsql(cs).ReplaceService<IModelCacheKeyFactory, ServiceModelKeyFactory>().Options, new(role));
}

[CollectionDefinition("PostgreSQL")]
public sealed class PostgresCollection : ICollectionFixture<PostgresFixture>;

[Collection("PostgreSQL")]
[Trait("Category", "Integration")]
public sealed class PostgresIntegrationTests(PostgresFixture fixture)
{
    [Fact]
    public async Task VersionedMigrationsApplyOnceAndRecordImmutableChecksums()
    {
        var cs = await fixture.Database("reporting", false);
        await using var db = PostgresFixture.Db(cs, "reporting");
        await SchemaMigrator.Apply(db); await SchemaMigrator.Apply(db);
        Assert.Equal(3, await db.Database.SqlQueryRaw<int>("SELECT count(*)::integer AS \"Value\" FROM fieldops_schema_migrations").SingleAsync());
        await db.Database.ExecuteSqlRawAsync("UPDATE fieldops_schema_migrations SET sha256='changed' WHERE migration_id LIKE '%001_initial%'");
        await Assert.ThrowsAsync<InvalidOperationException>(() => SchemaMigrator.Apply(db));
    }

    [Fact]
    public async Task RuntimeRoleCanAppendEvidenceButCannotRewriteItOrChangeSchema()
    {
        var cs = await fixture.Database("reporting", false);
        var role = "runtime_" + Guid.NewGuid().ToString("N"); var password = Guid.NewGuid().ToString("N");
        await using (var administrator = new NpgsqlConnection(fixture.Container.GetConnectionString()))
        {
            await administrator.OpenAsync();
            await using var create = new NpgsqlCommand($"CREATE ROLE {role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD '{password}'", administrator);
            await create.ExecuteNonQueryAsync();
        }
        await using (var owner = PostgresFixture.Db(cs, "reporting")) await SchemaMigrator.Apply(owner, role);
        var runtimeConnection = new NpgsqlConnectionStringBuilder(cs) { Username = role, Password = password }.ConnectionString;
        await using var runtime = PostgresFixture.Db(runtimeConnection, "reporting");
        var now = DateTimeOffset.UtcNow;
        var original = EventFactory.Create(null, "work-orders", "WorkOrderCreated.v1", Guid.NewGuid(), new { teamId = "north" }, 1, now);
        runtime.Events.Add(FaultEvidence.Store(original, now));
        runtime.DeliveryAttempts.Add(new DeliveryAttempt { EventId = original.EventId, Attempt = 1, Status = "Processed", OccurredAtUtc = now, ReceivedAtUtc = now, ProcessedAtUtc = now });
        runtime.ReplayProjections.Add(new ReplayProjection { WorkOrderId = original.WorkOrderId, TeamId = "north", StateJson = "{}", EventCount = 1, UpdatedAtUtc = now });
        await runtime.SaveChangesAsync();
        Assert.Equal(1, await runtime.Events.AsNoTracking().CountAsync());
        var projection = await runtime.ReplayProjections.SingleAsync(); projection.EventCount = 2; await runtime.SaveChangesAsync();
        foreach (var forbidden in new[]
        {
            "UPDATE audit_events SET \"Body\"='tampered'", "DELETE FROM audit_events", "TRUNCATE audit_events",
            "UPDATE delivery_attempts SET \"Status\"='Processed'", "DELETE FROM delivery_attempts", "TRUNCATE delivery_attempts",
            "ALTER TABLE audit_events DISABLE TRIGGER ALL", "CREATE TABLE public.unauthorized_schema_change(id integer)",
            "UPDATE fieldops_schema_migrations SET sha256='tampered'"
        })
        {
            var rejected = await Assert.ThrowsAsync<PostgresException>(() => runtime.Database.ExecuteSqlRawAsync(forbidden));
            Assert.Equal("42501", rejected.SqlState);
        }
    }
    [Fact]
    public async Task DatabaseExclusionConstraintPreventsConcurrentDoubleBooking()
    {
        var cs = await fixture.Database("scheduling");
        await using (var setup = PostgresFixture.Db(cs, "scheduling"))
            await setup.Database.ExecuteSqlRawAsync("CREATE EXTENSION btree_gist; ALTER TABLE bookings ADD CONSTRAINT no_overlapping_bookings EXCLUDE USING gist (\"TechnicianId\" WITH =, tstzrange(\"StartUtc\", \"EndUtc\", '[)') WITH &&) WHERE (\"Status\"='Confirmed');");
        var start = DateTimeOffset.UtcNow;
        async Task<bool> Book()
        {
            await using var db = PostgresFixture.Db(cs, "scheduling");
            db.Bookings.Add(new Booking { WorkOrderId = Guid.NewGuid(), TechnicianId = "tech-01", StartUtc = start, EndUtc = start.AddHours(1) });
            try { await db.SaveChangesAsync(); return true; } catch (DbUpdateException ex) when (ex.InnerException is PostgresException { SqlState: "23P01" }) { return false; }
        }
        var outcomes = await Task.WhenAll(Book(), Book());
        Assert.Single(outcomes, x => x);
        await using var inspect = PostgresFixture.Db(cs, "scheduling"); Assert.Equal(1, await inspect.Bookings.CountAsync());
    }

    [Fact]
    public async Task WorkflowVersionAndOutboxCommitAtomicallyUnderConcurrentSubmission()
    {
        var cs = await fixture.Database("workflows");
        var now = DateTimeOffset.UtcNow; var policy = new SlaPolicy();
        var workflow = WorkflowEngine.Start(Guid.NewGuid(), "tech-01", "north", now, policy);
        await using (var setup = PostgresFixture.Db(cs, "workflows")) { setup.Workflows.Add(workflow); await setup.SaveChangesAsync(); }
        await using var first = PostgresFixture.Db(cs, "workflows"); await using var second = PostgresFixture.Db(cs, "workflows");
        var a = await first.Workflows.SingleAsync(); var b = await second.Workflows.SingleAsync();
        var answers = new Dictionary<string, string> { ["assignment"] = "Accept", ["readiness"] = "Ready" };
        WorkflowEngine.Submit(a, 1, answers, now.AddMinutes(1), policy); WorkflowEngine.Submit(b, 1, answers, now.AddMinutes(2), policy);
        first.Enqueue(EventFactory.Create(null, "workflows", "StageCompleted.v1", workflow.WorkOrderId, new { teamId = "north" }, a.Version, now, a.Id));
        second.Enqueue(EventFactory.Create(null, "workflows", "StageCompleted.v1", workflow.WorkOrderId, new { teamId = "north" }, b.Version, now, b.Id));
        await first.SaveChangesAsync();
        await Assert.ThrowsAsync<DbUpdateConcurrencyException>(() => second.SaveChangesAsync());
        await using var inspect = PostgresFixture.Db(cs, "workflows");
        Assert.Equal(1, await inspect.Outbox.CountAsync()); Assert.Equal(2, (await inspect.Workflows.SingleAsync()).Version);
    }

    [Fact]
    public async Task AppendOnlyDatabaseTriggerRejectsOrdinarySqlMutation()
    {
        var cs = await fixture.Database("reporting");
        await using var db = PostgresFixture.Db(cs, "reporting");
        await db.Database.ExecuteSqlRawAsync("CREATE FUNCTION reject_mutation() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'immutable'; END; $$ LANGUAGE plpgsql; CREATE TRIGGER guard BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_mutation();");
        db.Events.Add(new StoredEvent { EventId = Guid.NewGuid(), Body = "{}", TeamId = "north", OccurredAtUtc = DateTimeOffset.UtcNow, ReceivedAtUtc = DateTimeOffset.UtcNow, ProcessedAtUtc = DateTimeOffset.UtcNow }); await db.SaveChangesAsync();
        await Assert.ThrowsAsync<PostgresException>(() => db.Database.ExecuteSqlRawAsync("UPDATE audit_events SET \"TeamId\"='south'"));
        await Assert.ThrowsAsync<PostgresException>(() => db.Database.ExecuteSqlRawAsync("DELETE FROM audit_events"));
        Assert.Equal("north", (await db.Events.AsNoTracking().SingleAsync()).TeamId);
    }

    [Fact]
    public async Task EvidenceBytesAndIntegrityHashSurvivePostgreSqlRoundTrip()
    {
        var cs = await fixture.Database("reporting");
        var now = DateTimeOffset.UtcNow;
        var audit = EventFactory.Create(null, "workflows", "StageStarted.v1", Guid.NewGuid(), new { teamId = "north", stageName = "Diagnosis", detail = "Unicode evidence: \u00e9" }, 2, now);
        var body = Json.Write(audit);
        var hash = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(body)));
        await using (var write = PostgresFixture.Db(cs, "reporting")) { write.Events.Add(new StoredEvent { EventId = audit.EventId, WorkOrderId = audit.WorkOrderId, Body = body, IntegrityHash = hash, OccurredAtUtc = now, ReceivedAtUtc = now, ProcessedAtUtc = now }); await write.SaveChangesAsync(); }
        await using var read = PostgresFixture.Db(cs, "reporting"); var stored = await read.Events.SingleAsync();
        Assert.Equal(body, stored.Body);
        Assert.Equal(hash, Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(stored.Body))));
    }

    [Fact]
    public async Task FaultMonitorPreservesMissingOriginalOnceAndDeduplicatesTerminalEvidence()
    {
        var cs = await fixture.Database("reporting");
        var now = DateTimeOffset.FromUnixTimeMilliseconds(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
        var original = EventFactory.Create(null, "workflows", "StageStarted.v1", Guid.NewGuid(),
            new { teamId = "north", technicianId = "tech-01", stageName = "Diagnosis" }, 2, now, Guid.NewGuid(), Guid.NewGuid());
        var originalBody = Json.Write(original);
        var observation = new FaultObservation(Guid.NewGuid(), original.EventId, original, now.AddSeconds(5), "notifications", ["System.InvalidOperationException"]);
        await using (var write = PostgresFixture.Db(cs, "reporting"))
        {
            Assert.True(await FaultEvidence.Record(write, observation, now.AddSeconds(10)));
            Assert.False(await FaultEvidence.Record(write, observation, now.AddSeconds(20)));
        }
        await using var inspect = PostgresFixture.Db(cs, "reporting");
        var retained = await inspect.Events.ToListAsync();
        Assert.Equal(3, retained.Count);
        var business = Assert.Single(retained, e => e.EventId == original.EventId);
        Assert.Equal(originalBody, business.Body);
        Assert.Equal(original.OccurredAtUtc, business.OccurredAtUtc);
        Assert.Equal(now.AddSeconds(10), business.ReceivedAtUtc);
        Assert.Equal(Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(originalBody))), business.IntegrityHash);
        var attempt = Assert.Single(await inspect.DeliveryAttempts.ToListAsync());
        Assert.Equal("notifications", attempt.ConsumerService); Assert.Equal("DeadLettered", attempt.Status); Assert.Null(attempt.Attempt);
        Assert.Equal(observation.FaultId, attempt.FaultId);
        Assert.Equal(3, (await inspect.ReplayProjections.SingleAsync()).EventCount);
        Assert.Equal(new[] { "StageStarted.v1", "MessageProcessingFailed.v1", "DeadLetterRecorded.v1" }, ReplayEngine.Order(retained.Select(e => Json.Read<AuditEvent>(e.Body))).Select(e => e.Event.EventType));
    }

    [Fact]
    public async Task AdditionalFaultsAppendObservationsWithoutRewritingExistingBusinessEvidence()
    {
        var cs = await fixture.Database("reporting"); var now = DateTimeOffset.FromUnixTimeMilliseconds(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
        var original = EventFactory.Create(null, "work-orders", "WorkOrderCreated.v1", Guid.NewGuid(), new { teamId = "north" }, 1, now);
        var priorArrival = now.AddSeconds(1);
        await using (var setup = PostgresFixture.Db(cs, "reporting")) { setup.Events.Add(FaultEvidence.Store(original, priorArrival)); await setup.SaveChangesAsync(); }
        await using (var write = PostgresFixture.Db(cs, "reporting"))
        {
            var fault = new FaultObservation(Guid.NewGuid(), original.EventId, original, now.AddSeconds(5), "notifications", ["System.Exception"]);
            await FaultEvidence.Record(write, fault, now.AddSeconds(10));
            await FaultEvidence.Record(write, fault with { FaultId = Guid.NewGuid(), ConsumerService = "work-orders" }, now.AddSeconds(15));
        }
        await using var inspect = PostgresFixture.Db(cs, "reporting");
        Assert.Equal(5, await inspect.Events.CountAsync());
        Assert.Equal(priorArrival, (await inspect.Events.SingleAsync(e => e.EventId == original.EventId)).ReceivedAtUtc);
        Assert.Equal(2, await inspect.DeliveryAttempts.CountAsync());
        Assert.Equal(2, await inspect.Inbox.CountAsync());
    }

    [Fact]
    public async Task InboxUniquenessAndReceiptUniquenessPreventDuplicateSideEffects()
    {
        var cs = await fixture.Database("notifications");
        await using var first = PostgresFixture.Db(cs, "notifications");
        first.Inbox.Add(new InboxMessage { Id = "notifications:stable-event", ProcessedAtUtc = DateTimeOffset.UtcNow });
        first.Notifications.Add(new Notification { EventId = Guid.NewGuid(), TeamId = "north", CreatedAtUtc = DateTimeOffset.UtcNow }); await first.SaveChangesAsync();
        await using var duplicate = PostgresFixture.Db(cs, "notifications");
        duplicate.Inbox.Add(new InboxMessage { Id = "notifications:stable-event", ProcessedAtUtc = DateTimeOffset.UtcNow });
        duplicate.Notifications.Add(new Notification { EventId = Guid.NewGuid(), TeamId = "north", CreatedAtUtc = DateTimeOffset.UtcNow });
        await Assert.ThrowsAsync<DbUpdateException>(() => duplicate.SaveChangesAsync());
        Assert.Equal(1, await first.Notifications.CountAsync());
    }
}
