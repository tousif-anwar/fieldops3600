using System.Net;
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
public sealed class InventoryPostgresTests(PostgresFixture fixture)
{
    [Fact]
    public async Task FreshMigrationReappliesWithoutDataLossAndMovementEvidenceCannotBeRewritten()
    {
        var seed = await Seed(); await using var db = PostgresFixture.Db(seed.Connection, "inventory");
        await InventoryApi.Receive(new(Guid.NewGuid(), seed.Part.Id, seed.Warehouse.Id, 8, "Purchase delivery"), db, Actor(), TimeProvider.System, default);
        await SchemaMigrator.Apply(db);
        Assert.Equal(8, (await db.StockBalances.SingleAsync()).OnHand);
        Assert.Equal(1, await db.InventoryMovements.CountAsync());
        Assert.Equal(1, await db.Database.SqlQueryRaw<int>("SELECT count(*)::integer AS \"Value\" FROM fieldops_schema_migrations").SingleAsync());
        foreach (var sql in new[] { "UPDATE inventory_movements SET \"Reason\"='tampered'", "DELETE FROM inventory_movements", "TRUNCATE inventory_movements" })
            Assert.Equal("42501", (await Assert.ThrowsAsync<PostgresException>(() => db.Database.ExecuteSqlRawAsync(sql))).SqlState);
        Assert.Equal(1, await db.InventoryMovements.CountAsync());
    }

    [Fact]
    public async Task ReservationRaceCannotOverAllocateTheLastStock()
    {
        var seed = await Seed(10); var orders = new Owner(); var firstOrder = orders.Add(); var secondOrder = orders.Add();
        async Task<int> Attempt(Guid order)
        {
            await using var db = PostgresFixture.Db(seed.Connection, "inventory");
            try { _ = await InventoryApi.Reserve(new(Guid.NewGuid(), order, seed.Part.Id, seed.Warehouse.Id, 7), db, orders.Remote, Actor(), TimeProvider.System, default); return 200; }
            catch (DomainException exception) { return exception.Status; }
        }
        var results = await Task.WhenAll(Attempt(firstOrder.Id), Attempt(secondOrder.Id));
        Assert.Equal([200, 409], results.Order().ToArray());
        await using var verify = PostgresFixture.Db(seed.Connection, "inventory");
        var balance = await verify.StockBalances.SingleAsync(); Assert.Equal(7, balance.Reserved); Assert.Equal(3, balance.Available);
        Assert.Equal(1, await verify.InventoryReservations.CountAsync()); Assert.Equal(1, await verify.Receipts.CountAsync());
    }

    [Fact]
    public async Task DuplicateConsumptionReplaysAfterCompletionButChangedPayloadAndNewClosedJobCommandsConflict()
    {
        var seed = await Seed(10); var owner = new Owner(); var order = owner.Add();
        var request = new ConsumeInventory(Guid.NewGuid(), order.Id, seed.Part.Id, seed.Warehouse.Id, 4);
        async Task<InventoryConsumption> Consume(ConsumeInventory command)
        {
            await using var db = PostgresFixture.Db(seed.Connection, "inventory");
            return Body<InventoryConsumption>(await InventoryApi.Consume(command, db, owner.Remote, Actor(), TimeProvider.System, default));
        }
        var original = await Consume(request); order.Status = "Completed";
        var replay = await Consume(request); Assert.Equal(original.Id, replay.Id); Assert.Equal(0.1234m, replay.UnitCost);
        Assert.Equal(409, (await Assert.ThrowsAsync<DomainException>(() => Consume(request with { Quantity = 5 }))).Status);
        Assert.Equal(409, (await Assert.ThrowsAsync<DomainException>(() => Consume(request with { OperationId = Guid.NewGuid() }))).Status);
        await using var verify = PostgresFixture.Db(seed.Connection, "inventory");
        Assert.Equal(1, await verify.InventoryConsumptions.CountAsync()); Assert.Equal(6, (await verify.StockBalances.SingleAsync()).OnHand);
        Assert.Equal(2, await verify.Outbox.CountAsync());
    }

