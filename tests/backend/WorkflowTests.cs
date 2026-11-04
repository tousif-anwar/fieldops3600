using FieldOps.Core;
using Xunit;

namespace FieldOps.Tests;

public sealed class WorkflowTests
{
    private static readonly DateTimeOffset Start = new(2026, 11, 4, 13, 0, 0, TimeSpan.Zero);
    private readonly SlaPolicy policy = new();
    private Workflow New() => WorkflowEngine.Start(Guid.NewGuid(), "tech-01", "north", Start, policy);
    private static Dictionary<string, string> Answers(int index) => Templates.Default.Stages[index].Fields.Where(f => f.ConditionField is null).ToDictionary(f => f.Key, f => f.Options[0]);

    [Fact]
    public void AllEightStagesCompleteInOrderAndPreserveAnswers()
    {
        var workflow = New();
        for (var i = 0; i < 8; i++)
        {
            Assert.Equal(i, workflow.CurrentStageIndex);
            var completed = WorkflowEngine.Submit(workflow, workflow.Version, Answers(i), Start.AddMinutes(i + 1), policy);
            Assert.Equal("Completed", completed.Status);
            Assert.Equal(Answers(i), completed.Answers);
        }
        Assert.Equal("Completed", workflow.Status);
        Assert.All(workflow.Stages, s => Assert.NotNull(s.CompletedAtUtc));
        Assert.Throws<DomainException>(() => WorkflowEngine.Submit(workflow, workflow.Version, Answers(7), Start.AddMinutes(10), policy));
    }

    [Theory]
    [InlineData(19, 0)] [InlineData(20, 1)] [InlineData(25, 2)] [InlineData(30, 3)] [InlineData(45, 3)]
    public void PersistedSlaThresholdsCatchUpAfterRestart(int minutes, int expected)
    {
        var workflow = New();
        var events = WorkflowEngine.Evaluate(workflow, Start.AddMinutes(minutes), policy);
        Assert.Equal(expected, events.Length);
        var restarted = Json.Read<Workflow>(Json.Write(workflow));
        Assert.Empty(WorkflowEngine.Evaluate(restarted, Start.AddMinutes(minutes).AddSeconds(1), policy));
        Assert.Equal(expected, restarted.Stages[0].WarningLevel);
    }

    [Fact]
    public void PauseExcludesApprovedTimeAndRetainsBreachEvidence()
    {
        var workflow = New();
        WorkflowEngine.Pause(workflow, 1, Start.AddMinutes(10));
        Assert.Empty(WorkflowEngine.Evaluate(workflow, Start.AddHours(2), policy));
        WorkflowEngine.Resume(workflow, workflow.Version, Start.AddMinutes(40));
        Assert.Equal(Start.AddMinutes(60), workflow.Stages[0].DeadlineUtc);
        Assert.Empty(WorkflowEngine.Evaluate(workflow, Start.AddMinutes(49), policy));
        Assert.Equal("StageWarningRaised.v1", Assert.Single(WorkflowEngine.Evaluate(workflow, Start.AddMinutes(50), policy)));
        Assert.Equal(2, WorkflowEngine.Evaluate(workflow, Start.AddMinutes(60), policy).Length);
        WorkflowEngine.Pause(workflow, workflow.Version, Start.AddMinutes(61));
        WorkflowEngine.Resume(workflow, workflow.Version, Start.AddMinutes(66));
        Assert.Equal("Breached", workflow.Stages[0].SlaStatus);
        Assert.Equal(3, workflow.Stages[0].WarningLevel);
    }

    [Fact]
    public void StaleSubmissionAndPausedSubmissionAreRejected()
    {
        var workflow = New();
        Assert.Equal(409, Assert.Throws<DomainException>(() => WorkflowEngine.Submit(workflow, 0, Answers(0), Start, policy)).Status);
        WorkflowEngine.Pause(workflow, workflow.Version, Start);
        Assert.Equal(409, Assert.Throws<DomainException>(() => WorkflowEngine.Submit(workflow, workflow.Version, Answers(0), Start, policy)).Status);
    }

    [Fact]
    public void DropdownOptionsUnknownFieldsAndConditionalFieldsAreValidated()
    {
        Assert.Throws<DomainException>(() => Templates.Validate(0, new() { ["assignment"] = "Made up", ["readiness"] = "Ready" }));
        Assert.Throws<DomainException>(() => Templates.Validate(0, new() { ["assignment"] = "Accept" }));
        var invalid = Answers(0); invalid["isAdmin"] = "true"; Assert.Throws<DomainException>(() => Templates.Validate(0, invalid));
        Assert.Throws<DomainException>(() => Templates.Validate(1, new() { ["travelStatus"] = "Delayed", ["siteAccess"] = "Accessible" }));
        Templates.Validate(1, new() { ["travelStatus"] = "Delayed", ["delayReason"] = "Traffic", ["siteAccess"] = "Accessible" });
        Assert.Throws<DomainException>(() => Templates.Validate(1, new() { ["travelStatus"] = "Arrived", ["delayReason"] = "Traffic", ["siteAccess"] = "Accessible" }));
    }

    [Fact]
    public void AcceleratedSlaRequiresDevelopment()
    {
        var accelerated = new SlaPolicy(30, 20, 25);
        accelerated.Validate(true);
        Assert.Throws<InvalidOperationException>(() => accelerated.Validate(false));
        Assert.Throws<InvalidOperationException>(() => new SlaPolicy(30, 25, 20).Validate(true));
    }
}
