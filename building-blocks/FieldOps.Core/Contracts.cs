using System.Globalization;
using System.Text.RegularExpressions;

namespace FieldOps.Core;

public sealed class MaintenanceContract
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string TeamId { get; set; } = "";
    public Guid CustomerId { get; set; }
    public string Status { get; set; } = "Draft";
    public DateTimeOffset EffectiveFromUtc { get; set; }
    public DateTimeOffset? ExpiresAtUtc { get; set; }
    public string TimeZoneId { get; set; } = "UTC";
    public bool CoversAllAssets { get; set; }
    public int Version { get; set; } = 1;
    public DateTimeOffset CreatedAtUtc { get; set; }
    public DateTimeOffset UpdatedAtUtc { get; set; }
    public List<ContractLine> Lines { get; set; } = [];
    public List<CoveredAsset> CoveredAssets { get; set; } = [];
    public List<ContractExclusion> Exclusions { get; set; } = [];
    public List<MaintenancePlan> Plans { get; set; } = [];
    public List<MaintenanceVisit> Visits { get; set; } = [];
    public List<ContractUsage> Usage { get; set; } = [];
    public List<ContractEvent> Events { get; set; } = [];
}

public sealed class ContractLine
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ContractId { get; set; }
    public string ServiceType { get; set; } = "";
    public bool LaborCovered { get; set; } = true;
    public bool PartsCovered { get; set; }
    public int IncludedVisits { get; set; }
    public decimal PartsAllowance { get; set; }
    public bool Active { get; set; } = true;
}

public sealed class CoveredAsset
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ContractId { get; set; }
    public Guid AssetId { get; set; }
    public DateOnly EffectiveFrom { get; set; }
    public DateOnly? EffectiveTo { get; set; }
    public bool Active { get; set; } = true;
}

public sealed class ContractExclusion
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ContractId { get; set; }
    public string? ServiceType { get; set; }
    public Guid? AssetId { get; set; }
    public string Reason { get; set; } = "";
}

public sealed class MaintenancePlan
{
    public Guid? ServiceLocationId { get; set; }
    public int? AnchorDay { get; set; }
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ContractId { get; set; }
    public Guid ContractLineId { get; set; }
    public Guid? AssetId { get; set; }
    public string Frequency { get; set; } = "Annual";
    public int IntervalMonths { get; set; } = 12;
    public DateOnly NextDueDate { get; set; }
    public DateOnly? EndsOn { get; set; }
    public bool Active { get; set; } = true;
    public int Version { get; set; } = 1;
}

public sealed class MaintenanceVisit
{
    public Guid? ServiceLocationId { get; set; }
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ContractId { get; set; }
    public Guid ContractLineId { get; set; }
    public Guid CustomerId { get; set; }
    public Guid? AssetId { get; set; }
    public Guid? WorkOrderId { get; set; }
    public DateOnly DueDate { get; set; }
    public string Status { get; set; } = "Pending";
    public DateTimeOffset GeneratedAtUtc { get; set; }
    public long AssignmentRevision { get; set; }
    public DateTimeOffset? CompletedAtUtc { get; set; }
    public Guid? CompletionEventId { get; set; }
    public bool CompletionReviewRequired { get; set; }
    public string? CompletionReviewReason { get; set; }
}

public sealed class ContractUsage
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ContractId { get; set; }
    public Guid ContractLineId { get; set; }
    public Guid WorkOrderId { get; set; }
    public int VisitsUsed { get; set; } = 1;
    public decimal PartsCost { get; set; }
    public DateTimeOffset OccurredAtUtc { get; set; }
}

public sealed class ContractEvent
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ContractId { get; set; }
    public int Version { get; set; }
    public string Action { get; set; } = "";
    public string ActorId { get; set; } = "";
    public string ActorRole { get; set; } = "";
    public string CorrelationId { get; set; } = "";
    public DateTimeOffset OccurredAtUtc { get; set; }
    public string DetailsJson { get; set; } = "{}";
}

public sealed record EntitlementDecision(
    bool Covered,
    string Reason,
    Guid? ContractId = null,
    Guid? ContractLineId = null,
    int? VisitsRemaining = null,
    decimal? PartsAllowanceRemaining = null,
    bool LaborCovered = false,
    bool PartsCovered = false);

public static class ContractRules
{
    public static readonly string[] Statuses = ["Draft", "Active", "Suspended", "Cancelled", "Expired"];
    public static readonly string[] Frequencies = ["Monthly", "Quarterly", "Semiannual", "Annual"];
    private static readonly Dictionary<string, int> FrequencyMonths = new(StringComparer.Ordinal)
    {
        ["Monthly"] = 1,
        ["Quarterly"] = 3,
        ["Semiannual"] = 6,
        ["Annual"] = 12
    };

