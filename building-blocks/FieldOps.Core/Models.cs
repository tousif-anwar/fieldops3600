using System.ComponentModel.DataAnnotations.Schema;
using System.Text.Json;

namespace FieldOps.Core;

public static class Json
{
    public static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web);
    public static string Write<T>(T value) => JsonSerializer.Serialize(value, Options);
    public static T Read<T>(string value) => JsonSerializer.Deserialize<T>(value, Options)!;
}

public sealed class WorkOrder
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Number { get; set; } = "";
    public string Title { get; set; } = "";
    public string CustomerName { get; set; } = "";
    public string SiteAddress { get; set; } = "";
    public string ServiceCategory { get; set; } = "HVAC";
    public string Priority { get; set; } = "Normal";
    public string Status { get; set; } = "Created";
    public string TeamId { get; set; } = "north";
    public string? TechnicianId { get; set; }
    public DateTimeOffset CreatedAtUtc { get; set; }
    public DateTimeOffset? CompletedAtUtc { get; set; }
    public int Version { get; set; } = 1;
}

public sealed class Technician
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string TeamId { get; set; } = "north";
    public string SupervisorId { get; set; } = "supervisor-01";
    public string SkillsJson { get; set; } = "[]";
    public string CertificationsJson { get; set; } = "[]";
    public int WorkingStartHour { get; set; } = 8;
    public int WorkingEndHour { get; set; } = 18;
    public string TimeZone { get; set; } = "America/New_York";
    public bool Available { get; set; } = true;
    public int Version { get; set; } = 1;
    [NotMapped] public string[] Skills { get => Json.Read<string[]>(SkillsJson); set => SkillsJson = Json.Write(value); }
    [NotMapped] public string[] Certifications { get => Json.Read<string[]>(CertificationsJson); set => CertificationsJson = Json.Write(value); }
}

public sealed class TimeOff
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string TechnicianId { get; set; } = "";
    public DateTimeOffset StartUtc { get; set; }
    public DateTimeOffset EndUtc { get; set; }
    public string Reason { get; set; } = "Time off";
    public int Version { get; set; } = 1;
}

public sealed class Booking
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid WorkOrderId { get; set; }
    public string TechnicianId { get; set; } = "";
    public string TeamId { get; set; } = "north";
    public DateTimeOffset StartUtc { get; set; }
    public DateTimeOffset EndUtc { get; set; }
    public string Status { get; set; } = "Confirmed";
    public int Version { get; set; } = 1;
    public string? OverrideReason { get; set; }
}

public sealed class Workflow
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid WorkOrderId { get; set; }
    public string TechnicianId { get; set; } = "";
    public string TeamId { get; set; } = "north";
    public int TemplateVersion { get; set; } = 1;
    public int CurrentStageIndex { get; set; }
    public int Version { get; set; } = 1;
    public string Status { get; set; } = "Active";
    public string StagesJson { get; set; } = "[]";
    public DateTimeOffset StartedAtUtc { get; set; }
    public DateTimeOffset? CompletedAtUtc { get; set; }
    [NotMapped] public List<StageState> Stages { get => Json.Read<List<StageState>>(StagesJson); set => StagesJson = Json.Write(value); }
}

public sealed class StageState
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public int Index { get; set; }
    public string Name { get; set; } = "";
    public string Status { get; set; } = "Pending";
    public DateTimeOffset? StartedAtUtc { get; set; }
    public DateTimeOffset? DeadlineUtc { get; set; }
    public DateTimeOffset? CompletedAtUtc { get; set; }
    public DateTimeOffset? PausedAtUtc { get; set; }
    public double PausedSeconds { get; set; }
    public int WarningLevel { get; set; }
    public string SlaStatus { get; set; } = "OnTime";
    public Dictionary<string, string> Answers { get; set; } = [];
}

public sealed class IdempotencyReceipt
{
    public string Id { get; set; } = "";
    public string ActorId { get; set; } = "";
    public string RequestHash { get; set; } = "";
    public string ResponseJson { get; set; } = "";
    public DateTimeOffset CreatedAtUtc { get; set; }
}

