using System.Security.Cryptography;
using System.Text;
using FieldOps.Core;
using Microsoft.EntityFrameworkCore;

namespace FieldOps.ServiceHost;

public sealed record CreateInventoryPart(Guid OperationId, string Sku, string Name, string Category, string Unit, string Currency, decimal UnitCost, decimal ReorderPoint, decimal ReorderQuantity);
public sealed record CreateStockLocation(Guid OperationId, string Name, string Kind, string? TechnicianId = null);
public sealed record ReceiveInventory(Guid OperationId, Guid PartId, Guid LocationId, decimal Quantity, string Reason);
public sealed record ReserveInventory(Guid OperationId, Guid WorkOrderId, Guid PartId, Guid LocationId, decimal Quantity);
public sealed record InventoryQuantityReason(Guid OperationId, decimal Quantity, string Reason);
public sealed record ConsumeInventory(Guid OperationId, Guid WorkOrderId, Guid PartId, Guid LocationId, decimal Quantity, Guid? ReservationId = null);
public sealed record TransferInventory(Guid OperationId, Guid PartId, Guid SourceLocationId, Guid DestinationLocationId, decimal Quantity, Guid? WorkOrderId = null);
public sealed record ReceiveTransfer(Guid OperationId, decimal Quantity);
public sealed record AdjustInventory(Guid OperationId, Guid PartId, Guid LocationId, decimal QuantityDelta, string Reason);
public sealed record RequestInventoryPart(Guid OperationId, Guid WorkOrderId, Guid PartId, decimal Quantity, string Reason, string Kind = "Additional");
public sealed record CloseInventoryRequest(Guid OperationId, string Reason);
public sealed record InventoryBalanceView(Guid PartId, Guid LocationId, decimal OnHand, decimal Reserved, decimal Available, int Version, string PartName, string Sku, string LocationName, bool BelowReorderPoint);

