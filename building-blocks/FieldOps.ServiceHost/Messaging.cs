using System.Security.Cryptography;
using System.Text;
using FieldOps.Core;
using MassTransit;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Quartz;

namespace FieldOps.ServiceHost;

public sealed class OutboxDispatcher(IServiceScopeFactory scopes, ILogger<OutboxDispatcher> log, TimeProvider clock) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await using var scope = scopes.CreateAsyncScope();
                var db = scope.ServiceProvider.GetRequiredService<ServiceDb>();
                var publisher = scope.ServiceProvider.GetRequiredService<IPublishEndpoint>();
                // PostgreSQL row locks coordinate multiple replicas. Publication is at-least-once:
                // if a publisher dies between broker confirm and DB commit, inbox IDs deduplicate.
                await using var transaction = await db.Database.BeginTransactionAsync(stoppingToken);
                var now = clock.GetUtcNow();
                var messages = await db.Outbox.FromSqlInterpolated($"SELECT * FROM outbox_messages WHERE \"PublishedAtUtc\" IS NULL AND \"NextAttemptAtUtc\" <= {now} ORDER BY \"CreatedAtUtc\" LIMIT 40 FOR UPDATE SKIP LOCKED").ToListAsync(stoppingToken);
                foreach (var message in messages)
                {
                    try
                    {
                        var audit = Json.Read<AuditEvent>(message.Body);
                        System.Diagnostics.ActivityContext.TryParse(audit.TraceId is not null && audit.SpanId is not null ? $"00-{audit.TraceId}-{audit.SpanId}-01" : null, null, out var parent);
                        using var activity = Telemetry.Activities.StartActivity("outbox.publish", System.Diagnostics.ActivityKind.Producer, parent);
                        activity?.SetTag("messaging.message.id", audit.EventId.ToString());
                        await publisher.Publish(audit, context => { context.MessageId = audit.EventId; context.CorrelationId = Guid.TryParse(audit.CorrelationId, out var correlation) ? correlation : audit.EventId; context.Headers.Set("traceparent", audit.TraceId is not null && audit.SpanId is not null ? $"00-{audit.TraceId}-{audit.SpanId}-01" : ""); context.Headers.Set("outbox-attempt", message.Attempts + 1); }, stoppingToken);
                        message.PublishedAtUtc = now; message.LastError = null;
                        Telemetry.Published.WithLabels(db.ServiceName, "confirmed").Inc();
                    }
                    catch (Exception ex) when (ex is not OperationCanceledException)
                    {
                        message.Attempts++; message.LastError = ex.GetType().Name;
                        Telemetry.Published.WithLabels(db.ServiceName, "failed").Inc();
                        message.NextAttemptAtUtc = now.AddSeconds(Math.Min(300, Math.Pow(2, Math.Min(message.Attempts, 8))));
                        log.LogWarning("Outbox event {EventId} publication failed on attempt {Attempt}", message.Id, message.Attempts);
                    }
                }
                await db.SaveChangesAsync(stoppingToken);
                await transaction.CommitAsync(stoppingToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException) { log.LogError(ex, "Outbox dispatch pass failed; retrying"); }
            await Task.Delay(TimeSpan.FromSeconds(1), stoppingToken);
        }
    }
}

[DisallowConcurrentExecution]
public sealed class SlaSweep(IServiceScopeFactory scopes, TimeProvider clock, SlaPolicy policy, ILogger<SlaSweep> log) : IJob
{
    public async Task Execute(IJobExecutionContext context)
    {
        await using var scope = scopes.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<ServiceDb>();
        var workflows = await db.Workflows.Where(x => x.Status == "Active").ToListAsync(context.CancellationToken);
        foreach (var workflow in workflows)
        {
            var now = clock.GetUtcNow();
            var raised = WorkflowEngine.Evaluate(workflow, now, policy);
            Guid? precedingMilestone = null;
            foreach (var type in raised)
            {
                using var activity = Telemetry.Activities.StartActivity("sla.stage-transition", System.Diagnostics.ActivityKind.Internal);
                var stage = workflow.Stages[workflow.CurrentStageIndex];
                var milestone = EventFactory.Create(null, "workflows", type, workflow.WorkOrderId, OperationsApi.StagePayload(workflow, stage), workflow.Version, now, workflow.Id, stage.Id, precedingMilestone);
                db.Enqueue(milestone); precedingMilestone = milestone.EventId;
            }
        }
        try { await db.SaveChangesAsync(context.CancellationToken); }
        catch (DbUpdateConcurrencyException) { log.LogInformation("SLA sweep raced an operator change; next sweep will re-evaluate"); }
    }
}

