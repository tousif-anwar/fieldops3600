using System.Net;
using System.Net.Http.Json;
using System.Security.Claims;
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

[Collection("PostgreSQL")]
[Trait("Category", "Integration")]
public sealed class MaintenanceDispatchTests(PostgresFixture fixture)
{
    [Fact]
    public async Task LostWorkOrderResponseRecoversWithoutDuplicateJobOrEvent()
    {
        var setup = await Setup();
        var transport = new Owners(setup.CustomerDb, setup.OrderDb) { LoseFirstWorkOrderResponse = true };
        var request = new DispatchMaintenanceVisit(Guid.NewGuid(), setup.SiteId);
        await using (var db = PostgresFixture.Db(setup.CustomerDb, "customers"))
            await Assert.ThrowsAsync<HttpRequestException>(() => MaintenanceDispatch.Dispatch(setup.ContractId, setup.VisitId, request,
                db, transport.Remote(), Actor(), TimeProvider.System, default));
        await using (var db = PostgresFixture.Db(setup.CustomerDb, "customers"))
        {
            var pending = await db.MaintenanceVisits.SingleAsync();
            Assert.Equal("Dispatching", pending.Status);
            Assert.Null(pending.WorkOrderId);
            Assert.Single(await db.Receipts.ToListAsync());
        }
        MaintenanceDispatchResult result;
        await using (var db = PostgresFixture.Db(setup.CustomerDb, "customers"))
            result = Body<MaintenanceDispatchResult>(await MaintenanceDispatch.Dispatch(setup.ContractId, setup.VisitId, request,
                db, transport.Remote(), Actor(), TimeProvider.System, default));
        Assert.True(result.DispatchComplete);
        Assert.Equal(setup.VisitId, result.WorkOrderId);
        await using (var db = PostgresFixture.Db(setup.CustomerDb, "customers"))
            Assert.Equal(result, Body<MaintenanceDispatchResult>(await MaintenanceDispatch.Dispatch(setup.ContractId, setup.VisitId, request,
                db, transport.Remote(), Actor(), TimeProvider.System, default)));
        await using (var db = PostgresFixture.Db(setup.OrderDb, "work-orders"))
        {
            Assert.Single(await db.WorkOrders.ToListAsync());
            Assert.Single(await db.Outbox.ToListAsync());
            var order = await db.WorkOrders.SingleAsync();
            Assert.Equal(setup.SiteId, order.ServiceLocationId);
            Assert.Equal(setup.ContractId, order.ContractId);
            Assert.NotNull(order.CoverageEvaluatedAtUtc);
            Assert.Equal("Created", order.Status);
            Assert.Null(order.TechnicianId);
        }
    }

