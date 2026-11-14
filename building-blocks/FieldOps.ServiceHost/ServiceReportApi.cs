using FieldOps.Core;
using Microsoft.EntityFrameworkCore;

namespace FieldOps.ServiceHost;

public sealed record ReportResponse(string Label, string Value);
public sealed record ReportSection(int Stage, string Name, string Status, DateTimeOffset? CompletedAtUtc, ReportResponse[] Responses);
public sealed record ServiceReport(Guid WorkOrderId, Guid WorkflowId, int TemplateVersion, string Status, DateTimeOffset StartedAtUtc,
    DateTimeOffset? CompletedAtUtc, string? Outcome, string? EquipmentStatus, string? FollowUpRequired, ReportSection[] Sections);

public static class ServiceReportApi
{
    public static void Map(WebApplication app)
    {
        app.MapGet("/api/workflows/service-report/{workOrderId:guid}", async (Guid workOrderId, ServiceDb db, RemoteServices remote, HttpContext http, CancellationToken ct) =>
        {
            if (http.User.IsInRole("Customer"))
            {
                _ = CustomerScope.From(http.User);
                // The work-order owner proves exact customer membership before any workflow is returned.
                _ = await remote.Get<PortalOrder>("WorkOrders", $"/api/customer-portal/work-orders/{workOrderId}", http, ct);
            }
            var workflow = await db.Workflows.AsNoTracking().SingleOrDefaultAsync(x => x.WorkOrderId == workOrderId, ct)
                ?? throw new DomainException(404, "A service report is not available for this work order.");
            if (!http.User.IsInRole("Customer")) Caller.From(http.User).Demand(workflow.TeamId, workflow.TechnicianId);
            return Results.Ok(Build(workflow));
        }).RequireAuthorization("service-report");
    }

    public static ServiceReport Build(Workflow workflow)
    {
        if (workflow.Status != "Completed") throw new DomainException(409, "The service report is available after the technician completes the workflow.");
        var template = Templates.Get(workflow.TemplateVersion);
        var stages = workflow.Stages;
        var completion = stages[7].Answers;
        return new(workflow.WorkOrderId, workflow.Id, workflow.TemplateVersion, workflow.Status, workflow.StartedAtUtc, workflow.CompletedAtUtc,
            completion.GetValueOrDefault("outcome"), completion.GetValueOrDefault("equipmentStatus"), completion.GetValueOrDefault("followUpRequired"),
            stages.Select(stage => new ReportSection(stage.Index, stage.Name, stage.Status, stage.CompletedAtUtc,
                template.Stages[stage.Index].Fields.Where(field => stage.Answers.ContainsKey(field.Key))
                    .Select(field => new ReportResponse(field.Label, stage.Answers[field.Key])).ToArray())).ToArray());
    }
}