[Authorize(Policy = "operational")]
public sealed class NotificationHub : Hub
{
    public override async Task OnConnectedAsync()
    {
        var caller = Caller.From(Context.User!);
        await Groups.AddToGroupAsync(Context.ConnectionId, caller.IsTechnician ? $"technician:{caller.Id}" : caller.IsAdministrator ? "administrators" : $"team:{caller.TeamId}");
        await base.OnConnectedAsync();
    }
}

public sealed class OperationalConsumer(ServiceDb db, ServiceIdentity identity, TimeProvider clock, IHubContext<NotificationHub> hub, IConfiguration configuration) : IConsumer<AuditEvent>
{
    public async Task Consume(ConsumeContext<AuditEvent> context)
    {
        var e = context.Message;
        var now = clock.GetUtcNow();
        var inboxId = $"{identity.Name}:{e.EventId}";
        await using var transaction = await db.Database.BeginTransactionAsync(context.CancellationToken);
        var seen = await db.Inbox.AnyAsync(x => x.Id == inboxId, context.CancellationToken);
        if (context.GetRetryAttempt() > 0) Telemetry.Retries.WithLabels(identity.Name).Inc();
        if (identity.Name == "reporting")
        {
            db.DeliveryAttempts.Add(new DeliveryAttempt { EventId = e.EventId, Attempt = context.GetRetryAttempt() + 1, ConsumerService = identity.Name, OccurredAtUtc = now, ReceivedAtUtc = now, ProcessedAtUtc = now, Status = seen ? "Duplicate" : "Processed" });
        }
        if (seen)
        {
            Telemetry.Consumed.WithLabels(identity.Name, "duplicate").Inc();
            await db.SaveChangesAsync(context.CancellationToken); await transaction.CommitAsync(context.CancellationToken); return;
        }
        // Development-only deterministic failure injection for a broker retry demonstration.
        // One requested event type fails its first delivery; retry remains broker-owned.
        if (configuration.GetValue<bool>("Demo:EnableConsumerFailure") && e.EventType == configuration["Demo:FailEventType"] && (configuration.GetValue<bool>("Demo:AlwaysFailConsumer") || context.GetRetryAttempt() == 0))
        {
            if (identity.Name == "reporting")
            {
                db.ChangeTracker.Clear();
                db.DeliveryAttempts.Add(new DeliveryAttempt { EventId = e.EventId, Attempt = context.GetRetryAttempt() + 1, ConsumerService = identity.Name, OccurredAtUtc = now, ReceivedAtUtc = now, ProcessedAtUtc = now, Status = "Failed", Error = "Controlled development-only processing failure" });
                await db.SaveChangesAsync(context.CancellationToken); await transaction.CommitAsync(context.CancellationToken);
            }
            throw new InvalidOperationException("Controlled development-only consumer failure.");
        }
        db.Inbox.Add(new InboxMessage { Id = inboxId, ProcessedAtUtc = now });
        Notification? notification = null;
        if (identity.Name == "work-orders") await ProjectOrder(e, context.CancellationToken);
        if (identity.Name == "notifications") notification = ProjectNotification(e, now);
        if (identity.Name == "reporting") await ProjectReporting(e, now, context.CancellationToken);
        await db.SaveChangesAsync(context.CancellationToken);
        await transaction.CommitAsync(context.CancellationToken);
        Telemetry.Consumed.WithLabels(identity.Name, "processed").Inc();
        Telemetry.Delay.WithLabels(identity.Name).Observe(Math.Max(0, (now - e.OccurredAtUtc).TotalSeconds));
        if (notification is not null)
        {
            // The persisted history is authoritative. A disconnected client reconciles via GET;
            // real-time delivery is best effort and is never allowed to lose the notification.
            var audience = notification.Audience == "Technician" ? $"technician:{notification.TechnicianId}" : $"team:{notification.TeamId}";
            await hub.Clients.Groups(audience, "administrators").SendAsync("notification", notification, context.CancellationToken);
        }
    }