public sealed record AuditEvent(
    Guid EventId, string EventType, int EventVersion, Guid WorkOrderId,
    Guid? WorkflowId, Guid? StageInstanceId, string ActorId, string ActorRole,
    string SourceService, string CorrelationId, Guid? CausationId, string? TraceId,
    string? SpanId, DateTimeOffset OccurredAtUtc, DateTimeOffset RecordedAtUtc,
    long SequenceNumber, JsonElement EventPayload, int SchemaVersion = 1);

public sealed class OutboxMessage
{
    public Guid Id { get; set; }
    public string Body { get; set; } = "";
    public DateTimeOffset CreatedAtUtc { get; set; }
    public DateTimeOffset? PublishedAtUtc { get; set; }
    public int Attempts { get; set; }
    public DateTimeOffset NextAttemptAtUtc { get; set; }
    public string? LastError { get; set; }
}

public sealed class InboxMessage
{
    public string Id { get; set; } = "";
    public DateTimeOffset ProcessedAtUtc { get; set; }
}

public sealed class StoredEvent
{
    public Guid EventId { get; set; }
    public Guid WorkOrderId { get; set; }
    public string EventType { get; set; } = "";
    public string SourceService { get; set; } = "";
    public string TeamId { get; set; } = "";
    public string ActorId { get; set; } = "";
    public string Body { get; set; } = "";
    public DateTimeOffset OccurredAtUtc { get; set; }
    public DateTimeOffset ReceivedAtUtc { get; set; }
    public DateTimeOffset ProcessedAtUtc { get; set; }
    public long SequenceNumber { get; set; }
    public string CorrelationId { get; set; } = "";
    public string? TraceId { get; set; }
    public string IntegrityHash { get; set; } = "";
}

public sealed class DeliveryAttempt
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid EventId { get; set; }
    public int? Attempt { get; set; }
    public string ConsumerService { get; set; } = "reporting";
    public Guid? FaultId { get; set; }
    public DateTimeOffset? OccurredAtUtc { get; set; }
    public DateTimeOffset ReceivedAtUtc { get; set; }
    public DateTimeOffset ProcessedAtUtc { get; set; }
    public string Status { get; set; } = "Processed";
    public string? Error { get; set; }
}

public sealed class ReplayProjection
{
    public Guid WorkOrderId { get; set; }
    public string TeamId { get; set; } = "";
    public string StateJson { get; set; } = "{}";
    public int EventCount { get; set; }
    public DateTimeOffset UpdatedAtUtc { get; set; }
}

public sealed class Notification
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid EventId { get; set; }
    public Guid WorkOrderId { get; set; }
    public string TeamId { get; set; } = "";
    public string? TechnicianId { get; set; }
    public string Audience { get; set; } = "Supervisor";
    public string Title { get; set; } = "";
    public string Severity { get; set; } = "Warning";
    public DateTimeOffset CreatedAtUtc { get; set; }
    public DateTimeOffset? AcknowledgedAtUtc { get; set; }
    public string? AcknowledgedBy { get; set; }
}

public sealed class WorkOrderFact
{
    public Guid WorkOrderId { get; set; }
    public string Number { get; set; } = "";
    public string TeamId { get; set; } = "";
    public string ServiceCategory { get; set; } = "Unknown";
    public string Priority { get; set; } = "Normal";
    public string? TechnicianId { get; set; }
    public DateTimeOffset CreatedAtUtc { get; set; }
    public DateTimeOffset? CompletedAtUtc { get; set; }
    public string Status { get; set; } = "Created";
    public DateTimeOffset UpdatedAtUtc { get; set; }
}

public sealed class StageFact
{
    public Guid StageInstanceId { get; set; }
    public Guid WorkOrderId { get; set; }
    public string TeamId { get; set; } = "";
    public string Stage { get; set; } = "";
    public string TechnicianId { get; set; } = "";
    public DateTimeOffset? StartedAtUtc { get; set; }
    public DateTimeOffset? CompletedAtUtc { get; set; }
    public DateTimeOffset? DeadlineUtc { get; set; }
    public bool Breached { get; set; }
    public double PausedSeconds { get; set; }
    public string SlaStatus { get; set; } = "OnTime";
    public DateTimeOffset UpdatedAtUtc { get; set; }
}
