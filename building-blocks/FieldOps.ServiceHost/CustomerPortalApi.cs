using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using FieldOps.Core;
using Microsoft.EntityFrameworkCore;

namespace FieldOps.ServiceHost;

/// <summary>A signed identity is provisioned for one customer organization; request JSON never grants membership.</summary>
public sealed record CustomerScope(Guid CustomerId, string TeamId, string Subject)
{
    public static CustomerScope From(ClaimsPrincipal user)
    {
        if (!user.IsInRole("Customer")) throw new DomainException(403, "A customer account is required.");
        if (!Guid.TryParse(user.FindFirst("customer_id")?.Value, out var id) || id == Guid.Empty ||
            string.IsNullOrWhiteSpace(user.FindFirst("team_id")?.Value) || string.IsNullOrWhiteSpace(user.FindFirst("sub")?.Value))
            throw new DomainException(403, "Your customer membership has not been provisioned. Contact the service office.");
        return new(id, user.FindFirst("team_id")!.Value, user.FindFirst("sub")!.Value);
    }
}

public sealed record PortalLocation(Guid Id, string Name, string AddressLine1, string? AddressLine2, string City, string Region, string PostalCode, string CountryCode, string Status);
public sealed record PortalAccount(Guid Id, string DisplayName, string CustomerType, string TeamId, string Status, int Version, PortalLocation[] Locations);
public sealed record PortalEquipment(Guid Id, string Name, string AssetType, string Manufacturer, string Model, string SerialNumber, string Status, Guid ServiceLocationId, DateTimeOffset? WarrantyEndUtc);
public sealed record SubmitServiceRequest(Guid ServiceLocationId, Guid? AssetId, string Title, string Description, string ServiceType, string Urgency, string IdempotencyKey);
public sealed record QualifyServiceRequest(int ExpectedVersion, string Decision, string Reason, string ServiceCategory, string Priority);
public sealed record PortalOrder(Guid Id, string Number, string Title, string SiteAddress, string Status, string ServiceCategory, string Priority, DateTimeOffset CreatedAtUtc, DateTimeOffset? CompletedAtUtc, Guid? CustomerId, Guid? ServiceLocationId, Guid? AssetId);

public static class CustomerPortalApi
{
    public static void Map(WebApplication app, string service)
    {
        if (service == "customers")
            app.MapGet("/api/customer-portal/account", async (ServiceDb db, HttpContext http, CancellationToken ct) =>
            {
                var scope = CustomerScope.From(http.User);
                var customer = await db.Customers.AsNoTracking().Include(x => x.Locations)
                    .SingleOrDefaultAsync(x => x.Id == scope.CustomerId && x.TeamId == scope.TeamId, ct)
                    ?? throw new DomainException(404, "Customer account not found.");
                return Results.Ok(new PortalAccount(customer.Id, customer.DisplayName, customer.CustomerType, customer.TeamId, customer.Status, customer.Version,
                    customer.Locations.OrderBy(x => x.Name).Select(x => new PortalLocation(x.Id, x.Name, x.AddressLine1, x.AddressLine2, x.City, x.Region, x.PostalCode, x.CountryCode, x.Status)).ToArray()));
            }).RequireAuthorization("customer");
        if (service == "assets")
            app.MapGet("/api/customer-portal/equipment", async (ServiceDb db, HttpContext http, CancellationToken ct) =>
            {
                var scope = CustomerScope.From(http.User);
                return Results.Ok(await db.Assets.AsNoTracking().Where(x => x.CustomerId == scope.CustomerId && x.TeamId == scope.TeamId)
                    .OrderBy(x => x.Name).Take(500).Select(x => new PortalEquipment(x.Id, x.Name, x.AssetType, x.Manufacturer, x.Model, x.SerialNumber, x.Status, x.ServiceLocationId, x.WarrantyEndUtc)).ToListAsync(ct));
            }).RequireAuthorization("customer");
        if (service == "work-orders") MapIntake(app);
        if (service == "scheduling")
            app.MapGet("/api/customer-portal/appointments", async (ServiceDb db, RemoteServices remote, HttpContext http, CancellationToken ct) =>
            {
                _ = CustomerScope.From(http.User);
                var orders = await remote.Get<PortalOrder[]>("WorkOrders", "/api/customer-portal/work-orders", http, ct);
                var ids = orders.Select(x => x.Id).ToArray();
                // No technician identity, availability, or other customer's calendar is exposed.
                return Results.Ok(await db.Bookings.AsNoTracking().Where(x => ids.Contains(x.WorkOrderId)).OrderByDescending(x => x.StartUtc)
                    .Select(x => new { x.Id, x.WorkOrderId, x.StartUtc, x.EndUtc, x.Status, x.Version }).Take(500).ToListAsync(ct));
            }).RequireAuthorization("customer");
    }