    private async Task ProjectOrder(AuditEvent e, CancellationToken ct)
    {
        if (e.WorkOrderId == Guid.Empty) return;
        var order = await db.WorkOrders.FindAsync([e.WorkOrderId], ct);
        if (order is null) return;
        switch (e.EventType)
        {
            case "BookingCreated.v1":
                if (order.Status is "Created" or "Scheduled") { order.TechnicianId = GetString(e, "technicianId"); order.Status = "Scheduled"; order.Version++; }
                break;
            case "BookingCancelled.v1":
                if (order.Status == "Scheduled") { order.TechnicianId = null; order.Status = "Created"; order.Version++; }
                break;
            case "WorkflowStarted.v1":
                if (order.Status is not "Completed" and not "Cancelled") { order.Status = "InProgress"; order.TechnicianId = GetString(e, "technicianId"); order.Version++; }
                break;
            case "WorkflowCompleted.v1":
                order.Status = "Completed"; order.CompletedAtUtc = GetDate(e, "completedAtUtc") ?? e.OccurredAtUtc; order.Version++;
                db.Enqueue(new AuditEvent(Guid.NewGuid(), "WorkOrderCompleted.v1", 1, order.Id, e.WorkflowId, null, "system", "System", "work-orders", e.CorrelationId, e.EventId, e.TraceId, e.SpanId, e.OccurredAtUtc, clock.GetUtcNow(), order.Version, System.Text.Json.JsonSerializer.SerializeToElement(OperationsApi.OrderPayload(order), Json.Options))); break;
        }
    }

    private Notification? ProjectNotification(AuditEvent e, DateTimeOffset now)
    {
        if (e.EventType is not ("StageWarningRaised.v1" or "StageCriticalWarningRaised.v1" or "StageSLABreached.v1" or "AssistanceRequested.v1")) return null;
        var warning = e.EventType == "StageWarningRaised.v1";
        var notification = new Notification { EventId = e.EventId, WorkOrderId = e.WorkOrderId, TeamId = GetString(e, "teamId") ?? "", TechnicianId = GetString(e, "technicianId"), Audience = warning || e.EventType == "StageCriticalWarningRaised.v1" ? "Technician" : "Supervisor", Title = e.EventType switch { "StageWarningRaised.v1" => "Stage has reached its warning threshold", "StageCriticalWarningRaised.v1" => "Stage is approaching its SLA deadline", "StageSLABreached.v1" => "Stage SLA breached — supervisor review required", _ => "Technician requested assistance" }, Severity = warning ? "Warning" : "Critical", CreatedAtUtc = now };
        db.Notifications.Add(notification);
        db.Enqueue(new AuditEvent(Guid.NewGuid(), "SupervisorNotificationCreated.v1", 1, e.WorkOrderId, e.WorkflowId, e.StageInstanceId, "system", "System", "notifications", e.CorrelationId, e.EventId, e.TraceId, e.SpanId, now, now, e.SequenceNumber, System.Text.Json.JsonSerializer.SerializeToElement(new { notification.Id, notification.TeamId, notification.TechnicianId, notification.Audience, notification.Title }, Json.Options)));
        return notification;
    }