public static class InventoryApi
{
    public static void Map(WebApplication app)
    {
        var group = app.MapGroup("/api/inventory").RequireAuthorization("inventory-read");
        group.MapGet("/parts", async (ServiceDb db, HttpContext http, CancellationToken ct, string? q = null, int page = 1, int pageSize = 500) =>
        {
            var caller = Caller.From(http.User); var term = Search(q);
            var query = db.InventoryParts.AsNoTracking().Where(x => caller.IsAdministrator || x.TeamId == caller.TeamId);
            if (term.Length > 0) query = query.Where(x => x.Sku.ToLower().Contains(term) || x.Name.ToLower().Contains(term) || x.Category.ToLower().Contains(term));
            return Results.Ok(await Page(query.OrderBy(x => x.Sku).ThenBy(x => x.Id), http, page, pageSize, ct));
        });
        group.MapGet("/locations", async (ServiceDb db, HttpContext http, CancellationToken ct, string? q = null, int page = 1, int pageSize = 500) =>
        {
            var term = Search(q); var query = Locations(db, Caller.From(http.User));
            if (term.Length > 0) query = query.Where(x => x.Name.ToLower().Contains(term));
            return Results.Ok(await Page(query.OrderBy(x => x.Name).ThenBy(x => x.Id), http, page, pageSize, ct));
        });
        group.MapGet("/balances", async (ServiceDb db, HttpContext http, CancellationToken ct, Guid? locationId = null, Guid? partId = null, string? q = null, int page = 1, int pageSize = 500) =>
            Results.Ok(await Balances(db, Caller.From(http.User), locationId, ct, partId: partId, q: q, page: page, pageSize: pageSize, http: http)));
        group.MapGet("/work-orders/{id:guid}", WorkOrderContext);
        group.MapGet("/movements", async (ServiceDb db, RemoteServices remote, HttpContext http, CancellationToken ct, Guid? workOrderId = null, Guid? partId = null, string? q = null, int page = 1, int pageSize = 500) =>
        {
            var caller = Caller.From(http.User); var term = Search(q);
            if (caller.IsTechnician && workOrderId is null) throw new DomainException(400, "Select an assigned work order to review movement history.");
            if (workOrderId.HasValue) _ = await Order(workOrderId.Value, remote, http, false, ct);
            var query = db.InventoryMovements.AsNoTracking().Where(x => caller.IsAdministrator || x.TeamId == caller.TeamId);
            if (workOrderId.HasValue) query = query.Where(x => x.WorkOrderId == workOrderId.Value);
            if (partId.HasValue) query = query.Where(x => x.PartId == partId.Value);
            if (term.Length > 0) query = query.Where(x => x.Kind.ToLower().Contains(term) || x.Reason.ToLower().Contains(term));
            return Results.Ok(await Page(query.OrderByDescending(x => x.OccurredAtUtc).ThenBy(x => x.Id), http, page, pageSize, ct));
        });
        group.MapGet("/transfers", async (ServiceDb db, RemoteServices remote, HttpContext http, CancellationToken ct, Guid? workOrderId = null, int page = 1, int pageSize = 500) =>
        {
            var caller = Caller.From(http.User); var permitted = Locations(db, caller).Select(x => x.Id);
            if (workOrderId.HasValue) _ = await Order(workOrderId.Value, remote, http, false, ct);
            var query = db.StockTransfers.AsNoTracking().Where(x => (caller.IsAdministrator || x.TeamId == caller.TeamId) && (!caller.IsTechnician || permitted.Contains(x.DestinationLocationId)));
            if (workOrderId.HasValue) query = query.Where(x => x.WorkOrderId == workOrderId.Value);
            return Results.Ok(await Page(query.OrderByDescending(x => x.CreatedAtUtc).ThenBy(x => x.Id), http, page, pageSize, ct));
        });
        group.MapPost("/parts", CreatePart).RequireAuthorization("inventory-manage");
        group.MapPost("/locations", CreateLocation).RequireAuthorization("inventory-manage");
        group.MapPost("/stock/receive", Receive).RequireAuthorization("inventory-manage");
        group.MapPost("/reservations", Reserve).RequireAuthorization("inventory-manage");
        group.MapPost("/reservations/{id:guid}/release", Release).RequireAuthorization("inventory-manage");
        group.MapPost("/consumptions", Consume).RequireAuthorization("execute");
        group.MapPost("/consumptions/{id:guid}/return", Return).RequireAuthorization("execute");
        group.MapPost("/transfers", Transfer).RequireAuthorization("inventory-manage");
        group.MapPost("/transfers/{id:guid}/receive", ReceiveStockTransfer).RequireAuthorization("execute");
        group.MapPost("/adjustments", Adjust).RequireAuthorization("inventory-adjust");
        group.MapPost("/requests", RequestPart);
        group.MapPost("/requests/{id:guid}/close", CloseRequest).RequireAuthorization("inventory-manage");
    }

    public static Task<IResult> CreatePart(CreateInventoryPart request, ServiceDb db, IConfiguration configuration, HttpContext http, TimeProvider clock, CancellationToken ct)
    {
        var caller = Caller.From(http.User);
        return Commit(request.OperationId, request, "part-create", Team(caller), db, http, clock, async now =>
        {
            InventoryRules.Text(request.Sku, 2, 64, "SKU"); InventoryRules.Text(request.Name, 2, 160, "Part name");
            InventoryRules.Text(request.Category, 2, 80, "Part category"); InventoryRules.Text(request.Unit, 1, 24, "Part unit");
            var currency = request.Currency?.Trim().ToUpperInvariant() ?? "";
            if (currency.Length != 3 || currency.Any(x => x is < 'A' or > 'Z')) throw new DomainException(400, "Currency must be a three-letter currency code.");
            var configuredCurrency = configuration["Inventory:Currency"];
            if (string.IsNullOrWhiteSpace(configuredCurrency)) throw new DomainException(503, "Inventory currency is not configured.");
            if (currency != configuredCurrency) throw new DomainException(400, "Part currency must match the configured inventory currency.");
            InventoryRules.Cost(request.UnitCost);
            if (request.ReorderPoint < 0 || request.ReorderQuantity < 0) throw new DomainException(400, "Reorder policy quantities cannot be negative.");
            if (request.ReorderPoint > 0) InventoryRules.Quantity(request.ReorderPoint);
            if (request.ReorderQuantity > 0) InventoryRules.Quantity(request.ReorderQuantity);
            var part = new InventoryPart { TeamId = Team(caller), Sku = request.Sku.Trim().ToUpperInvariant(), Name = request.Name.Trim(), Category = request.Category.Trim(), Unit = request.Unit.Trim(), Currency = currency, UnitCost = request.UnitCost, ReorderPoint = request.ReorderPoint, ReorderQuantity = request.ReorderQuantity };
            if (await db.InventoryParts.AnyAsync(x => x.TeamId == part.TeamId && x.Sku == part.Sku, ct)) throw new DomainException(409, "This SKU already exists for the team.");
            db.InventoryParts.Add(part); Emit(db, http, "InventoryPartCreated.v1", part.TeamId, null, new { part.Id, part.Sku }, now); return part;
        }, ct);
    }

