namespace FieldOps.Core;

/// <summary>Customer intake owned by work-orders. Qualification creates one work order atomically.</summary>
public sealed class ServiceRequest
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid CustomerId { get; set; }
    public Guid ServiceLocationId { get; set; }
    public Guid? AssetId { get; set; }
    public string TeamId { get; set; } = "";
    public string SubmittedBy { get; set; } = "";
    public string CustomerName { get; set; } = "";
    public string SiteAddress { get; set; } = "";
    public string Title { get; set; } = "";
    public string Description { get; set; } = "";
    public string ServiceType { get; set; } = "Repair";
    public string Urgency { get; set; } = "Routine";
    public string Status { get; set; } = "Submitted";
    public Guid? WorkOrderId { get; set; }
    public string? DecisionReason { get; set; }
    public int Version { get; set; } = 1;
    public DateTimeOffset CreatedAtUtc { get; set; }
    public DateTimeOffset UpdatedAtUtc { get; set; }
}

public static class ServiceRequestRules
{
    public static readonly string[] ServiceTypes = ["Repair", "Maintenance", "Installation", "Replacement", "Warranty", "Diagnostic"];
    public static readonly string[] Urgencies = ["Routine", "Urgent", "Emergency"];
    public static void Validate(ServiceRequest request)
    {
        CustomerRules.Text(request.Title, 3, 160, "request title");
        CustomerRules.Text(request.Description, 10, 4000, "reported problem");
        if (request.CustomerId == Guid.Empty || request.ServiceLocationId == Guid.Empty || string.IsNullOrWhiteSpace(request.TeamId) || string.IsNullOrWhiteSpace(request.SubmittedBy))
            throw new DomainException(400, "A request needs an authorized customer, location, and submitter.");
        if (!ServiceTypes.Contains(request.ServiceType) || !Urgencies.Contains(request.Urgency))
            throw new DomainException(400, "Unknown service type or urgency.");
    }

    public static void Decide(ServiceRequest request, int expectedVersion, string decision, string reason, DateTimeOffset now, Guid? workOrderId)
    {
        if (request.Version != expectedVersion) throw new DomainException(409, "The service request changed. Refresh before qualifying it.");
        if (request.Status != "Submitted") throw new DomainException(409, "Only submitted requests can be qualified once.");
        CustomerRules.Text(reason, 8, 500, "qualification reason");
        if (decision is not ("Approve" or "Reject")) throw new DomainException(400, "Choose Approve or Reject.");
        if ((decision == "Approve") != (workOrderId is not null && workOrderId != Guid.Empty)) throw new DomainException(400, "Approval must create exactly one linked work order.");
        request.Status = decision == "Approve" ? "Qualified" : "Rejected";
        request.WorkOrderId = workOrderId;
        request.DecisionReason = reason.Trim();
        request.UpdatedAtUtc = now;
        request.Version++;
    }
}
