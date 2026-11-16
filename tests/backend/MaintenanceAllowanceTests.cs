using System.Net;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using FieldOps.Core;
using FieldOps.ServiceHost;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Xunit;

namespace FieldOps.Tests;

public sealed class MaintenanceAllowanceRulesTests
{
    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData(" ")]
    public void MissingRecurrenceFrequencyProducesAValidationFailure(string? frequency) =>
        Assert.Equal(400, Assert.Throws<DomainException>(() => ContractRules.IntervalMonths(frequency)).Status);

    [Fact]
    public void FinalVisitIsCommittedUntilConsumedOrOwnerCancellationAndCannotBeBorrowedByAnotherJob()
    {
        var contract = Agreement();
        var line = contract.Lines[0];
        var visit = Visit(contract, "Dispatching");
        contract.Visits.Add(visit);
        var generic = ContractRules.Evaluate(contract, contract.CustomerId, null, "HVAC", DateTimeOffset.UtcNow);
        Assert.False(generic.Covered);
        Assert.Equal(1, generic.CommittedVisits);
        Assert.Equal(0, generic.VisitsRemaining);
        Assert.Equal(0, ContractRules.AvailableVisits(contract, line.Id));
        var owner = ContractRules.Evaluate(contract, contract.CustomerId, null, "HVAC", DateTimeOffset.UtcNow, visit.Id);
        Assert.True(owner.Covered);
        Assert.Equal(1, owner.VisitsRemaining);
        Assert.False(ContractRules.Evaluate(contract, contract.CustomerId, null, "HVAC", DateTimeOffset.UtcNow, Guid.NewGuid()).Covered);
        Assert.Throws<DomainException>(() => ContractRules.RecordUsage(contract, line.Id, Guid.NewGuid(), 1, 0, DateTimeOffset.UtcNow));
        Assert.Throws<DomainException>(() => ContractRules.RecordUsage(contract, line.Id, Guid.NewGuid(), 1, 0, DateTimeOffset.UtcNow, visit.Id));
        ContractRules.RecordUsage(contract, line.Id, visit.Id, 1, 0, DateTimeOffset.UtcNow, visit.Id);
        Assert.Equal(0, ContractRules.CommittedVisits(contract, line.Id));
        Assert.Equal(0, ContractRules.AvailableVisits(contract, line.Id));
        Assert.Equal(1, contract.Usage.Sum(x => x.VisitsUsed));
    }

    [Theory]
    [InlineData("Pending")]
    [InlineData("Cancelled")]
    [InlineData("Missed")]
    public void ArbitraryUncommittedVisitCannotExemptAnotherAllocation(string status)
    {
        var contract = Agreement();
        var allocated = Visit(contract, "Scheduled");
        var uncommitted = Visit(contract, status);
        contract.Visits.AddRange([allocated, uncommitted]);
        Assert.False(ContractRules.Evaluate(contract, contract.CustomerId, null, "HVAC", DateTimeOffset.UtcNow, uncommitted.Id).Covered);
        Assert.Equal(1, ContractRules.CommittedVisits(contract, contract.Lines[0].Id));
        var mismatch = ContractRules.Evaluate(contract, contract.CustomerId, Guid.NewGuid(), "HVAC", DateTimeOffset.UtcNow, allocated.Id);
        Assert.False(mismatch.Covered);
    }

    [Fact]
    public void CompletedReviewAndLegacyZeroVisitUsageKeepAllowanceCommitted()
    {
        var contract = Agreement();
        var visit = Visit(contract, "Completed");
        visit.CompletionReviewRequired = true;
        visit.CompletionEventId = Guid.NewGuid();
        contract.Visits.Add(visit);
        contract.Usage.Add(new ContractUsage { ContractId = contract.Id, ContractLineId = visit.ContractLineId,
            WorkOrderId = visit.Id, VisitsUsed = 0, PartsCost = 10m, OccurredAtUtc = DateTimeOffset.UtcNow });
        Assert.Equal(1, ContractRules.CommittedVisits(contract, visit.ContractLineId));
        Assert.Equal(0, ContractRules.AvailableVisits(contract, visit.ContractLineId));
        Assert.False(ContractRules.Evaluate(contract, contract.CustomerId, null, "HVAC", DateTimeOffset.UtcNow, visit.Id).Covered);
    }

    [Fact]
    public void UnlimitedVisitTermsRetainCommitmentVisibilityWithoutFiniteCapacityLimit()
    {
        var contract = Agreement();
        contract.Lines[0].IncludedVisits = 0;
        contract.Visits.AddRange([Visit(contract, "Dispatching"), Visit(contract, "Created"), Visit(contract, "Scheduled")]);
        var decision = ContractRules.Evaluate(contract, contract.CustomerId, null, "HVAC", DateTimeOffset.UtcNow);
        Assert.True(decision.Covered);
        Assert.Null(decision.VisitsRemaining);
        Assert.Null(ContractRules.AvailableVisits(contract, contract.Lines[0].Id));
        Assert.Equal(3, decision.CommittedVisits);
        ContractRules.RecordUsage(contract, contract.Lines[0].Id, Guid.NewGuid(), 1, 0, DateTimeOffset.UtcNow);
    }

    private static MaintenanceContract Agreement()
    {
        var now = DateTimeOffset.UtcNow;
        var contract = new MaintenanceContract { CustomerId = Guid.NewGuid(), TeamId = "north", Status = "Active", CoversAllAssets = true,
            EffectiveFromUtc = now.AddDays(-1), ExpiresAtUtc = now.AddYears(1), CreatedAtUtc = now, UpdatedAtUtc = now };
        contract.Lines.Add(new ContractLine { ContractId = contract.Id, ServiceType = "HVAC", IncludedVisits = 1 });
        return contract;
    }
    private static MaintenanceVisit Visit(MaintenanceContract contract, string status) => new()
    {
        ContractId = contract.Id, ContractLineId = contract.Lines[0].Id, CustomerId = contract.CustomerId,
        ServiceLocationId = Guid.NewGuid(), Status = status, GeneratedAtUtc = DateTimeOffset.UtcNow
    };
}

