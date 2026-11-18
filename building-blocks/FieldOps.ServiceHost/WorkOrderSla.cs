using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using FieldOps.Core;
using Microsoft.EntityFrameworkCore;

namespace FieldOps.ServiceHost;

public sealed record WorkOrderSlaView(bool Configured, WorkOrderSlaSnapshot? Snapshot, WorkOrderSlaState? State,
    WorkOrderSlaEvidenceView[] Evidence);
public sealed record WorkOrderSlaEvidenceView(Guid Id, int ClockRevision, string Action, string TargetKind,
    Guid? SourceEventId, Guid? RelatedEvidenceId, DateTimeOffset EffectiveAtUtc, DateTimeOffset RecordedAtUtc, string DetailsJson);
public sealed record ContractSlaSweep(int Evaluated, int Changed, int Failed);

/// <summary>Job-owned contract obligations; workflow-stage policy is never changed here.</summary>
public static class WorkOrderSla
{
    public static void Map(WebApplication app)
    {
        app.MapGet("/api/work-orders/{id:guid}/sla", Read).RequireAuthorization("service-report");
        app.MapGet("/api/customer-portal/work-orders/{id:guid}/sla", Read).RequireAuthorization("customer");
    }

    public static async Task<IResult> Read(Guid id, ServiceDb db, HttpContext http, CancellationToken ct)
    {
        var order = await db.WorkOrders.AsNoTracking().SingleOrDefaultAsync(x => x.Id == id, ct)
            ?? throw new DomainException(404, "Work order not found.");
        if (http.User.IsInRole("Customer"))
        {
            var scope = CustomerScope.From(http.User);
            if (order.CustomerId != scope.CustomerId || order.TeamId != scope.TeamId)
                throw new DomainException(404, "Work order not found.");
        }
        else Caller.From(http.User).Demand(order.TeamId, order.TechnicianId);
        var snapshot = await db.WorkOrderSlaSnapshots.AsNoTracking().SingleOrDefaultAsync(x => x.WorkOrderId == id, ct);
        var state = snapshot is null ? null : await db.WorkOrderSlaStates.AsNoTracking().SingleAsync(x => x.WorkOrderId == id, ct);
        WorkOrderSlaEvidenceView[] evidence = snapshot is null ? [] : await db.WorkOrderSlaEvidence.AsNoTracking()
            .Where(x => x.WorkOrderId == id).OrderByDescending(x => x.RecordedAtUtc).ThenByDescending(x => x.Id).Take(200)
            .Select(x => new WorkOrderSlaEvidenceView(x.Id, x.ClockRevision, x.Action, x.TargetKind, x.SourceEventId,
                x.RelatedEvidenceId, x.EffectiveAtUtc, x.RecordedAtUtc, x.DetailsJson)).ToArrayAsync(ct);
        http.Response.Headers.CacheControl = "no-store";
        return Results.Ok(new WorkOrderSlaView(snapshot is not null, snapshot, state, evidence));
    }

