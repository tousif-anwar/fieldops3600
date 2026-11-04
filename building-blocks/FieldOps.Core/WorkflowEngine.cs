namespace FieldOps.Core;

public sealed class DomainException(int status, string message) : Exception(message)
{
    public int Status { get; } = status;
}

public sealed record FormField(string Key, string Label, string[] Options, bool Required = true,
    string? ConditionField = null, string? ConditionValue = null);
public sealed record StageDefinition(int Index, string Name, FormField[] Fields);
public sealed record WorkflowTemplate(int Version, StageDefinition[] Stages);

public sealed record SlaPolicy(int DurationSeconds = 1800, int WarningSeconds = 1200, int CriticalSeconds = 1500)
{
    public void Validate(bool development)
    {
        if (!(WarningSeconds > 0 && WarningSeconds < CriticalSeconds && CriticalSeconds < DurationSeconds)) throw new InvalidOperationException("SLA thresholds must increase.");
        if (!development && DurationSeconds < 1800) throw new InvalidOperationException("Accelerated SLA is development-only.");
    }
}

public static class WorkflowEngine
{
    public static Workflow Start(Guid workOrderId, string technicianId, string teamId, DateTimeOffset now, SlaPolicy policy, int templateVersion = 1)
    {
        var definition = Templates.Get(templateVersion);
        var workflow = new Workflow { WorkOrderId = workOrderId, TechnicianId = technicianId, TeamId = teamId, StartedAtUtc = now, TemplateVersion = definition.Version };
        var stages = definition.Stages.Select(s => new StageState { Index = s.Index, Name = s.Name }).ToList();
        Activate(stages[0], now, policy);
        workflow.Stages = stages;
        return workflow;
    }

    private static void Activate(StageState stage, DateTimeOffset now, SlaPolicy policy)
    {
        stage.Status = "Active";
        stage.StartedAtUtc = now;
        stage.DeadlineUtc = now.AddSeconds(policy.DurationSeconds);
    }

    public static StageState Submit(Workflow workflow, int expectedVersion, Dictionary<string, string> answers, DateTimeOffset now, SlaPolicy policy)
    {
        RequireVersion(workflow, expectedVersion);
        if (workflow.Status != "Active") throw new DomainException(409, "Workflow is not active.");
        var stages = workflow.Stages;
        var stage = stages[workflow.CurrentStageIndex];
        if (stage.PausedAtUtc is not null) throw new DomainException(409, "Resume the stage before submitting.");
        Templates.Validate(stage.Index, answers, workflow.TemplateVersion);
        if (stage.Index == 0 && answers.GetValueOrDefault("assignment") == "Request Reassignment")
            throw new DomainException(409, "Reassignment does not accept the job. Use Request Assistance to notify the supervisor; the acceptance stage remains open.");
        stage.Answers = new(answers);
        stage.CompletedAtUtc = now;
        stage.Status = "Completed";
        if (now >= stage.DeadlineUtc) { stage.SlaStatus = "Breached"; stage.WarningLevel = 3; }
        if (stage.Index == stages.Count - 1) { workflow.Status = "Completed"; workflow.CompletedAtUtc = now; }
        else { workflow.CurrentStageIndex++; Activate(stages[workflow.CurrentStageIndex], now, policy); }
        workflow.Stages = stages;
        workflow.Version++;
        return stage;
    }

    public static StageState Pause(Workflow workflow, int expectedVersion, DateTimeOffset now)
    {
        RequireVersion(workflow, expectedVersion);
        if (workflow.Status != "Active") throw new DomainException(409, "Workflow is not active.");
        var stages = workflow.Stages;
        var stage = stages[workflow.CurrentStageIndex];
        if (stage.PausedAtUtc is not null) throw new DomainException(409, "Stage is already paused.");
        stage.PausedAtUtc = now;
        stage.Status = "Paused";
        workflow.Stages = stages;
        workflow.Version++;
        return stage;
    }