[Collection("PostgreSQL")]
[Trait("Category", "Integration")]
public sealed class MaintenanceAllowancePostgresTests(PostgresFixture fixture)
{
    [Fact]
    public async Task DifferentVisitsRaceForFinalAllowanceAndOnlyOneOwnerJobCommits()
    {
        var setup = await Seed();
        var transport = new Owners(setup.CustomerDb, setup.OrderDb);
        var requests = setup.VisitIds.Select(_ => new DispatchMaintenanceVisit(Guid.NewGuid(), setup.SiteId)).ToArray();
        async Task<int> Dispatch(int index)
        {
            await using var db = PostgresFixture.Db(setup.CustomerDb, "customers");
            try
            {
                await MaintenanceDispatch.Dispatch(setup.ContractId, setup.VisitIds[index], requests[index], db, transport.Remote(), Actor(), TimeProvider.System, default);
                return 200;
            }
            catch (DomainException exception) { return exception.Status; }
        }
        var results = await Task.WhenAll(Dispatch(0), Dispatch(1));
        Assert.Equal(new[] { 200, 409 }, results.Order().ToArray());
        var winner = Array.IndexOf(results, 200);
        Assert.Equal(200, await Dispatch(winner));
        await using var owner = PostgresFixture.Db(setup.OrderDb, "work-orders");
        Assert.Single(await owner.WorkOrders.ToArrayAsync());
        await using var customer = PostgresFixture.Db(setup.CustomerDb, "customers");
        var contract = await Load(customer);
        Assert.Equal(1, ContractRules.CommittedVisits(contract, contract.Lines[0].Id));
        Assert.Equal(0, ContractRules.AvailableVisits(contract, contract.Lines[0].Id));
        Assert.Equal(1, contract.Visits.Count(x => x.Status == "Created"));
        Assert.Equal(1, contract.Visits.Count(x => x.Status == "Pending"));
        Assert.Equal(1, await customer.Receipts.CountAsync());
        Assert.Empty(contract.Usage);
    }

