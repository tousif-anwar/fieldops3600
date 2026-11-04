using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using FieldOps.Core;
using MassTransit;
using Microsoft.EntityFrameworkCore;

namespace FieldOps.ServiceHost;

public sealed record FaultObservation(Guid FaultId, Guid? FaultedMessageId, AuditEvent Original,
    DateTimeOffset FaultedAtUtc, string ConsumerService, string[] ExceptionTypes);

public sealed class ReplayFaultConsumer(ServiceDb db, TimeProvider clock) : IConsumer<Fault<AuditEvent>>
{
    public async Task Consume(ConsumeContext<Fault<AuditEvent>> context)
    {
        var fault = context.Message;
        var timestamp = fault.Timestamp.Kind == DateTimeKind.Unspecified ? DateTime.SpecifyKind(fault.Timestamp, DateTimeKind.Utc) : fault.Timestamp.ToUniversalTime();
        var types = new List<string>();
        foreach (var exception in fault.Exceptions)
        {
            ExceptionInfo? current = exception;
            for (var depth = 0; current is not null && depth < 8; depth++, current = current.InnerException) types.Add(current.ExceptionType);
        }
        // Exception messages, stack traces, Data and machine names are intentionally
        // never read into evidence: they may contain customer data or credentials.
        var observation = new FaultObservation(fault.FaultId, fault.FaultedMessageId, fault.Message,
            new DateTimeOffset(timestamp), FaultEvidence.ResolveConsumer(fault.Host?.Assembly, context.SourceAddress), FaultEvidence.SanitizeExceptionTypes(types));
        await FaultEvidence.Record(db, observation, clock.GetUtcNow(), context.CancellationToken);
    }
}

public static class FaultEvidence
{
    private static readonly Dictionary<string, string> Services = new(StringComparer.OrdinalIgnoreCase)
    {
        ["FieldOps.WorkOrders"] = "work-orders",
        ["FieldOps.Technicians"] = "technicians",
        ["FieldOps.Scheduling"] = "scheduling",
        ["FieldOps.Workflows"] = "workflows",
        ["FieldOps.Notifications"] = "notifications",
        ["FieldOps.Reporting"] = "reporting"
    };

    public static string ResolveConsumer(string? assembly, Uri? sourceAddress)
    {
        if (assembly is not null && Services.TryGetValue(assembly, out var known)) return known;
        var queue = sourceAddress?.AbsolutePath.Trim('/').Split('/').LastOrDefault();
        return Services.Values.FirstOrDefault(service => queue == $"fieldops-{service}-events") ?? "unknown";
    }

    public static string[] SanitizeExceptionTypes(IEnumerable<string?> types) => types.Take(16).Select(type =>
        !string.IsNullOrEmpty(type) && type.Length <= 240 && type.All(c => char.IsAsciiLetterOrDigit(c) || c is '.' or '_' or '+' or '`' or '[' or ']')
            ? type : "UnknownException").Distinct(StringComparer.Ordinal).ToArray();

    public static AuditEvent[] DiagnosticEvents(FaultObservation observation, DateTimeOffset recordedAtUtc)
    {
        var original = observation.Original;
        var payload = JsonSerializer.SerializeToElement(new
        {
            observation.FaultId,
            observation.FaultedMessageId,
            originalEventId = original.EventId,
            originalEventType = original.EventType,
            originalSourceService = original.SourceService,
            originalOccurredAtUtc = original.OccurredAtUtc,
            observation.FaultedAtUtc,
            teamId = Text(original, "teamId") ?? "",
            technicianId = Text(original, "technicianId"),
            observation.ConsumerService,
            exceptionTypes = SanitizeExceptionTypes(observation.ExceptionTypes),
            processingStatus = "DeadLettered",
            retryCount = (int?)null,
            evidenceBasis = "MassTransit Fault<AuditEvent> observed after consumer retry policy. Error-queue contents require independent inspection; intermediate attempt counts are not contained in this fault contract."
        }, Json.Options);
        var failed = new AuditEvent(Guid.NewGuid(), "MessageProcessingFailed.v1", 1, original.WorkOrderId, original.WorkflowId,
            original.StageInstanceId, "system", "System", "reporting", original.CorrelationId, original.EventId,
            original.TraceId, original.SpanId, observation.FaultedAtUtc, recordedAtUtc, 0, payload);
        var terminal = failed with { EventId = Guid.NewGuid(), EventType = "DeadLetterRecorded.v1", CausationId = failed.EventId };
        return [failed, terminal];
    }