    public static async Task<IResult> CreateLocation(CreateStockLocation request, ServiceDb db, RemoteServices remote, HttpContext http, TimeProvider clock, CancellationToken ct)
    {
        var caller = Caller.From(http.User);
        if (request.Kind == "Vehicle")
        {
            InventoryRules.Text(request.TechnicianId, 1, 100, "Vehicle technician");
            var technician = await remote.Get<Technician>("Technicians", $"/api/technicians/{Uri.EscapeDataString(request.TechnicianId!)}", http, ct);
            if (technician.TeamId != Team(caller)) throw new DomainException(404, "Technician not found for this team.");
        }
        return await Commit(request.OperationId, request, "location-create", Team(caller), db, http, clock, now =>
        {
            InventoryRules.Text(request.Name, 2, 160, "Stock location name");
            if (!InventoryRules.LocationKinds.Contains(request.Kind) || (request.Kind != "Vehicle" && request.TechnicianId is not null)) throw new DomainException(400, "Select a valid stock location kind; only vehicles have technicians.");
            var location = new StockLocation { TeamId = Team(caller), Name = request.Name.Trim(), Kind = request.Kind, TechnicianId = request.TechnicianId };
            db.StockLocations.Add(location); Emit(db, http, "StockLocationCreated.v1", location.TeamId, null, new { location.Id, location.Kind }, now); return Task.FromResult<object>(location);
        }, ct);
    }

    public static async Task<IResult> Receive(ReceiveInventory request, ServiceDb db, HttpContext http, TimeProvider clock, CancellationToken ct)
    {
        var part = await Part(request.PartId, db, http, ct);
        return await Commit(request.OperationId, request, "stock-receive", part.TeamId, db, http, clock, async now =>
        {
            var location = await Location(request.LocationId, part.TeamId, db, http, false, ct);
            InventoryRules.Text(request.Reason, 3, 1000, "Receipt reason");
            var balance = await Balance(part.Id, location.Id, db, ct); InventoryRules.Receive(balance, request.Quantity);
            Movement(db, http, part, null, location.Id, null, Guid.NewGuid(), "Receipt", request.Quantity, request.Reason, now);
            return View(balance, part, location);
        }, ct);
    }

    public static async Task<IResult> Reserve(ReserveInventory request, ServiceDb db, RemoteServices remote, HttpContext http, TimeProvider clock, CancellationToken ct)
    {
        var order = await Order(request.WorkOrderId, remote, http, false, ct); var part = await Part(request.PartId, db, http, ct); RequireTeam(part.TeamId, order.TeamId);
        return await Commit(request.OperationId, request, "reserve", part.TeamId, db, http, clock, async now =>
        {
            RequireOpen(order); var location = await Location(request.LocationId, part.TeamId, db, http, false, ct);
            if (await db.InventoryReservations.AnyAsync(x => x.WorkOrderId == order.Id && x.PartId == part.Id && x.LocationId == location.Id && x.Status == "Active", ct)) throw new DomainException(409, "An active reservation already exists for this job, part, and location.");
            var balance = await Balance(part.Id, location.Id, db, ct); InventoryRules.Reserve(balance, request.Quantity);
            var reservation = new InventoryReservation { TeamId = part.TeamId, WorkOrderId = order.Id, PartId = part.Id, LocationId = location.Id, Quantity = request.Quantity, ActorId = Caller.From(http.User).Id, CreatedAtUtc = now };
            db.InventoryReservations.Add(reservation); Movement(db, http, part, location.Id, location.Id, order.Id, reservation.Id, "Reservation", request.Quantity, "Reserved for work order", now); return reservation;
        }, ct);
    }