    [Fact]
    public async Task PartialTransferReceiptsAreIdempotentAndStockRemainsAccountedForInTransit()
    {
        var seed = await Seed(10); var owner = new Owner(); var order = owner.Add();
        StockTransfer transfer;
        await using (var db = PostgresFixture.Db(seed.Connection, "inventory"))
            transfer = Body<StockTransfer>(await InventoryApi.Transfer(new(Guid.NewGuid(), seed.Part.Id, seed.Warehouse.Id, seed.Vehicle.Id, 6, order.Id), db, owner.Remote, Actor(), TimeProvider.System, default));
        var receipt = new ReceiveTransfer(Guid.NewGuid(), 2);
        async Task<StockTransfer> Receive(ReceiveTransfer request)
        {
            await using var db = PostgresFixture.Db(seed.Connection, "inventory");
            return Body<StockTransfer>(await InventoryApi.ReceiveStockTransfer(transfer.Id, request, db, Actor("tech-01", "Technician"), TimeProvider.System, default));
        }
        var partial = await Receive(receipt); var duplicate = await Receive(receipt);
        Assert.Equal(2, partial.ReceivedQuantity); Assert.Equal(2, duplicate.ReceivedQuantity); Assert.Equal("InTransit", partial.Status);
        await using (var verify = PostgresFixture.Db(seed.Connection, "inventory"))
        {
            var sum = await verify.StockBalances.SumAsync(x => x.OnHand); Assert.Equal(10, sum + partial.Quantity - partial.ReceivedQuantity);
        }
        var finished = await Receive(new(Guid.NewGuid(), 4)); Assert.Equal("Received", finished.Status); Assert.NotNull(finished.ReceivedAtUtc);
        Assert.Equal(409, (await Assert.ThrowsAsync<DomainException>(() => Receive(new(Guid.NewGuid(), 1)))).Status);
        await using var final = PostgresFixture.Db(seed.Connection, "inventory"); Assert.Equal(10, await final.StockBalances.SumAsync(x => x.OnHand));
        Assert.Equal(3, await final.InventoryMovements.CountAsync());
    }

    [Fact]
    public async Task FailedTransferAndUnauthorizedVehicleConsumptionLeaveNoStockOrReceiptWrites()
    {
        var seed = await Seed(10); var owner = new Owner(); var order = owner.Add();
        await using (var db = PostgresFixture.Db(seed.Connection, "inventory"))
            Assert.Equal(404, (await Assert.ThrowsAsync<DomainException>(() => InventoryApi.Transfer(new(Guid.NewGuid(), seed.Part.Id, seed.Warehouse.Id, Guid.NewGuid(), 6), db, owner.Remote, Actor(), TimeProvider.System, default))).Status);
        await using (var db = PostgresFixture.Db(seed.Connection, "inventory"))
            Assert.Equal(404, (await Assert.ThrowsAsync<DomainException>(() => InventoryApi.Consume(new(Guid.NewGuid(), order.Id, seed.Part.Id, seed.Warehouse.Id, 1), db, owner.Remote, Actor("tech-01", "Technician"), TimeProvider.System, default))).Status);
        await using (var db = PostgresFixture.Db(seed.Connection, "inventory"))
            Assert.Equal(404, (await Assert.ThrowsAsync<DomainException>(() => InventoryApi.Consume(new(Guid.NewGuid(), order.Id, seed.Part.Id, seed.Vehicle.Id, 1), db, owner.Remote, Actor("tech-other", "Technician"), TimeProvider.System, default))).Status);
        await using var verify = PostgresFixture.Db(seed.Connection, "inventory"); Assert.Equal(10, (await verify.StockBalances.SingleAsync()).OnHand);
        Assert.Equal(0, await verify.Receipts.CountAsync()); Assert.Equal(0, await verify.Outbox.CountAsync());
    }

    [Fact]
    public async Task ReturnsAndReservationReleaseCannotOverRestoreConsumedOrReservedStock()
    {
        var seed = await Seed(10); var owner = new Owner(); var order = owner.Add(); InventoryReservation reservation; InventoryConsumption consumption;
        await using (var db = PostgresFixture.Db(seed.Connection, "inventory"))
            reservation = Body<InventoryReservation>(await InventoryApi.Reserve(new(Guid.NewGuid(), order.Id, seed.Part.Id, seed.Warehouse.Id, 7), db, owner.Remote, Actor(), TimeProvider.System, default));
        await using (var db = PostgresFixture.Db(seed.Connection, "inventory"))
            consumption = Body<InventoryConsumption>(await InventoryApi.Consume(new(Guid.NewGuid(), order.Id, seed.Part.Id, seed.Warehouse.Id, 4, reservation.Id), db, owner.Remote, Actor(), TimeProvider.System, default));
        await using (var db = PostgresFixture.Db(seed.Connection, "inventory"))
            _ = await InventoryApi.Return(consumption.Id, new(Guid.NewGuid(), 2, "Unused replacement parts"), db, owner.Remote, Actor(), TimeProvider.System, default);
        await using (var db = PostgresFixture.Db(seed.Connection, "inventory"))
            Assert.Equal(409, (await Assert.ThrowsAsync<DomainException>(() => InventoryApi.Return(consumption.Id, new(Guid.NewGuid(), 3, "Over-return attempt"), db, owner.Remote, Actor(), TimeProvider.System, default))).Status);
        await using (var db = PostgresFixture.Db(seed.Connection, "inventory"))
            _ = await InventoryApi.Release(reservation.Id, new(Guid.NewGuid(), 3, "Unused reservation released"), db, owner.Remote, Actor(), TimeProvider.System, default);
        await using var verify = PostgresFixture.Db(seed.Connection, "inventory"); var balance = await verify.StockBalances.SingleAsync();
        Assert.Equal(8, balance.OnHand); Assert.Equal(0, balance.Reserved); Assert.Equal("Closed", (await verify.InventoryReservations.SingleAsync()).Status);
        Assert.Equal(2, (await verify.InventoryConsumptions.SingleAsync()).ReturnedQuantity);
    }