    [Fact]
    public async Task LostResponseReceiptRecoversAfterOwnerCompletionWithoutRemoteCallsOrRepeatedUsage()
    {
        var setup = await Setup();
        var transport = new Owners(setup.CustomerDb, setup.OrderDb) { LoseFirstWorkOrderResponse = true };
        var request = new DispatchMaintenanceVisit(Guid.NewGuid(), setup.SiteId);
        await using (var db = PostgresFixture.Db(setup.CustomerDb, "customers"))
            await Assert.ThrowsAsync<HttpRequestException>(() => MaintenanceDispatch.Dispatch(setup.ContractId, setup.VisitId, request,
                db, transport.Remote(), Actor(), TimeProvider.System, default));

        AuditEvent completed;
        await using (var db = PostgresFixture.Db(setup.OrderDb, "work-orders"))
        {
            var order = await db.WorkOrders.SingleAsync();
            order.Status = "Completed";
            order.CompletedAtUtc = DateTimeOffset.UtcNow;
            order.Version++;
            await db.SaveChangesAsync();
            completed = EventFactory.Create(null, "work-orders", "WorkOrderCompleted.v1", order.Id,
                OperationsApi.OrderPayload(order), order.Version, order.CompletedAtUtc.Value);
        }
        int eventCount;
        int version;
        Guid otherSiteId;
        await using (var db = PostgresFixture.Db(setup.CustomerDb, "customers"))
        {
            await MaintenanceVisitConsumer.Process(completed, db, TimeProvider.System);
            var visit = await db.MaintenanceVisits.SingleAsync();
            Assert.Equal("Completed", visit.Status);
            Assert.Equal(setup.VisitId, visit.WorkOrderId);
            Assert.Equal(completed.EventId, visit.CompletionEventId);
            Assert.Single(await db.ContractUsage.ToArrayAsync());
            eventCount = await db.ContractEvents.CountAsync();
            version = (await db.Contracts.SingleAsync()).Version;
            var otherSite = new ServiceLocation
            {
                CustomerId = setup.CustomerId, Name = "Another authorized site", AddressLine1 = "200 Example Avenue",
                City = "Test City", Region = "NY", PostalCode = "10000"
            };
            db.ServiceLocations.Add(otherSite);
            await db.SaveChangesAsync();
            otherSiteId = otherSite.Id;
        }

        // Any HTTP owner call would throw: the committed customer projection is
        // enough to finalize this exact original receipt, even after completion.
        var noRemote = new RemoteServices(new NoRemote(), new ConfigurationBuilder().Build());
        MaintenanceDispatchResult recovered;
        await using (var db = PostgresFixture.Db(setup.CustomerDb, "customers"))
            recovered = Body<MaintenanceDispatchResult>(await MaintenanceDispatch.Dispatch(setup.ContractId, setup.VisitId,
                request, db, noRemote, Actor(), TimeProvider.System, default));
        Assert.True(recovered.DispatchComplete);
        Assert.Equal("Completed", recovered.Status);
        Assert.Equal(setup.VisitId, recovered.WorkOrderId);
        await using (var db = PostgresFixture.Db(setup.CustomerDb, "customers"))
            Assert.Equal(recovered, Body<MaintenanceDispatchResult>(await MaintenanceDispatch.Dispatch(setup.ContractId,
                setup.VisitId, request, db, noRemote, Actor(), TimeProvider.System, default)));
        await using (var db = PostgresFixture.Db(setup.CustomerDb, "customers"))
            Assert.Equal(409, (await Assert.ThrowsAsync<DomainException>(() => MaintenanceDispatch.Dispatch(setup.ContractId,
                setup.VisitId, request with { ServiceLocationId = otherSiteId }, db, noRemote, Actor(), TimeProvider.System, default))).Status);
        await using (var db = PostgresFixture.Db(setup.CustomerDb, "customers"))
            Assert.Equal(404, (await Assert.ThrowsAsync<DomainException>(() => MaintenanceDispatch.Dispatch(setup.ContractId,
                setup.VisitId, request, db, noRemote, Actor("south"), TimeProvider.System, default))).Status);
        await using (var db = PostgresFixture.Db(setup.CustomerDb, "customers"))
        {
            Assert.Equal(eventCount, await db.ContractEvents.CountAsync());
            Assert.Equal(version, (await db.Contracts.SingleAsync()).Version);
            Assert.Equal(1, (await db.ContractUsage.SingleAsync()).VisitsUsed);
            Assert.Equal(recovered, Json.Read<MaintenanceDispatchResult>((await db.Receipts.SingleAsync()).ResponseJson));
        }
        await using var orders = PostgresFixture.Db(setup.OrderDb, "work-orders");
        Assert.Single(await orders.WorkOrders.ToArrayAsync());
    }

    [Fact]
    public async Task RacingDispatchesCreateOneOwnerRecordAndBindOneSite()
    {
        var setup = await Setup();
        var transport = new Owners(setup.CustomerDb, setup.OrderDb);
        async Task<MaintenanceDispatchResult> Dispatch()
        {
            await using var db = PostgresFixture.Db(setup.CustomerDb, "customers");
            return Body<MaintenanceDispatchResult>(await MaintenanceDispatch.Dispatch(setup.ContractId, setup.VisitId,
                new(Guid.NewGuid(), setup.SiteId), db, transport.Remote(), Actor(), TimeProvider.System, default));
        }
        var results = await Task.WhenAll(Dispatch(), Dispatch());
        Assert.All(results, result => Assert.Equal(setup.VisitId, result.WorkOrderId));
        await using var orders = PostgresFixture.Db(setup.OrderDb, "work-orders");
        Assert.Equal(1, await orders.WorkOrders.CountAsync());
        await using var customer = PostgresFixture.Db(setup.CustomerDb, "customers");
        Assert.Equal(1, await customer.ContractEvents.CountAsync(x => x.Action == "MaintenanceVisitWorkOrderCreated.v1"));
        Assert.Equal("Created", (await customer.MaintenanceVisits.SingleAsync()).Status);
    }

