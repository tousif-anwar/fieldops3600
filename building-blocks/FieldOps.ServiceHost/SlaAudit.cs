using FieldOps.Core;

namespace FieldOps.ServiceHost;

public static class SlaAudit
{
    public static AuditEvent[] Milestones(HttpContext? http, Workflow workflow, IEnumerable<string> eventTypes, DateTimeOffset now)
    {
        var stage = workflow.Stages[workflow.CurrentStageIndex];
        var result = new List<AuditEvent>(); Guid? cause = null;
        foreach (var type in eventTypes)
        {
            var milestone = EventFactory.Create(http, "workflows", type, workflow.WorkOrderId,
                OperationsApi.StagePayload(workflow, stage), workflow.Version, now, workflow.Id, stage.Id, cause);
            result.Add(milestone); cause = milestone.EventId;
        }
        return result.ToArray();
    }

    public static void Enqueue(ServiceDb db, HttpContext? http, Workflow workflow, IEnumerable<string> eventTypes, DateTimeOffset now)
    {
        foreach (var e in Milestones(http, workflow, eventTypes, now)) db.Enqueue(e);
    }
}
