using System.Text.Json;
using FieldOps.Core;
using MassTransit;
using Microsoft.EntityFrameworkCore;

namespace FieldOps.ServiceHost;

/// <summary>Projects owner-confirmed service facts into customer-owned maintenance evidence.</summary>
public sealed class MaintenanceVisitConsumer(ServiceDb db, TimeProvider clock) : IConsumer<AuditEvent>
{
    public Task Consume(ConsumeContext<AuditEvent> context) => Process(context.Message, db, clock, context.CancellationToken);

    public static async Task Process(AuditEvent message, ServiceDb db, TimeProvider clock, CancellationToken ct = default)
    {
        if (db.ServiceName != "customers") throw new InvalidOperationException("Maintenance visit projection belongs to customers.");
        var cancellationFact = message.SourceService == "work-orders" && message.EventType == "WorkOrderUpdated.v1" && Text(message, "status") == "Cancelled";
        var orderFact = cancellationFact || message.SourceService == "work-orders" && message.EventType is "WorkOrderCreated.v1" or "WorkOrderCompleted.v1";
        var bookingFact = message.SourceService == "scheduling" && message.EventType is "BookingCreated.v1" or "BookingRescheduled.v1" or "BookingCancelled.v1";
        if ((!orderFact && !bookingFact) || message.EventVersion != 1 || message.SchemaVersion != 1 || message.WorkOrderId == Guid.Empty)
            return;

        // Only an already committed dispatch intent can be linked. The deterministic
        // work-order key also repairs a lost dispatch response without an owner API call.
        var identity = await db.MaintenanceVisits.AsNoTracking()
            .Where(x => x.Id == message.WorkOrderId || x.WorkOrderId == message.WorkOrderId)
            .Join(db.Contracts.AsNoTracking(), visit => visit.ContractId, contract => contract.Id,
                (visit, contract) => new { VisitId = visit.Id, contract.Id, contract.TeamId })
            .SingleOrDefaultAsync(ct);
        if (identity is null) return;
        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        await ContractLifecycleProcessor.Lock(db, identity.TeamId, ct);
        db.ChangeTracker.Clear();
        var inboxId = $"customers-maintenance:{message.EventId:D}";
        if (await db.Inbox.AnyAsync(x => x.Id == inboxId, ct)) return;
        var contract = await db.Contracts.Include(x => x.Lines).Include(x => x.CoveredAssets).Include(x => x.Exclusions)
            .Include(x => x.Visits).Include(x => x.Usage).AsSplitQuery().SingleAsync(x => x.Id == identity.Id, ct);
        var visit = contract.Visits.Single(x => x.Id == identity.VisitId);
        var line = contract.Lines.Single(x => x.Id == visit.ContractLineId);
        var now = clock.GetUtcNow();
        var linkedWorkOrder = false;
        db.Inbox.Add(new InboxMessage { Id = inboxId, ProcessedAtUtc = now });
        if (visit.ServiceLocationId is null || visit.Id != message.WorkOrderId ||
            (visit.WorkOrderId.HasValue && visit.WorkOrderId != message.WorkOrderId) ||
            visit.Status == "Pending" || Text(message, "teamId") != contract.TeamId)
        {
            await Save();
            return;
        }
        if (orderFact && !MatchesOwner(message, contract, visit, line))
        {
            await Save();
            return;
        }

        if (cancellationFact && visit.CompletionEventId is null && visit.Status is not ("Completed" or "Cancelled"))
        {
            linkedWorkOrder = visit.WorkOrderId is null;
            visit.WorkOrderId = message.WorkOrderId;
            visit.Status = "Cancelled";
            contract.Version++;
            contract.UpdatedAtUtc = now;
            Append("MaintenanceVisitCancelled.v1", new { contract.TeamId, contractId = contract.Id, visitId = visit.Id,
                workOrderId = message.WorkOrderId, sourceEventId = message.EventId, allocationReleased = true });
        }
        else if (message.EventType == "WorkOrderCompleted.v1")
        {
            if (visit.CompletionEventId is null)
            {
                var completedAt = Date(message, "completedAtUtc");
                if (Text(message, "status") != "Completed" || completedAt is null || completedAt > now.AddMinutes(1))
                {
                    await Save();
                    return;
                }
                var wasCancelled = visit.Status == "Cancelled";
                var decision = EvaluateCompletion(contract, visit.AssetId, line.ServiceType, completedAt.Value,
                    wasCancelled ? null : visit.Id);
                linkedWorkOrder = visit.WorkOrderId is null;
                visit.WorkOrderId = message.WorkOrderId;
                visit.Status = "Completed";
                visit.CompletedAtUtc = completedAt;
                visit.CompletionEventId = message.EventId;
                var existing = contract.Usage.SingleOrDefault(x => x.ContractLineId == line.Id && x.WorkOrderId == message.WorkOrderId);
                if (existing is null)
                {
                    // The actual completion instant controls the term boundary.
                    // A currently non-active term requires review: Expired alone
                    // cannot prove whether its previous state was Active or Suspended.
                    var changedStatus = await StatusChangedAfterDispatch(db, contract.Id, visit, completedAt.Value, ct);
                    if (decision.Covered && !wasCancelled && !changedStatus && completedAt >= visit.GeneratedAtUtc)
                    {
                        var usage = ContractRules.RecordUsage(contract, line.Id, message.WorkOrderId, 1, 0, completedAt.Value, visit.Id);
                        db.Entry(usage).State = EntityState.Added;
                        Append("ContractUsageRecorded.v1", new { contract.TeamId, contractId = contract.Id, visitId = visit.Id,
                            usageId = usage.Id, usage.ContractLineId, usage.WorkOrderId, usage.VisitsUsed, usage.PartsCost,
                            usage.OccurredAtUtc, sourceEventId = message.EventId });
                    }
                    else
                    {
                        visit.CompletionReviewRequired = true;
                        visit.CompletionReviewReason = completedAt < visit.GeneratedAtUtc
                            ? "Completion precedes the generated maintenance visit."
                            : wasCancelled ? "Completion conflicts with the owner's cancelled work order; review historical service authorization."
                            : changedStatus ? "Agreement status changed after dispatch; review historical service authorization."
                            : decision.Reason;
                        contract.Version++;
                    }
                }
                else
                {
                    if (existing.VisitsUsed != 1)
                    {
                        visit.CompletionReviewRequired = true;
                        visit.CompletionReviewReason = "Existing usage does not account for one completed maintenance visit.";
                    }
                    contract.Version++;
                }
                contract.UpdatedAtUtc = now;
                Append(visit.CompletionReviewRequired ? "MaintenanceCompletionReviewRequired.v1" : "MaintenanceVisitCompleted.v1",
                    new { contract.TeamId, contractId = contract.Id, visitId = visit.Id, workOrderId = message.WorkOrderId,
                        visit.CompletedAtUtc, visit.CompletionReviewRequired, visit.CompletionReviewReason, sourceEventId = message.EventId });
            }
        }
        else if (!cancellationFact && visit.CompletionEventId is null && visit.Status is not ("Completed" or "Cancelled"))
        {
            var previousStatus = visit.Status;
            var previousOrderId = visit.WorkOrderId;
            var previousRevision = visit.AssignmentRevision;
            linkedWorkOrder = visit.WorkOrderId is null;
            visit.WorkOrderId = message.WorkOrderId;
            if (bookingFact && message.SequenceNumber > visit.AssignmentRevision)
            {
                visit.AssignmentRevision = message.SequenceNumber;
                visit.Status = message.EventType == "BookingCancelled.v1" ? "Created" : "Scheduled";
            }
            else if (message.EventType == "WorkOrderCreated.v1" && visit.Status == "Dispatching") visit.Status = "Created";
            if (visit.Status != previousStatus || visit.WorkOrderId != previousOrderId || visit.AssignmentRevision != previousRevision)
            {
                contract.Version++;
                contract.UpdatedAtUtc = now;
                Append("MaintenanceVisitProgressed.v1", new { contract.TeamId, contractId = contract.Id, visitId = visit.Id,
                    workOrderId = message.WorkOrderId, visit.Status, visit.AssignmentRevision, sourceEventId = message.EventId });
            }
        }
        if (linkedWorkOrder)
            Append("MaintenanceVisitWorkOrderCreated.v1", new { contract.TeamId, contractId = contract.Id,
                visitId = visit.Id, workOrderId = message.WorkOrderId, sourceEventId = message.EventId });
        await Save();

        async Task Save()
        {
            await db.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);
        }
        void Append(string action, object details)
        {
            var audit = new AuditEvent(Guid.NewGuid(), action, 1, message.WorkOrderId, message.WorkflowId, null,
                "system", "System", "customers", message.CorrelationId, message.EventId, message.TraceId, message.SpanId,
                now, now, contract.Version, JsonSerializer.SerializeToElement(details, Json.Options));
            db.ContractEvents.Add(new ContractEvent
            {
                Id = audit.EventId, ContractId = contract.Id, Version = contract.Version, Action = action,
                ActorId = "system", ActorRole = "System", CorrelationId = audit.CorrelationId,
                OccurredAtUtc = now, DetailsJson = Json.Write(details)
            });
            db.Enqueue(audit);
        }
    }

    public static EntitlementDecision EvaluateCompletion(MaintenanceContract contract, Guid? assetId, string serviceType, DateTimeOffset completedAt,
        Guid? allocationVisitId = null)
    {
        return ContractRules.Evaluate(contract, contract.CustomerId, assetId, serviceType, completedAt, allocationVisitId);
    }

    private static async Task<bool> StatusChangedAfterDispatch(ServiceDb db, Guid contractId, MaintenanceVisit visit,
        DateTimeOffset completedAt, CancellationToken ct)
    {
        var history = await db.ContractEvents.AsNoTracking().Where(x => x.ContractId == contractId &&
            x.OccurredAtUtc >= visit.GeneratedAtUtc && x.OccurredAtUtc <= completedAt &&
            (x.Action == "MaintenanceVisitDispatchRequested.v1" || x.Action == "MaintenanceContractStatusChanged.v1" ||
             x.Action == "MaintenanceContractExpired.v1")).ToArrayAsync(ct);
        var dispatchVersion = history.Where(x => x.Action == "MaintenanceVisitDispatchRequested.v1" &&
            Json.Read<JsonElement>(x.DetailsJson).TryGetProperty("visitId", out var id) && id.TryGetGuid(out var value) && value == visit.Id)
            .Select(x => (int?)x.Version).Max();
        return history.Any(x => x.Action != "MaintenanceVisitDispatchRequested.v1" &&
            (dispatchVersion is null || x.Version > dispatchVersion));
    }

    private static bool MatchesOwner(AuditEvent message, MaintenanceContract contract, MaintenanceVisit visit, ContractLine line) =>
        Id(message, "workOrderId") == message.WorkOrderId && Id(message, "maintenanceVisitId") == visit.Id &&
        Id(message, "contractId") == contract.Id && Id(message, "contractLineId") == line.Id &&
        Id(message, "customerId") == contract.CustomerId && Id(message, "serviceLocationId") == visit.ServiceLocationId &&
        message.EventPayload.TryGetProperty("assetId", out var asset) &&
        ((asset.ValueKind == JsonValueKind.Null && visit.AssetId is null) || Id(message, "assetId") == visit.AssetId && visit.AssetId.HasValue) &&
        string.Equals(Text(message, "serviceCategory"), line.ServiceType, StringComparison.OrdinalIgnoreCase);

    private static string? Text(AuditEvent message, string key) =>
        message.EventPayload.TryGetProperty(key, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;
    private static Guid? Id(AuditEvent message, string key) => Guid.TryParse(Text(message, key), out var value) ? value : null;
    private static DateTimeOffset? Date(AuditEvent message, string key) =>
        message.EventPayload.TryGetProperty(key, out var value) && value.ValueKind == JsonValueKind.String && value.TryGetDateTimeOffset(out var date) ? date : null;
}