    [Fact]
    public async Task OnlyCanonicalOwnerCancellationReleasesAllocationAndStaleEventsCannotReopenIt()
    {
        var setup = await Seed();
        var transport = new Owners(setup.CustomerDb, setup.OrderDb);
        await Dispatch(setup, setup.VisitIds[0], transport);
        var now = DateTimeOffset.UtcNow;
        var appointmentCancelled = EventFactory.Create(null, "scheduling", "BookingCancelled.v1", setup.VisitIds[0],
            new { teamId = "north", workOrderId = setup.VisitIds[0] }, 2, now);
        await Process(setup, appointmentCancelled);
        await Process(setup, appointmentCancelled with { EventId = Guid.NewGuid(), EventType = "WorkOrderCancellationReserved.v1" });
        await using (var db = PostgresFixture.Db(setup.CustomerDb, "customers"))
        {
            var contract = await Load(db);
            Assert.Equal(1, ContractRules.CommittedVisits(contract, contract.Lines[0].Id));
            Assert.Equal("Created", contract.Visits.Single(x => x.Id == setup.VisitIds[0]).Status);
            Assert.Throws<DomainException>(() => ContractRules.RecordUsage(contract, contract.Lines[0].Id, Guid.NewGuid(), 1, 0, now));
        }
        AuditEvent created;
        AuditEvent cancelled;
        await using (var db = PostgresFixture.Db(setup.OrderDb, "work-orders"))
        {
            created = Json.Read<AuditEvent>((await db.Outbox.SingleAsync()).Body);
            var order = await db.WorkOrders.SingleAsync();
            order.Status = "Cancelled";
            order.Version++;
            cancelled = EventFactory.Create(null, "work-orders", "WorkOrderUpdated.v1", order.Id, OperationsApi.OrderPayload(order), order.Version, now);
            db.Enqueue(cancelled);
            await db.SaveChangesAsync();
        }
        await Process(setup, cancelled with { SourceService = "scheduling" });
        await using (var db = PostgresFixture.Db(setup.CustomerDb, "customers"))
        {
            var contract = await Load(db);
            Assert.Equal(1, ContractRules.CommittedVisits(contract, contract.Lines[0].Id));
        }
        await Process(setup, cancelled);
        await Process(setup, cancelled);
        await Process(setup, created);
        await Process(setup, appointmentCancelled with { EventId = Guid.NewGuid(), EventType = "BookingCreated.v1", SequenceNumber = 9 });
        await using (var db = PostgresFixture.Db(setup.CustomerDb, "customers"))
        {
            var contract = await Load(db);
            Assert.Equal("Cancelled", contract.Visits.Single(x => x.Id == setup.VisitIds[0]).Status);
            Assert.Equal(0, ContractRules.CommittedVisits(contract, contract.Lines[0].Id));
            Assert.Equal(1, ContractRules.AvailableVisits(contract, contract.Lines[0].Id));
            Assert.Equal(1, await db.ContractEvents.CountAsync(x => x.Action == "MaintenanceVisitCancelled.v1"));
        }
        await Dispatch(setup, setup.VisitIds[1], transport);
        await using var verify = PostgresFixture.Db(setup.CustomerDb, "customers");
        var final = await Load(verify);
        Assert.Equal(1, ContractRules.CommittedVisits(final, final.Lines[0].Id));
        Assert.Equal(0, ContractRules.AvailableVisits(final, final.Lines[0].Id));
    }

