namespace FieldOps.Core;

public sealed record ContractSlaTerms(Guid ContractId, Guid ContractLineId, int ContractVersion, string ClockOrigin,
    int? ResponseTargetMinutes, int? CompletionTargetMinutes, string TimeZoneId);

public sealed class WorkOrderSlaSnapshot
{
    public Guid WorkOrderId { get; set; }
    public string TeamId { get; set; } = "";
    public Guid ContractId { get; set; }
    public Guid ContractLineId { get; set; }
    public int ContractVersion { get; set; }
    public string ClockOrigin { get; set; } = "";
    public int? ResponseTargetMinutes { get; set; }
    public int? CompletionTargetMinutes { get; set; }
    public string TimeZoneId { get; set; } = "UTC";
    public DateTimeOffset WorkOrderCreatedAtUtc { get; set; }
    public DateTimeOffset AttachedAtUtc { get; set; }
    public string TermsHash { get; set; } = "";
}

public sealed class WorkOrderSlaState
{
    public Guid WorkOrderId { get; set; }
    public int Version { get; set; } = 1;
    public int ClockRevision { get; set; } = 1;
    public long BookingRevision { get; set; }
    public Guid? BookingId { get; set; }
    public DateTimeOffset? AppointmentStartUtc { get; set; }
    public DateTimeOffset? OriginAtUtc { get; set; }
    public DateTimeOffset? ResponseDueAtUtc { get; set; }
    public DateTimeOffset? CompletionDueAtUtc { get; set; }
    public DateTimeOffset? ResponseAtUtc { get; set; }
    public DateTimeOffset? CompletedAtUtc { get; set; }
    public Guid? ResponseSourceEventId { get; set; }
    public Guid? CompletionSourceEventId { get; set; }
    public string ResponseStatus { get; set; } = "Unconfigured";
    public string CompletionStatus { get; set; } = "Unconfigured";
    public Guid? ResponseOverdueEvidenceId { get; set; }
    public Guid? CompletionOverdueEvidenceId { get; set; }
    public bool ResponseEverOverdue { get; set; }
    public bool CompletionEverOverdue { get; set; }
    public DateTimeOffset? CancelledAtUtc { get; set; }
    public bool RequiresReview { get; set; }
    public string? ReviewReason { get; set; }
    public DateTimeOffset UpdatedAtUtc { get; set; }
}

public sealed class WorkOrderSlaEvidence
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid WorkOrderId { get; set; }
    public int ClockRevision { get; set; }
    public string SemanticKey { get; set; } = "";
    public string Action { get; set; } = "";
    public string TargetKind { get; set; } = "";
    public Guid? SourceEventId { get; set; }
    public Guid? RelatedEvidenceId { get; set; }
    public DateTimeOffset EffectiveAtUtc { get; set; }
    public DateTimeOffset RecordedAtUtc { get; set; }
    public string ActorId { get; set; } = "system";
    public string ActorRole { get; set; } = "System";
    public string DetailsJson { get; set; } = "{}";
}

public sealed record ContractSlaTransition(string Action, string TargetKind, DateTimeOffset EffectiveAtUtc,
    DateTimeOffset? DueAtUtc = null, DateTimeOffset? MilestoneAtUtc = null, Guid? RelatedEvidenceId = null,
    string? Reason = null, int? ClockRevision = null);

/// <summary>Elapsed contract targets are independent of workflow-stage timing and pauses.</summary>
public static class ContractSlaRules
{
    public static void ValidateTerms(MaintenanceContract contract)
    {
        if (contract.SlaClockOrigin is not (null or "WorkOrderCreated" or "AppointmentStart"))
            throw new DomainException(400, "Choose WorkOrderCreated or AppointmentStart for the contract SLA clock.");
        foreach (var line in contract.Lines)
        {
            ValidateDurations(line.ResponseTargetMinutes, line.CompletionTargetMinutes);
            if ((line.ResponseTargetMinutes.HasValue || line.CompletionTargetMinutes.HasValue) && contract.SlaClockOrigin is null)
                throw new DomainException(400, "Contract SLA targets require an explicit clock origin.");
        }
    }

    public static void Validate(ContractSlaTerms terms)
    {
        if (terms.ContractId == Guid.Empty || terms.ContractLineId == Guid.Empty || terms.ContractVersion < 1)
            throw new DomainException(400, "Contract SLA source identity and version are required.");
        if (terms.ClockOrigin is not ("WorkOrderCreated" or "AppointmentStart"))
            throw new DomainException(400, "An explicit contract SLA clock origin is required.");
        ValidateDurations(terms.ResponseTargetMinutes, terms.CompletionTargetMinutes);
        if (!terms.ResponseTargetMinutes.HasValue && !terms.CompletionTargetMinutes.HasValue)
            throw new DomainException(400, "At least one contract SLA target is required.");
        try { _ = TimeZoneInfo.FindSystemTimeZoneById(terms.TimeZoneId); }
        catch (Exception exception) when (exception is TimeZoneNotFoundException or InvalidTimeZoneException or ArgumentException)
        { throw new DomainException(400, "Contract SLA display time zone is not recognized."); }
    }

