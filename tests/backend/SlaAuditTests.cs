using FieldOps.Core;
using FieldOps.ServiceHost;
using Xunit;

namespace FieldOps.Tests;

public sealed class SlaAuditTests
{
    [Fact]
    public void MissedThresholdsShareARealCausalChainEvenWhenVersionAndTimestampAreIdentical()
    {
        var started = new DateTimeOffset(2026, 11, 4, 13, 0, 0, TimeSpan.Zero);
        var policy = new SlaPolicy();
        var workflow = WorkflowEngine.Start(Guid.NewGuid(), "tech-01", "north", started, policy);
        var now = started.AddMinutes(31);
        var types = WorkflowEngine.Evaluate(workflow, now, policy);
        var milestones = SlaAudit.Milestones(null, workflow, types, now);
        Assert.Equal(3, milestones.Length);
        Assert.Single(milestones.Select(e => e.SequenceNumber).Distinct());
        Assert.All(milestones, e => Assert.Equal(now, e.OccurredAtUtc));
        Assert.Equal(milestones[0].EventId, milestones[1].CausationId);
        Assert.Equal(milestones[1].EventId, milestones[2].CausationId);
        Assert.Equal(new[] { "StageWarningRaised.v1", "StageCriticalWarningRaised.v1", "StageSLABreached.v1" }, ReplayEngine.Order(milestones.Reverse()).Select(e => e.Event.EventType));
    }
}