    private static void MapIntake(WebApplication app)
    {
        var portal = app.MapGroup("/api/customer-portal/work-orders").RequireAuthorization("customer");
        portal.MapGet("", async (ServiceDb db, HttpContext http, CancellationToken ct) =>
        {
            var scope = CustomerScope.From(http.User);
            var orders = await db.WorkOrders.AsNoTracking().Where(x => x.CustomerId == scope.CustomerId && x.TeamId == scope.TeamId)
                .OrderByDescending(x => x.CreatedAtUtc).Take(500).ToListAsync(ct);
            return Results.Ok(orders.Select(OrderView));
        });
        portal.MapGet("/{id:guid}", async (Guid id, ServiceDb db, HttpContext http, CancellationToken ct) =>
        {
            var scope = CustomerScope.From(http.User);
            var order = await db.WorkOrders.AsNoTracking().SingleOrDefaultAsync(x => x.Id == id && x.CustomerId == scope.CustomerId && x.TeamId == scope.TeamId, ct)
                ?? throw new DomainException(404, "Work order not found.");
            return Results.Ok(OrderView(order));
        });
        var group = app.MapGroup("/api/service-requests").RequireAuthorization("intake");
        group.MapGet("", async (ServiceDb db, HttpContext http, CancellationToken ct) =>
        {
            var query = VisibleRequests(db, http);
            return Results.Ok(await query.AsNoTracking().OrderByDescending(x => x.CreatedAtUtc).Take(500).ToListAsync(ct));
        });
        group.MapGet("/{id:guid}", async (Guid id, ServiceDb db, HttpContext http, CancellationToken ct) =>
            Results.Ok(await VisibleRequests(db, http).AsNoTracking().SingleOrDefaultAsync(x => x.Id == id, ct) ?? throw new DomainException(404, "Service request not found.")));
        group.MapPost("", Submit).RequireAuthorization("customer");
        group.MapPost("/{id:guid}/qualify", Qualify).RequireAuthorization("dispatch");
    }

    private static IQueryable<ServiceRequest> VisibleRequests(ServiceDb db, HttpContext http)
    {
        if (http.User.IsInRole("Customer"))
        {
            var customer = CustomerScope.From(http.User);
            return db.ServiceRequests.Where(x => x.CustomerId == customer.CustomerId && x.TeamId == customer.TeamId);
        }
        var caller = Caller.From(http.User);
        return db.ServiceRequests.Where(x => caller.IsAdministrator || x.TeamId == caller.TeamId);
    }