    [Fact]
    public async Task QuantityAndConfiguredCurrencyValidationDoNotSilentlyRoundOrCreateStock()
    {
        var seed = await Seed(); var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["Inventory:Currency"] = "USD" }).Build();
        await using var db = PostgresFixture.Db(seed.Connection, "inventory");
        var request = new CreateInventoryPart(Guid.NewGuid(), "PRECISION", "Precision part", "HVAC", "Each", "USD", 0.12345m, 0, 0);
        Assert.Equal(400, (await Assert.ThrowsAsync<DomainException>(() => InventoryApi.CreatePart(request, db, configuration, Actor(), TimeProvider.System, default))).Status);
        db.ChangeTracker.Clear();
        Assert.Equal(400, (await Assert.ThrowsAsync<DomainException>(() => InventoryApi.CreatePart(request with { OperationId = Guid.NewGuid(), UnitCost = 1, Currency = "EUR" }, db, configuration, Actor(), TimeProvider.System, default))).Status);
        db.ChangeTracker.Clear();
        Assert.Equal(400, (await Assert.ThrowsAsync<DomainException>(() => InventoryApi.Receive(new(Guid.NewGuid(), seed.Part.Id, seed.Warehouse.Id, .0001m, "Invalid precision"), db, Actor(), TimeProvider.System, default))).Status);
        Assert.Empty(await db.Receipts.ToListAsync()); Assert.Empty(await db.InventoryMovements.ToListAsync());
    }

    private async Task<(string Connection, InventoryPart Part, StockLocation Warehouse, StockLocation Vehicle)> Seed(decimal onHand = 0)
    {
        var cs = await fixture.Database("inventory", false); await using var db = PostgresFixture.Db(cs, "inventory"); await SchemaMigrator.Apply(db);
        var part = new InventoryPart { TeamId = "north", Sku = "HVAC-FILTER", Name = "HVAC filter", Category = "HVAC", UnitCost = .1234m };
        var warehouse = new StockLocation { TeamId = "north", Name = "Central", Kind = "CentralWarehouse" };
        var vehicle = new StockLocation { TeamId = "north", Name = "Technician van", Kind = "Vehicle", TechnicianId = "tech-01" };
        db.InventoryParts.Add(part); db.StockLocations.AddRange(warehouse, vehicle);
        if (onHand > 0) db.StockBalances.Add(new StockBalance { PartId = part.Id, LocationId = warehouse.Id, OnHand = onHand });
        await db.SaveChangesAsync(); return (cs, part, warehouse, vehicle);
    }
    private static T Body<T>(IResult result) => Json.Read<T>(Assert.IsType<ContentHttpResult>(result).ResponseContent!);
    private static DefaultHttpContext Actor(string id = "manager-01", string role = "OperationsManager")
    {
        var http = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity([new Claim("sub", id), new Claim("team_id", "north"), new Claim(ClaimTypes.Role, role)], "test")) };
        http.Items["CorrelationId"] = Guid.NewGuid().ToString(); return http;
    }
    private sealed class Owner : IHttpClientFactory
    {
        public Dictionary<Guid, WorkOrder> Orders { get; } = [];
        public RemoteServices Remote => new(this, new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["Services:WorkOrders"] = "http://owner.test" }).Build());
        public WorkOrder Add() { var order = new WorkOrder { TeamId = "north", TechnicianId = "tech-01", Status = "InProgress" }; Orders.Add(order.Id, order); return order; }
        public HttpClient CreateClient(string name) => new(new Handler(Orders));
    }
    private sealed class Handler(Dictionary<Guid, WorkOrder> orders) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var id = Guid.Parse(request.RequestUri!.Segments[^1]);
            return Task.FromResult(orders.TryGetValue(id, out var order)
                ? new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(Json.Write(order), System.Text.Encoding.UTF8, "application/json") }
                : new HttpResponseMessage(HttpStatusCode.NotFound));
        }
    }
}
