using System.Net;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text.Json;
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
public sealed class MaintenanceVisitConsumerTests(PostgresFixture fixture)
{
    private static readonly DateTimeOffset Now = new(2026, 11, 16, 12, 0, 0, TimeSpan.Zero);

    [Fact]
    public async Task ConcurrentCompletionRepairsLostDispatchAndRecordsOneVisitWithoutInventingPartsCost()
    {
        var setup = await Seed();
        var completed = OwnerEvent(setup, "WorkOrderCompleted.v1");
        await Task.WhenAll(Process(setup, completed), Process(setup, completed));
        await Process(setup, completed with { EventId = Guid.NewGuid() });
        await using var db = PostgresFixture.Db(setup.Connection, "customers");
        var visit = await db.MaintenanceVisits.SingleAsync();
        Assert.Equal("Completed", visit.Status);
        Assert.Equal(visit.Id, visit.WorkOrderId);
        Assert.Equal(Now.AddMinutes(-10), visit.CompletedAtUtc);
        Assert.Equal(completed.EventId, visit.CompletionEventId);
        Assert.False(visit.CompletionReviewRequired);
        var usage = await db.ContractUsage.SingleAsync();
        Assert.Equal(1, usage.VisitsUsed);
        Assert.Equal(0m, usage.PartsCost);
        Assert.Equal(visit.Id, usage.WorkOrderId);
        Assert.Equal(2, await db.Inbox.CountAsync());
        Assert.Equal(2, await db.ContractEvents.CountAsync());
        Assert.Equal(2, await db.Outbox.CountAsync());
        Assert.All(await db.Outbox.ToArrayAsync(), row =>
        {
            var audit = Json.Read<AuditEvent>(row.Body);
            Assert.Equal(completed.EventId, audit.CausationId);
            Assert.Equal(completed.WorkOrderId, audit.WorkOrderId);
            Assert.Equal("customers", audit.SourceService);
        });
    }

    [Fact]
    public async Task BookingRevisionsAndTerminalCompletionConvergeWhenDeliveryIsReordered()
    {
        var setup = await Seed();
        await Process(setup, BookingEvent(setup, "BookingRescheduled.v1", 2));
        await Process(setup, BookingEvent(setup, "BookingCancelled.v1", 3));
        await Process(setup, BookingEvent(setup, "BookingCreated.v1", 1));
        await Process(setup, OwnerEvent(setup, "WorkOrderCreated.v1"));
        await using (var db = PostgresFixture.Db(setup.Connection, "customers"))
        {
            var visit = await db.MaintenanceVisits.SingleAsync();
            Assert.Equal("Created", visit.Status);
            Assert.Equal(3, visit.AssignmentRevision);
            Assert.Equal(visit.Id, visit.WorkOrderId);
        }
        await Process(setup, OwnerEvent(setup, "WorkOrderCompleted.v1"));
        await Process(setup, BookingEvent(setup, "BookingRescheduled.v1", 4));
        await Process(setup, OwnerEvent(setup, "WorkOrderCreated.v1"));
        await using var verify = PostgresFixture.Db(setup.Connection, "customers");
        Assert.Equal("Completed", (await verify.MaintenanceVisits.SingleAsync()).Status);
        Assert.Single(await verify.ContractUsage.ToListAsync());
    }

    [Fact]
    public async Task ForeignSourceAndMismatchedOwnerReferencesCannotConsumeEntitlements()
    {
        var setup = await Seed();
        var canonical = OwnerEvent(setup, "WorkOrderCompleted.v1");
        foreach (var key in new[] { "customerId", "contractId", "contractLineId", "serviceLocationId", "maintenanceVisitId", "assetId", "teamId", "serviceCategory" })
        {
            var payload = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(canonical.EventPayload.GetRawText())!;
            payload[key] = JsonSerializer.SerializeToElement(key == "teamId" ? "south" : key == "serviceCategory" ? "Electrical" : Guid.NewGuid().ToString());
            await Process(setup, canonical with { EventId = Guid.NewGuid(), EventPayload = JsonSerializer.SerializeToElement(payload) });
        }
        await Process(setup, canonical with { SourceService = "workflows" });
        await Process(setup, BookingEvent(setup, "BookingCreated.v1", 8) with { SourceService = "customers" });
        await using var db = PostgresFixture.Db(setup.Connection, "customers");
        Assert.Equal("Dispatching", (await db.MaintenanceVisits.SingleAsync()).Status);
        Assert.Empty(await db.ContractUsage.ToListAsync());
        Assert.Empty(await db.ContractEvents.ToListAsync());
        Assert.Empty(await db.Outbox.ToListAsync());
    }