    [Fact]
    public async Task LegacyPartsOnlyUsageCreatesCompletionReviewAndKeepsVisitCommitted()
    {
        var setup = await Seed();
        var transport = new Owners(setup.CustomerDb, setup.OrderDb);
        await Dispatch(setup, setup.VisitIds[0], transport);
        await using (var db = PostgresFixture.Db(setup.CustomerDb, "customers"))
        {
            var lineId = (await Load(db)).Lines[0].Id;
            db.ContractUsage.Add(new ContractUsage { ContractId = setup.ContractId, ContractLineId = lineId,
                WorkOrderId = setup.VisitIds[0], VisitsUsed = 0, PartsCost = 12m, OccurredAtUtc = DateTimeOffset.UtcNow });
            await db.SaveChangesAsync();
        }
        AuditEvent completed;
        await using (var db = PostgresFixture.Db(setup.OrderDb, "work-orders"))
        {
            var order = await db.WorkOrders.SingleAsync();
            order.Status = "Completed";
            order.CompletedAtUtc = DateTimeOffset.UtcNow;
            completed = EventFactory.Create(null, "work-orders", "WorkOrderCompleted.v1", order.Id, OperationsApi.OrderPayload(order), 3, order.CompletedAtUtc.Value);
        }
        await Process(setup, completed);
        await Process(setup, completed with { EventId = Guid.NewGuid() });
        await using var verify = PostgresFixture.Db(setup.CustomerDb, "customers");
        var contract = await Load(verify);
        var visit = contract.Visits.Single(x => x.Id == setup.VisitIds[0]);
        Assert.Equal("Completed", visit.Status);
        Assert.True(visit.CompletionReviewRequired);
        Assert.Contains("Existing usage", visit.CompletionReviewReason);
        Assert.Equal(0, contract.Usage.Sum(x => x.VisitsUsed));
        Assert.Single(contract.Usage);
        Assert.Equal(1, ContractRules.CommittedVisits(contract, contract.Lines[0].Id));
        Assert.Equal(0, ContractRules.AvailableVisits(contract, contract.Lines[0].Id));
    }

