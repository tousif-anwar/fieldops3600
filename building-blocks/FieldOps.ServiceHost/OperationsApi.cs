using System.Security.Cryptography;
using System.Text;
using FieldOps.Core;
using Microsoft.EntityFrameworkCore;

namespace FieldOps.ServiceHost;

public sealed record CreateOrder(string Title, string? CustomerName, string? SiteAddress, string ServiceCategory, string Priority, string TeamId, Guid? CustomerId = null, Guid? ServiceLocationId = null, string? UnregisteredCustomerReason = null, Guid? AssetId = null);
public sealed record UpdateOrder(int ExpectedVersion, string Title, string Priority, string Status);
public sealed record LinkOrderAsset(int ExpectedVersion, Guid? AssetId);
public sealed record AssetReferenceView(Guid Id, string TeamId, Guid CustomerId, Guid ServiceLocationId, string Status);
public sealed record CreateBooking(Guid WorkOrderId, string TechnicianId, DateTimeOffset StartUtc, DateTimeOffset EndUtc, string? OverrideReason);
public sealed record MoveBooking(int ExpectedVersion, DateTimeOffset StartUtc, DateTimeOffset EndUtc, string Reason);
public sealed record StartWorkflow(Guid WorkOrderId);
public sealed record SubmitStage(int ExpectedVersion, string IdempotencyKey, Dictionary<string, string> Answers, DateTimeOffset? ClientOccurredAtUtc, bool Offline = false);
public sealed record Intervention(int ExpectedVersion, string Reason, int? TargetStageIndex);
public sealed record RecommendationRequest(Guid WorkOrderId, DateTimeOffset StartUtc, int DurationMinutes = 60, string Strategy = "baseline");
public sealed record TimeOffRequest(DateTimeOffset StartUtc, DateTimeOffset EndUtc, string Reason);

public sealed class RemoteServices(IHttpClientFactory factory, IConfiguration config)
{
    public async Task<T> Get<T>(string service, string path, HttpContext http, CancellationToken ct)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, $"{config[$"Services:{service}"] ?? throw new InvalidOperationException($"Missing service URL {service}")}{path}");
        if (http.Request.Headers.TryGetValue("Authorization", out var authorization)) request.Headers.TryAddWithoutValidation("Authorization", authorization.ToString());
        request.Headers.TryAddWithoutValidation("X-Correlation-ID", http.Items["CorrelationId"]?.ToString());
        using var response = await factory.CreateClient("services").SendAsync(request, ct);
        if (!response.IsSuccessStatusCode) throw new DomainException(response.StatusCode is System.Net.HttpStatusCode.NotFound ? 404 : 409, $"Unable to validate {service} resource ({(int)response.StatusCode}).");
        return (await response.Content.ReadFromJsonAsync<T>(Json.Options, ct))!;
    }
}

public static class OperationsApi
{
    public static void Map(WebApplication app, string service)
    {
        switch (service)
        {
            case "customers": CustomerApi.Map(app); break;
            case "assets": AssetApi.Map(app); break;
            case "work-orders": MapOrders(app); break;
            case "technicians": MapTechnicians(app); break;
            case "scheduling": MapScheduling(app); AssignmentOfferApi.Map(app); break;
            case "workflows": MapWorkflows(app); break;
        }
    }