    [Fact]
    public async Task ForeignSiteAndChangedOperationAreRejectedBeforeRemoteWrites()
    {
        var setup = await Setup();
        var transport = new Owners(setup.CustomerDb, setup.OrderDb);
        var request = new DispatchMaintenanceVisit(Guid.NewGuid(), Guid.NewGuid());
        await using (var db = PostgresFixture.Db(setup.CustomerDb, "customers"))
            Assert.Equal(404, (await Assert.ThrowsAsync<DomainException>(() => MaintenanceDispatch.Dispatch(setup.ContractId,
                setup.VisitId, request, db, transport.Remote(), Actor(), TimeProvider.System, default))).Status);
        await using (var db = PostgresFixture.Db(setup.CustomerDb, "customers"))
            Assert.Equal(404, (await Assert.ThrowsAsync<DomainException>(() => MaintenanceDispatch.Dispatch(setup.ContractId,
                setup.VisitId, new(Guid.NewGuid(), setup.SiteId), db, transport.Remote(), Actor("south"), TimeProvider.System, default))).Status);
        await using var orders = PostgresFixture.Db(setup.OrderDb, "work-orders");
        Assert.Empty(await orders.WorkOrders.ToListAsync());
    }

    [Fact]
    public void ExclusionsMatchOnlyTheirConfiguredDimensions()
    {
        var now = DateTimeOffset.UtcNow;
        var contract = new MaintenanceContract { CustomerId = Guid.NewGuid(), TeamId = "north", Status = "Active",
            EffectiveFromUtc = now.AddDays(-1), CoversAllAssets = true };
        contract.Lines.Add(new ContractLine { ContractId = contract.Id, ServiceType = "HVAC", IncludedVisits = 2 });
        contract.Exclusions.Add(new ContractExclusion { ContractId = contract.Id, ServiceType = "Electrical", Reason = "Other service excluded" });
        Assert.True(ContractRules.Evaluate(contract, contract.CustomerId, null, "HVAC", now).Covered);
        var excluded = Guid.NewGuid();
        contract.Exclusions.Add(new ContractExclusion { ContractId = contract.Id, ServiceType = "HVAC", AssetId = excluded, Reason = "Specific equipment excluded" });
        Assert.True(ContractRules.Evaluate(contract, contract.CustomerId, Guid.NewGuid(), "HVAC", now).Covered);
        Assert.False(ContractRules.Evaluate(contract, contract.CustomerId, excluded, "HVAC", now).Covered);
    }

    private async Task<(string CustomerDb, string OrderDb, Guid CustomerId, Guid SiteId, Guid ContractId, Guid VisitId)> Setup()
    {
        var customers = await fixture.Database("customers", false);
        var orders = await fixture.Database("work-orders", false);
        await using (var db = PostgresFixture.Db(orders, "work-orders")) await SchemaMigrator.Apply(db);
        await using var owner = PostgresFixture.Db(customers, "customers");
        await SchemaMigrator.Apply(owner);
        var now = DateTimeOffset.UtcNow;
        var customer = new Customer { DisplayName = "Synthetic maintenance dispatch", TeamId = "north", CreatedAtUtc = now, UpdatedAtUtc = now };
        var site = new ServiceLocation { CustomerId = customer.Id, Name = "Synthetic site", AddressLine1 = "100 Example Avenue", City = "Test City", Region = "NY", PostalCode = "10000" };
        customer.Locations.Add(site);
        var contract = new MaintenanceContract { CustomerId = customer.Id, TeamId = "north", Status = "Active",
            EffectiveFromUtc = now.AddDays(-1), ExpiresAtUtc = now.AddYears(1), CoversAllAssets = true, CreatedAtUtc = now, UpdatedAtUtc = now };
        var line = new ContractLine { ContractId = contract.Id, ServiceType = "HVAC", IncludedVisits = 5, LaborCovered = true, PartsCovered = true, PartsAllowance = 100 };
        contract.Lines.Add(line);
        var visit = new MaintenanceVisit { ContractId = contract.Id, CustomerId = customer.Id, ContractLineId = line.Id,
            DueDate = DateOnly.FromDateTime(now.UtcDateTime), GeneratedAtUtc = now };
        contract.Visits.Add(visit);
        owner.Customers.Add(customer); owner.Contracts.Add(contract); await owner.SaveChangesAsync();
        return (customers, orders, customer.Id, site.Id, contract.Id, visit.Id);
    }