    private static Task<MaintenanceContract> Load(ServiceDb db) => db.Contracts.Include(x => x.Lines).Include(x => x.Visits).Include(x => x.Usage).SingleAsync();
    private static async Task Dispatch(Setup setup, Guid visitId, Owners owners)
    {
        await using var db = PostgresFixture.Db(setup.CustomerDb, "customers");
        await MaintenanceDispatch.Dispatch(setup.ContractId, visitId, new(Guid.NewGuid(), setup.SiteId), db, owners.Remote(), Actor(), TimeProvider.System, default);
    }
    private static async Task Process(Setup setup, AuditEvent audit)
    {
        await using var db = PostgresFixture.Db(setup.CustomerDb, "customers");
        await MaintenanceVisitConsumer.Process(audit, db, TimeProvider.System);
    }
    private async Task<Setup> Seed()
    {
        var customers = await fixture.Database("customers", false);
        var orders = await fixture.Database("work-orders", false);
        await using (var db = PostgresFixture.Db(orders, "work-orders")) await SchemaMigrator.Apply(db);
        await using var owner = PostgresFixture.Db(customers, "customers");
        await SchemaMigrator.Apply(owner);
        var now = DateTimeOffset.UtcNow;
        var customer = new Customer { DisplayName = "Synthetic allowance customer", TeamId = "north", CreatedAtUtc = now, UpdatedAtUtc = now };
        var site = new ServiceLocation { CustomerId = customer.Id, Name = "Synthetic allowance site", AddressLine1 = "100 Example Avenue", City = "Test City", Region = "NY", PostalCode = "10000" };
        customer.Locations.Add(site);
        owner.Customers.Add(customer);
        await owner.SaveChangesAsync();
        var contract = new MaintenanceContract { CustomerId = customer.Id, TeamId = "north", Status = "Active", CoversAllAssets = true,
            EffectiveFromUtc = now.AddDays(-1), ExpiresAtUtc = now.AddYears(1), CreatedAtUtc = now, UpdatedAtUtc = now };
        var line = new ContractLine { ContractId = contract.Id, ServiceType = "HVAC", IncludedVisits = 1, LaborCovered = true, PartsCovered = true, PartsAllowance = 100m };
        contract.Lines.Add(line);
        for (var index = 0; index < 2; index++) contract.Visits.Add(new MaintenanceVisit
        {
            ContractId = contract.Id, ContractLineId = line.Id, CustomerId = customer.Id,
            DueDate = DateOnly.FromDateTime(now.UtcDateTime).AddMonths(index), GeneratedAtUtc = now
        });
        owner.Contracts.Add(contract);
        await owner.SaveChangesAsync();
        return new(customers, orders, contract.Id, site.Id, contract.Visits.Select(x => x.Id).ToArray());
    }
    private sealed record Setup(string CustomerDb, string OrderDb, Guid ContractId, Guid SiteId, Guid[] VisitIds);
    private static DefaultHttpContext Actor() => new()
    {
        User = new ClaimsPrincipal(new ClaimsIdentity([new("sub", "manager-01"), new("team_id", "north"), new(ClaimTypes.Role, "OperationsManager")], "test"))
    };
    // Only HTTP transport is replaced: both owners execute their canonical handlers
    // against separate actual PostgreSQL databases, including intent/allowance checks.
    private sealed class Owners(string customerDb, string orderDb) : IHttpClientFactory
    {
        public RemoteServices Remote() => new(this, new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        { ["Services:Customers"] = "http://customers", ["Services:WorkOrders"] = "http://work-orders" }).Build());
        public HttpClient CreateClient(string name) => new(new Handler(this));
        private sealed class Handler(Owners owners) : HttpMessageHandler
        {
            protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
            {
                var uri = request.RequestUri!;
                IResult result;
                if (uri.Host == "work-orders")
                {
                    var input = (await request.Content!.ReadFromJsonAsync<CreateOrder>(Json.Options, ct))!;
                    await using var db = PostgresFixture.Db(owners.OrderConnection, "work-orders");
                    result = await OperationsApi.CreateWorkOrder(input, db, owners.Remote(), TimeProvider.System, Actor(), ct);
                }
                else
                {
                    await using var db = PostgresFixture.Db(owners.CustomerConnection, "customers");
                    if (uri.AbsolutePath == "/api/contracts/entitlements")
                    {
                        var query = QueryHelpers.ParseQuery(uri.Query);
                        Guid? Id(string key) => query.TryGetValue(key, out var value) ? Guid.Parse(value.ToString()) : null;
                        result = await ContractApi.Evaluate(db, Actor(), ct, Guid.Parse(query["customerId"].ToString()), query["serviceType"].ToString(),
                            assetId: Id("assetId"), contractId: Id("contractId"), allocationVisitId: Id("allocationVisitId"));
                    }
                    else if (uri.AbsolutePath.EndsWith("/dispatch", StringComparison.Ordinal))
                    {
                        var pieces = uri.AbsolutePath.Split('/');
                        result = await MaintenanceDispatch.Intent(Guid.Parse(pieces[3]), Guid.Parse(pieces[5]), db, Actor(), TimeProvider.System, ct);
                    }
                    else
                    {
                        var id = Guid.Parse(uri.AbsolutePath.Split('/').Last());
                        var customer = await db.Customers.Include(x => x.Locations).SingleAsync(x => x.Id == id, ct);
                        result = Results.Ok(new CustomerView(customer.Id, customer.DisplayName, customer.CustomerType, customer.TeamId,
                            customer.Status, customer.PreferredChannel, customer.Version, customer.CreatedAtUtc, customer.UpdatedAtUtc, [],
                            customer.Locations.Select(x => new ServiceLocationView(x.Id, x.Name, x.AddressLine1, x.AddressLine2, x.City, x.Region, x.PostalCode, x.CountryCode, x.AccessNotes, x.Status)).ToArray()));
                    }
                }
                var body = result is ContentHttpResult text ? text.ResponseContent! : JsonSerializer.Serialize(((IValueHttpResult)result).Value, Json.Options);
                return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(body, Encoding.UTF8, "application/json") };
            }
        }
        private string CustomerConnection => customerDb;
        private string OrderConnection => orderDb;
    }
}