    public static async Task<IResult> Release(Guid id, InventoryQuantityReason request, ServiceDb db, RemoteServices remote, HttpContext http, TimeProvider clock, CancellationToken ct)
    {
        var reference = await db.InventoryReservations.AsNoTracking().SingleOrDefaultAsync(x => x.Id == id, ct) ?? throw new DomainException(404, "Reservation not found.");
        _ = await Order(reference.WorkOrderId, remote, http, false, ct); Caller.From(http.User).Demand(reference.TeamId);
        return await Commit(request.OperationId, request, "release:" + id, reference.TeamId, db, http, clock, async now =>
        {
            InventoryRules.Text(request.Reason, 3, 1000, "Release reason");
            var reservation = await db.InventoryReservations.SingleAsync(x => x.Id == id, ct);
            var part = await Part(reservation.PartId, db, http, ct);
            var balance = await Balance(part.Id, reservation.LocationId, db, ct); InventoryRules.Release(balance, reservation, request.Quantity);
            Movement(db, http, part, reservation.LocationId, reservation.LocationId, reservation.WorkOrderId, id, "Release", request.Quantity, request.Reason, now); return reservation;
        }, ct);
    }

    public static async Task<IResult> Consume(ConsumeInventory request, ServiceDb db, RemoteServices remote, HttpContext http, TimeProvider clock, CancellationToken ct)
    {
        var order = await Order(request.WorkOrderId, remote, http, false, ct); var part = await Part(request.PartId, db, http, ct); RequireTeam(part.TeamId, order.TeamId);
        return await Commit(request.OperationId, request, "consume", part.TeamId, db, http, clock, async now =>
        {
            RequireOpen(order); var location = await Location(request.LocationId, part.TeamId, db, http, true, ct);
            var reservation = request.ReservationId.HasValue ? await db.InventoryReservations.SingleOrDefaultAsync(x => x.Id == request.ReservationId, ct) ?? throw new DomainException(404, "Reservation not found.") : null;
            if (reservation is not null && (reservation.WorkOrderId != order.Id || reservation.PartId != part.Id || reservation.LocationId != location.Id)) throw new DomainException(404, "Reservation does not belong to this job, part, and location.");
            var balance = await Balance(part.Id, location.Id, db, ct); InventoryRules.Consume(balance, request.Quantity, reservation);
            var consumption = new InventoryConsumption { TeamId = part.TeamId, WorkOrderId = order.Id, PartId = part.Id, LocationId = location.Id, ReservationId = reservation?.Id, Quantity = request.Quantity, UnitCost = part.UnitCost, Currency = part.Currency, ActorId = Caller.From(http.User).Id, CreatedAtUtc = now };
            db.InventoryConsumptions.Add(consumption); Movement(db, http, part, location.Id, null, order.Id, consumption.Id, "Consumption", request.Quantity, "Consumed during service", now);
            Emit(db, http, "PartConsumed.v1", part.TeamId, order.Id, consumption, now); return consumption;
        }, ct);
    }

    public static async Task<IResult> Return(Guid id, InventoryQuantityReason request, ServiceDb db, RemoteServices remote, HttpContext http, TimeProvider clock, CancellationToken ct)
    {
        var reference = await db.InventoryConsumptions.AsNoTracking().SingleOrDefaultAsync(x => x.Id == id, ct) ?? throw new DomainException(404, "Consumption not found.");
        var order = await Order(reference.WorkOrderId, remote, http, false, ct); RequireTeam(reference.TeamId, order.TeamId);
        return await Commit(request.OperationId, request, "return:" + id, reference.TeamId, db, http, clock, async now =>
        {
            var consumption = await db.InventoryConsumptions.SingleAsync(x => x.Id == id, ct);
            _ = await Location(consumption.LocationId, consumption.TeamId, db, http, true, ct);
            var part = await Part(consumption.PartId, db, http, ct); InventoryRules.Text(request.Reason, 3, 1000, "Return reason");
            var balance = await Balance(part.Id, consumption.LocationId, db, ct); InventoryRules.Return(balance, consumption, request.Quantity);
            Movement(db, http, part, null, consumption.LocationId, order.Id, id, "Return", request.Quantity, request.Reason, now);
            Emit(db, http, "PartReturned.v1", part.TeamId, order.Id, new { consumption.Id, quantity = request.Quantity, consumption.UnitCost, consumption.Currency }, now); return consumption;
        }, ct);
    }

