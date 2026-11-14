using System.Security.Cryptography;
using System.Text;
using FieldOps.Core;
using Microsoft.EntityFrameworkCore;

namespace FieldOps.ServiceHost;

public sealed record CreateAssignmentOffer(Guid WorkOrderId, string TechnicianId, DateTimeOffset StartUtc,
    DateTimeOffset EndUtc, DateTimeOffset ExpiresAtUtc, string IdempotencyKey);
public sealed record RespondToAssignmentOffer(int ExpectedVersion, string IdempotencyKey, string? Reason = null);

public static class AssignmentOfferApi
{
    public static void Map(WebApplication app)
    {
        var group = app.MapGroup("/api/assignment-offers").RequireAuthorization("operational");
        group.MapGet("", async (Guid? workOrderId, ServiceDb db, TimeProvider clock, HttpContext http, CancellationToken ct) =>
        {
            var caller = Caller.From(http.User);
            var query = db.AssignmentOffers.AsNoTracking().Where(x => caller.IsAdministrator ||
                (x.TeamId == caller.TeamId && (!caller.IsTechnician || x.TechnicianId == caller.Id)));
            if (workOrderId.HasValue) query = query.Where(x => x.WorkOrderId == workOrderId);
            var offers = await query.OrderBy(x => x.Status != "Pending").ThenByDescending(x => x.CreatedAtUtc).Take(1000).ToListAsync(ct);
            return Results.Ok(offers.Select(x => View(x, clock.GetUtcNow())));
        });
        group.MapPost("", Create).RequireAuthorization("dispatch");
        group.MapPost("/{id:guid}/accept", async (Guid id, RespondToAssignmentOffer request, ServiceDb db,
            RemoteServices remote, TimeProvider clock, HttpContext http, CancellationToken ct) =>
            await Respond(id, "Accepted", request, db, remote, clock, http, ct)).RequireAuthorization("execute");
        group.MapPost("/{id:guid}/decline", async (Guid id, RespondToAssignmentOffer request, ServiceDb db,
            RemoteServices remote, TimeProvider clock, HttpContext http, CancellationToken ct) =>
            await Respond(id, "Declined", request, db, remote, clock, http, ct)).RequireAuthorization("execute");
        group.MapPost("/{id:guid}/revoke", async (Guid id, RespondToAssignmentOffer request, ServiceDb db,
            RemoteServices remote, TimeProvider clock, HttpContext http, CancellationToken ct) =>
            await Respond(id, "Revoked", request, db, remote, clock, http, ct)).RequireAuthorization("dispatch");
        app.MapPost("/api/scheduling/work-orders/{id:guid}/cancel-intent", async (Guid id, ServiceDb db,
            RemoteServices remote, TimeProvider clock, HttpContext http, CancellationToken ct) =>
        {
            await using var transaction = await db.Database.BeginTransactionAsync(ct);
            await LockOrder(db, id, ct);
            var order = await remote.Get<WorkOrder>("WorkOrders", $"/api/work-orders/{id}", http, ct);
            Caller.From(http.User).Demand(order.TeamId);
            if (order.Status is not ("Created" or "Cancelled"))
                throw new DomainException(409, "Only an unassigned, unstarted work order may be cancelled.");
            var now = clock.GetUtcNow();
            var added = await RecordCancellationIntent(db, id, now, ct);
            await RevokePendingOffers(db, id, now, http, "Work order cancellation is pending.", ct);
            if (added)
            {
                var revision = await NextAssignmentRevision(db, id, ct);
                db.Enqueue(EventFactory.Create(http, "scheduling", "WorkOrderCancellationReserved.v1", id,
                    new { workOrderId = id, order.TeamId, cancellationPending = true }, revision, now));
            }
            await db.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);
            return Results.Ok(new { workOrderId = id, cancellationPending = true });
        }).RequireAuthorization("dispatch");
    }

    private static async Task<IResult> Create(CreateAssignmentOffer request, ServiceDb db, RemoteServices remote,
        TimeProvider clock, HttpContext http, CancellationToken ct)
    {
        var caller = Caller.From(http.User);
        ValidateKey(request.IdempotencyKey);
        if (string.IsNullOrWhiteSpace(request.TechnicianId) || request.TechnicianId.Length > 128)
            throw new DomainException(400, "A technician identifier containing 1–128 characters is required.");
        var key = $"offer:create:{caller.Id}:{request.IdempotencyKey}";
        var hash = Hash(request);
        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        await LockOrder(db, request.WorkOrderId, ct);
        var prior = await ReplayReceipt(db, key, caller.Id, hash, ct);
        if (prior is not null) return prior;
        await RequireNotCancelling(db, request.WorkOrderId, ct);
        var order = await remote.Get<WorkOrder>("WorkOrders", $"/api/work-orders/{request.WorkOrderId}", http, ct);
        caller.Demand(order.TeamId);
        RequireSchedulable(order);
        var technicianId = Uri.EscapeDataString(request.TechnicianId);
        var technician = (await remote.Get<OperationsApi.TechnicianDto>("Technicians", $"/api/technicians/{technicianId}", http, ct)).ToEntity();
        var timeOff = await remote.Get<TimeOff[]>("Technicians", $"/api/technicians/{technicianId}/time-off", http, ct);
        var now = clock.GetUtcNow();
        AssignmentOfferRules.ValidateWindow(request.StartUtc, request.EndUtc, request.ExpiresAtUtc, now);
        BookingRules.Validate(technician, order, request.StartUtc, request.EndUtc, timeOff);
        await RequireCapacity(db, order.Id, technician.Id, request.StartUtc, request.EndUtc, ct);
        await ExpireForOrder(db, order.Id, now, http, ct);
        if (await db.AssignmentOffers.AnyAsync(x => x.WorkOrderId == order.Id && x.Status == "Pending", ct))
            throw new DomainException(409, "This work order already has a pending offer. Revoke it before offering another technician.");
        var offer = new AssignmentOffer
        {
            WorkOrderId = order.Id, TechnicianId = technician.Id, TeamId = order.TeamId,
            WorkOrderNumber = order.Number, Title = order.Title, SiteAddress = order.SiteAddress,
            ServiceCategory = order.ServiceCategory, Priority = order.Priority,
            StartUtc = request.StartUtc.ToUniversalTime(), EndUtc = request.EndUtc.ToUniversalTime(),
            ExpiresAtUtc = request.ExpiresAtUtc.ToUniversalTime(), CreatedAtUtc = now
        };
        db.AssignmentOffers.Add(offer);
        Enqueue(db, http, offer, "AssignmentOfferCreated.v1", now);
        var response = Json.Write(View(offer, now));
        AddReceipt(db, key, caller.Id, hash, response, now);
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
        return Results.Content(response, "application/json", statusCode: 201);
    }

    private static async Task<IResult> Respond(Guid id, string status, RespondToAssignmentOffer request,
        ServiceDb db, RemoteServices remote, TimeProvider clock, HttpContext http, CancellationToken ct)
    {
        var caller = Caller.From(http.User);
        ValidateKey(request.IdempotencyKey);
        var initial = await db.AssignmentOffers.AsNoTracking().SingleOrDefaultAsync(x => x.Id == id, ct)
            ?? throw new DomainException(404, "Assignment offer not found.");
        caller.Demand(initial.TeamId, initial.TechnicianId);
        // Supervisors and administrators may revoke, but cannot accept on a technician's behalf.
        if (status != "Revoked" && (!caller.IsTechnician || caller.Id != initial.TechnicianId))
            throw new DomainException(403, "Only the offered technician may accept or decline this assignment.");
        var key = $"offer:{id}:{status}:{caller.Id}:{request.IdempotencyKey}";
        var hash = Hash(request);
        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        await LockOrder(db, initial.WorkOrderId, ct);
        var prior = await ReplayReceipt(db, key, caller.Id, hash, ct);
        if (prior is not null) return prior;
        var offer = await db.AssignmentOffers.SingleAsync(x => x.Id == id, ct);
        AssignmentOfferRules.RequirePending(offer, request.ExpectedVersion, clock.GetUtcNow());
        Guid? bookingId = null;
        if (status == "Accepted")
        {
            await RequireNotCancelling(db, offer.WorkOrderId, ct);
            // The work-order endpoint grants a candidate read only while this exact offer is live.
            var order = await remote.Get<WorkOrder>("WorkOrders", $"/api/work-orders/{offer.WorkOrderId}", http, ct);
            if (order.TeamId != offer.TeamId) throw new DomainException(409, "The work order's team changed. Ask dispatch to issue a new offer.");
            RequireSchedulable(order);
            var technicianId = Uri.EscapeDataString(offer.TechnicianId);
            var technician = (await remote.Get<OperationsApi.TechnicianDto>("Technicians", $"/api/technicians/{technicianId}", http, ct)).ToEntity();
            var timeOff = await remote.Get<TimeOff[]>("Technicians", $"/api/technicians/{technicianId}/time-off", http, ct);
            BookingRules.Validate(technician, order, offer.StartUtc, offer.EndUtc, timeOff);
            await RequireCapacity(db, order.Id, technician.Id, offer.StartUtc, offer.EndUtc, ct);
            var booking = new Booking
            {
                WorkOrderId = order.Id, TechnicianId = technician.Id, TeamId = order.TeamId,
                StartUtc = offer.StartUtc, EndUtc = offer.EndUtc
            };
            db.Bookings.Add(booking);
            bookingId = booking.Id;
            var revision = await NextAssignmentRevision(db, order.Id, ct);
            db.Enqueue(EventFactory.Create(http, "scheduling", "BookingCreated.v1", order.Id, booking, revision, clock.GetUtcNow()));
        }
        var now = clock.GetUtcNow();
        // Recheck after remote validation, which could have crossed the expiration instant.
        AssignmentOfferRules.Respond(offer, status, request.ExpectedVersion, now, request.Reason, bookingId);
        Enqueue(db, http, offer, $"AssignmentOffer{status}.v1", now);
        var response = Json.Write(View(offer, now));
        AddReceipt(db, key, caller.Id, hash, response, now);
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
        return Results.Content(response, "application/json");
    }

    public static async Task LockOrder(ServiceDb db, Guid orderId, CancellationToken ct) =>
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({orderId.ToString()}, 760360))", ct);

    // Call inside the allocation transaction after LockOrder. A rollback also rolls back its revision.
    public static async Task<long> NextAssignmentRevision(ServiceDb db, Guid orderId, CancellationToken ct)
    {
        var revisions = await db.Database.SqlQuery<long>($"""
            INSERT INTO assignment_revisions(work_order_id, revision) VALUES ({orderId}, 1)
            ON CONFLICT (work_order_id) DO UPDATE SET revision = assignment_revisions.revision + 1
            RETURNING revision AS "Value"
            """).ToListAsync(ct);
        return revisions.Single();
    }

    public static async Task RequireNotCancelling(ServiceDb db, Guid orderId, CancellationToken ct)
    {
        var cancelling = await db.Database.SqlQuery<bool>($"SELECT EXISTS (SELECT 1 FROM work_order_cancellations WHERE work_order_id={orderId}) AS \"Value\"").SingleAsync(ct);
        if (cancelling) throw new DomainException(409, "Cancellation is pending for this work order. Refresh it or ask dispatch to finish cancellation.");
    }

    // The caller holds LockOrder inside its transaction, shared with every allocation path.
    public static async Task<bool> RecordCancellationIntent(ServiceDb db, Guid orderId, DateTimeOffset now, CancellationToken ct)
    {
        if (await db.Bookings.AnyAsync(x => x.WorkOrderId == orderId && x.Status == "Confirmed", ct))
            throw new DomainException(409, "Cancel the confirmed booking first, then refresh the work order before cancelling it.");
        return await db.Database.ExecuteSqlInterpolatedAsync($"INSERT INTO work_order_cancellations(work_order_id, requested_at_utc) VALUES ({orderId}, {now}) ON CONFLICT (work_order_id) DO NOTHING", ct) > 0;
    }

    public static void RequireSchedulable(WorkOrder order)
    {
        if (order.Status is not ("Created" or "Scheduled"))
            throw new DomainException(409, "Work order cannot be assigned in this state.");
    }

    public static async Task RequireCapacity(ServiceDb db, Guid orderId, string technicianId,
        DateTimeOffset start, DateTimeOffset end, CancellationToken ct)
    {
        if (await db.Bookings.AnyAsync(x => x.WorkOrderId == orderId && x.Status == "Confirmed", ct))
            throw new DomainException(409, "This work order already has a confirmed appointment.");
        if (await db.Bookings.AnyAsync(x => x.TechnicianId == technicianId && x.Status == "Confirmed" && start < x.EndUtc && x.StartUtc < end, ct))
            throw new DomainException(409, "This technician already has an overlapping appointment.");
    }

    public static async Task ExpireForOrder(ServiceDb db, Guid orderId, DateTimeOffset now, HttpContext? http, CancellationToken ct)
    {
        var expired = await db.AssignmentOffers.Where(x => x.WorkOrderId == orderId && x.Status == "Pending" && x.ExpiresAtUtc <= now).ToListAsync(ct);
        foreach (var offer in expired)
            if (AssignmentOfferRules.Expire(offer, now)) Enqueue(db, http, offer, "AssignmentOfferExpired.v1", now);
        // Flush expired rows before inserting a replacement under the partial unique index.
        if (expired.Count > 0) await db.SaveChangesAsync(ct);
    }

    public static async Task RevokeForDirectBooking(ServiceDb db, Guid orderId, DateTimeOffset now, HttpContext http, CancellationToken ct)
        => await RevokePendingOffers(db, orderId, now, http, "Dispatcher confirmed a direct assignment.", ct);

    private static async Task RevokePendingOffers(ServiceDb db, Guid orderId, DateTimeOffset now, HttpContext http, string reason, CancellationToken ct)
    {
        await ExpireForOrder(db, orderId, now, http, ct);
        foreach (var offer in await db.AssignmentOffers.Where(x => x.WorkOrderId == orderId && x.Status == "Pending").ToListAsync(ct))
        {
            AssignmentOfferRules.Respond(offer, "Revoked", offer.Version, now, reason);
            Enqueue(db, http, offer, "AssignmentOfferRevoked.v1", now);
        }
    }

    public static object View(AssignmentOffer offer, DateTimeOffset now) => new
    {
        offer.Id, offer.WorkOrderId, offer.TechnicianId, offer.TeamId, offer.WorkOrderNumber, offer.Title,
        offer.SiteAddress, offer.ServiceCategory, offer.Priority, offer.StartUtc, offer.EndUtc,
        offer.ExpiresAtUtc, status = offer.Status == "Pending" && offer.ExpiresAtUtc <= now ? "Expired" : offer.Status,
        offer.Version, offer.CreatedAtUtc, offer.RespondedAtUtc, offer.Reason, offer.BookingId,
        requiredSkills = new[] { offer.ServiceCategory }, requiredCertifications = new[] { "HVAC Safety" }
    };

    private static void Enqueue(ServiceDb db, HttpContext? http, AssignmentOffer offer, string type, DateTimeOffset now) =>
        db.Enqueue(EventFactory.Create(http, "scheduling", type, offer.WorkOrderId, new
        {
            offerId = offer.Id, offer.WorkOrderId, offer.TeamId, offer.TechnicianId, offer.Status,
            offer.StartUtc, offer.EndUtc, offer.ExpiresAtUtc, offer.BookingId, offer.Reason
        }, offer.Version, now));

    private static void ValidateKey(string? value)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Length is < 8 or > 128)
            throw new DomainException(400, "The idempotency key must contain 8–128 characters.");
    }

    private static string Hash<T>(T request) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(Json.Write(request))));
    private static async Task<IResult?> ReplayReceipt(ServiceDb db, string key, string actor, string hash, CancellationToken ct)
    {
        var receipt = await db.Receipts.FindAsync([key], ct);
        if (receipt is null) return null;
        if (receipt.ActorId != actor || receipt.RequestHash != hash) throw new DomainException(409, "Idempotency key was reused for a different request.");
        return Results.Content(receipt.ResponseJson, "application/json");
    }

    private static void AddReceipt(ServiceDb db, string key, string actor, string hash, string response, DateTimeOffset now) =>
        db.Receipts.Add(new IdempotencyReceipt { Id = key, ActorId = actor, RequestHash = hash, ResponseJson = response, CreatedAtUtc = now });
}

public sealed class AssignmentOfferExpiryWorker(IServiceScopeFactory scopes, TimeProvider clock, ILogger<AssignmentOfferExpiryWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(15));
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await using var scope = scopes.CreateAsyncScope();
                var db = scope.ServiceProvider.GetRequiredService<ServiceDb>();
                var now = clock.GetUtcNow();
                var orders = await db.AssignmentOffers.AsNoTracking().Where(x => x.Status == "Pending" && x.ExpiresAtUtc <= now)
                    .Select(x => x.WorkOrderId).Take(100).ToArrayAsync(stoppingToken);
                foreach (var order in orders)
                {
                    await using var transaction = await db.Database.BeginTransactionAsync(stoppingToken);
                    await AssignmentOfferApi.LockOrder(db, order, stoppingToken);
                    await AssignmentOfferApi.ExpireForOrder(db, order, clock.GetUtcNow(), null, stoppingToken);
                    await transaction.CommitAsync(stoppingToken);
                    db.ChangeTracker.Clear();
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { return; }
            catch (Exception ex) { logger.LogError(ex, "Assignment offer expiry sweep failed; pending expirations will be retried."); }
            if (!await timer.WaitForNextTickAsync(stoppingToken)) return;
        }
    }
}