    private static void MapOrders(WebApplication app)
    {
        var group = app.MapGroup("/api/work-orders").RequireAuthorization("operational");
        group.MapGet("", async (ServiceDb db, HttpContext http, CancellationToken ct) =>
        {
            var caller = Caller.From(http.User);
            var query = db.WorkOrders.AsNoTracking().AsQueryable();
            if (!caller.IsAdministrator) query = query.Where(x => x.TeamId == caller.TeamId);
            if (caller.IsTechnician) query = query.Where(x => x.TechnicianId == caller.Id);
            return Results.Ok(await query.OrderByDescending(x => x.CreatedAtUtc).Take(500).ToListAsync(ct));
        });
        group.MapGet("/{id:guid}", async (Guid id, ServiceDb db, RemoteServices remote, TimeProvider clock, HttpContext http, CancellationToken ct) =>
        {
            var order = await db.WorkOrders.AsNoTracking().SingleOrDefaultAsync(x => x.Id == id, ct) ?? throw new DomainException(404, "Work order not found.");
            var caller = Caller.From(http.User);
            if (!caller.CanAccess(order.TeamId, order.TechnicianId))
            {
                if (!caller.IsTechnician || caller.TeamId != order.TeamId) throw new DomainException(404, "Work order not found.");
                // Scheduling is the authority for candidate access; revocation/expiry removes this grant immediately.
                var offers = await remote.Get<AssignmentOffer[]>("Scheduling", $"/api/assignment-offers?workOrderId={id}", http, ct);
                if (!(order.Status is "Created" or "Scheduled") || !offers.Any(x => x.WorkOrderId == id && x.TeamId == order.TeamId && x.TechnicianId == caller.Id && AssignmentOfferRules.IsLive(x, clock.GetUtcNow())))
                    throw new DomainException(404, "Work order not found.");
            }
            return Results.Ok(order);
        });
        group.MapGet("/by-customer/{customerId:guid}", async (Guid customerId, ServiceDb db, RemoteServices remote, HttpContext http, CancellationToken ct, int page = 1, int pageSize = 25) =>
        {
            if (page < 1 || page > 1_000_000 || pageSize is < 1 or > 100) throw new DomainException(400, "Invalid work order pagination.");
            _ = await remote.Get<CustomerView>("Customers", $"/api/customers/{customerId}", http, ct);
            var caller = Caller.From(http.User);
            var query = db.WorkOrders.AsNoTracking().Where(x => x.CustomerId == customerId && (caller.IsAdministrator || x.TeamId == caller.TeamId));
            var total = await query.CountAsync(ct);
            var items = await query.OrderByDescending(x => x.CreatedAtUtc).ThenBy(x => x.Id).Skip((page - 1) * pageSize).Take(pageSize).ToListAsync(ct);
            return Results.Ok(new { items, total, page, pageSize });
        }).RequireAuthorization("dispatch");
        group.MapGet("/by-asset/{assetId:guid}", async (Guid assetId, ServiceDb db, RemoteServices remote, HttpContext http, CancellationToken ct, int page = 1, int pageSize = 25) =>
        {
            if (page < 1 || page > 1_000_000 || pageSize is < 1 or > 100) throw new DomainException(400, "Invalid work order pagination.");
            var caller = Caller.From(http.User);
            var query = db.WorkOrders.AsNoTracking().Where(x => x.AssetId == assetId);
            if (!caller.IsAdministrator) query = query.Where(x => x.TeamId == caller.TeamId);
            if (caller.IsTechnician) query = query.Where(x => x.TechnicianId == caller.Id);
            if (caller.IsTechnician)
            {
                // The technician's own assigned work is the authorization proof.
                // The office-only asset reference lookup intentionally hides
                // assets from technicians and cannot authorize this history.
                if (!await query.AnyAsync(ct)) throw new DomainException(404, "Equipment history was not found in your assigned work.");
            }
            else
            {
                var asset = await remote.Get<AssetReferenceView>("Assets", $"/api/assets/{assetId}/reference", http, ct);
                if (!caller.IsAdministrator && asset.TeamId != caller.TeamId) throw new DomainException(404, "Equipment was not found in this team.");
            }
            http.Response.Headers.CacheControl = "no-store";
            var total = await query.CountAsync(ct);
            var items = await query.OrderByDescending(x => x.CreatedAtUtc).ThenBy(x => x.Id).Skip((page - 1) * pageSize).Take(pageSize).ToListAsync(ct);
            return Results.Ok(new { items, total, page, pageSize });
        }).RequireAuthorization("operational");
        group.MapPost("", async (CreateOrder request, ServiceDb db, RemoteServices remote, TimeProvider clock, HttpContext http, CancellationToken ct) =>
        {
            var caller = Caller.From(http.User);
            caller.Demand(request.TeamId);
            ValidateText(request.Title, 3, 160, "title");
            string customerName, siteAddress;
            int? customerVersion = null;
            string? unregisteredReason = null;
            if (request.CustomerId.HasValue && request.ServiceLocationId.HasValue)
            {
                if (!string.IsNullOrWhiteSpace(request.UnregisteredCustomerReason)) throw new DomainException(400, "A registered customer does not need an unregistered exception.");
                var customer = await remote.Get<CustomerView>("Customers", $"/api/customers/{request.CustomerId}", http, ct);
                if (customer.TeamId != request.TeamId) throw new DomainException(404, "Customer was not found in this team.");
                var location = customer.Locations.SingleOrDefault(x => x.Id == request.ServiceLocationId) ?? throw new DomainException(400, "Service location does not belong to this customer.");
                if (customer.Status != "Active" || location.Status != "Active") throw new DomainException(409, "New work requires an active customer and service location.");
                if (request.AssetId is { } assetId)
                {
                    var asset = await remote.Get<AssetReferenceView>("Assets", $"/api/assets/{assetId}/reference", http, ct);
                    if (asset.TeamId != request.TeamId || asset.CustomerId != customer.Id || asset.ServiceLocationId != location.Id)
                        throw new DomainException(400, "Equipment must be active equipment at this customer service location.");
                    if (asset.Status != "Active") throw new DomainException(409, "Only active equipment can be linked to new work.");
                }
                customerName = customer.DisplayName;
                customerVersion = customer.Version;
                siteAddress = string.Join(", ", new[] { location.AddressLine1, location.AddressLine2, location.City, location.Region, location.PostalCode, location.CountryCode }.Where(x => !string.IsNullOrWhiteSpace(x)));
            }
            else
            {
                if (request.CustomerId.HasValue || request.ServiceLocationId.HasValue) throw new DomainException(400, "Customer and service location references must be supplied together.");
                if (request.AssetId.HasValue) throw new DomainException(400, "Equipment can be linked only to a registered customer work order.");
                ValidateText(request.UnregisteredCustomerReason, 8, 500, "unregistered customer exception reason");
                ValidateText(request.CustomerName, 2, 100, "customer name"); ValidateText(request.SiteAddress, 3, 240, "site address");
                customerName = request.CustomerName!.Trim(); siteAddress = request.SiteAddress!.Trim(); unregisteredReason = request.UnregisteredCustomerReason!.Trim();
            }
            if (!new[] { "HVAC", "Electrical", "Mechanical", "Refrigeration", "Controls", "Heating", "Cooling", "Ventilation" }.Contains(request.ServiceCategory)) throw new DomainException(400, "Unknown service category.");
            if (!new[] { "Low", "Normal", "High", "Critical" }.Contains(request.Priority)) throw new DomainException(400, "Unknown priority.");
            var now = clock.GetUtcNow();
            var order = new WorkOrder { Number = $"WO-{now:yyyyMMdd}-{Guid.NewGuid().ToString("N")[..6].ToUpperInvariant()}", Title = request.Title.Trim(), CustomerName = customerName, SiteAddress = siteAddress, CustomerId = request.CustomerId, CustomerVersion = customerVersion, ServiceLocationId = request.ServiceLocationId, AssetId = request.AssetId, UnregisteredCustomerReason = unregisteredReason, ServiceCategory = request.ServiceCategory, Priority = request.Priority, TeamId = request.TeamId, CreatedAtUtc = now };
            db.WorkOrders.Add(order);
            // Customer and address are deliberately excluded from integration/audit events.
            db.Enqueue(EventFactory.Create(http, "work-orders", "WorkOrderCreated.v1", order.Id, OrderPayload(order), order.Version, now));
            await db.SaveChangesAsync(ct);
            return Results.Created($"/api/work-orders/{order.Id}", order);
        }).RequireAuthorization("dispatch");
        group.MapPut("/{id:guid}/asset", async (Guid id, LinkOrderAsset request, ServiceDb db, RemoteServices remote, TimeProvider clock, HttpContext http, CancellationToken ct) =>
        {
            var order = await db.WorkOrders.SingleOrDefaultAsync(x => x.Id == id, ct) ?? throw new DomainException(404, "Work order not found.");
            Caller.From(http.User).Demand(order.TeamId);
            if (order.Version != request.ExpectedVersion) throw new DomainException(409, "Work order changed. Refresh before saving.");
            if (order.CustomerId is null || order.ServiceLocationId is null) throw new DomainException(409, "Equipment can be linked only to a registered customer work order.");
            if (order.Status is "Completed" or "Cancelled") throw new DomainException(409, "Equipment cannot be changed after the work order is closed.");
            if (request.AssetId is { } assetId)
            {
                var asset = await remote.Get<AssetReferenceView>("Assets", $"/api/assets/{assetId}/reference", http, ct);
                if (asset.TeamId != order.TeamId || asset.CustomerId != order.CustomerId || asset.ServiceLocationId != order.ServiceLocationId)
                    throw new DomainException(400, "Equipment must belong to this work order's customer and service location.");
                if (asset.Status != "Active") throw new DomainException(409, "Only active equipment can be linked to work.");
            }
            if (order.AssetId == request.AssetId) return Results.Ok(order);
            order.AssetId = request.AssetId;
            order.Version++;
            db.Enqueue(EventFactory.Create(http, "work-orders", "WorkOrderUpdated.v1", order.Id, OrderPayload(order), order.Version, clock.GetUtcNow()));
            await db.SaveChangesAsync(ct);
            return Results.Ok(order);
        }).RequireAuthorization("dispatch");
        group.MapPut("/{id:guid}", async (Guid id, UpdateOrder request, ServiceDb db, TimeProvider clock, HttpContext http, CancellationToken ct) =>
        {
            var order = await db.WorkOrders.SingleOrDefaultAsync(x => x.Id == id, ct) ?? throw new DomainException(404, "Work order not found.");
            Caller.From(http.User).Demand(order.TeamId, order.TechnicianId);
            if (order.Version != request.ExpectedVersion) throw new DomainException(409, "Work order changed. Refresh before saving.");
            ValidateText(request.Title, 3, 160, "title");
            if (!new[] { "Low", "Normal", "High", "Critical" }.Contains(request.Priority)) throw new DomainException(400, "Unknown priority.");
            WorkOrderRules.RequireAllowedUpdate(order.Status, request.Status);
            order.Title = request.Title.Trim(); order.Priority = request.Priority; order.Status = request.Status; order.Version++;
            db.Enqueue(EventFactory.Create(http, "work-orders", "WorkOrderUpdated.v1", order.Id, OrderPayload(order), order.Version, clock.GetUtcNow()));
            await db.SaveChangesAsync(ct);
            return Results.Ok(order);
        }).RequireAuthorization("dispatch");
    }