    private static void ValidateDurations(int? response, int? completion)
    {
        if (response is <= 0 || completion is <= 0)
            throw new DomainException(400, "Contract SLA targets must be positive whole elapsed minutes.");
        if (response.HasValue && completion.HasValue && completion < response)
            throw new DomainException(400, "The completion target must not precede the response target.");
    }

    // PostgreSQL and Npgsql timestamps retain microseconds. Normalize owner facts
    // before semantic comparison so an event's seventh fractional digit is not a conflict.
    public static DateTimeOffset Instant(DateTimeOffset value) => new(value.UtcTicks - value.UtcTicks % 10, TimeSpan.Zero);

    public static DateTimeOffset? Due(DateTimeOffset? origin, int? minutes)
    {
        if (origin is null || minutes is null) return null;
        try { return Instant(origin.Value.AddMinutes(minutes.Value)); }
        catch (ArgumentOutOfRangeException) { throw new DomainException(400, "The contract SLA deadline is outside the supported timestamp range."); }
    }

    public static WorkOrderSlaState Initial(WorkOrderSlaSnapshot snapshot, DateTimeOffset now)
    {
        var origin = snapshot.ClockOrigin == "WorkOrderCreated" ? snapshot.WorkOrderCreatedAtUtc : (DateTimeOffset?)null;
        var state = new WorkOrderSlaState { WorkOrderId = snapshot.WorkOrderId, OriginAtUtc = origin, UpdatedAtUtc = Instant(now) };
        SetDeadlines(snapshot, state);
        return state;
    }

    public static void SetDeadlines(WorkOrderSlaSnapshot snapshot, WorkOrderSlaState state)
    {
        state.ResponseDueAtUtc = Due(state.OriginAtUtc, snapshot.ResponseTargetMinutes);
        state.CompletionDueAtUtc = Due(state.OriginAtUtc, snapshot.CompletionTargetMinutes);
        state.ResponseStatus = InitialStatus(snapshot.ResponseTargetMinutes, state.ResponseDueAtUtc);
        state.CompletionStatus = InitialStatus(snapshot.CompletionTargetMinutes, state.CompletionDueAtUtc);
    }

    private static string InitialStatus(int? configured, DateTimeOffset? due) =>
        configured is null ? "Unconfigured" : due is null ? "WaitingForAppointment" : "Pending";

    public static ContractSlaTransition[] Review(WorkOrderSlaState state, string reason, DateTimeOffset now)
    {
        if (state.RequiresReview) return [];
        state.RequiresReview = true;
        state.ReviewReason = reason;
        if (state.ResponseAtUtc is null && state.ResponseStatus != "Unconfigured") state.ResponseStatus = "Review";
        if (state.CompletedAtUtc is null && state.CompletionStatus != "Unconfigured") state.CompletionStatus = "Review";
        return [new("ContractSlaReviewRequired.v1", "Review", Instant(now), Reason: reason, ClockRevision: state.ClockRevision)];
    }

    public static ContractSlaTransition[] Evaluate(WorkOrderSlaSnapshot snapshot, WorkOrderSlaState state, DateTimeOffset now)
    {
        if (state.RequiresReview) return [];
        var result = new List<ContractSlaTransition>();
        state.ResponseStatus = EvaluateTarget("Response", snapshot.ResponseTargetMinutes, state.ResponseDueAtUtc,
            state.ResponseAtUtc, state.ResponseStatus, state.ResponseOverdueEvidenceId, state.CancelledAtUtc);
        state.CompletionStatus = EvaluateTarget("Completion", snapshot.CompletionTargetMinutes, state.CompletionDueAtUtc,
            state.CompletedAtUtc, state.CompletionStatus, state.CompletionOverdueEvidenceId, state.CancelledAtUtc);
        return result.Select(x => x with { ClockRevision = state.ClockRevision }).ToArray();

        string EvaluateTarget(string target, int? configured, DateTimeOffset? due, DateTimeOffset? milestone,
            string previous, Guid? overdueEvidenceId, DateTimeOffset? cancelled)
        {
            if (configured is null) return "Unconfigured";
            if (milestone is not null && due is not null)
            {
                var status = milestone < due ? "Met" : "Late";
                if (status == previous) return status;
                if (status == "Late" && previous != "OverdueObserved" && overdueEvidenceId is null)
                    result.Add(new("ContractSlaTargetOverdueObserved.v1", target, due.Value, due, milestone));
                result.Add(new(status == "Met" && overdueEvidenceId.HasValue ? "ContractSlaFindingCorrected.v1"
                    : status == "Met" ? "ContractSlaTargetMet.v1" : "ContractSlaTargetLate.v1",
                    target, milestone.Value, due, milestone, overdueEvidenceId));
                return status;
            }
            if (cancelled is not null) return "Cancelled";
            if (due is null) return "WaitingForAppointment";
            if (Instant(now) < due) return "Pending";
            if (previous != "OverdueObserved")
                result.Add(new("ContractSlaTargetOverdueObserved.v1", target, due.Value, due));
            return "OverdueObserved";
        }
    }
}