    public static void Validate(MaintenanceContract contract, DateTimeOffset now)
    {
        if (contract.Id == Guid.Empty || contract.CustomerId == Guid.Empty)
            throw new DomainException(400, "Contract and customer identifiers are required.");
        if (!Regex.IsMatch(contract.TeamId, "^[A-Za-z0-9_-]{2,64}$"))
            throw new DomainException(400, "Invalid contract team.");
        if (!Statuses.Contains(contract.Status))
            throw new DomainException(400, "Unknown contract status.");
        if (contract.Status != "Draft" && contract.EffectiveFromUtc > now.AddDays(1))
            throw new DomainException(400, "Contract start cannot be in the future.");
        if (contract.ExpiresAtUtc is not null && contract.ExpiresAtUtc <= contract.EffectiveFromUtc)
            throw new DomainException(400, "Contract expiration must follow its start.");
        try { _ = TimeZoneInfo.FindSystemTimeZoneById(contract.TimeZoneId); }
        catch (TimeZoneNotFoundException) { throw new DomainException(400, "Contract time zone is not recognized."); }
        catch (InvalidTimeZoneException) { throw new DomainException(400, "Contract time zone data is invalid."); }
        if (contract.Lines.Count is 0 or > 50)
            throw new DomainException(400, "A contract must contain between one and fifty coverage lines.");
        if (contract.Lines.Select(x => x.ServiceType).Distinct(StringComparer.OrdinalIgnoreCase).Count() != contract.Lines.Count)
            throw new DomainException(400, "A contract may contain only one line per service type.");
        foreach (var line in contract.Lines)
        {
            if (line.Id == Guid.Empty || line.ContractId != contract.Id)
                throw new DomainException(400, "Coverage line identity is invalid.");
            Text(line.ServiceType, 2, 80, "Covered service type");
            if (line.IncludedVisits is < 0 or > 10_000)
                throw new DomainException(400, "Included visits must be between zero and ten thousand.");
            if (line.PartsAllowance < 0 || decimal.Round(line.PartsAllowance, 2) != line.PartsAllowance)
                throw new DomainException(400, "Parts allowance must be a nonnegative amount with at most two decimal places.");
        }
        if (contract.CoveredAssets.Select(x => x.AssetId).Distinct().Count() != contract.CoveredAssets.Count)
            throw new DomainException(400, "Covered equipment must be unique.");
        foreach (var covered in contract.CoveredAssets)
        {
            if (covered.Id == Guid.Empty || covered.AssetId == Guid.Empty || covered.ContractId != contract.Id)
                throw new DomainException(400, "Covered equipment identity is invalid.");
            if (covered.EffectiveTo is not null && covered.EffectiveTo < covered.EffectiveFrom)
                throw new DomainException(400, "Covered equipment end date must follow its start date.");
        }
        foreach (var exclusion in contract.Exclusions)
        {
            if (exclusion.Id == Guid.Empty || exclusion.ContractId != contract.Id ||
                (string.IsNullOrWhiteSpace(exclusion.ServiceType) && exclusion.AssetId is null))
                throw new DomainException(400, "A contract exclusion needs a service type or equipment.");
            Text(exclusion.Reason, 3, 500, "Exclusion reason");
        }
        if (!contract.CoversAllAssets && contract.CoveredAssets.Count == 0)
            throw new DomainException(400, "A contract must cover all equipment or list the covered equipment.");
        if (contract.Plans.Any(plan => plan.ContractId != contract.Id || plan.ContractLineId == Guid.Empty ||
            contract.Lines.All(line => line.Id != plan.ContractLineId) || !Frequencies.Contains(plan.Frequency) ||
            plan.IntervalMonths != FrequencyMonths[plan.Frequency] || plan.NextDueDate == default ||
            (plan.AnchorDay is < 1 or > 31) ||
            (plan.Active && plan.EndsOn is not null && plan.EndsOn < plan.NextDueDate)))
            throw new DomainException(400, "Maintenance plan values are invalid.");
        if (contract.Plans.Where(x => x.Active).GroupBy(x => new { x.ContractLineId, x.AssetId }).Any(group => group.Count() > 1))
            throw new DomainException(400, "Only one active maintenance plan is allowed per line and equipment.");
    }