    public static async Task<IResult> Transfer(TransferInventory request, ServiceDb db, RemoteServices remote, HttpContext http, TimeProvider clock, CancellationToken ct)
    {
        var part = await Part(request.PartId, db, http, ct);
        var order = request.WorkOrderId.HasValue ? await Order(request.WorkOrderId.Value, remote, http, false, ct) : null;
        if (order is not null) RequireTeam(part.TeamId, order.TeamId);
        return await Commit(request.OperationId, request, "transfer", part.TeamId, db, http, clock, async now =>
        {
            if (order is not null) RequireOpen(order);
            if (request.SourceLocationId == request.DestinationLocationId) throw new DomainException(400, "A transfer requires two different stock locations.");
            _ = await Location(request.SourceLocationId, part.TeamId, db, http, false, ct); _ = await Location(request.DestinationLocationId, part.TeamId, db, http, false, ct);
            var source = await Balance(part.Id, request.SourceLocationId, db, ct); InventoryRules.TransferOut(source, request.Quantity);
            var transfer = new StockTransfer { TeamId = part.TeamId, PartId = part.Id, SourceLocationId = request.SourceLocationId, DestinationLocationId = request.DestinationLocationId, WorkOrderId = request.WorkOrderId, Quantity = request.Quantity, ActorId = Caller.From(http.User).Id, CreatedAtUtc = now };
            db.StockTransfers.Add(transfer); Movement(db, http, part, transfer.SourceLocationId, transfer.DestinationLocationId, transfer.WorkOrderId, transfer.Id, "TransferSent", request.Quantity, "Stock in transit pending destination receipt", now); return transfer;
        }, ct);
    }

    public static async Task<IResult> ReceiveStockTransfer(Guid id, ReceiveTransfer request, ServiceDb db, HttpContext http, TimeProvider clock, CancellationToken ct)
    {
        var reference = await db.StockTransfers.AsNoTracking().SingleOrDefaultAsync(x => x.Id == id, ct) ?? throw new DomainException(404, "Stock transfer not found.");
        Caller.From(http.User).Demand(reference.TeamId, Caller.From(http.User).Id);
        return await Commit(request.OperationId, request, "transfer-receive:" + id, reference.TeamId, db, http, clock, async now =>
        {
            var transfer = await db.StockTransfers.SingleAsync(x => x.Id == id, ct); var part = await Part(transfer.PartId, db, http, ct);
            _ = await Location(transfer.DestinationLocationId, transfer.TeamId, db, http, true, ct);
            InventoryRules.Quantity(request.Quantity);
            if (transfer.Status != "InTransit" || transfer.Quantity - transfer.ReceivedQuantity < request.Quantity) throw new DomainException(409, "Receipt exceeds the unreceived transfer quantity.");
            var destination = await Balance(part.Id, transfer.DestinationLocationId, db, ct); InventoryRules.Receive(destination, request.Quantity);
            transfer.ReceivedQuantity += request.Quantity;
            if (transfer.ReceivedQuantity == transfer.Quantity) { transfer.Status = "Received"; transfer.ReceivedAtUtc = now; }
            Movement(db, http, part, transfer.SourceLocationId, transfer.DestinationLocationId, transfer.WorkOrderId, id, "TransferReceived", request.Quantity, "Destination stock receipt", now); return transfer;
        }, ct);
    }

    public static async Task<IResult> Adjust(AdjustInventory request, ServiceDb db, HttpContext http, TimeProvider clock, CancellationToken ct)
    {
        var part = await Part(request.PartId, db, http, ct);
        return await Commit(request.OperationId, request, "adjust", part.TeamId, db, http, clock, async now =>
        {
            var location = await Location(request.LocationId, part.TeamId, db, http, false, ct); InventoryRules.Text(request.Reason, 5, 1000, "Adjustment reason");
            var balance = await Balance(part.Id, location.Id, db, ct); InventoryRules.Adjust(balance, request.QuantityDelta);
            Movement(db, http, part, request.QuantityDelta < 0 ? location.Id : null, request.QuantityDelta > 0 ? location.Id : null, null, Guid.NewGuid(), "Adjustment", request.QuantityDelta, request.Reason, now); return View(balance, part, location);
        }, ct);
    }

