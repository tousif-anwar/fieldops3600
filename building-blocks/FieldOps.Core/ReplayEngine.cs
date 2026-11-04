namespace FieldOps.Core;

public sealed record ReplayItem(AuditEvent Event, bool OrderingUncertain, bool MissingCausation);
public sealed record HistoricalState(string Status, string? TechnicianId, string? CurrentStage, bool Paused, string SlaStatus, int EventsApplied);

public static class ReplayEngine
{
    // Causation and authoritative per-source sequence constrain the display ordering.
    // Timestamp then event ID provides deterministic order only among independent events;
    // the API explicitly reports that cross-service order as uncertain.
    public static IReadOnlyList<ReplayItem> Order(IEnumerable<AuditEvent> source)
    {
        var events = source.GroupBy(e => e.EventId).Select(g => g.First()).ToDictionary(e => e.EventId);
        var edges = events.Keys.ToDictionary(id => id, _ => new HashSet<Guid>());
        var indegree = events.Keys.ToDictionary(id => id, _ => 0);
        void Edge(Guid from, Guid to) { if (from != to && edges[from].Add(to)) indegree[to]++; }
        foreach (var e in events.Values)
            if (e.CausationId is { } cause && events.ContainsKey(cause)) Edge(cause, e.EventId);
        foreach (var group in events.Values.GroupBy(e => new { e.SourceService, e.WorkOrderId }))
        {
            var groups = group.Where(e => e.SequenceNumber > 0).GroupBy(e => e.SequenceNumber).OrderBy(g => g.Key).ToArray();
            for (var i = 1; i < groups.Length; i++)
                foreach (var previous in groups[i - 1]) foreach (var next in groups[i]) Edge(previous.EventId, next.EventId);
        }
        var result = new List<ReplayItem>();
        var remaining = new HashSet<Guid>(events.Keys);
        while (remaining.Count > 0)
        {
            var candidates = remaining.Where(id => indegree[id] == 0).OrderBy(id => events[id].OccurredAtUtc).ThenBy(id => id).ToArray();
            var cycle = candidates.Length == 0;
            var id = cycle ? remaining.OrderBy(id => events[id].OccurredAtUtc).ThenBy(id => id).First() : candidates[0];
            var e = events[id];
            var independent = candidates.Select(c => events[c].SourceService).Distinct().Count() > 1;
            result.Add(new(e, cycle || independent, e.CausationId is { } cause && !events.ContainsKey(cause)));
            remaining.Remove(id);
            foreach (var next in edges[id]) indegree[next]--;
        }
        return result;
    }

    public static HistoricalState Reconstruct(IEnumerable<AuditEvent> events)
    {
        var status = "Unknown"; string? technician = null; string? stage = null; var paused = false; var sla = "OnTime"; var count = 0;
        foreach (var item in Order(events))
        {
            var e = item.Event; count++;
            string? Get(string key) => e.EventPayload.TryGetProperty(key, out var value) && value.ValueKind == System.Text.Json.JsonValueKind.String ? value.GetString() : null;
            switch (e.EventType)
            {
                case "WorkOrderCreated.v1": if (status == "Unknown") status = "Created"; break;
                case "BookingCreated.v1": technician = Get("technicianId"); if (status is "Unknown" or "Created") status = "Scheduled"; break;
                case "BookingCancelled.v1": if (status == "Scheduled") { status = "Created"; technician = null; } break;
                case "WorkflowStarted.v1": status = "InProgress"; break;
                case "StageStarted.v1": stage = Get("stageName"); paused = false; sla = "OnTime"; break;
                case "StageWarningRaised.v1": sla = "Warning"; break;
                case "StageCriticalWarningRaised.v1": sla = "Critical"; break;
                case "StageSLABreached.v1": sla = "Breached"; break;
                case "StagePaused.v1": paused = true; break;
                case "StageResumed.v1": paused = false; break;
                case "WorkflowCompleted.v1": case "WorkOrderCompleted.v1": status = "Completed"; break;
            }
        }
        return new(status, technician, stage, paused, sla, count);
    }
}
