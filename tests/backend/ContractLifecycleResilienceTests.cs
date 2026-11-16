using FieldOps.Core;
using FieldOps.ServiceHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Xunit;

namespace FieldOps.Tests;

[Collection("PostgreSQL")]
[Trait("Category", "Integration")]
public sealed class ContractLifecycleResilienceTests(PostgresFixture fixture)
{
    private static readonly DateTimeOffset Now = new(2026, 1, 15, 12, 0, 0, TimeSpan.Zero);
    private static readonly ContractLifecyclePolicy Policy = new(true, 30, 1);

    [Fact]
    public async Task FailedAgreementRollsBackAndDoesNotStarveLaterAgreementsOrDuplicateHealthyWork()
    {
        var (connection, poison, healthy) = await Seed();
        var logger = new CaptureLogger();
        await using (var db = PostgresFixture.Db(connection, "customers"))
        {
            var result = await ContractLifecycleProcessor.Run(db, new FixedClock(Now), Policy, logger: logger);
            Assert.Equal(new ContractLifecycleSweep(0, 1, 1, 1), result);
        }

        string committedHealthy;
        await using (var db = PostgresFixture.Db(connection, "customers"))
        {
            // Expire mutates the poison before MarkMissed encounters the invalid
            // zone. Neither its state change nor its staged audit/outbox may leak.
            var unchanged = await db.Contracts.SingleAsync(x => x.Id == poison.Id);
            Assert.Equal("Suspended", unchanged.Status);
            Assert.Equal(poison.Version, unchanged.Version);
            Assert.Equal(poison.UpdatedAtUtc, unchanged.UpdatedAtUtc);
            Assert.Empty(await db.ContractEvents.Where(x => x.ContractId == poison.Id).ToArrayAsync());

            var current = await Load(db, healthy.Id);
            Assert.Equal(2, current.Visits.Count);
            Assert.Equal("Missed", Assert.Single(current.Visits, x => x.DueDate == new DateOnly(2026, 1, 1)).Status);
            Assert.Equal("Pending", Assert.Single(current.Visits, x => x.DueDate == new DateOnly(2026, 1, 31)).Status);
            Assert.Equal(new DateOnly(2026, 2, 28), Assert.Single(current.Plans).NextDueDate);
            Assert.Equal(2, await db.ContractEvents.CountAsync());
            Assert.All(await db.ContractEvents.ToArrayAsync(), x => Assert.Equal(healthy.Id, x.ContractId));
            Assert.Equal(2, await db.Outbox.CountAsync());
            Assert.All(await db.Outbox.ToArrayAsync(), x =>
                Assert.Equal(healthy.Id, Json.Read<AuditEvent>(x.Body).EventPayload.GetProperty("contractId").GetGuid()));
            committedHealthy = Json.Write(current);
        }

        // A later sweep retries the failed owner, while committed healthy work
        // remains untouched and gets no repeated audit or event delivery request.
        await using (var db = PostgresFixture.Db(connection, "customers"))
            Assert.Equal(new ContractLifecycleSweep(0, 0, 0, 1),
                await ContractLifecycleProcessor.Run(db, new FixedClock(Now.AddMinutes(1)), Policy, logger: logger));
        await using (var db = PostgresFixture.Db(connection, "customers"))
        {
            Assert.Equal(committedHealthy, Json.Write(await Load(db, healthy.Id)));
            Assert.Equal(2, await db.ContractEvents.CountAsync());
            Assert.Equal(2, await db.Outbox.CountAsync());
        }

        Assert.Equal(2, logger.Errors.Count);
        Assert.All(logger.Errors, failure =>
        {
            Assert.IsType<TimeZoneNotFoundException>(failure.Exception);
            Assert.Contains(poison.Id.ToString(), failure.Message);
            Assert.Contains(poison.TeamId, failure.Message);
            Assert.Contains("rolled back", failure.Message);
        });
    }

    [Fact]
    public async Task CancellationInsideAnAgreementPropagatesAndDoesNotCountAsAnOwnerFailure()
    {
        var (connection, poison, healthy) = await Seed();
        using var cancellation = new CancellationTokenSource();
        var logger = new CaptureLogger();
        await using (var db = PostgresFixture.Db(connection, "customers"))
        {
            // This clock is reached only after a real transaction and advisory
            // lock have been acquired for the first agreement.
            var clock = new CancellingClock(cancellation);
            await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
                ContractLifecycleProcessor.Run(db, clock, Policy, cancellation.Token, logger));
            Assert.True(cancellation.IsCancellationRequested);
        }
        await using var verify = PostgresFixture.Db(connection, "customers");
        Assert.Equal(poison.Version, (await verify.Contracts.SingleAsync(x => x.Id == poison.Id)).Version);
        Assert.Equal(healthy.Version, (await verify.Contracts.SingleAsync(x => x.Id == healthy.Id)).Version);
        Assert.Single(await verify.MaintenanceVisits.ToArrayAsync());
        Assert.Empty(await verify.ContractEvents.ToArrayAsync());
        Assert.Empty(await verify.Outbox.ToArrayAsync());
        Assert.Empty(logger.Errors);
    }

    private async Task<(string Connection, MaintenanceContract Poison, MaintenanceContract Healthy)> Seed()
    {
        var connection = await fixture.Database("customers", false);
        await using var db = PostgresFixture.Db(connection, "customers");
        await SchemaMigrator.Apply(db);
        var poison = ContractLifecycleTests.Contract();
        poison.TeamId = "aa-poison"; // Sorted ahead of the healthy agreement.
        poison.Status = "Suspended";
        poison.ExpiresAtUtc = Now;
        poison.TimeZoneId = "Not/A-Time-Zone";
        var healthy = ContractLifecycleTests.Contract();
        healthy.TeamId = "zz-healthy";
        healthy.Plans.Add(ContractLifecycleTests.Plan(healthy, new(2026, 1, 31)));
        healthy.Visits.Add(ContractLifecycleTests.Visit(healthy, new(2026, 1, 1)));
        foreach (var contract in new[] { poison, healthy })
        {
            db.Customers.Add(new Customer
            {
                Id = contract.CustomerId, TeamId = contract.TeamId, DisplayName = "Lifecycle resilience fixture",
                Status = "Active", CreatedAtUtc = Now, UpdatedAtUtc = Now
            });
            db.Contracts.Add(contract);
        }
        // The invalid time zone models persisted bad/obsolete configuration. It
        // intentionally reaches the worker through real rows, not a fake DbSet.
        await db.SaveChangesAsync();
        return (connection, poison, healthy);
    }

    private static Task<MaintenanceContract> Load(ServiceDb db, Guid id) => db.Contracts
        .Include(x => x.Plans).Include(x => x.Visits).AsSplitQuery().SingleAsync(x => x.Id == id);

    private sealed class FixedClock(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }

    private sealed class CancellingClock(CancellationTokenSource cancellation) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow()
        {
            cancellation.Cancel();
            throw new OperationCanceledException(cancellation.Token);
        }
    }

    private sealed class CaptureLogger : ILogger
    {
        public List<(Exception? Exception, string Message)> Errors { get; } = [];
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(LogLevel logLevel) => true;
        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception,
            Func<TState, Exception?, string> formatter)
        {
            if (logLevel == LogLevel.Error) Errors.Add((exception, formatter(state, exception)));
        }
    }
}
