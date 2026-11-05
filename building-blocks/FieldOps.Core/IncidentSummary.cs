namespace FieldOps.Core;

public sealed record StageIncident(Guid StageInstanceId, string AffectedStage, DateTimeOffset? SlaDeadlineUtc,
    DateTimeOffset? EffectiveDeadlineUtc, DateTimeOffset? ActualCompletionAtUtc, double? DelayMinutes, string CompletionKind);
public sealed record SupervisorAction(DateTimeOffset OccurredAtUtc, string ActorId, string ActorRole, string EventType, string? Reason);
public sealed record IncidentSummary(DateTimeOffset IncidentStartUtc, DateTimeOffset IncidentEndUtc, int BreachCount,
    int InterventionCount, string Outcome, string[] Facts, string[] Inferences, StageIncident[] StageIncidents, SupervisorAction[] SupervisorActions);

public static class IncidentSummaries
{
    public static IncidentSummary Create(IEnumerable<AuditEvent> source)
    {
        var events = ReplayEngine.Order(source).Select(x => x.Event).ToArray();
        if (events.Length == 0) throw new DomainException(404, "No incident evidence is available.");
        var breaches = events.Where(e => e.EventType == "StageSLABreached.v1").ToArray();
        var interventions = events.Where(e => e.EventType is "StagePaused.v1" or "StageResumed.v1" or "SupervisorOverrideApplied.v1").ToArray();
        var incidents = breaches.Where(e => e.StageInstanceId.HasValue).GroupBy(e => e.StageInstanceId!.Value).Select(group =>
        {
            var breach = group.First();
            var completion = events.LastOrDefault(e => e.StageInstanceId == group.Key && e.EventType is "StageCompleted.v1" or "SupervisorOverrideApplied.v1");
            var deadline = completion is null ? Time(breach, "deadlineUtc") : Time(completion, "deadlineUtc") ?? Time(breach, "deadlineUtc");
            var completed = completion is null ? null : Time(completion, "completedAtUtc");
            return new StageIncident(group.Key, Text(breach, "stageName") ?? "Unknown stage", Time(breach, "deadlineUtc"), deadline, completed,
                completed.HasValue && deadline.HasValue ? Math.Max(0, (completed.Value - deadline.Value).TotalMinutes) : null,
                completion?.EventType == "SupervisorOverrideApplied.v1" ? "Overridden" : completion is not null ? "Completed" : "Completion not yet observed");
        }).ToArray();
        var actions = events.Where(e => e.ActorRole is "Supervisor" or "OperationsManager" or "Administrator" && e.EventType is "StagePaused.v1" or "StageResumed.v1" or "SupervisorOverrideApplied.v1" or "RecommendationDecisionRecorded.v1" or "NotificationAcknowledged.v1")
            .Select(e => new SupervisorAction(e.OccurredAtUtc, e.ActorId, e.ActorRole, e.EventType, Text(e, "reason"))).ToArray();
        var finished = events.LastOrDefault(e => e.EventType == "WorkflowCompleted.v1");
        return new(events.Min(e => e.OccurredAtUtc), events.Max(e => e.OccurredAtUtc), breaches.Length, interventions.Length,
            finished is not null ? Text(finished, "outcome") ?? "Completed" : "In progress",
            [$"{events.Length} distinct business events recorded.", $"{breaches.Length} stage SLA breaches recorded.", $"{interventions.Length} stage-control interventions recorded.", $"{actions.Length} supervisor actions or advisory decisions recorded."],
            ["No root cause is inferred automatically. Recorded delays, failures, answers and interventions establish observations, not causality."], incidents, actions);
    }
    private static string? Text(AuditEvent e, string field) => e.EventPayload.TryGetProperty(field, out var value) && value.ValueKind == System.Text.Json.JsonValueKind.String ? value.GetString() : null;
    private static DateTimeOffset? Time(AuditEvent e, string field) => e.EventPayload.TryGetProperty(field, out var value) && value.ValueKind == System.Text.Json.JsonValueKind.String && value.TryGetDateTimeOffset(out var result) ? result : null;
}
