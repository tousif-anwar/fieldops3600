namespace FieldOps.Core;

public static class WorkOrderRules
{
    public static void RequireAllowedUpdate(string currentStatus, string requestedStatus)
    {
        if (requestedStatus == currentStatus) return;
        if (requestedStatus == "Cancelled" && currentStatus == "Created") return;
        if (requestedStatus == "Cancelled" && currentStatus == "Scheduled")
            throw new DomainException(409, "Cancel the confirmed booking first, then refresh the work order before cancelling it.");
        throw new DomainException(409, "Only an unbooked, unstarted work order can be cancelled. Workflow state controls service completion.");
    }
}
