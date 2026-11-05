using System.Text.Json;
using FieldOps.Core;
using Xunit;

namespace FieldOps.Tests;

public sealed class IncidentSummaryTests
{
    private static readonly DateTimeOffset Start = new(2026, 11, 4, 13, 0, 0, TimeSpan.Zero);
    private static AuditEvent Event(string type, Guid stage, object payload, int minutes, string role = "System") => new(Guid.NewGuid(), type, 1, Guid.Empty, null, stage, "actor", role, "workflows", "correlation", null, "trace", null, Start.AddMinutes(minutes), Start.AddMinutes(minutes), minutes + 1, JsonSerializer.SerializeToElement(payload, Json.Options));

    [Fact]
    public void SummaryPreservesOriginalBreachAndComputesDelayUsingApprovedPauseAdjustedDeadline()
    {
        var stage = Guid.NewGuid();
        var breach = Event("StageSLABreached.v1", stage, new { stageName = "Diagnosis", deadlineUtc = Start.AddMinutes(30) }, 30);
        var pause = Event("StagePaused.v1", stage, new { reason = "Approved parts support" }, 31, "Supervisor");
        var complete = Event("StageCompleted.v1", stage, new { deadlineUtc = Start.AddMinutes(40), completedAtUtc = Start.AddMinutes(45) }, 45, "Technician");
        var summary = IncidentSummaries.Create([complete, breach, pause, breach]);
        var incident = Assert.Single(summary.StageIncidents);
        Assert.Equal(Start.AddMinutes(30), incident.SlaDeadlineUtc);
        Assert.Equal(Start.AddMinutes(40), incident.EffectiveDeadlineUtc);
        Assert.Equal(5, incident.DelayMinutes);
        Assert.Equal("Approved parts support", Assert.Single(summary.SupervisorActions).Reason);
        Assert.Equal(1, summary.BreachCount);
        Assert.Contains("No root cause", summary.Inferences[0]);
    }

    [Fact]
    public void MissingCompletionIsExplicitAndNeverReplacedWithAComputedGuess()
    {
        var summary = IncidentSummaries.Create([Event("StageSLABreached.v1", Guid.NewGuid(), new { stageName = "Diagnosis", deadlineUtc = Start.AddMinutes(30) }, 30)]);
        var incident = Assert.Single(summary.StageIncidents);
        Assert.Null(incident.ActualCompletionAtUtc); Assert.Null(incident.DelayMinutes);
        Assert.Equal("Completion not yet observed", incident.CompletionKind);
    }

    [Fact]
    public void SummaryOnlyTreatsStageControlsAsSupervisorActionsForAuthorizedRoles()
    {
        var stage = Guid.NewGuid();
        var technicianResume = Event("StageResumed.v1", stage, new { reason = "Technician resumed work" }, 2, "Technician");
        var supervisorPause = Event("StagePaused.v1", stage, new { reason = "Supervisor approved pause" }, 3, "Supervisor");

        var summary = IncidentSummaries.Create([technicianResume, supervisorPause]);

        var action = Assert.Single(summary.SupervisorActions);
        Assert.Equal("Supervisor", action.ActorRole);
        Assert.Equal("StagePaused.v1", action.EventType);
    }
}