    public static object OrderPayload(WorkOrder order) => new { workOrderId = order.Id, order.Number, order.TeamId, order.TechnicianId, order.CustomerId, order.CustomerVersion, order.ServiceLocationId, order.AssetId, customerReferenceStatus = order.CustomerId.HasValue ? "Registered" : "ExplicitException", order.ServiceCategory, order.Priority, order.Status, order.CreatedAtUtc, order.CompletedAtUtc };

    private static void MapTechnicians(WebApplication app)
    {
        var group = app.MapGroup("/api/technicians").RequireAuthorization("operational");
        group.MapGet("", async (ServiceDb db, HttpContext http, CancellationToken ct) =>
        {
            var caller = Caller.From(http.User);
            var records = await db.Technicians.AsNoTracking().Where(x => caller.IsAdministrator || (x.TeamId == caller.TeamId && (!caller.IsTechnician || x.Id == caller.Id))).OrderBy(x => x.Name).ToListAsync(ct);
            return Results.Ok(records.Select(TechnicianView));
        });
        group.MapGet("/{id}", async (string id, ServiceDb db, HttpContext http, CancellationToken ct) =>
        {
            var tech = await db.Technicians.AsNoTracking().SingleOrDefaultAsync(x => x.Id == id, ct) ?? throw new DomainException(404, "Technician not found.");
            var caller = Caller.From(http.User);
            if (!caller.IsAdministrator && (caller.TeamId != tech.TeamId || caller.IsTechnician && tech.Id != caller.Id)) throw new DomainException(404, "Technician not found.");
            return Results.Ok(TechnicianView(tech));
        });
        group.MapGet("/{id}/time-off", async (string id, ServiceDb db, HttpContext http, CancellationToken ct) =>
        {
            var tech = await db.Technicians.FindAsync([id], ct) ?? throw new DomainException(404, "Technician not found.");
            var caller = Caller.From(http.User);
            if (!caller.IsAdministrator && (tech.TeamId != caller.TeamId || caller.IsTechnician && tech.Id != caller.Id)) throw new DomainException(404, "Technician not found.");
            return Results.Ok(await db.TimeOff.AsNoTracking().Where(x => x.TechnicianId == id).ToListAsync(ct));
        });
        group.MapPost("/{id}/time-off", async (string id, TimeOffRequest request, ServiceDb db, TimeProvider clock, HttpContext http, CancellationToken ct) =>
        {
            var tech = await db.Technicians.FindAsync([id], ct) ?? throw new DomainException(404, "Technician not found.");
            Caller.From(http.User).Demand(tech.TeamId);
            if (request.EndUtc <= request.StartUtc) throw new DomainException(400, "Time off end must follow start.");
            ValidateText(request.Reason, 3, 240, "reason");
            var record = new TimeOff { TechnicianId = id, StartUtc = request.StartUtc.ToUniversalTime(), EndUtc = request.EndUtc.ToUniversalTime(), Reason = request.Reason };
            db.TimeOff.Add(record);
            // The reason stays operational; analytics receives only the interval and scope.
            db.Enqueue(EventFactory.Create(http, "technicians", "TechnicianTimeOffChanged.v1", Guid.Empty,
                new { timeOffId = record.Id, technicianId = id, tech.TeamId, record.StartUtc, record.EndUtc }, record.Version, clock.GetUtcNow()));
            await db.SaveChangesAsync(ct); return Results.Ok(record);
        }).RequireAuthorization("supervise");
        group.MapPut("/{id}", async (string id, Technician request, ServiceDb db, TimeProvider clock, HttpContext http, CancellationToken ct) =>
        {
            var tech = await db.Technicians.FindAsync([id], ct) ?? throw new DomainException(404, "Technician not found.");
            Caller.From(http.User).Demand(tech.TeamId);
            if (request.Version != tech.Version) throw new DomainException(409, "Technician changed.");
            if (request.WorkingStartHour < 0 || request.WorkingEndHour > 24 || request.WorkingStartHour >= request.WorkingEndHour) throw new DomainException(400, "Invalid working hours.");
            ValidateText(request.Name, 2, 100, "name");
            try { TimeZoneInfo.FindSystemTimeZoneById(request.TimeZone); } catch (TimeZoneNotFoundException) { throw new DomainException(400, "Unknown time zone."); }
            tech.Name = request.Name; tech.Skills = request.Skills; tech.Certifications = request.Certifications; tech.WorkingStartHour = request.WorkingStartHour; tech.WorkingEndHour = request.WorkingEndHour; tech.TimeZone = request.TimeZone; tech.Available = request.Available; tech.Version++;
            db.Enqueue(EventFactory.Create(http, "technicians", "TechnicianAvailabilityChanged.v1", Guid.Empty, new { technicianId = tech.Id, tech.TeamId, tech.SupervisorId, tech.Available, tech.Skills, tech.Certifications, tech.WorkingStartHour, tech.WorkingEndHour, tech.TimeZone }, tech.Version, clock.GetUtcNow()));
            await db.SaveChangesAsync(ct); return Results.Ok(TechnicianView(tech));
        }).RequireAuthorization("supervise");
    }