    private static DefaultHttpContext Actor(string team = "north") => new()
    {
        User = new ClaimsPrincipal(new ClaimsIdentity([new("sub", "manager-01"), new("team_id", team),
            new(ClaimTypes.Role, "OperationsManager")], "test"))
    };
    private static T Body<T>(IResult result) => result is ContentHttpResult content
        ? Json.Read<T>(content.ResponseContent!) : (T)((IValueHttpResult)result).Value!;

    private sealed class NoRemote : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => throw new InvalidOperationException("Receipt recovery must not call an owner service.");
    }

    // Only HTTP transport is substituted: both owners execute their actual handlers
    // and durable transactions against separate real PostgreSQL databases.
    private sealed class Owners(string customerDb, string orderDb) : IHttpClientFactory
    {
        public bool LoseFirstWorkOrderResponse { get; set; }
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
                    if (owners.LoseFirstWorkOrderResponse) { owners.LoseFirstWorkOrderResponse = false; throw new HttpRequestException("Simulated lost response after owner commit"); }
                }
                else
                {
                    await using var db = PostgresFixture.Db(owners.CustomerConnection, "customers");
                    if (uri.AbsolutePath == "/api/contracts/entitlements")
                    {
                        var query = QueryHelpers.ParseQuery(uri.Query);
                        result = await ContractApi.Evaluate(db, Actor(), ct, Guid.Parse(query["customerId"].ToString()), query["serviceType"].ToString(),
                            contractId: query.TryGetValue("contractId", out var selected) ? Guid.Parse(selected.ToString()) : null,
                            allocationVisitId: query.TryGetValue("allocationVisitId", out var allocated) ? Guid.Parse(allocated.ToString()) : null);
                    }
                    else if (uri.AbsolutePath.EndsWith("/dispatch", StringComparison.Ordinal))
                    {
                        var pieces = uri.AbsolutePath.Split('/');
                        result = await MaintenanceDispatch.Intent(Guid.Parse(pieces[3]), Guid.Parse(pieces[5]), db, Actor(), TimeProvider.System, ct);
                    }
                    else if (uri.AbsolutePath.StartsWith("/api/customers/", StringComparison.Ordinal))
                    {
                        var id = Guid.Parse(uri.AbsolutePath.Split('/').Last());
                        var customer = await db.Customers.Include(x => x.Locations).SingleAsync(x => x.Id == id, ct);
                        result = Results.Ok(new CustomerView(customer.Id, customer.DisplayName, customer.CustomerType, customer.TeamId,
                            customer.Status, customer.PreferredChannel, customer.Version, customer.CreatedAtUtc, customer.UpdatedAtUtc, [],
                            customer.Locations.Select(x => new ServiceLocationView(x.Id, x.Name, x.AddressLine1, x.AddressLine2, x.City, x.Region, x.PostalCode, x.CountryCode, x.AccessNotes, x.Status)).ToArray()));
                    }
                    else throw new InvalidOperationException("Unexpected owner URL: " + uri.AbsolutePath);
                }
                var value = result is ContentHttpResult text ? text.ResponseContent! : JsonSerializer.Serialize(((IValueHttpResult)result).Value, Json.Options);
                return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(value, System.Text.Encoding.UTF8, "application/json") };
            }
        }
        private string CustomerConnection => customerDb;
        private string OrderConnection => orderDb;
    }
}