    public static void Activate(MaintenanceContract contract, DateTimeOffset now)
    {
        if (contract.Status is not ("Draft" or "Suspended"))
            throw new DomainException(409, "Only a draft or suspended contract can be activated.");
        if (contract.EffectiveFromUtc > now)
            throw new DomainException(409, "A contract cannot be activated before its effective start.");
        if (contract.ExpiresAtUtc is not null && contract.ExpiresAtUtc <= now)
            throw new DomainException(409, "An expired contract cannot be activated.");
        contract.Status = "Active";
        contract.UpdatedAtUtc = now;
        contract.Version++;
    }

    public static void Suspend(MaintenanceContract contract, DateTimeOffset now)
    {
        if (contract.Status != "Active")
            throw new DomainException(409, "Only an active contract can be suspended.");
        contract.Status = "Suspended";
        contract.UpdatedAtUtc = now;
        contract.Version++;
    }

    public static void Cancel(MaintenanceContract contract, DateTimeOffset now)
    {
        if (contract.Status == "Cancelled")
            throw new DomainException(409, "This contract is already cancelled.");
        contract.Status = "Cancelled";
        contract.UpdatedAtUtc = now;
        contract.Version++;
    }

    public static bool IsEffective(MaintenanceContract contract, DateTimeOffset now) =>
        contract.Status == "Active" && contract.EffectiveFromUtc <= now &&
        (contract.ExpiresAtUtc is null || now < contract.ExpiresAtUtc.Value);