    private static object TechnicianView(Technician t) => new { t.Id, t.Name, t.TeamId, t.SupervisorId, t.Skills, t.Certifications, t.WorkingStartHour, t.WorkingEndHour, t.TimeZone, t.Available, t.Version };

    private static void MapScheduling(WebApplication app)
    {
        var group = app.MapGroup("/api/bookings").RequireAuthorization("operational");
        group.MapGet("", async (Guid? workOrderId, ServiceDb db, HttpContext http, CancellationToken ct) =>
        {
            var caller = Caller.From(http.User);
            var query = db.Bookings.AsNoTracking().Where(x => caller.IsAdministrator || (x.TeamId == caller.TeamId && (!caller.IsTechnician || x.TechnicianId == caller.Id)));
            if (workOrderId.HasValue) query = query.Where(x => x.WorkOrderId == workOrderId);
            return Results.Ok(await query.OrderBy(x => x.StartUtc).Take(1000).ToListAsync(ct));
        });
        group.MapGet("/{id:guid}", async (Guid id, ServiceDb db, HttpContext http, CancellationToken ct) =>
        {
            var booking = await db.Bookings.AsNoTracking().SingleOrDefaultAsync(x => x.Id == id, ct) ?? throw new DomainException(404, "Booking not found.");
            Caller.From(http.User).Demand(booking.TeamId, booking.TechnicianId);
            return Results.Ok(booking);
        });
        group.MapPost("", async (CreateBooking request, ServiceDb db, RemoteServices remote, TimeProvider clock, HttpContext http, CancellationToken ct) =>
        {
            await using var transaction = await db.Database.BeginTransactionAsync(ct);
            await AssignmentOfferApi.LockOrder(db, request.WorkOrderId, ct);
            var order = await remote.Get<WorkOrder>("WorkOrders", $"/api/work-orders/{request.WorkOrderId}", http, ct);
            var tech = await GetTechnician(remote, request.TechnicianId, http, ct);
            var timeOff = await remote.Get<TimeOff[]>("Technicians", $"/api/technicians/{request.TechnicianId}/time-off", http, ct);
            Caller.From(http.User).Demand(order.TeamId);
            if (order.Status is "Completed" or "Cancelled" or "InProgress") throw new DomainException(409, "Work order cannot be scheduled in this state.");
            BookingRules.Validate(tech, order, request.StartUtc, request.EndUtc, timeOff);
            await AssignmentOfferApi.RequireCapacity(db, order.Id, tech.Id, request.StartUtc, request.EndUtc, ct);
            if (!string.IsNullOrWhiteSpace(request.OverrideReason)) ValidateText(request.OverrideReason, 3, 500, "override reason");
            await AssignmentOfferApi.RevokeForDirectBooking(db, order.Id, clock.GetUtcNow(), http, ct);
            var booking = new Booking { WorkOrderId = order.Id, TechnicianId = tech.Id, TeamId = order.TeamId, StartUtc = request.StartUtc.ToUniversalTime(), EndUtc = request.EndUtc.ToUniversalTime(), OverrideReason = request.OverrideReason };
            db.Bookings.Add(booking);
            var revision = await AssignmentOfferApi.NextAssignmentRevision(db, order.Id, ct);
            db.Enqueue(EventFactory.Create(http, "scheduling", "BookingCreated.v1", order.Id, booking, revision, clock.GetUtcNow()));
            await db.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);
            return Results.Created($"/api/bookings/{booking.Id}", booking);
        }).RequireAuthorization("dispatch");
        group.MapPut("/{id:guid}", async (Guid id, MoveBooking request, ServiceDb db, RemoteServices remote, TimeProvider clock, HttpContext http, CancellationToken ct) =>
        {
            var initial = await db.Bookings.AsNoTracking().SingleOrDefaultAsync(x => x.Id == id, ct) ?? throw new DomainException(404, "Booking not found.");
            Caller.From(http.User).Demand(initial.TeamId);
            await using var transaction = await db.Database.BeginTransactionAsync(ct);
            await AssignmentOfferApi.LockOrder(db, initial.WorkOrderId, ct);
            var booking = await db.Bookings.SingleAsync(x => x.Id == id, ct);
            Caller.From(http.User).Demand(booking.TeamId);
            if (booking.Version != request.ExpectedVersion || booking.Status != "Confirmed") throw new DomainException(409, "Booking changed or is not confirmed.");
            ValidateText(request.Reason, 3, 240, "reason");
            var order = await RequireUnstartedBooking(remote, booking, http, ct);
            var tech = await GetTechnician(remote, booking.TechnicianId, http, ct);
            var timeOff = await remote.Get<TimeOff[]>("Technicians", $"/api/technicians/{booking.TechnicianId}/time-off", http, ct);
            BookingRules.Validate(tech, order, request.StartUtc, request.EndUtc, timeOff);
            booking.StartUtc = request.StartUtc.ToUniversalTime(); booking.EndUtc = request.EndUtc.ToUniversalTime(); booking.Version++; booking.OverrideReason = request.Reason;
            var revision = await AssignmentOfferApi.NextAssignmentRevision(db, booking.WorkOrderId, ct);
            db.Enqueue(EventFactory.Create(http, "scheduling", "BookingRescheduled.v1", booking.WorkOrderId, booking, revision, clock.GetUtcNow()));
            await db.SaveChangesAsync(ct); await transaction.CommitAsync(ct); return Results.Ok(booking);
        }).RequireAuthorization("dispatch");
        group.MapPost("/{id:guid}/cancel", async (Guid id, Intervention request, ServiceDb db, RemoteServices remote, TimeProvider clock, HttpContext http, CancellationToken ct) =>
        {
            var initial = await db.Bookings.AsNoTracking().SingleOrDefaultAsync(x => x.Id == id, ct) ?? throw new DomainException(404, "Booking not found.");
            Caller.From(http.User).Demand(initial.TeamId);
            await using var transaction = await db.Database.BeginTransactionAsync(ct);
            await AssignmentOfferApi.LockOrder(db, initial.WorkOrderId, ct);
            var booking = await db.Bookings.SingleAsync(x => x.Id == id, ct);
            Caller.From(http.User).Demand(booking.TeamId);
            if (booking.Version != request.ExpectedVersion || booking.Status != "Confirmed") throw new DomainException(409, "Booking changed or is not confirmed.");
            _ = await RequireUnstartedBooking(remote, booking, http, ct);
            ValidateText(request.Reason, 3, 240, "reason"); booking.Status = "Cancelled"; booking.Version++;
            var revision = await AssignmentOfferApi.NextAssignmentRevision(db, booking.WorkOrderId, ct);
            db.Enqueue(EventFactory.Create(http, "scheduling", "BookingCancelled.v1", booking.WorkOrderId, new { booking.Id, booking.WorkOrderId, booking.TeamId, booking.TechnicianId, request.Reason }, revision, clock.GetUtcNow()));
            await db.SaveChangesAsync(ct); await transaction.CommitAsync(ct); return Results.Ok(booking);
        }).RequireAuthorization("dispatch");
        app.MapPost("/api/scheduling/recommendations", SchedulingRecommendations.Handle).RequireAuthorization("dispatch");
    }

    private static async Task<WorkOrder> RequireUnstartedBooking(RemoteServices remote, Booking booking, HttpContext http, CancellationToken ct)
    {
        var order = await remote.Get<WorkOrder>("WorkOrders", $"/api/work-orders/{booking.WorkOrderId}", http, ct);
        var workflows = await remote.Get<Workflow[]>("Workflows", $"/api/workflows?workOrderId={booking.WorkOrderId}", http, ct);
        if (order.Status is not ("Created" or "Scheduled") || workflows.Length > 0)
            throw new DomainException(409, "An appointment cannot be moved or cancelled after its service workflow has started. Ask a supervisor to manage the active service.");
        return order;
    }

    private static async Task<Technician> GetTechnician(RemoteServices remote, string id, HttpContext http, CancellationToken ct) => (await remote.Get<TechnicianDto>("Technicians", $"/api/technicians/{id}", http, ct)).ToEntity();
    public sealed record TechnicianDto(string Id, string Name, string TeamId, string SupervisorId, string[] Skills, string[] Certifications, int WorkingStartHour, int WorkingEndHour, string TimeZone, bool Available, int Version)
    {
        public Technician ToEntity() => new() { Id = Id, Name = Name, TeamId = TeamId, SupervisorId = SupervisorId, Skills = Skills, Certifications = Certifications, WorkingStartHour = WorkingStartHour, WorkingEndHour = WorkingEndHour, TimeZone = TimeZone, Available = Available, Version = Version };
    }

    private static void MapWorkflows(WebApplication app)
    {
        var defaultTemplateVersion = app.Configuration.GetValue("Workflows:DefaultTemplateVersion", Templates.CurrentVersion);
        _ = Templates.Get(defaultTemplateVersion);
        var group = app.MapGroup("/api/workflows").RequireAuthorization("operational");
        group.MapGet("/templates/default", () => Results.Ok(Templates.Get(defaultTemplateVersion)));
        group.MapGet("/templates/{version:int}", (int version) => Results.Ok(Templates.Get(version)));
        group.MapGet("", async (Guid? workOrderId, ServiceDb db, HttpContext http, CancellationToken ct) =>
        {
            var caller = Caller.From(http.User);
            var query = db.Workflows.AsNoTracking().Where(x => caller.IsAdministrator || (x.TeamId == caller.TeamId && (!caller.IsTechnician || x.TechnicianId == caller.Id)));
            if (workOrderId.HasValue) query = query.Where(x => x.WorkOrderId == workOrderId);
            return Results.Ok((await query.OrderByDescending(x => x.StartedAtUtc).Take(500).ToListAsync(ct)).Select(WorkflowView));
        });
        group.MapGet("/{id:guid}", async (Guid id, ServiceDb db, HttpContext http, CancellationToken ct) => Results.Ok(WorkflowView(await FindWorkflow(id, db, http, ct))));
        group.MapPost("", async (StartWorkflow request, ServiceDb db, RemoteServices remote, TimeProvider clock, SlaPolicy policy, HttpContext http, CancellationToken ct) =>
        {
            var order = await remote.Get<WorkOrder>("WorkOrders", $"/api/work-orders/{request.WorkOrderId}", http, ct);
            var bookings = await remote.Get<Booking[]>("Scheduling", $"/api/bookings?workOrderId={order.Id}", http, ct);
            var booking = bookings.SingleOrDefault(x => x.WorkOrderId == order.Id && x.Status == "Confirmed") ?? throw new DomainException(409, "A confirmed booking is required before starting work.");
            Caller.From(http.User).Demand(order.TeamId, booking.TechnicianId);
            if (order.Status is "Completed" or "Cancelled") throw new DomainException(409, "Work order cannot be started.");
            var existing = await db.Workflows.SingleOrDefaultAsync(x => x.WorkOrderId == order.Id, ct);
            if (existing is not null) return Results.Ok(WorkflowView(existing));
            var now = clock.GetUtcNow();
            var workflow = WorkflowEngine.Start(order.Id, booking.TechnicianId, order.TeamId, now, policy, defaultTemplateVersion);
            db.Workflows.Add(workflow);
            var started = EventFactory.Create(http, "workflows", "WorkflowStarted.v1", order.Id, StagePayload(workflow, workflow.Stages[0]), workflow.Version, now, workflow.Id);
            db.Enqueue(started);
            db.Enqueue(EventFactory.Create(http, "workflows", "StageStarted.v1", order.Id, StagePayload(workflow, workflow.Stages[0]), workflow.Version, now, workflow.Id, workflow.Stages[0].Id, started.EventId));
            await db.SaveChangesAsync(ct); return Results.Created($"/api/workflows/{workflow.Id}", WorkflowView(workflow));
        }).RequireAuthorization("execute");
        group.MapPost("/{id:guid}/submit", async (Guid id, SubmitStage request, ServiceDb db, TimeProvider clock, SlaPolicy policy, HttpContext http, CancellationToken ct) =>
        {
            var workflow = await FindWorkflow(id, db, http, ct);
            ValidateText(request.IdempotencyKey, 8, 128, "idempotency key");
            var actor = Caller.From(http.User);
            var key = $"{actor.Id}:{id}:{request.IdempotencyKey}";
            var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(Json.Write(request))));
            var receipt = await db.Receipts.FindAsync([key], ct);
            if (receipt is not null)
            {
                if (receipt.ActorId != actor.Id || receipt.RequestHash != hash) throw new DomainException(409, "Idempotency key was reused for a different request.");
                return Results.Content(receipt.ResponseJson, "application/json");
            }
            var now = clock.GetUtcNow();
            // Catch up persisted SLA milestones before a late submission completes a stage.
            var expectedVersion = request.ExpectedVersion;
            WorkflowEngine.RequireVersion(workflow, expectedVersion);
            var warnings = WorkflowEngine.Evaluate(workflow, now, policy);
            SlaAudit.Enqueue(db, http, workflow, warnings, now);
            var completed = WorkflowEngine.Submit(workflow, workflow.Version, request.Answers, now, policy);
            Guid? causation = null;
            if (request.Offline)
            {
                var offline = EventFactory.Create(http, "workflows", "OfflineSubmissionSynchronized.v1", workflow.WorkOrderId, new { workflow.TeamId, workflow.TechnicianId, clientOccurredAtUtc = request.ClientOccurredAtUtc, serverReceivedAtUtc = now, timestampAuthoritative = false, request.IdempotencyKey }, workflow.Version, now, workflow.Id, completed.Id);
                db.Enqueue(offline); causation = offline.EventId;
            }
            var submission = EventFactory.Create(http, "workflows", "FormSubmitted.v1", workflow.WorkOrderId, new { workflow.TeamId, workflow.TechnicianId, stageName = completed.Name, request.Answers, request.ClientOccurredAtUtc, serverReceivedAtUtc = now }, workflow.Version, now, workflow.Id, completed.Id, causation);
            db.Enqueue(submission);
            var completionEvent = EventFactory.Create(http, "workflows", "StageCompleted.v1", workflow.WorkOrderId, StagePayload(workflow, completed), workflow.Version, now, workflow.Id, completed.Id, submission.EventId);
            db.Enqueue(completionEvent);
            if (workflow.Status == "Completed") db.Enqueue(EventFactory.Create(http, "workflows", "WorkflowCompleted.v1", workflow.WorkOrderId, new { workflow.TeamId, workflow.TechnicianId, workflow.CompletedAtUtc, outcome = completed.Answers.GetValueOrDefault("outcome") }, workflow.Version, now, workflow.Id, completed.Id, completionEvent.EventId));
            else db.Enqueue(EventFactory.Create(http, "workflows", "StageStarted.v1", workflow.WorkOrderId, StagePayload(workflow, workflow.Stages[workflow.CurrentStageIndex]), workflow.Version, now, workflow.Id, workflow.Stages[workflow.CurrentStageIndex].Id, completionEvent.EventId));
            var response = Json.Write(WorkflowView(workflow));
            db.Receipts.Add(new IdempotencyReceipt { Id = key, ActorId = actor.Id, RequestHash = hash, ResponseJson = response, CreatedAtUtc = now });
            try { await db.SaveChangesAsync(ct); }
            catch (DbUpdateException ex) when (ex is DbUpdateConcurrencyException || ex.InnerException is Npgsql.PostgresException { SqlState: "23505" })
            {
                db.ChangeTracker.Clear();
                var committed = await db.Receipts.FindAsync([key], ct);
                if (committed is null || committed.ActorId != actor.Id || committed.RequestHash != hash) throw;
                return Results.Content(committed.ResponseJson, "application/json");
            }
            return Results.Content(response, "application/json");
        }).RequireAuthorization("execute");
        foreach (var action in new[] { "pause", "resume", "assistance", "override" })
        {
            var operation = action;
            group.MapPost($"/{{id:guid}}/{operation}", async (Guid id, Intervention request, ServiceDb db, TimeProvider clock, SlaPolicy policy, HttpContext http, CancellationToken ct) =>
            {
                var workflow = await FindWorkflow(id, db, http, ct);
                ValidateText(request.Reason, 3, 500, "reason");
                WorkflowEngine.RequireVersion(workflow, request.ExpectedVersion);
                if (workflow.Status != "Active") throw new DomainException(409, "Only active workflows accept interventions.");
                var now = clock.GetUtcNow();
                StageState stage;
                string type;
                switch (operation)
                {
                    case "pause":
                        SlaAudit.Enqueue(db, http, workflow, WorkflowEngine.Evaluate(workflow, now, policy), now);
                        stage = WorkflowEngine.Pause(workflow, workflow.Version, now); type = "StagePaused.v1"; break;
                    case "resume": stage = WorkflowEngine.Resume(workflow, request.ExpectedVersion, now); type = "StageResumed.v1"; break;
                    case "override":
                        if (workflow.Status != "Active" || request.TargetStageIndex != workflow.CurrentStageIndex + 1 || workflow.CurrentStageIndex >= 7) throw new DomainException(400, "An override can advance exactly one active stage; completion requires a final form.");
                        SlaAudit.Enqueue(db, http, workflow, WorkflowEngine.Evaluate(workflow, now, policy), now);
                        var states = workflow.Stages; stage = states[workflow.CurrentStageIndex];
                        if (stage.PausedAtUtc is not null) throw new DomainException(409, "Resume before applying an override.");
                        stage.Status = "Overridden"; stage.CompletedAtUtc = now;
                        workflow.CurrentStageIndex++; var next = states[workflow.CurrentStageIndex]; next.Status = "Active"; next.StartedAtUtc = now; next.DeadlineUtc = now.AddSeconds(policy.DurationSeconds); workflow.Stages = states; workflow.Version++; type = "SupervisorOverrideApplied.v1"; break;
                    default: stage = workflow.Stages[workflow.CurrentStageIndex]; type = "AssistanceRequested.v1"; workflow.Version++; break;
                }
                var interventionEvent = EventFactory.Create(http, "workflows", type, workflow.WorkOrderId, new { workflow.TeamId, workflow.TechnicianId, stageName = stage.Name, request.Reason, request.TargetStageIndex, stage.StartedAtUtc, stage.DeadlineUtc, stage.CompletedAtUtc, stage.PausedSeconds }, workflow.Version, now, workflow.Id, stage.Id);
                db.Enqueue(interventionEvent);
                if (operation == "override") db.Enqueue(EventFactory.Create(http, "workflows", "StageStarted.v1", workflow.WorkOrderId, StagePayload(workflow, workflow.Stages[workflow.CurrentStageIndex]), workflow.Version, now, workflow.Id, workflow.Stages[workflow.CurrentStageIndex].Id, interventionEvent.EventId));
                await db.SaveChangesAsync(ct); return Results.Ok(WorkflowView(workflow));
            }).RequireAuthorization(operation == "assistance" ? "execute" : "supervise");
        }
    }

    private static async Task<Workflow> FindWorkflow(Guid id, ServiceDb db, HttpContext http, CancellationToken ct)
    {
        var workflow = await db.Workflows.SingleOrDefaultAsync(x => x.Id == id, ct) ?? throw new DomainException(404, "Workflow not found.");
        Caller.From(http.User).Demand(workflow.TeamId, workflow.TechnicianId); return workflow;
    }
    public static object WorkflowView(Workflow w) => new { w.Id, w.WorkOrderId, w.TechnicianId, w.TeamId, w.TemplateVersion, w.CurrentStageIndex, w.Version, w.Status, w.Stages, w.StartedAtUtc, w.CompletedAtUtc };
    public static object StagePayload(Workflow w, StageState s) => new { w.WorkOrderId, w.TeamId, w.TechnicianId, stageName = s.Name, stageIndex = s.Index, s.StartedAtUtc, s.DeadlineUtc, s.CompletedAtUtc, s.PausedSeconds, s.SlaStatus, s.Status, answers = s.Answers };
    private static void ValidateText(string? value, int min, int max, string field)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Trim().Length < min || value.Length > max) throw new DomainException(400, $"The {field} must contain {min}–{max} characters.");
    }
}