    public static async Task<IResult> RequestPart(RequestInventoryPart request, ServiceDb db, RemoteServices remote, HttpContext http, TimeProvider clock, CancellationToken ct)
    {
        var order = await Order(request.WorkOrderId, remote, http, false, ct); var part = await Part(request.PartId, db, http, ct); RequireTeam(part.TeamId, order.TeamId);
        return await Commit(request.OperationId, request, "part-request", part.TeamId, db, http, clock, now =>
        {
            RequireOpen(order); InventoryRules.Quantity(request.Quantity); InventoryRules.Text(request.Reason, 3, 1000, "Part request reason");
            if (request.Kind is not ("Missing" or "Additional")) throw new DomainException(400, "Request kind must be Missing or Additional.");
            var item = new InventoryPartRequest { TeamId = part.TeamId, PartId = part.Id, WorkOrderId = order.Id, Quantity = request.Quantity, Kind = request.Kind, Reason = request.Reason.Trim(), ActorId = Caller.From(http.User).Id, CreatedAtUtc = now };
            db.InventoryPartRequests.Add(item); Emit(db, http, "PartRequested.v1", part.TeamId, order.Id, item, now); return Task.FromResult<object>(item);
        }, ct);
    }

    public static async Task<IResult> CloseRequest(Guid id, CloseInventoryRequest request, ServiceDb db, HttpContext http, TimeProvider clock, CancellationToken ct)
    {
        var reference = await db.InventoryPartRequests.AsNoTracking().SingleOrDefaultAsync(x => x.Id == id, ct) ?? throw new DomainException(404, "Part request not found."); Caller.From(http.User).Demand(reference.TeamId);
        return await Commit(request.OperationId, request, "part-request-close:" + id, reference.TeamId, db, http, clock, async now =>
        {
            InventoryRules.Text(request.Reason, 3, 1000, "Resolution reason"); var item = await db.InventoryPartRequests.SingleAsync(x => x.Id == id, ct);
            if (item.Status != "Open") throw new DomainException(409, "This part request is already closed.");
            item.Status = "Closed"; item.Resolution = request.Reason.Trim(); item.ClosedAtUtc = now; item.ClosedBy = Caller.From(http.User).Id;
            Emit(db, http, "PartRequestClosed.v1", item.TeamId, item.WorkOrderId, item, now); return item;
        }, ct);
    }

    public static async Task<IResult> WorkOrderContext(Guid id, ServiceDb db, RemoteServices remote, HttpContext http, CancellationToken ct)
    {
        var order = await Order(id, remote, http, false, ct); var caller = Caller.From(http.User);
        return Results.Ok(new
        {
            parts = await db.InventoryParts.AsNoTracking().Where(x => x.TeamId == order.TeamId && x.Active).OrderBy(x => x.Sku).Take(500).ToListAsync(ct),
            locations = await Locations(db, caller).Where(x => x.TeamId == order.TeamId).OrderBy(x => x.Name).Take(500).ToListAsync(ct),
            balances = await Balances(db, caller, null, ct, order.TeamId),
            reservations = await db.InventoryReservations.AsNoTracking().Where(x => x.WorkOrderId == id && x.TeamId == order.TeamId).OrderByDescending(x => x.CreatedAtUtc).Take(500).ToListAsync(ct),
            consumptions = await db.InventoryConsumptions.AsNoTracking().Where(x => x.WorkOrderId == id && x.TeamId == order.TeamId).OrderByDescending(x => x.CreatedAtUtc).Take(500).ToListAsync(ct),
            requests = await db.InventoryPartRequests.AsNoTracking().Where(x => x.WorkOrderId == id && x.TeamId == order.TeamId).OrderByDescending(x => x.CreatedAtUtc).Take(500).ToListAsync(ct),
            transfers = await db.StockTransfers.AsNoTracking().Where(x => x.WorkOrderId == id && x.TeamId == order.TeamId).OrderByDescending(x => x.CreatedAtUtc).Take(500).ToListAsync(ct),
            movements = await db.InventoryMovements.AsNoTracking().Where(x => x.WorkOrderId == id && x.TeamId == order.TeamId).OrderByDescending(x => x.OccurredAtUtc).Take(500).ToListAsync(ct)
        });
    }