    private static async Task<IResult> Submit(SubmitServiceRequest input, ServiceDb db, RemoteServices remote, TimeProvider clock, HttpContext http, CancellationToken ct)
    {
        var scope = CustomerScope.From(http.User);
        CustomerRules.Text(input.IdempotencyKey, 8, 128, "operation ID");
        var key = $"{scope.Subject}:{scope.CustomerId}:service-request:{input.IdempotencyKey}";
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(Json.Write(input))));
        var receipt = await db.Receipts.AsNoTracking().SingleOrDefaultAsync(x => x.Id == key, ct);
        if (receipt is not null) return Receipt(receipt, scope.Subject, hash);
        var account = await remote.Get<PortalAccount>("Customers", "/api/customer-portal/account", http, ct);
        if (account.Id != scope.CustomerId || account.TeamId != scope.TeamId) throw new DomainException(404, "Customer account not found.");
        var location = account.Locations.SingleOrDefault(x => x.Id == input.ServiceLocationId) ?? throw new DomainException(404, "Service location not found.");
        if (account.Status != "Active" || location.Status != "Active") throw new DomainException(409, "Service requests require an active account and service location.");
        if (input.AssetId is { } assetId)
        {
            var equipment = await remote.Get<PortalEquipment[]>("Assets", "/api/customer-portal/equipment", http, ct);
            if (!equipment.Any(x => x.Id == assetId && x.ServiceLocationId == location.Id && x.Status == "Active"))
                throw new DomainException(404, "Active equipment was not found at this service location.");
        }
        var now = clock.GetUtcNow();
        var request = new ServiceRequest { CustomerId = scope.CustomerId, ServiceLocationId = location.Id, AssetId = input.AssetId, TeamId = scope.TeamId, SubmittedBy = scope.Subject,
            CustomerName = account.DisplayName, SiteAddress = Address(location), Title = input.Title?.Trim() ?? "", Description = input.Description?.Trim() ?? "", ServiceType = input.ServiceType, Urgency = input.Urgency, CreatedAtUtc = now, UpdatedAtUtc = now };
        ServiceRequestRules.Validate(request);
        db.ServiceRequests.Add(request);
        db.Enqueue(EventFactory.Create(http, "work-orders", "ServiceRequestSubmitted.v1", Guid.Empty,
            new { requestId = request.Id, request.CustomerId, request.TeamId, request.ServiceType, request.Urgency }, request.Version, now));
        db.Receipts.Add(new IdempotencyReceipt { Id = key, ActorId = scope.Subject, RequestHash = hash, ResponseJson = Json.Write(request), CreatedAtUtc = now });
        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateException ex) when (ex.InnerException is Npgsql.PostgresException { SqlState: "23505" })
        {
            db.ChangeTracker.Clear();
            var committed = await db.Receipts.AsNoTracking().SingleOrDefaultAsync(x => x.Id == key, ct);
            if (committed is null) throw;
            return Receipt(committed, scope.Subject, hash);
        }
        return Results.Created($"/api/service-requests/{request.Id}", request);
    }

    private static IResult Receipt(IdempotencyReceipt receipt, string actor, string hash)
    {
        if (receipt.ActorId != actor || receipt.RequestHash != hash) throw new DomainException(409, "This operation ID was already used for a different request.");
        var request = Json.Read<ServiceRequest>(receipt.ResponseJson);
        return Results.Created($"/api/service-requests/{request.Id}", request);
    }

    private static async Task<IResult> Qualify(Guid id, QualifyServiceRequest input, ServiceDb db, RemoteServices remote, TimeProvider clock, HttpContext http, CancellationToken ct)
    {
        var caller = Caller.From(http.User);
        var request = await db.ServiceRequests.SingleOrDefaultAsync(x => x.Id == id && (caller.IsAdministrator || x.TeamId == caller.TeamId), ct)
            ?? throw new DomainException(404, "Service request not found.");
        // Validate decisions before remote requests. EF's version token makes concurrent qualification atomic.
        if (request.Status != "Submitted" || request.Version != input.ExpectedVersion) throw new DomainException(409, "The request was already reviewed or changed. Refresh it.");
        var now = clock.GetUtcNow();
        WorkOrder? order = null;
        if (input.Decision == "Approve")
        {
            if (!new[] { "HVAC", "Electrical", "Mechanical", "Refrigeration", "Controls", "Heating", "Cooling", "Ventilation" }.Contains(input.ServiceCategory) ||
                !new[] { "Low", "Normal", "High", "Critical" }.Contains(input.Priority)) throw new DomainException(400, "Choose a valid service category and priority.");
            var customer = await remote.Get<CustomerView>("Customers", $"/api/customers/{request.CustomerId}", http, ct);
            var location = customer.Locations.SingleOrDefault(x => x.Id == request.ServiceLocationId);
            if (customer.TeamId != request.TeamId || customer.Status != "Active" || location?.Status != "Active") throw new DomainException(409, "The customer or location is no longer eligible for service.");
            if (request.AssetId is { } assetId)
            {
                var asset = await remote.Get<AssetReferenceView>("Assets", $"/api/assets/{assetId}/reference", http, ct);
                if (asset.TeamId != request.TeamId || asset.CustomerId != customer.Id || asset.ServiceLocationId != location.Id || asset.Status != "Active")
                    throw new DomainException(409, "The equipment moved or is no longer active. Review the request with the customer.");
            }
            order = new WorkOrder { Number = $"WO-{now:yyyyMMdd}-{Guid.NewGuid().ToString("N")[..6].ToUpperInvariant()}", Title = request.Title, ReportedProblem = request.Description,
                CustomerId = request.CustomerId, CustomerVersion = customer.Version, ServiceLocationId = request.ServiceLocationId, AssetId = request.AssetId,
                CustomerName = customer.DisplayName, SiteAddress = string.Join(", ", new[] { location.AddressLine1, location.AddressLine2, location.City, location.Region, location.PostalCode, location.CountryCode }.Where(x => !string.IsNullOrWhiteSpace(x))),
                TeamId = request.TeamId, ServiceCategory = input.ServiceCategory, Priority = input.Priority, CreatedAtUtc = now };
        }
        ServiceRequestRules.Decide(request, input.ExpectedVersion, input.Decision, input.Reason, now, order?.Id);
        if (order is not null)
        {
            var decision = await remote.Get<EntitlementDecision>("Customers", $"/api/contracts/entitlements?customerId={order.CustomerId:D}&serviceType={Uri.EscapeDataString(order.ServiceCategory)}{(order.AssetId is { } equipmentId ? "&assetId=" + equipmentId.ToString("D") : "")}", http, ct);
            MaintenanceDispatch.ApplyDecision(order, decision, now);
            db.WorkOrders.Add(order);
            db.Enqueue(EventFactory.Create(http, "work-orders", "WorkOrderCreated.v1", order.Id, OperationsApi.OrderPayload(order), order.Version, now));
        }
        db.Enqueue(EventFactory.Create(http, "work-orders", input.Decision == "Approve" ? "ServiceRequestQualified.v1" : "ServiceRequestRejected.v1", order?.Id ?? Guid.Empty,
            new { requestId = request.Id, request.CustomerId, request.TeamId, request.Status, request.WorkOrderId, request.ServiceType, request.Urgency }, request.Version, now));
        await db.SaveChangesAsync(ct);
        return Results.Ok(request);
    }

    private static string Address(PortalLocation location) => string.Join(", ", new[] { location.AddressLine1, location.AddressLine2, location.City, location.Region, location.PostalCode, location.CountryCode }.Where(x => !string.IsNullOrWhiteSpace(x)));
    private static PortalOrder OrderView(WorkOrder x) => new(x.Id, x.Number, x.Title, x.SiteAddress, x.Status, x.ServiceCategory, x.Priority, x.CreatedAtUtc, x.CompletedAtUtc, x.CustomerId, x.ServiceLocationId, x.AssetId);
}