    // Call while creating the canonical order, before the same SaveChanges/commit.
    public static void Attach(ServiceDb db, WorkOrder order, ContractSlaTerms? terms, HttpContext? http, DateTimeOffset now)
    {
        if (terms is null) return;
        ContractSlaRules.Validate(terms);
        if (order.Id == Guid.Empty || order.CreatedAtUtc == default || order.ContractId != terms.ContractId || order.ContractLineId != terms.ContractLineId)
            throw new DomainException(409, "The SLA terms must match this work order's evaluated agreement and line.");
        if (db.WorkOrderSlaSnapshots.Local.Any(x => x.WorkOrderId == order.Id))
            throw new InvalidOperationException("A job's contract SLA snapshot can be attached only once.");
        now = ContractSlaRules.Instant(now);
        var snapshot = new WorkOrderSlaSnapshot
        {
            WorkOrderId = order.Id, TeamId = order.TeamId, ContractId = terms.ContractId, ContractLineId = terms.ContractLineId,
            ContractVersion = terms.ContractVersion, ClockOrigin = terms.ClockOrigin, ResponseTargetMinutes = terms.ResponseTargetMinutes,
            CompletionTargetMinutes = terms.CompletionTargetMinutes, TimeZoneId = terms.TimeZoneId,
            WorkOrderCreatedAtUtc = ContractSlaRules.Instant(order.CreatedAtUtc), AttachedAtUtc = now,
            TermsHash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(Json.Write(terms))))
        };
        var state = ContractSlaRules.Initial(snapshot, now);
        db.WorkOrderSlaSnapshots.Add(snapshot);
        db.WorkOrderSlaStates.Add(state);
        var caller = http is null ? null : Caller.From(http.User);
        Append(db, snapshot, state, new("ContractSlaAttached.v1", "Snapshot", now), null, now,
            caller?.Id ?? "system", caller?.Role ?? "System", http?.Items["CorrelationId"]?.ToString());
        AppendAll(db, snapshot, state, ContractSlaRules.Evaluate(snapshot, state, now), null, now);
    }

    // The existing work-order consumer owns the inbox and transaction. Invoke
    // after it applies the canonical lifecycle fact; this method does not commit.
    public static async Task Project(ServiceDb db, WorkOrder order, AuditEvent message, TimeProvider clock, CancellationToken ct)
    {
        var scheduling = message.SourceService == "scheduling" && message.EventType is
            "BookingCreated.v1" or "BookingRescheduled.v1" or "BookingCancelled.v1" or "BookingServiceStarted.v1";
        var completion = message.SourceService == "workflows" && message.EventType == "WorkflowCompleted.v1" ||
            message.SourceService == "work-orders" && message.EventType == "WorkOrderCompleted.v1";
        var update = message.SourceService == "work-orders" && message.EventType == "WorkOrderUpdated.v1";
        if ((!scheduling && !completion && !update) || message.EventVersion != 1 || message.SchemaVersion != 1 ||
            message.WorkOrderId != order.Id || Text(message, "teamId") != order.TeamId) return;
        await AssignmentOfferApi.LockOrder(db, order.Id, ct);
        var snapshot = await db.WorkOrderSlaSnapshots.AsNoTracking().SingleOrDefaultAsync(x => x.WorkOrderId == order.Id, ct);
        if (snapshot is null) return;
        var state = await db.WorkOrderSlaStates.SingleAsync(x => x.WorkOrderId == order.Id, ct);
        var now = ContractSlaRules.Instant(clock.GetUtcNow());
        var before = Json.Write(state);
        var transitions = new List<ContractSlaTransition>();
        if (snapshot.TeamId != order.TeamId || snapshot.ContractId != order.ContractId || snapshot.ContractLineId != order.ContractLineId)
            transitions.AddRange(ContractSlaRules.Review(state, "Current work-order coverage differs from its immutable SLA terms.", now));
        else if (scheduling) ApplyScheduling(snapshot, state, message, now, transitions);
        else if (completion) ApplyCompletion(snapshot, state, order, message, now, transitions);
        else if (Text(message, "status") == "Cancelled") ApplyCancellation(snapshot, state, order, message, now, transitions);
        transitions.AddRange(ContractSlaRules.Evaluate(snapshot, state, now));
        if (transitions.Count > 0 || before != Json.Write(state))
        {
            state.Version++;
            state.UpdatedAtUtc = now;
        }
        AppendAll(db, snapshot, state, transitions, message, now, before);
    }

    private static void ApplyScheduling(WorkOrderSlaSnapshot snapshot, WorkOrderSlaState state, AuditEvent message,
        DateTimeOffset now, List<ContractSlaTransition> transitions)
    {
        var booking = Id(message, "id");
        if (booking is null || booking == Guid.Empty || Id(message, "workOrderId") != snapshot.WorkOrderId || message.SequenceNumber <= 0) return;
        var started = message.EventType == "BookingServiceStarted.v1";
        if (!started && message.SequenceNumber <= state.BookingRevision) return;
        if (started)
        {
            var instant = Date(message, "serviceStartedAtUtc");
            var appointment = Date(message, "startUtc");
            var end = Date(message, "endUtc");
            if (Text(message, "status") != "Confirmed" || instant is null || appointment is null || end is null || end <= appointment ||
                !ValidFactTime(snapshot, instant.Value, now))
            {
                transitions.AddRange(ContractSlaRules.Review(state, "The scheduling owner returned inconsistent service-start evidence.", now));
                return;
            }
            if (state.ResponseAtUtc is { } existing)
            {
                if (existing != instant || state.BookingId != booking)
                    transitions.AddRange(ContractSlaRules.Review(state, "Conflicting canonical service-start evidence requires review.", now));
                return;
            }
            if (message.SequenceNumber < state.BookingRevision || state.CancelledAtUtc.HasValue ||
                state.CompletedAtUtc < instant)
            {
                transitions.AddRange(ContractSlaRules.Review(state, "Service-start evidence conflicts with the retained booking or lifecycle history.", now));
                return;
            }
            state.BookingId = booking;
            state.BookingRevision = message.SequenceNumber;
            state.AppointmentStartUtc = appointment;
            if (snapshot.ClockOrigin == "AppointmentStart" && (state.OriginAtUtc is null || state.OriginAtUtc != appointment))
            {
                CorrectSupersededFindings(state, instant.Value, transitions, "Service-start evidence identifies the canonical appointment clock.");
                if (!ReviseClock(snapshot, state, appointment, message, now, transitions)) return;
            }
            state.ResponseAtUtc = instant;
            state.ResponseSourceEventId = message.EventId;
            transitions.Add(new("ContractSlaResponseObserved.v1", "Response", instant.Value,
                state.ResponseDueAtUtc, instant));
            return;
        }
        var occurred = ContractSlaRules.Instant(message.OccurredAtUtc);
        if (occurred < snapshot.WorkOrderCreatedAtUtc || occurred > now)
        {
            transitions.AddRange(ContractSlaRules.Review(state, "The scheduling change has an inconsistent owner timestamp.", now));
            return;
        }
        if (state.ResponseAtUtc.HasValue || state.CompletedAtUtc.HasValue || state.CancelledAtUtc.HasValue)
        {
            transitions.AddRange(ContractSlaRules.Review(state, "An appointment changed after a terminal service milestone.", now));
            return;
        }
        state.BookingId = booking;
        state.BookingRevision = message.SequenceNumber;
        if (message.EventType == "BookingCancelled.v1")
        {
            if (snapshot.ClockOrigin == "AppointmentStart")
            {
                CorrectSupersededFindings(state, occurred, transitions, "Owner cancellation preceded the target deadline.");
                transitions.AddRange(ContractSlaRules.Evaluate(snapshot, state, occurred));
                ReviseClock(snapshot, state, null, message, now, transitions);
            }
            transitions.Add(new("ContractSlaAppointmentCancelled.v1", "Clock", occurred));
            return;
        }
        var start = Date(message, "startUtc");
        var end = Date(message, "endUtc");
        if (Text(message, "status") != "Confirmed" || start is null || end is null || end <= start)
        {
            transitions.AddRange(ContractSlaRules.Review(state, "The scheduling owner returned an invalid confirmed appointment window.", now));
            return;
        }
        state.AppointmentStartUtc = start;
        if (snapshot.ClockOrigin == "AppointmentStart" && state.OriginAtUtc != start)
        {
            var priorDue = new[] { state.ResponseDueAtUtc, state.CompletionDueAtUtc }.Where(x => x.HasValue).Min();
            CorrectSupersededFindings(state, occurred, transitions, "The owner revised the appointment before its target deadline.");
            transitions.AddRange(ContractSlaRules.Evaluate(snapshot, state, occurred));
            if (!ReviseClock(snapshot, state, start, message, now, transitions)) return;
            if (priorDue.HasValue && occurred >= priorDue)
                transitions.AddRange(ContractSlaRules.Review(state, "Appointment revision followed an elapsed target; earlier SLA findings remain for review.", now));
        }
        else transitions.Add(new("ContractSlaAppointmentObserved.v1", "Clock", occurred));
    }

    private static bool ReviseClock(WorkOrderSlaSnapshot snapshot, WorkOrderSlaState state, DateTimeOffset? origin,
        AuditEvent message, DateTimeOffset now, List<ContractSlaTransition> transitions)
    {
        try
        {
            _ = ContractSlaRules.Due(origin, snapshot.ResponseTargetMinutes);
            _ = ContractSlaRules.Due(origin, snapshot.CompletionTargetMinutes);
        }
        catch (DomainException)
        {
            transitions.AddRange(ContractSlaRules.Review(state, "The appointment cannot represent the configured SLA deadlines.", now));
            return false;
        }
        state.ClockRevision++;
        state.OriginAtUtc = origin;
        state.ResponseOverdueEvidenceId = null;
        state.CompletionOverdueEvidenceId = null;
        ContractSlaRules.SetDeadlines(snapshot, state);
        transitions.Add(new("ContractSlaClockRevised.v1", "Clock", ContractSlaRules.Instant(message.OccurredAtUtc),
            Reason: origin is null ? "Awaiting a confirmed appointment." : "Clock follows the canonical appointment start."));
        return true;
    }

    private static void ApplyCompletion(WorkOrderSlaSnapshot snapshot, WorkOrderSlaState state, WorkOrder order,
        AuditEvent message, DateTimeOffset now, List<ContractSlaTransition> transitions)
    {
        var completed = Date(message, "completedAtUtc");
        if (completed is null || !ValidFactTime(snapshot, completed.Value, now) || order.Status != "Completed" ||
            order.CompletedAtUtc is null || ContractSlaRules.Instant(order.CompletedAtUtc.Value) != completed)
        {
            transitions.AddRange(ContractSlaRules.Review(state, "Completion does not match the canonical work-order owner state and timestamp.", now));
            return;
        }
        if (state.CompletedAtUtc is { } previous)
        {
            if (previous != completed) transitions.AddRange(ContractSlaRules.Review(state, "Conflicting canonical completion evidence requires review.", now));
            return;
        }
        if (state.CancelledAtUtc.HasValue || state.ResponseAtUtc > completed)
        {
            transitions.AddRange(ContractSlaRules.Review(state, "Completion conflicts with retained cancellation or response chronology.", now));
            return;
        }
        state.CompletedAtUtc = completed;
        state.CompletionSourceEventId = message.EventId;
        transitions.Add(new("ContractSlaCompletionObserved.v1", "Completion", completed.Value, state.CompletionDueAtUtc, completed));
    }

    private static void ApplyCancellation(WorkOrderSlaSnapshot snapshot, WorkOrderSlaState state, WorkOrder order,
        AuditEvent message, DateTimeOffset now, List<ContractSlaTransition> transitions)
    {
        var instant = ContractSlaRules.Instant(message.OccurredAtUtc);
        if (order.Status != "Cancelled" || !ValidFactTime(snapshot, instant, now))
        {
            transitions.AddRange(ContractSlaRules.Review(state, "Cancellation does not match the canonical work-order owner state.", now));
            return;
        }
        if (state.CancelledAtUtc.HasValue) return;
        CorrectSupersededFindings(state, instant, transitions, "Canonical work-order cancellation preceded the target deadline.");
        transitions.AddRange(ContractSlaRules.Evaluate(snapshot, state, instant));
        state.CancelledAtUtc = instant;
        transitions.Add(new("ContractSlaCancelled.v1", "Clock", instant));
    }

    private static bool ValidFactTime(WorkOrderSlaSnapshot snapshot, DateTimeOffset instant, DateTimeOffset now) =>
        instant >= snapshot.WorkOrderCreatedAtUtc && instant <= now;

    private static void CorrectSupersededFindings(WorkOrderSlaState state, DateTimeOffset effective,
        List<ContractSlaTransition> transitions, string reason)
    {
        if (state.ResponseOverdueEvidenceId is { } response && effective < state.ResponseDueAtUtc)
            transitions.Add(new("ContractSlaFindingCorrected.v1", "Response", effective, state.ResponseDueAtUtc,
                RelatedEvidenceId: response, Reason: reason, ClockRevision: state.ClockRevision));
        if (state.CompletionOverdueEvidenceId is { } completion && effective < state.CompletionDueAtUtc)
            transitions.Add(new("ContractSlaFindingCorrected.v1", "Completion", effective, state.CompletionDueAtUtc,
                RelatedEvidenceId: completion, Reason: reason, ClockRevision: state.ClockRevision));
    }

    private static void AppendAll(ServiceDb db, WorkOrderSlaSnapshot snapshot, WorkOrderSlaState state,
        IEnumerable<ContractSlaTransition> transitions, AuditEvent? source, DateTimeOffset now, string? beforeState = null)
    {
        foreach (var transition in transitions) Append(db, snapshot, state, transition, source, now, beforeState: beforeState);
    }

    private static void Append(ServiceDb db, WorkOrderSlaSnapshot snapshot, WorkOrderSlaState state,
        ContractSlaTransition transition, AuditEvent? source, DateTimeOffset now, string actor = "system", string role = "System", string? correlation = null,
        string? beforeState = null)
    {
        var revision = transition.ClockRevision ?? state.ClockRevision;
        var semantic = $"{revision}:{transition.TargetKind}:{transition.Action}";
        if (transition.Action is "ContractSlaAppointmentObserved.v1" or "ContractSlaAppointmentCancelled.v1") semantic += ":" + state.BookingRevision;
        if (db.WorkOrderSlaEvidence.Local.Any(x => x.WorkOrderId == snapshot.WorkOrderId && x.SemanticKey == semantic)) return;
        var related = transition.RelatedEvidenceId;
        if (transition.Action == "ContractSlaTargetLate.v1") related ??= transition.TargetKind == "Response" ? state.ResponseOverdueEvidenceId : state.CompletionOverdueEvidenceId;
        var evidence = new WorkOrderSlaEvidence
        {
            WorkOrderId = snapshot.WorkOrderId, ClockRevision = revision, SemanticKey = semantic,
            Action = transition.Action, TargetKind = transition.TargetKind, SourceEventId = source?.EventId,
            RelatedEvidenceId = related, EffectiveAtUtc = transition.EffectiveAtUtc, RecordedAtUtc = now,
            ActorId = actor, ActorRole = role
        };
        var details = new
        {
            snapshot.TeamId, snapshot.ContractId, snapshot.ContractLineId, snapshot.ContractVersion,
            snapshot.ClockOrigin, snapshot.TermsHash, clockRevision = revision, state.BookingId, state.BookingRevision,
            state.OriginAtUtc, state.ResponseDueAtUtc, state.CompletionDueAtUtc,
            targetKind = transition.TargetKind, dueAtUtc = transition.DueAtUtc, milestoneAtUtc = transition.MilestoneAtUtc,
            reason = transition.Reason, sourceEventId = source?.EventId, relatedEvidenceId = related,
            before = beforeState is null ? (JsonElement?)null : Json.Read<JsonElement>(beforeState),
            after = JsonSerializer.SerializeToElement(state, Json.Options),
            effectiveAtUtc = transition.EffectiveAtUtc, recordedAtUtc = now
        };
        evidence.DetailsJson = Json.Write(details);
        db.WorkOrderSlaEvidence.Add(evidence);
        db.Enqueue(new AuditEvent(evidence.Id, evidence.Action, 1, snapshot.WorkOrderId, source?.WorkflowId, null,
            actor, role, "work-orders", source?.CorrelationId ?? correlation ?? Guid.NewGuid().ToString("D"), source?.EventId,
            source?.TraceId, source?.SpanId, transition.EffectiveAtUtc, now, state.Version,
            JsonSerializer.SerializeToElement(details, Json.Options)));
        if (transition.Action == "ContractSlaTargetOverdueObserved.v1")
        {
            if (transition.TargetKind == "Response")
            {
                if (revision == state.ClockRevision) state.ResponseOverdueEvidenceId = evidence.Id;
                state.ResponseEverOverdue = true;
            }
            else
            {
                if (revision == state.ClockRevision) state.CompletionOverdueEvidenceId = evidence.Id;
                state.CompletionEverOverdue = true;
            }
        }
    }

    public static async Task<ContractSlaSweep> Sweep(ServiceDb db, TimeProvider clock, CancellationToken ct = default, ILogger? logger = null)
    {
        if (db.ServiceName != "work-orders") throw new InvalidOperationException("Contract SLA execution belongs to work-orders.");
        var ids = await db.WorkOrderSlaStates.AsNoTracking().Where(x => !x.RequiresReview && x.CancelledAtUtc == null &&
            (x.ResponseStatus == "Pending" || x.ResponseStatus == "OverdueObserved" || x.CompletionStatus == "Pending" || x.CompletionStatus == "OverdueObserved"))
            .OrderBy(x => x.WorkOrderId).Select(x => x.WorkOrderId).ToArrayAsync(ct);
        var changed = 0;
        var failed = 0;
        foreach (var id in ids)
        {
            ct.ThrowIfCancellationRequested();
            try
            {
                await using var transaction = await db.Database.BeginTransactionAsync(ct);
                await AssignmentOfferApi.LockOrder(db, id, ct);
                db.ChangeTracker.Clear();
                var snapshot = await db.WorkOrderSlaSnapshots.AsNoTracking().SingleAsync(x => x.WorkOrderId == id, ct);
                var state = await db.WorkOrderSlaStates.SingleAsync(x => x.WorkOrderId == id, ct);
                var now = ContractSlaRules.Instant(clock.GetUtcNow());
                var before = Json.Write(state);
                var transitions = ContractSlaRules.Evaluate(snapshot, state, now);
                if (transitions.Length > 0)
                {
                    state.Version++;
                    state.UpdatedAtUtc = now;
                    AppendAll(db, snapshot, state, transitions, null, now, before);
                    await db.SaveChangesAsync(ct);
                }
                await transaction.CommitAsync(ct);
                if (transitions.Length > 0) changed++;
            }
            catch (Exception exception) when (exception is not OperationCanceledException)
            {
                db.ChangeTracker.Clear();
                failed++;
                logger?.LogError(exception, "Contract SLA evaluation failed for work order {WorkOrderId}; its transaction rolled back and will retry.", id);
            }
        }
        return new(ids.Length, changed, failed);
    }

    private static string? Text(AuditEvent message, string key) => message.EventPayload.TryGetProperty(key, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;
    private static Guid? Id(AuditEvent message, string key) => Guid.TryParse(Text(message, key), out var value) ? value : null;
    private static DateTimeOffset? Date(AuditEvent message, string key) => DateTimeOffset.TryParse(Text(message, key), System.Globalization.CultureInfo.InvariantCulture,
        System.Globalization.DateTimeStyles.RoundtripKind, out var value) ? ContractSlaRules.Instant(value) : null;
}

public sealed class WorkOrderSlaWorker(IServiceScopeFactory scopes, TimeProvider clock, ILogger<WorkOrderSlaWorker> logger,
    IConfiguration configuration) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var seconds = configuration.GetValue("ContractSla:IntervalSeconds", 10);
        if (seconds is < 1 or > 3600) throw new InvalidOperationException("Contract SLA sweep interval must be between one and 3600 seconds.");
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(seconds));
        do
        {
            try
            {
                await using var scope = scopes.CreateAsyncScope();
                await WorkOrderSla.Sweep(scope.ServiceProvider.GetRequiredService<ServiceDb>(), clock, stoppingToken, logger);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { return; }
            catch (Exception exception) { logger.LogError(exception, "Contract SLA sweep failed; it will retry."); }
        } while (await timer.WaitForNextTickAsync(stoppingToken));
    }
}