    // Short local transactions serialize each team's ledger; owner API calls finish before this lock.
    public static async Task<IResult> Commit(Guid operationId, object request, string operation, string team, ServiceDb db, HttpContext http, TimeProvider clock, Func<DateTimeOffset, Task<object>> change, CancellationToken ct)
    {
        if (operationId == Guid.Empty) throw new DomainException(400, "A nonempty operation ID is required.");
        var caller = Caller.From(http.User); var key = $"inventory:{caller.Id}:{operationId:D}";
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(operation + ":" + Json.Write(request))));
        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({"inventory:" + team},0))", ct);
        var receipt = await db.Receipts.AsNoTracking().SingleOrDefaultAsync(x => x.Id == key, ct);
        if (receipt is not null)
        {
            if (receipt.ActorId != caller.Id || receipt.RequestHash != hash) throw new DomainException(409, "Operation ID was already used for a different inventory command.");
            return Results.Content(receipt.ResponseJson, "application/json");
        }
        var now = clock.GetUtcNow(); var response = Json.Write(await change(now));
        db.Receipts.Add(new IdempotencyReceipt { Id = key, ActorId = caller.Id, RequestHash = hash, ResponseJson = response, CreatedAtUtc = now });
        await db.SaveChangesAsync(ct); await transaction.CommitAsync(ct); return Results.Content(response, "application/json");
    }

    private static IQueryable<StockLocation> Locations(ServiceDb db, Caller caller) => db.StockLocations.AsNoTracking().Where(x => (caller.IsAdministrator || x.TeamId == caller.TeamId) && (!caller.IsTechnician || (x.Kind == "Vehicle" && x.TechnicianId == caller.Id)));
    private static async Task<InventoryBalanceView[]> Balances(ServiceDb db, Caller caller, Guid? locationId, CancellationToken ct, string? team = null, Guid? partId = null, string? q = null, int page = 1, int pageSize = 500, HttpContext? http = null)
    {
        var term = Search(q);
        var query = from balance in db.StockBalances.AsNoTracking()
                    join part in db.InventoryParts.AsNoTracking() on balance.PartId equals part.Id
                    join location in Locations(db, caller) on balance.LocationId equals location.Id
                    where (!locationId.HasValue || location.Id == locationId.Value) && (team == null || part.TeamId == team) && (!partId.HasValue || part.Id == partId.Value) && (term == "" || part.Sku.ToLower().Contains(term) || part.Name.ToLower().Contains(term) || location.Name.ToLower().Contains(term))
                    orderby part.Sku, location.Name
                    select new InventoryBalanceView(part.Id, location.Id, balance.OnHand, balance.Reserved, balance.OnHand - balance.Reserved, balance.Version, part.Name, part.Sku, location.Name, balance.OnHand - balance.Reserved <= part.ReorderPoint);
        return await Page(query.OrderBy(x => x.Sku).ThenBy(x => x.LocationName).ThenBy(x => x.PartId).ThenBy(x => x.LocationId), http, page, pageSize, ct);
    }
    private static string Search(string? value)
    {
        if (value?.Length > 100) throw new DomainException(400, "Inventory search cannot exceed 100 characters.");
        return value?.Trim().ToLowerInvariant() ?? "";
    }
    private static async Task<T[]> Page<T>(IQueryable<T> query, HttpContext? http, int page, int pageSize, CancellationToken ct)
    {
        if (page is < 1 or > 1_000_000 || pageSize is < 1 or > 500) throw new DomainException(400, "Inventory page must be positive and page size between 1 and 500.");
        if (http is not null)
        {
            var count = await query.CountAsync(ct);
            http.Response.Headers["X-Total-Count"] = count.ToString(System.Globalization.CultureInfo.InvariantCulture);
            http.Response.Headers["X-Has-More"] = (count > (long)page * pageSize).ToString().ToLowerInvariant();
        }
        return await query.Skip((page - 1) * pageSize).Take(pageSize).ToArrayAsync(ct);
    }
    private static InventoryBalanceView View(StockBalance balance, InventoryPart part, StockLocation location) => new(part.Id, location.Id, balance.OnHand, balance.Reserved, balance.Available, balance.Version, part.Name, part.Sku, location.Name, balance.Available <= part.ReorderPoint);
    private static async Task<InventoryPart> Part(Guid id, ServiceDb db, HttpContext http, CancellationToken ct)
    {
        var part = await db.InventoryParts.AsNoTracking().SingleOrDefaultAsync(x => x.Id == id && x.Active, ct) ?? throw new DomainException(404, "Part not found.");
        var caller = Caller.From(http.User); if (!caller.IsAdministrator && part.TeamId != caller.TeamId) throw new DomainException(404, "Part not found."); return part;
    }
    private static async Task<StockLocation> Location(Guid id, string team, ServiceDb db, HttpContext http, bool technicianAllowed, CancellationToken ct)
    {
        var location = await db.StockLocations.AsNoTracking().SingleOrDefaultAsync(x => x.Id == id && x.TeamId == team && x.Active, ct) ?? throw new DomainException(404, "Stock location not found.");
        var caller = Caller.From(http.User);
        if (!caller.IsAdministrator && (caller.TeamId != team || (caller.IsTechnician && (!technicianAllowed || location.Kind != "Vehicle" || location.TechnicianId != caller.Id)))) throw new DomainException(404, "Stock location not found.");
        return location;
    }
    private static async Task<StockBalance> Balance(Guid partId, Guid locationId, ServiceDb db, CancellationToken ct)
    {
        var balance = await db.StockBalances.SingleOrDefaultAsync(x => x.PartId == partId && x.LocationId == locationId, ct);
        if (balance is null) { balance = new StockBalance { PartId = partId, LocationId = locationId }; db.StockBalances.Add(balance); }
        return balance;
    }
    private static async Task<WorkOrder> Order(Guid id, RemoteServices remote, HttpContext http, bool open, CancellationToken ct)
    {
        var order = await remote.Get<WorkOrder>("WorkOrders", $"/api/work-orders/{id:D}", http, ct); Caller.From(http.User).Demand(order.TeamId, order.TechnicianId);
        if (open && order.Status is "Cancelled" or "Completed") throw new DomainException(409, "This work order no longer accepts inventory operations."); return order;
    }
    private static void RequireOpen(WorkOrder order) { if (order.Status is "Cancelled" or "Completed") throw new DomainException(409, "This work order no longer accepts inventory operations."); }
    private static string Team(Caller caller) { InventoryRules.Text(caller.TeamId, 1, 100, "Signed team claim"); return caller.TeamId; }
    private static void RequireTeam(string partTeam, string orderTeam) { if (partTeam != orderTeam) throw new DomainException(404, "Part not found for this work order."); }
    private static void Movement(ServiceDb db, HttpContext http, InventoryPart part, Guid? source, Guid? destination, Guid? workOrderId, Guid referenceId, string kind, decimal quantity, string reason, DateTimeOffset now)
    {
        var actor = Caller.From(http.User);
        var movement = new InventoryMovement { TeamId = part.TeamId, PartId = part.Id, SourceLocationId = source, DestinationLocationId = destination, WorkOrderId = workOrderId, ReferenceId = referenceId, Kind = kind, Quantity = quantity, Reason = reason.Trim(), ActorId = actor.Id, ActorRole = actor.Role, CorrelationId = http.Items["CorrelationId"]?.ToString() ?? Guid.NewGuid().ToString(), OccurredAtUtc = now };
        db.InventoryMovements.Add(movement); Emit(db, http, "InventoryMovementRecorded.v1", part.TeamId, workOrderId, movement, now);
    }
    private static void Emit(ServiceDb db, HttpContext http, string eventType, string team, Guid? orderId, object data, DateTimeOffset now) => db.Enqueue(EventFactory.Create(http, "inventory", eventType, orderId ?? Guid.Empty, new { teamId = team, data }, now.UtcTicks, now));
}
