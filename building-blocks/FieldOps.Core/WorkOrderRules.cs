using System.Collections.Frozen;

namespace FieldOps.Core;

public static class WorkOrderRules
{
    public static readonly FrozenSet<string> ServiceCategories = new[]
    { "HVAC", "Electrical", "Mechanical", "Refrigeration", "Controls", "Heating", "Cooling", "Ventilation" }.ToFrozenSet(StringComparer.Ordinal);

    public static void RequireCategory(string category)
    {
        if (!ServiceCategories.Contains(category)) throw new DomainException(400, "Unknown service category.");
    }
    public static bool ApplyBookingEvent(WorkOrder order, string eventType, string? technicianId, long revision)
    {
        if (eventType is not ("BookingCreated.v1" or "BookingCancelled.v1" or "BookingRescheduled.v1") || revision <= order.AssignmentRevision) return false;
        order.AssignmentRevision = revision;
        if (order.Status is "Created" or "Scheduled")
        {
            order.TechnicianId = eventType == "BookingCancelled.v1" ? null : technicianId;
            order.Status = eventType == "BookingCancelled.v1" ? "Created" : "Scheduled";
        }
        order.Version++;
        return true;
    }

    public static void RequireAllowedUpdate(string currentStatus, string requestedStatus)
    {
        if (requestedStatus == currentStatus) return;
        if (requestedStatus == "Cancelled" && currentStatus == "Created") return;
        if (requestedStatus == "Cancelled" && currentStatus == "Scheduled")
            throw new DomainException(409, "Cancel the confirmed booking first, then refresh the work order before cancelling it.");
        throw new DomainException(409, "Only an unbooked, unstarted work order can be cancelled. Workflow state controls service completion.");
    }
}
