using System.Security.Claims;
using FieldOps.Core;
using FieldOps.ServiceHost;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace FieldOps.Tests;

public sealed class ServiceRequestTests
{
    private static ServiceRequest New() => new() { CustomerId = Guid.NewGuid(), ServiceLocationId = Guid.NewGuid(), TeamId = "north", SubmittedBy = "customer-user", Title = "Synthetic repair", Description = "The synthetic air handler is not cooling.", CreatedAtUtc = DateTimeOffset.UtcNow, UpdatedAtUtc = DateTimeOffset.UtcNow };

    [Fact]
    public void QualificationAndRejectionAreTerminalAndVersioned()
    {
        var request = New(); ServiceRequestRules.Validate(request);
        var order = Guid.NewGuid();
        ServiceRequestRules.Decide(request, 1, "Approve", "Qualified for an HVAC diagnostic visit.", DateTimeOffset.UtcNow, order);
        Assert.Equal("Qualified", request.Status); Assert.Equal(order, request.WorkOrderId); Assert.Equal(2, request.Version);
        Assert.Throws<DomainException>(() => ServiceRequestRules.Decide(request, 2, "Approve", "Repeated qualification must fail.", DateTimeOffset.UtcNow, Guid.NewGuid()));
        var rejected = New();
        ServiceRequestRules.Decide(rejected, 1, "Reject", "Location is outside our service coverage.", DateTimeOffset.UtcNow, null);
        Assert.Equal("Rejected", rejected.Status); Assert.Null(rejected.WorkOrderId);
    }

    [Fact]
    public void InvalidTransitionsCannotMutateIntake()
    {
        var request = New();
        Assert.Throws<DomainException>(() => ServiceRequestRules.Decide(request, 0, "Approve", "Valid reason for review.", DateTimeOffset.UtcNow, Guid.NewGuid()));
        Assert.Throws<DomainException>(() => ServiceRequestRules.Decide(request, 1, "Approve", "Valid reason for review.", DateTimeOffset.UtcNow, null));
        Assert.Throws<DomainException>(() => ServiceRequestRules.Decide(request, 1, "Reject", "short", DateTimeOffset.UtcNow, null));
        Assert.Throws<DomainException>(() => ServiceRequestRules.Decide(request, 1, "Reject", "Valid reason for review.", DateTimeOffset.UtcNow, Guid.NewGuid()));
        Assert.Equal("Submitted", request.Status); Assert.Equal(1, request.Version);
    }

    [Fact]
    public void CustomerScopeRequiresSignedRoleAndValidMembership()
    {
        ClaimsPrincipal User(params Claim[] claims) => new(new ClaimsIdentity(claims, "test"));
        var id = Guid.NewGuid();
        var claims = new[] { new Claim(ClaimTypes.Role, "Customer"), new Claim("customer_id", id.ToString()), new Claim("team_id", "north"), new Claim("sub", "customer-user") };
        Assert.Equal(id, CustomerScope.From(User(claims)).CustomerId);
        Assert.Throws<DomainException>(() => CustomerScope.From(User(claims.Where(x => x.Type != "customer_id").ToArray())));
        Assert.Throws<DomainException>(() => CustomerScope.From(User(claims.Where(x => x.Type != ClaimTypes.Role).ToArray())));
        Assert.Throws<DomainException>(() => CustomerScope.From(User([.. claims.Where(x => x.Type != "customer_id"), new("customer_id", "not-a-guid")])));
    }
}

[Collection("PostgreSQL")]
public sealed class ServiceRequestPostgresTests(PostgresFixture fixture)
{
    [Fact]
    public async Task DatabaseRejectsTerminalDecisionWithoutARetainedReason()
    {
        var cs = await fixture.Database("work-orders", false);
        await using var db = PostgresFixture.Db(cs, "work-orders");
        await SchemaMigrator.Apply(db);
        var invalid = new ServiceRequest { CustomerId = Guid.NewGuid(), ServiceLocationId = Guid.NewGuid(), TeamId = "north", SubmittedBy = "synthetic", CustomerName = "Synthetic", SiteAddress = "Synthetic", Title = "Synthetic rejection", Description = "Synthetic rejected request without decision evidence.", Status = "Rejected", CreatedAtUtc = DateTimeOffset.UtcNow, UpdatedAtUtc = DateTimeOffset.UtcNow };
        db.ServiceRequests.Add(invalid);
        var failure = await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
        Assert.IsType<Npgsql.PostgresException>(failure.InnerException);
        Assert.Equal("23514", ((Npgsql.PostgresException)failure.InnerException!).SqlState);
    }

    [Fact]
    public async Task ConcurrentQualificationCommitsOnlyOneOrderAndItsEvent()
    {
        var cs = await fixture.Database("work-orders", false);
        var request = new ServiceRequest { CustomerId = Guid.NewGuid(), ServiceLocationId = Guid.NewGuid(), TeamId = "north", SubmittedBy = "customer-user", Title = "Synthetic intake", Description = "Synthetic qualification race scenario.", CustomerName = "Synthetic", SiteAddress = "Synthetic site", CreatedAtUtc = DateTimeOffset.UtcNow, UpdatedAtUtc = DateTimeOffset.UtcNow };
        await using (var setup = PostgresFixture.Db(cs, "work-orders")) { await SchemaMigrator.Apply(setup); setup.ServiceRequests.Add(request); await setup.SaveChangesAsync(); }
        await using var first = PostgresFixture.Db(cs, "work-orders"); await using var second = PostgresFixture.Db(cs, "work-orders");
        var a = await first.ServiceRequests.SingleAsync(); var b = await second.ServiceRequests.SingleAsync();
        async Task<bool> Qualify(ServiceDb db, ServiceRequest item)
        {
            var order = new WorkOrder { Number = "WO-RACE-" + Guid.NewGuid().ToString("N"), Title = item.Title, CustomerName = item.CustomerName, SiteAddress = item.SiteAddress, CreatedAtUtc = DateTimeOffset.UtcNow, CustomerId = item.CustomerId, CustomerVersion = 1, ServiceLocationId = item.ServiceLocationId };
            ServiceRequestRules.Decide(item, 1, "Approve", "Synthetic valid qualification.", DateTimeOffset.UtcNow, order.Id);
            db.WorkOrders.Add(order);
            db.Enqueue(EventFactory.Create(null, "work-orders", "WorkOrderCreated.v1", order.Id, OperationsApi.OrderPayload(order), 1, DateTimeOffset.UtcNow));
            try { await db.SaveChangesAsync(); return true; } catch (DbUpdateConcurrencyException) { return false; }
        }
        var results = await Task.WhenAll(Qualify(first, a), Qualify(second, b));
        Assert.Single(results, x => x);
        await using var inspect = PostgresFixture.Db(cs, "work-orders");
        Assert.Equal(1, await inspect.WorkOrders.CountAsync()); Assert.Equal(1, await inspect.Outbox.CountAsync());
        Assert.Equal("Qualified", (await inspect.ServiceRequests.SingleAsync()).Status);
    }
}