    public static async Task<bool> Record(ServiceDb db, FaultObservation observation, DateTimeOffset receivedAtUtc, CancellationToken ct = default)
    {
        if (observation.FaultId == Guid.Empty || observation.Original.EventId == Guid.Empty) throw new InvalidOperationException("Fault evidence requires stable fault and original event IDs.");
        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        await LockOrder(db, observation.Original.WorkOrderId, ct);
        var inboxId = $"reporting:fault:{observation.FaultId}";
        if (await db.Inbox.AnyAsync(x => x.Id == inboxId, ct)) { await transaction.CommitAsync(ct); return false; }
        db.Inbox.Add(new InboxMessage { Id = inboxId, ProcessedAtUtc = receivedAtUtc });
        var original = observation.Original;
        var retained = await db.Events.AsNoTracking().Where(x => x.WorkOrderId == original.WorkOrderId).ToListAsync(ct);
        if (retained.All(e => e.EventId != original.EventId))
        {
            var preserved = Store(original, receivedAtUtc); db.Events.Add(preserved); retained.Add(preserved);
        }
        var diagnostic = DiagnosticEvents(observation, receivedAtUtc);
        foreach (var e in diagnostic) { var stored = Store(e, receivedAtUtc); db.Events.Add(stored); retained.Add(stored); }
        db.DeliveryAttempts.Add(new DeliveryAttempt
        {
            EventId = original.EventId,
            FaultId = observation.FaultId,
            Attempt = null,
            ConsumerService = observation.ConsumerService,
            OccurredAtUtc = observation.FaultedAtUtc,
            ReceivedAtUtc = receivedAtUtc,
            ProcessedAtUtc = receivedAtUtc,
            Status = "DeadLettered",
            Error = string.Join(", ", SanitizeExceptionTypes(observation.ExceptionTypes))
        });
        if (original.WorkOrderId != Guid.Empty)
        {
            var projection = await db.ReplayProjections.FindAsync([original.WorkOrderId], ct);
            if (projection is null) { projection = new ReplayProjection { WorkOrderId = original.WorkOrderId, TeamId = Text(original, "teamId") ?? "" }; db.ReplayProjections.Add(projection); }
            projection.StateJson = Json.Write(ReplayEngine.Reconstruct(retained.Select(e => Json.Read<AuditEvent>(e.Body))));
            projection.EventCount = retained.Count; projection.UpdatedAtUtc = receivedAtUtc;
        }
        await db.SaveChangesAsync(ct); await transaction.CommitAsync(ct); return true;
    }

    public static async Task LockOrder(ServiceDb db, Guid orderId, CancellationToken ct)
    {
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtext({"fieldops-replay:" + orderId}));", ct);
    }

    public static StoredEvent Store(AuditEvent e, DateTimeOffset receivedAtUtc)
    {
        var body = Json.Write(e);
        return new StoredEvent
        {
            EventId = e.EventId,
            WorkOrderId = e.WorkOrderId,
            EventType = e.EventType,
            SourceService = e.SourceService,
            TeamId = Text(e, "teamId") ?? "",
            ActorId = e.ActorId,
            Body = body,
            OccurredAtUtc = e.OccurredAtUtc,
            ReceivedAtUtc = receivedAtUtc,
            ProcessedAtUtc = receivedAtUtc,
            SequenceNumber = e.SequenceNumber,
            CorrelationId = e.CorrelationId,
            TraceId = e.TraceId,
            IntegrityHash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(body)))
        };
    }
    private static string? Text(AuditEvent e, string key) => e.EventPayload.TryGetProperty(key, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;
}
