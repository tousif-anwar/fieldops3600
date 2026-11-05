using System.Security.Cryptography;
using System.Text;
using FieldOps.Core;
using Microsoft.EntityFrameworkCore;

namespace FieldOps.ServiceHost;

public sealed record CreateOrder(string Title, string CustomerName, string SiteAddress, string ServiceCategory, string Priority, string TeamId);
public sealed record UpdateOrder(int ExpectedVersion, string Title, string Priority, string Status);
public sealed record CreateBooking(Guid WorkOrderId, string TechnicianId, DateTimeOffset StartUtc, DateTimeOffset EndUtc, string? OverrideReason);
public sealed record MoveBooking(int ExpectedVersion, DateTimeOffset StartUtc, DateTimeOffset EndUtc, string Reason);
public sealed record StartWorkflow(Guid WorkOrderId);
public sealed record SubmitStage(int ExpectedVersion, string IdempotencyKey, Dictionary<string, string> Answers, DateTimeOffset? ClientOccurredAtUtc, bool Offline = false);
public sealed record Intervention(int ExpectedVersion, string Reason, int? TargetStageIndex);
public sealed record RecommendationRequest(Guid WorkOrderId, DateTimeOffset StartUtc, int DurationMinutes = 60, string Strategy = "baseline");
public sealed record TimeOffRequest(DateTimeOffset StartUtc, DateTimeOffset EndUtc, string Reason);
public sealed record RecommendationDecision(int ExpectedVersion, string ModelVersion, double BreachRisk, string Decision, string Reason, DateTimeOffset? PredictedAtUtc = null, Dictionary<string, string>? Features = null);

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
            case "work-orders": MapOrders(app); break;
            case "technicians": MapTechnicians(app); break;
            case "scheduling": MapScheduling(app); break;
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
        group.MapGet("/{id:guid}", async (Guid id, ServiceDb db, HttpContext http, CancellationToken ct) =>
        {
            var order = await db.WorkOrders.AsNoTracking().SingleOrDefaultAsync(x => x.Id == id, ct) ?? throw new DomainException(404, "Work order not found.");
            Caller.From(http.User).Demand(order.TeamId, order.TechnicianId);
            return Results.Ok(order);
        });
        group.MapPost("", async (CreateOrder request, ServiceDb db, TimeProvider clock, HttpContext http, CancellationToken ct) =>
        {
            var caller = Caller.From(http.User);
            caller.Demand(request.TeamId);
            ValidateText(request.Title, 3, 160, "title"); ValidateText(request.CustomerName, 2, 100, "customer name"); ValidateText(request.SiteAddress, 3, 240, "site address");
            if (!new[] { "HVAC", "Electrical", "Mechanical", "Refrigeration", "Controls", "Heating", "Cooling", "Ventilation" }.Contains(request.ServiceCategory)) throw new DomainException(400, "Unknown service category.");
            if (!new[] { "Low", "Normal", "High", "Critical" }.Contains(request.Priority)) throw new DomainException(400, "Unknown priority.");
            var now = clock.GetUtcNow();
            var order = new WorkOrder { Number = $"WO-{now:yyyyMMdd}-{Guid.NewGuid().ToString("N")[..6].ToUpperInvariant()}", Title = request.Title.Trim(), CustomerName = request.CustomerName.Trim(), SiteAddress = request.SiteAddress.Trim(), ServiceCategory = request.ServiceCategory, Priority = request.Priority, TeamId = request.TeamId, CreatedAtUtc = now };
            db.WorkOrders.Add(order);
            // Customer and address are deliberately excluded from integration/audit events.
            db.Enqueue(EventFactory.Create(http, "work-orders", "WorkOrderCreated.v1", order.Id, OrderPayload(order), order.Version, now));
            await db.SaveChangesAsync(ct);
            return Results.Created($"/api/work-orders/{order.Id}", order);
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

    public static object OrderPayload(WorkOrder order) => new { workOrderId = order.Id, order.Number, order.TeamId, order.TechnicianId, order.ServiceCategory, order.Priority, order.Status, order.CreatedAtUtc, order.CompletedAtUtc };

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
        group.MapGet("", async (ServiceDb db, HttpContext http, CancellationToken ct) =>
        {
            var caller = Caller.From(http.User);
            return Results.Ok(await db.Bookings.AsNoTracking().Where(x => caller.IsAdministrator || (x.TeamId == caller.TeamId && (!caller.IsTechnician || x.TechnicianId == caller.Id))).OrderBy(x => x.StartUtc).Take(1000).ToListAsync(ct));
        });
        group.MapPost("", async (CreateBooking request, ServiceDb db, RemoteServices remote, TimeProvider clock, HttpContext http, CancellationToken ct) =>
        {
            var order = await remote.Get<WorkOrder>("WorkOrders", $"/api/work-orders/{request.WorkOrderId}", http, ct);
            var tech = await GetTechnician(remote, request.TechnicianId, http, ct);
            var timeOff = await remote.Get<TimeOff[]>("Technicians", $"/api/technicians/{request.TechnicianId}/time-off", http, ct);
            Caller.From(http.User).Demand(order.TeamId);
            if (order.Status is "Completed" or "Cancelled" or "InProgress") throw new DomainException(409, "Work order cannot be scheduled in this state.");
            BookingRules.Validate(tech, order, request.StartUtc, request.EndUtc, timeOff);
            var booking = new Booking { WorkOrderId = order.Id, TechnicianId = tech.Id, TeamId = order.TeamId, StartUtc = request.StartUtc.ToUniversalTime(), EndUtc = request.EndUtc.ToUniversalTime(), OverrideReason = request.OverrideReason };
            db.Bookings.Add(booking);
            db.Enqueue(EventFactory.Create(http, "scheduling", "BookingCreated.v1", order.Id, booking, booking.Version, clock.GetUtcNow()));
            await db.SaveChangesAsync(ct);
            return Results.Created($"/api/bookings/{booking.Id}", booking);
        }).RequireAuthorization("dispatch");
        group.MapPut("/{id:guid}", async (Guid id, MoveBooking request, ServiceDb db, RemoteServices remote, TimeProvider clock, HttpContext http, CancellationToken ct) =>
        {
            var booking = await db.Bookings.FindAsync([id], ct) ?? throw new DomainException(404, "Booking not found.");
            Caller.From(http.User).Demand(booking.TeamId);
            if (booking.Version != request.ExpectedVersion || booking.Status != "Confirmed") throw new DomainException(409, "Booking changed or is not confirmed.");
            ValidateText(request.Reason, 3, 240, "reason");
            var order = await remote.Get<WorkOrder>("WorkOrders", $"/api/work-orders/{booking.WorkOrderId}", http, ct);
            var tech = await GetTechnician(remote, booking.TechnicianId, http, ct);
            var timeOff = await remote.Get<TimeOff[]>("Technicians", $"/api/technicians/{booking.TechnicianId}/time-off", http, ct);
            BookingRules.Validate(tech, order, request.StartUtc, request.EndUtc, timeOff);
            booking.StartUtc = request.StartUtc.ToUniversalTime(); booking.EndUtc = request.EndUtc.ToUniversalTime(); booking.Version++; booking.OverrideReason = request.Reason;
            db.Enqueue(EventFactory.Create(http, "scheduling", "BookingRescheduled.v1", booking.WorkOrderId, booking, booking.Version, clock.GetUtcNow()));
            await db.SaveChangesAsync(ct); return Results.Ok(booking);
        }).RequireAuthorization("dispatch");
        group.MapPost("/{id:guid}/cancel", async (Guid id, Intervention request, ServiceDb db, TimeProvider clock, HttpContext http, CancellationToken ct) =>
        {
            var booking = await db.Bookings.FindAsync([id], ct) ?? throw new DomainException(404, "Booking not found.");
            Caller.From(http.User).Demand(booking.TeamId);
            if (booking.Version != request.ExpectedVersion || booking.Status != "Confirmed") throw new DomainException(409, "Booking changed or is not confirmed.");
            ValidateText(request.Reason, 3, 240, "reason"); booking.Status = "Cancelled"; booking.Version++;
            db.Enqueue(EventFactory.Create(http, "scheduling", "BookingCancelled.v1", booking.WorkOrderId, new { booking.Id, booking.WorkOrderId, booking.TeamId, booking.TechnicianId, request.Reason }, booking.Version, clock.GetUtcNow()));
            await db.SaveChangesAsync(ct); return Results.Ok(booking);
        }).RequireAuthorization("dispatch");
        app.MapPost("/api/scheduling/recommendations", SchedulingRecommendations.Handle).RequireAuthorization("dispatch");
    }

    private static async Task<Technician> GetTechnician(RemoteServices remote, string id, HttpContext http, CancellationToken ct) => (await remote.Get<TechnicianDto>("Technicians", $"/api/technicians/{id}", http, ct)).ToEntity();
    public sealed record TechnicianDto(string Id, string Name, string TeamId, string SupervisorId, string[] Skills, string[] Certifications, int WorkingStartHour, int WorkingEndHour, string TimeZone, bool Available, int Version)
    {
        public Technician ToEntity() => new() { Id = Id, Name = Name, TeamId = TeamId, SupervisorId = SupervisorId, Skills = Skills, Certifications = Certifications, WorkingStartHour = WorkingStartHour, WorkingEndHour = WorkingEndHour, TimeZone = TimeZone, Available = Available, Version = Version };
    }

    private static void MapWorkflows(WebApplication app)
    {
        var defaultTemplateVersion = app.Configuration.GetValue("Workflows:DefaultTemplateVersion", 1);
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
            var bookings = await remote.Get<Booking[]>("Scheduling", "/api/bookings", http, ct);
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
        group.MapPost("/{id:guid}/interventions", async (Guid id, RecommendationDecision request, ServiceDb db, TimeProvider clock, HttpContext http, CancellationToken ct) =>
        {
            var workflow = await FindWorkflow(id, db, http, ct);
            WorkflowEngine.RequireVersion(workflow, request.ExpectedVersion);
            if (workflow.Status != "Active") throw new DomainException(409, "Prediction decisions require an active workflow.");
            ValidateText(request.Reason, 3, 500, "reason"); ValidateText(request.ModelVersion, 2, 100, "model version");
            if (request.BreachRisk is < 0 or > 1 || !double.IsFinite(request.BreachRisk) || request.Decision is not ("Accepted" or "Dismissed")) throw new DomainException(400, "Choose Accepted or Dismissed and a probability between zero and one.");
            var allowedFeatures = new[] { "serviceCategory", "stageIndex", "technicianWorkload", "historicalStageDurationMinutes", "elapsedMinutes", "progress", "priority", "previousDelays", "equipmentCategory" };
            if (request.Features is not null && request.Features.Any(x => !allowedFeatures.Contains(x.Key) || x.Value.Length > 128)) throw new DomainException(400, "Unknown or oversized advisory feature.");
            workflow.Version++;
            db.Enqueue(EventFactory.Create(http, "workflows", "RecommendationDecisionRecorded.v1", workflow.WorkOrderId, new { workflow.TeamId, workflow.TechnicianId, request.ModelVersion, request.BreachRisk, request.Decision, request.Reason, request.PredictedAtUtc, request.Features, advisory = true, provenance = "Supervisor-submitted advisory snapshot; model output is not independently verified by this endpoint." }, workflow.Version, clock.GetUtcNow(), workflow.Id, workflow.Stages[workflow.CurrentStageIndex].Id));
            await db.SaveChangesAsync(ct); return Results.Ok(WorkflowView(workflow));
        }).RequireAuthorization("supervise");
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
