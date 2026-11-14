using FieldOps.Core;
using FieldOps.ServiceHost;
using Xunit;

namespace FieldOps.Tests;

public sealed class ServiceExecutionTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 13, 15, 0, 0, TimeSpan.Zero);
    private static Workflow New() => WorkflowEngine.Start(Guid.NewGuid(), "tech-01", "north", Now, new(), 2);
    private static Dictionary<string, string> Answers(int index)
    {
        var answers = new Dictionary<string, string>();
        foreach (var field in Templates.Get(2).Stages[index].Fields)
            if (field.ConditionField is null || answers.GetValueOrDefault(field.ConditionField) == field.ConditionValue)
                answers[field.Key] = field.InputType switch { "text" => "Synthetic recorded service evidence", "number" => "45.5", _ => field.Options[0] };
        return answers;
    }
    private static void AdvanceTo(Workflow workflow, int index)
    {
        while (workflow.CurrentStageIndex < index) WorkflowEngine.Submit(workflow, workflow.Version, Answers(workflow.CurrentStageIndex), Now.AddMinutes(workflow.CurrentStageIndex + 1), new());
    }

    [Fact]
    public void VersionTwoCompletesWithStoredEvidenceAndBuildsReport()
    {
        var workflow = New();
        for (var index = 0; index < 8; index++) WorkflowEngine.Submit(workflow, workflow.Version, Answers(index), Now.AddMinutes(index + 1), new());
        var report = ServiceReportApi.Build(Json.Read<Workflow>(Json.Write(workflow)));
        Assert.Equal("Completed", report.Status);
        Assert.Equal(8, report.Sections.Length);
        Assert.Contains(report.Sections[4].Responses, x => x.Label == "Labor minutes" && x.Value == "45.5");
        Assert.Equal("Resolved", report.Outcome);
    }

    [Theory]
    [InlineData(0, "readiness", "Missing Equipment")]
    [InlineData(1, "travelStatus", "Departed")]
    [InlineData(1, "siteAccess", "Customer Unavailable")]
    [InlineData(4, "partsStatus", "Ordered")]
    [InlineData(5, "functionalTest", "Fail")]
    [InlineData(5, "safetyVerification", "Fail")]
    [InlineData(6, "serviceAccepted", "Pending")]
    [InlineData(6, "customerInformed", "No")]
    public void ObservationsDoNotBypassProgressionPrerequisites(int index, string key, string value)
    {
        var workflow = New(); AdvanceTo(workflow, index);
        var answers = Answers(index); answers[key] = value;
        var version = workflow.Version;
        Assert.Equal(409, Assert.Throws<DomainException>(() => WorkflowEngine.Submit(workflow, version, answers, Now.AddHours(1), new())).Status);
        Assert.Equal(version, workflow.Version);
        Assert.Equal(index, workflow.CurrentStageIndex);
        Assert.Empty(workflow.Stages[index].Answers);
    }

    [Theory]
    [InlineData("0")]
    [InlineData("481")]
    [InlineData("NaN")]
    [InlineData("Infinity")]
    [InlineData("1e2")]
    [InlineData("1,000")]
    public void InvalidLaborIsRejected(string labor)
    {
        var answers = Answers(4); answers["laborMinutes"] = labor;
        Assert.Equal(400, Assert.Throws<DomainException>(() => Templates.Validate(4, answers, 2)).Status);
    }

    [Fact]
    public void DiagnosisRequiresPartsDocumentationAndUnresolvedWorkRequiresFollowUp()
    {
        var workflow = New(); AdvanceTo(workflow, 3);
        var diagnosis = Answers(3); diagnosis["partsRequired"] = "Yes";
        WorkflowEngine.Submit(workflow, workflow.Version, diagnosis, Now.AddMinutes(4), new());
        Assert.Throws<DomainException>(() => WorkflowEngine.Submit(workflow, workflow.Version, Answers(4), Now.AddMinutes(5), new()));
        var repair = Answers(4); repair["partsStatus"] = "Available";
        Assert.Throws<DomainException>(() => Templates.Validate(4, repair, 2));
        repair["partsUsed"] = "SYN-CAP-01, quantity 1 (documentation only)";
        WorkflowEngine.Submit(workflow, workflow.Version, repair, Now.AddMinutes(5), new());
        AdvanceTo(workflow, 7);
        var completion = Answers(7); completion["equipmentStatus"] = "Out of Service"; completion["followUpRequired"] = "No";
        Assert.Throws<DomainException>(() => WorkflowEngine.Submit(workflow, workflow.Version, completion, Now.AddMinutes(8), new()));
        completion["outcome"] = "Escalated"; completion["followUpRequired"] = "Yes";
        WorkflowEngine.Submit(workflow, workflow.Version, completion, Now.AddMinutes(8), new());
        Assert.Equal("Completed", workflow.Status);
    }

    [Fact]
    public void PublishedVersionOneRemainsUnchangedAndIncompleteReportIsUnavailable()
    {
        Assert.Equal("Departed", Templates.Get(1).Stages[1].Fields[0].Options[0]);
        Assert.DoesNotContain(Templates.Get(1).Stages[4].Fields, x => x.Key == "laborMinutes");
        Assert.Equal(409, Assert.Throws<DomainException>(() => ServiceReportApi.Build(New())).Status);
    }
}