    public static StageState Resume(Workflow workflow, int expectedVersion, DateTimeOffset now)
    {
        RequireVersion(workflow, expectedVersion);
        if (workflow.Status != "Active") throw new DomainException(409, "Workflow is not active.");
        var stages = workflow.Stages;
        var stage = stages[workflow.CurrentStageIndex];
        if (stage.PausedAtUtc is null) throw new DomainException(409, "Stage is not paused.");
        var seconds = Math.Max(0, (now - stage.PausedAtUtc.Value).TotalSeconds);
        stage.PausedSeconds += seconds;
        stage.DeadlineUtc = stage.DeadlineUtc!.Value.AddSeconds(seconds);
        stage.PausedAtUtc = null;
        stage.Status = "Active";
        workflow.Stages = stages;
        workflow.Version++;
        return stage;
    }

    public static string[] Evaluate(Workflow workflow, DateTimeOffset now, SlaPolicy policy)
    {
        if (workflow.Status != "Active") return [];
        var stages = workflow.Stages;
        var stage = stages[workflow.CurrentStageIndex];
        if (stage.PausedAtUtc is not null || stage.StartedAtUtc is null) return [];
        var elapsed = (now - stage.StartedAtUtc.Value).TotalSeconds - stage.PausedSeconds;
        var events = new List<string>();
        if (elapsed >= policy.WarningSeconds && stage.WarningLevel < 1) { stage.WarningLevel = 1; stage.SlaStatus = "Warning"; events.Add("StageWarningRaised.v1"); }
        if (elapsed >= policy.CriticalSeconds && stage.WarningLevel < 2) { stage.WarningLevel = 2; stage.SlaStatus = "Critical"; events.Add("StageCriticalWarningRaised.v1"); }
        if (elapsed >= policy.DurationSeconds && stage.WarningLevel < 3) { stage.WarningLevel = 3; stage.SlaStatus = "Breached"; events.Add("StageSLABreached.v1"); }
        if (events.Count > 0) { workflow.Stages = stages; workflow.Version++; }
        return events.ToArray();
    }

    public static void RequireVersion(Workflow workflow, int expectedVersion)
    {
        if (workflow.Version != expectedVersion) throw new DomainException(409, "This workflow changed. Refresh it before trying again.");
    }
}

public static class BookingRules
{
    public static void Validate(Technician technician, WorkOrder order, DateTimeOffset start, DateTimeOffset end, IEnumerable<TimeOff> timeOff)
    {
        if (end <= start || end - start > TimeSpan.FromHours(8)) throw new DomainException(400, "Booking duration must be positive and at most eight hours.");
        if (!technician.Available || technician.TeamId != order.TeamId) throw new DomainException(409, "Technician is unavailable or belongs to another team.");
        if (!technician.Skills.Contains(order.ServiceCategory, StringComparer.OrdinalIgnoreCase)) throw new DomainException(409, "Technician lacks the required service skill.");
        if (!technician.Certifications.Contains("HVAC Safety")) throw new DomainException(409, "An HVAC Safety certification is required.");
        var zone = TimeZoneInfo.FindSystemTimeZoneById(technician.TimeZone);
        var localStart = TimeZoneInfo.ConvertTime(start, zone);
        var localEnd = TimeZoneInfo.ConvertTime(end, zone);
        if (localStart.Date != localEnd.Date || localStart.Hour < technician.WorkingStartHour || localEnd.TimeOfDay > TimeSpan.FromHours(technician.WorkingEndHour)) throw new DomainException(409, "Booking falls outside the technician's local working hours.");
        if (timeOff.Any(t => start < t.EndUtc && t.StartUtc < end)) throw new DomainException(409, "Booking overlaps approved time off.");
    }
    public static bool Overlaps(DateTimeOffset aStart, DateTimeOffset aEnd, DateTimeOffset bStart, DateTimeOffset bEnd) => aStart < bEnd && bStart < aEnd;
}