    [Theory]
    [InlineData("Cancelled", false)]
    [InlineData("Suspended", false)]
    [InlineData("Active", true)]
    public async Task CompletedServiceRemainsRecordedWhenCoverageRequiresReview(string status, bool exhausted)
    {
        var setup = await Seed(status, exhausted);
        await Process(setup, OwnerEvent(setup, "WorkOrderCompleted.v1"));
        await Process(setup, OwnerEvent(setup, "WorkOrderCompleted.v1"));
        await using var db = PostgresFixture.Db(setup.Connection, "customers");
        var visit = await db.MaintenanceVisits.SingleAsync();
        Assert.Equal("Completed", visit.Status);
        Assert.True(visit.CompletionReviewRequired);
        Assert.False(string.IsNullOrWhiteSpace(visit.CompletionReviewReason));
        Assert.Equal(exhausted ? 1 : 0, await db.ContractUsage.CountAsync());
        Assert.Single(await db.ContractEvents.ToListAsync());
        Assert.Equal("MaintenanceCompletionReviewRequired.v1", (await db.ContractEvents.SingleAsync()).Action);
    }

    [Fact]
    public async Task LateDeliveryAfterSuspendedTermExpiresRetainsCompletionAndRequiresHistoricalCoverageReview()
    {
        var setup = await Seed("Suspended");
        await using (var db = PostgresFixture.Db(setup.Connection, "customers"))
        {
            var contract = await db.Contracts.SingleAsync();
            contract.ExpiresAtUtc = Now.AddMinutes(-5);
            Assert.True(ContractLifecycleRules.Expire(contract, Now));
            await db.SaveChangesAsync();
        }
        await Process(setup, OwnerEvent(setup, "WorkOrderCompleted.v1"));
        await using var verify = PostgresFixture.Db(setup.Connection, "customers");
        Assert.Equal("Expired", (await verify.Contracts.SingleAsync()).Status);
        Assert.Equal("Completed", (await verify.MaintenanceVisits.SingleAsync()).Status);
        Assert.True((await verify.MaintenanceVisits.SingleAsync()).CompletionReviewRequired);
        Assert.Empty(await verify.ContractUsage.ToListAsync());
    }

    [Fact]
    public async Task FailedOutboxInsertRollsBackCompletionUsageAndInboxThenRetryConverges()
    {
        var setup = await Seed();
        await using (var db = PostgresFixture.Db(setup.Connection, "customers"))
        {
            await db.Database.ExecuteSqlRawAsync("""
                CREATE FUNCTION fail_maintenance_outbox() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN RAISE EXCEPTION 'Synthetic storage failure'; END $$;
                CREATE TRIGGER fail_maintenance_outbox BEFORE INSERT ON outbox_messages FOR EACH ROW EXECUTE FUNCTION fail_maintenance_outbox();
                """);
        }
        var completed = OwnerEvent(setup, "WorkOrderCompleted.v1");
        await Assert.ThrowsAsync<DbUpdateException>(() => Process(setup, completed));
        await using (var db = PostgresFixture.Db(setup.Connection, "customers"))
        {
            Assert.Equal("Dispatching", (await db.MaintenanceVisits.SingleAsync()).Status);
            Assert.Empty(await db.ContractUsage.ToListAsync());
            Assert.Empty(await db.Inbox.ToListAsync());
            Assert.Empty(await db.ContractEvents.ToListAsync());
            await db.Database.ExecuteSqlRawAsync("DROP TRIGGER fail_maintenance_outbox ON outbox_messages");
        }
        await Process(setup, completed);
        await using var verify = PostgresFixture.Db(setup.Connection, "customers");
        Assert.Single(await verify.ContractUsage.ToListAsync());
    }