    public static EntitlementDecision Evaluate(MaintenanceContract contract, Guid customerId, Guid? assetId,
        string serviceType, DateTimeOffset now)
    {
        if (contract.CustomerId != customerId)
            return new(false, "The contract belongs to another customer.");
        if (!IsEffective(contract, now))
            return new(false, "The contract is not active and effective.");
        var line = contract.Lines.FirstOrDefault(x => x.Active &&
            string.Equals(x.ServiceType, serviceType?.Trim(), StringComparison.OrdinalIgnoreCase));
        if (line is null)
            return new(false, "The requested service is not covered by this contract.");
        if (!contract.CoversAllAssets)
        {
            if (!assetId.HasValue)
                return new(false, "Equipment must be selected for this contract.");
            var covered = contract.CoveredAssets.FirstOrDefault(x => x.AssetId == assetId.Value && x.Active);
            if (covered is null)
                return new(false, "The selected equipment is not covered by this contract.");
            var localDate = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(now, TimeZoneInfo.FindSystemTimeZoneById(contract.TimeZoneId)).DateTime);
            if (localDate < covered.EffectiveFrom || (covered.EffectiveTo is not null && localDate > covered.EffectiveTo))
                return new(false, "Equipment coverage is not effective on this date.");
        }
        if (contract.Exclusions.Any(x => (x.AssetId is null || x.AssetId == assetId) &&
            (x.ServiceType is null || string.Equals(x.ServiceType, serviceType, StringComparison.OrdinalIgnoreCase))))
            return new(false, "This service or equipment is excluded from the contract.");
        var usedVisits = contract.Usage.Where(x => x.ContractLineId == line.Id).Sum(x => x.VisitsUsed);
        if (line.IncludedVisits > 0 && usedVisits >= line.IncludedVisits)
            return new(false, "The contract visit allowance is exhausted.", contract.Id, line.Id, 0, line.PartsCovered ? line.PartsAllowance : null, line.LaborCovered, line.PartsCovered);
        var usedParts = contract.Usage.Where(x => x.ContractLineId == line.Id).Sum(x => x.PartsCost);
        return new(true, "Covered by the active contract.", contract.Id, line.Id,
            line.IncludedVisits > 0 ? line.IncludedVisits - usedVisits : null,
            line.PartsCovered ? Math.Max(0, line.PartsAllowance - usedParts) : null,
            line.LaborCovered, line.PartsCovered);
    }

    /// <summary>Adds only missing visits and advances the plan; callers persist atomically.</summary>
    public static int GenerateVisits(MaintenanceContract contract, DateOnly throughDate, DateTimeOffset now)
    {
        if (contract.Status != "Active")
            throw new DomainException(409, "Maintenance visits can only be generated for an active contract.");
        var zone = TimeZoneInfo.FindSystemTimeZoneById(contract.TimeZoneId);
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(now, zone).DateTime);
        if (throughDate < today)
            throw new DomainException(400, "The recurring visit horizon cannot be in the past.");
        if (throughDate > today.AddYears(2))
            throw new DomainException(400, "Generate maintenance visits no more than two years ahead.");
        var firstDate = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(contract.EffectiveFromUtc, zone).DateTime);
        DateOnly? lastDate = null;
        if (contract.ExpiresAtUtc is { } expires)
        {
            var localExpiry = TimeZoneInfo.ConvertTime(expires, zone);
            lastDate = DateOnly.FromDateTime(localExpiry.DateTime);
            if (localExpiry.TimeOfDay == TimeSpan.Zero) lastDate = lastDate.Value.AddDays(-1);
        }
        var generated = 0;
        foreach (var plan in contract.Plans.Where(x => x.Active))
        {
            var line = contract.Lines.SingleOrDefault(x => x.Id == plan.ContractLineId && x.Active)
                ?? throw new DomainException(409, "A maintenance plan refers to an inactive coverage line.");
            var due = plan.NextDueDate;
            plan.AnchorDay ??= due.Day;
            while (due <= throughDate && (plan.EndsOn is null || due <= plan.EndsOn))
            {
                if (lastDate is not null && due > lastDate)
                    break;
                if (due >= firstDate && contract.Visits.All(x => x.ContractLineId != plan.ContractLineId || x.AssetId != plan.AssetId || x.DueDate != due))
                {
                    contract.Visits.Add(new MaintenanceVisit
                    {
                        ContractId = contract.Id,
                        ContractLineId = plan.ContractLineId,
                        CustomerId = contract.CustomerId,
                        AssetId = plan.AssetId,
                        ServiceLocationId = plan.ServiceLocationId,
                        DueDate = due,
                        GeneratedAtUtc = now
                    });
                    generated++;
                }
                var month = new DateOnly(due.Year, due.Month, 1).AddMonths(plan.IntervalMonths);
                due = new DateOnly(month.Year, month.Month, Math.Min(plan.AnchorDay.Value, DateTime.DaysInMonth(month.Year, month.Month)));
                plan.NextDueDate = due;
                plan.Version++;
                if (generated >= 1000) throw new DomainException(409, "Too many visits would be generated in one batch.");
            }
            if (plan.EndsOn is not null && plan.NextDueDate > plan.EndsOn) plan.Active = false;
        }
        contract.UpdatedAtUtc = now;
        if (generated > 0) contract.Version++;
        return generated;
    }

    public static ContractUsage RecordUsage(MaintenanceContract contract, Guid lineId, Guid workOrderId,
        int visitsUsed, decimal partsCost, DateTimeOffset now)
    {
        if (workOrderId == Guid.Empty) throw new DomainException(400, "A work order is required for contract usage.");
        if (visitsUsed is < 0 or > 100) throw new DomainException(400, "Usage visits must be between zero and one hundred.");
        if (partsCost < 0 || decimal.Round(partsCost, 2) != partsCost)
            throw new DomainException(400, "Usage parts cost must be nonnegative with at most two decimal places.");
        var line = contract.Lines.SingleOrDefault(x => x.Id == lineId && x.Active)
            ?? throw new DomainException(404, "Coverage line not found.");
        var usedVisits = contract.Usage.Where(x => x.ContractLineId == lineId).Sum(x => x.VisitsUsed);
        if (line.IncludedVisits > 0 && usedVisits + visitsUsed > line.IncludedVisits)
            throw new DomainException(409, "Recorded visits exceed the contract allowance.");
        var usedParts = contract.Usage.Where(x => x.ContractLineId == lineId).Sum(x => x.PartsCost);
        if (line.PartsCovered && usedParts + partsCost > line.PartsAllowance)
            throw new DomainException(409, "Recorded parts exceed the contract allowance.");
        if (contract.Usage.Any(x => x.ContractLineId == lineId && x.WorkOrderId == workOrderId))
            throw new DomainException(409, "Usage is already recorded for this work order and coverage line.");
        var usage = new ContractUsage
        {
            ContractId = contract.Id,
            ContractLineId = lineId,
            WorkOrderId = workOrderId,
            VisitsUsed = visitsUsed,
            PartsCost = partsCost,
            OccurredAtUtc = now
        };
        contract.Usage.Add(usage);
        contract.UpdatedAtUtc = now;
        contract.Version++;
        return usage;
    }

    public static int IntervalMonths(string frequency) =>
        FrequencyMonths.TryGetValue(frequency, out var months) ? months : throw new DomainException(400, "Unknown recurrence frequency.");

    public static void Text(string? value, int minimum, int maximum, string field)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Trim().Length < minimum || value.Length > maximum)
            throw new DomainException(400, $"{field} must contain {minimum}-{maximum} characters.");
    }
}
