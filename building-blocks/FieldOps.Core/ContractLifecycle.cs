namespace FieldOps.Core;

/// <summary>Immutable evidence connecting two separately versioned agreements.</summary>
public sealed class ContractRenewalRecord
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid SourceContractId { get; set; }
    public Guid RenewedContractId { get; set; }
    public string TeamId { get; set; } = "";
    public Guid OperationId { get; set; }
    public int SourceVersion { get; set; }
    public DateTimeOffset EffectiveFromUtc { get; set; }
    public DateTimeOffset ExpiresAtUtc { get; set; }
    public string Reason { get; set; } = "";
    public string ActorId { get; set; } = "";
    public string ActorRole { get; set; } = "";
    public DateTimeOffset RecordedAtUtc { get; set; }
}

public static class ContractLifecycleRules
{
    /// <summary>Renews terms, not operational history or the previous plan cursor.</summary>
    public static MaintenanceContract Renew(MaintenanceContract source, int expectedVersion,
        DateTimeOffset effectiveFromUtc, DateTimeOffset expiresAtUtc, string reason, DateTimeOffset now)
    {
        if (source.Version != expectedVersion) throw new DomainException(409, "The contract changed; refresh and retry.");
        if (source.Status is not ("Active" or "Suspended" or "Expired"))
            throw new DomainException(409, "Only active, suspended or expired agreements can be renewed.");
        ContractRules.Text(reason, 3, 500, "Renewal reason");
        if (source.ExpiresAtUtc is null)
            throw new DomainException(409, "An open-ended agreement needs an explicit end before renewal.");
        if (effectiveFromUtc < source.ExpiresAtUtc || expiresAtUtc <= effectiveFromUtc)
            throw new DomainException(400, "Renewal needs a non-overlapping start and a later explicit expiration.");
        if (expiresAtUtc <= now)
            throw new DomainException(400, "The renewed agreement must not already be expired.");

        var renewed = new MaintenanceContract
        {
            TeamId = source.TeamId, CustomerId = source.CustomerId, Status = "Draft",
            EffectiveFromUtc = effectiveFromUtc, ExpiresAtUtc = expiresAtUtc,
            TimeZoneId = source.TimeZoneId, CoversAllAssets = source.CoversAllAssets,
            SlaClockOrigin = source.SlaClockOrigin,
            CreatedAtUtc = now, UpdatedAtUtc = now
        };
        renewed.Lines.AddRange(source.Lines.Select(x => new ContractLine
        {
            ContractId = renewed.Id, ServiceType = x.ServiceType, LaborCovered = x.LaborCovered,
            PartsCovered = x.PartsCovered, IncludedVisits = x.IncludedVisits,
            PartsAllowance = x.PartsAllowance, Active = x.Active,
            ResponseTargetMinutes = x.ResponseTargetMinutes, CompletionTargetMinutes = x.CompletionTargetMinutes
        }));
        var zone = TimeZoneInfo.FindSystemTimeZoneById(source.TimeZoneId);
        var starts = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(effectiveFromUtc, zone).DateTime);
        // Expiration is exclusive, including when it falls exactly at local midnight.
        var ends = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(expiresAtUtc.AddTicks(-1), zone).DateTime);
        renewed.CoveredAssets.AddRange(source.CoveredAssets.Select(x => new CoveredAsset
        {
            ContractId = renewed.Id, AssetId = x.AssetId, Active = x.Active,
            EffectiveFrom = starts, EffectiveTo = ends
        }));
        renewed.Exclusions.AddRange(source.Exclusions.Select(x => new ContractExclusion
        {
            ContractId = renewed.Id, AssetId = x.AssetId, ServiceType = x.ServiceType, Reason = x.Reason
        }));
        // Draft terms can be configured ahead of their start; activation enforces the instant.
        ContractRules.Validate(renewed, now);
        return renewed;
    }

    public static bool Expire(MaintenanceContract contract, DateTimeOffset now)
    {
        if (contract.Status is not ("Active" or "Suspended") || contract.ExpiresAtUtc is null || contract.ExpiresAtUtc > now)
            return false;
        contract.Status = "Expired";
        contract.UpdatedAtUtc = now;
        contract.Version++;
        return true;
    }

    /// <summary>Due day plus grace must fully pass in the agreement's time zone.</summary>
    public static MaintenanceVisit[] MarkMissed(MaintenanceContract contract, int? graceDays, DateTimeOffset now)
    {
        if (graceDays is null) return [];
        if (graceDays is < 0 or > 366) throw new DomainException(400, "Missed-visit grace must be between zero and 366 days.");
        if (contract.Status is "Draft" or "Cancelled") return [];
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(now, TimeZoneInfo.FindSystemTimeZoneById(contract.TimeZoneId)).DateTime);
        var cutoff = today.AddDays(-graceDays.Value);
        var missed = contract.Visits.Where(x => x.Status == "Pending" && x.WorkOrderId is null && x.DueDate < cutoff).ToArray();
        if (missed.Length == 0) return [];
        foreach (var visit in missed) visit.Status = "Missed";
        contract.Version++;
        contract.UpdatedAtUtc = now;
        return missed;
    }
}