    [Fact]
    public async Task ManualUsageRequiresCompletedMatchingNonMaintenanceOrderAndVerifiedVisitOnly()
    {
        var setup = await Seed();
        var order = setup.Order;
        order.MaintenanceVisitId = null;
        order.Status = "Created";
        order.CompletedAtUtc = null;
        var remote = new RemoteServices(new OrderOwner(order), new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Services:WorkOrders"] = "http://work-orders" }).Build());
        var command = new RecordContractUsage(Guid.NewGuid(), setup.Contract.Id, setup.Contract.Lines[0].Id, order.Id);
        async Task<IResult> Execute(RecordContractUsage? changed = null)
        {
            await using var db = PostgresFixture.Db(setup.Connection, "customers");
            return await ContractApi.RecordUsage(setup.Contract.Id, changed ?? command, db, remote, Actor(), new FixedClock(Now), default);
        }
        Assert.Equal(409, (await Assert.ThrowsAsync<DomainException>(() => Execute())).Status);
        order.Status = "Completed";
        order.CompletedAtUtc = Now.AddMinutes(-10);
        order.ContractLineId = Guid.NewGuid();
        Assert.Equal(409, (await Assert.ThrowsAsync<DomainException>(() => Execute())).Status);
        order.ContractLineId = command.ContractLineId;
        order.ServiceCategory = "Electrical";
        Assert.Equal(409, (await Assert.ThrowsAsync<DomainException>(() => Execute())).Status);
        order.ServiceCategory = "HVAC";
        order.MaintenanceVisitId = setup.Order.Id;
        Assert.Equal(409, (await Assert.ThrowsAsync<DomainException>(() => Execute())).Status);
        order.MaintenanceVisitId = null;
        Assert.Equal(400, (await Assert.ThrowsAsync<DomainException>(() => Execute(command with { PartsCost = 10m }))).Status);
        var first = Assert.IsType<ContentHttpResult>(await Execute()).ResponseContent;
        Assert.Equal(first, Assert.IsType<ContentHttpResult>(await Execute()).ResponseContent);
        Assert.Equal(409, (await Assert.ThrowsAsync<DomainException>(() => Execute(command with { OperationId = Guid.NewGuid() }))).Status);
        await using var verify = PostgresFixture.Db(setup.Connection, "customers");
        Assert.Single(await verify.ContractUsage.ToListAsync());
        Assert.Equal(0m, (await verify.ContractUsage.SingleAsync()).PartsCost);
    }

    private async Task<Setup> Seed(string status = "Active", bool exhausted = false)
    {
        var connection = await fixture.Database("customers", false);
        await using var db = PostgresFixture.Db(connection, "customers");
        await SchemaMigrator.Apply(db);
        var customer = new Customer { DisplayName = "Synthetic maintenance completion", TeamId = "north", CreatedAtUtc = Now.AddDays(-2), UpdatedAtUtc = Now.AddDays(-2) };
        var site = new ServiceLocation { CustomerId = customer.Id, Name = "Synthetic site", AddressLine1 = "100 Example Avenue", City = "Test City", Region = "NY", PostalCode = "10000" };
        customer.Locations.Add(site);
        var contract = new MaintenanceContract { CustomerId = customer.Id, TeamId = "north", Status = status,
            EffectiveFromUtc = Now.AddDays(-1), ExpiresAtUtc = Now.AddDays(1), CoversAllAssets = true, CreatedAtUtc = Now.AddDays(-2), UpdatedAtUtc = Now.AddDays(-2) };
        var line = new ContractLine { ContractId = contract.Id, ServiceType = "HVAC", IncludedVisits = 1, PartsCovered = true, PartsAllowance = 100 };
        contract.Lines.Add(line);
        var visit = new MaintenanceVisit { ContractId = contract.Id, ContractLineId = line.Id, CustomerId = customer.Id,
            ServiceLocationId = site.Id, Status = "Dispatching", DueDate = DateOnly.FromDateTime(Now.UtcDateTime), GeneratedAtUtc = Now.AddHours(-1) };
        contract.Visits.Add(visit);
        if (exhausted) contract.Usage.Add(new ContractUsage { ContractId = contract.Id, ContractLineId = line.Id,
            WorkOrderId = Guid.NewGuid(), VisitsUsed = 1, OccurredAtUtc = Now.AddHours(-2) });
        db.Customers.Add(customer);
        db.Contracts.Add(contract);
        await db.SaveChangesAsync();
        var order = new WorkOrder { Id = visit.Id, MaintenanceVisitId = visit.Id, ContractId = contract.Id, ContractLineId = line.Id,
            CustomerId = customer.Id, ServiceLocationId = site.Id, TeamId = "north", ServiceCategory = "HVAC", Status = "Completed", CompletedAtUtc = Now.AddMinutes(-10) };
        return new(connection, contract, order);
    }

    private static AuditEvent OwnerEvent(Setup setup, string type) => EventFactory.Create(null, "work-orders", type, setup.Order.Id,
        OperationsApi.OrderPayload(type == "WorkOrderCreated.v1" ? new WorkOrder
        {
            Id = setup.Order.Id, MaintenanceVisitId = setup.Order.Id, ContractId = setup.Contract.Id,
            ContractLineId = setup.Contract.Lines[0].Id, CustomerId = setup.Contract.CustomerId,
            ServiceLocationId = setup.Order.ServiceLocationId, TeamId = "north", ServiceCategory = "HVAC"
        } : setup.Order), 5, Now);
    private static AuditEvent BookingEvent(Setup setup, string type, long revision) =>
        EventFactory.Create(null, "scheduling", type, setup.Order.Id, new { teamId = "north", workOrderId = setup.Order.Id }, revision, Now);
    private static async Task Process(Setup setup, AuditEvent audit)
    {
        await using var db = PostgresFixture.Db(setup.Connection, "customers");
        await MaintenanceVisitConsumer.Process(audit, db, new FixedClock(Now));
    }
    private static DefaultHttpContext Actor() => new()
    {
        User = new ClaimsPrincipal(new ClaimsIdentity([new("sub", "manager-01"), new("team_id", "north"), new(ClaimTypes.Role, "OperationsManager")], "test"))
    };
    private sealed record Setup(string Connection, MaintenanceContract Contract, WorkOrder Order);
    private sealed class FixedClock(DateTimeOffset now) : TimeProvider { public override DateTimeOffset GetUtcNow() => now; }
    // Transport contract test: the actual customer handler/transactions run on PostgreSQL.
    private sealed class OrderOwner(WorkOrder order) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new(new Handler(order));
        private sealed class Handler(WorkOrder order) : HttpMessageHandler
        {
            protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
                Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = JsonContent.Create(order, options: Json.Options) });
        }
    }
}