    private async Task ProjectReporting(AuditEvent e, DateTimeOffset now, CancellationToken ct)
    {
        await FaultEvidence.LockOrder(db, e.WorkOrderId, ct);
        // A fault may have preserved this original evidence before normal delivery
        // recovers. Keep its original body/arrival and still apply the missing facts.
        if (!await db.Events.AnyAsync(x => x.EventId == e.EventId, ct)) db.Events.Add(FaultEvidence.Store(e, now));
        if (e.WorkOrderId == Guid.Empty) return;
        var projection = await db.ReplayProjections.FindAsync([e.WorkOrderId], ct);
        if (projection is null) { projection = new ReplayProjection { WorkOrderId = e.WorkOrderId, TeamId = GetString(e, "teamId") ?? "" }; db.ReplayProjections.Add(projection); }
        var priorEvents = await db.Events.AsNoTracking().Where(x => x.WorkOrderId == e.WorkOrderId).Select(x => x.Body).ToListAsync(ct);
        var history = priorEvents.Select(Json.Read<AuditEvent>).Append(e).GroupBy(x => x.EventId).Select(g => g.First()).ToArray();
        projection.StateJson = Json.Write(ReplayEngine.Reconstruct(history)); projection.EventCount = history.Length; projection.UpdatedAtUtc = now;
        var order = await db.WorkOrderFacts.FindAsync([e.WorkOrderId], ct);
        if (order is null) { order = new WorkOrderFact { WorkOrderId = e.WorkOrderId, CreatedAtUtc = e.OccurredAtUtc, TeamId = GetString(e, "teamId") ?? "" }; db.WorkOrderFacts.Add(order); }
        // Late creation enriches a pre-existing fact without erasing already observed completion.
        if (e.EventType == "WorkOrderCreated.v1") { order.Number = GetString(e, "number") ?? ""; order.ServiceCategory = GetString(e, "serviceCategory") ?? "Unknown"; order.Priority = GetString(e, "priority") ?? "Normal"; order.CreatedAtUtc = GetDate(e, "createdAtUtc") ?? e.OccurredAtUtc; }
        if (e.EventType == "BookingCreated.v1") { order.TechnicianId = GetString(e, "technicianId"); if (order.Status == "Created") order.Status = "Scheduled"; }
        if (e.EventType == "WorkflowStarted.v1" && order.CompletedAtUtc is null) order.Status = "InProgress";
        if (e.EventType is "WorkOrderCompleted.v1" or "WorkflowCompleted.v1") { order.Status = "Completed"; order.CompletedAtUtc = GetDate(e, "completedAtUtc") ?? e.OccurredAtUtc; }
        order.UpdatedAtUtc = now;
        if (e.StageInstanceId.HasValue && e.EventType is "StageStarted.v1" or "StageCompleted.v1" or "StageWarningRaised.v1" or "StageCriticalWarningRaised.v1" or "StageSLABreached.v1" or "StagePaused.v1" or "StageResumed.v1" or "SupervisorOverrideApplied.v1")
        {
            var stage = await db.StageFacts.FindAsync([e.StageInstanceId.Value], ct);
            if (stage is null) { stage = new StageFact { StageInstanceId = e.StageInstanceId.Value, WorkOrderId = e.WorkOrderId, TeamId = order.TeamId, Stage = GetString(e, "stageName") ?? "Unknown", TechnicianId = GetString(e, "technicianId") ?? "" }; db.StageFacts.Add(stage); }
            stage.StartedAtUtc ??= GetDate(e, "startedAtUtc");
            stage.CompletedAtUtc ??= GetDate(e, "completedAtUtc");
            stage.DeadlineUtc = GetDate(e, "deadlineUtc") ?? stage.DeadlineUtc;
            if (e.EventType == "StageSLABreached.v1" || GetString(e, "slaStatus") == "Breached") stage.Breached = true;
            var status = GetString(e, "slaStatus");
            if (stage.Breached) stage.SlaStatus = "Breached";
            else if (status is not null) stage.SlaStatus = status;
            if (e.EventPayload.TryGetProperty("pausedSeconds", out var paused)) stage.PausedSeconds = Math.Max(stage.PausedSeconds, paused.GetDouble());
            stage.UpdatedAtUtc = now;
        }
    }
    internal static string? GetString(AuditEvent e, string name) => e.EventPayload.TryGetProperty(name, out var value) && value.ValueKind == System.Text.Json.JsonValueKind.String ? value.GetString() : null;
    internal static DateTimeOffset? GetDate(AuditEvent e, string name) => e.EventPayload.TryGetProperty(name, out var value) && value.ValueKind == System.Text.Json.JsonValueKind.String && value.TryGetDateTimeOffset(out var date) ? date : null;
}
