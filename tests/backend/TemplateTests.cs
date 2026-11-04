using FieldOps.Core;
using Xunit;

namespace FieldOps.Tests;

public sealed class TemplateTests
{
    [Fact]
    public void VersionOneConfigurationMatchesEightStagesAndConditionalOptions()
    {
        var configured = Templates.Get(1);
        Assert.Equal(8, configured.Stages.Length);
        var conditional = configured.Stages[1].Fields.Single(field => field.Key == "delayReason");
        Assert.Equal("travelStatus", conditional.ConditionField);
        Assert.Equal("Delayed", conditional.ConditionValue);
        Assert.Contains("Other", conditional.Options);
    }

    [Fact]
    public void CallerCannotMutateThePublishedConfiguration()
    {
        var first = Templates.Get(1);
        first.Stages[0].Fields[0].Options[0] = "Invented";
        Assert.Equal("Accept", Templates.Get(1).Stages[0].Fields[0].Options[0]);
    }

    [Fact]
    public void UnknownPinnedVersionNeverFallsBackToTheCurrentDefault()
    {
        var workflow = WorkflowEngine.Start(Guid.NewGuid(), "tech-01", "north", DateTimeOffset.UtcNow, new SlaPolicy());
        workflow.TemplateVersion = 999;
        var exception = Assert.Throws<DomainException>(() => WorkflowEngine.Submit(workflow, workflow.Version,
            new() { ["assignment"] = "Accept", ["readiness"] = "Ready" }, DateTimeOffset.UtcNow, new SlaPolicy()));
        Assert.Equal(404, exception.Status);
        Assert.Equal(0, workflow.CurrentStageIndex);
    }

    [Fact]
    public void InvalidConditionalConfigurationCannotBePublished()
    {
        var template = Templates.Get(1);
        template.Stages[1].Fields[1] = template.Stages[1].Fields[1] with { ConditionValue = "Invented" };
        Assert.Throws<InvalidOperationException>(() => Templates.ParseDefinition(Json.Write(template)));
    }

    [Fact]
    public void RequestingReassignmentDoesNotMarkTheJobAccepted()
    {
        var workflow = WorkflowEngine.Start(Guid.NewGuid(), "tech-01", "north", DateTimeOffset.UtcNow, new SlaPolicy());
        var exception = Assert.Throws<DomainException>(() => WorkflowEngine.Submit(workflow, workflow.Version,
            new() { ["assignment"] = "Request Reassignment", ["readiness"] = "Need Assistance" }, DateTimeOffset.UtcNow, new SlaPolicy()));
        Assert.Equal(409, exception.Status);
        Assert.Equal(0, workflow.CurrentStageIndex);
        Assert.Equal("Active", workflow.Stages[0].Status);
    }
}
