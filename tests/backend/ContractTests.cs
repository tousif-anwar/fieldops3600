using FieldOps.Core;
using Xunit;

namespace FieldOps.Tests;

public sealed class ContractTests
{
    private static readonly DateTimeOffset Now = new(2026, 1, 1, 12, 0, 0, TimeSpan.Zero);

    [Fact]
    public void EligibilityRequiresAnActiveEffectiveContractAndCoveredService()
    {
        var contract = ActiveContract();

        Assert.True(ContractRules.Evaluate(contract, contract.CustomerId, null, "HVAC", Now).Covered);
        Assert.False(ContractRules.Evaluate(contract, contract.CustomerId, null, "Electrical", Now).Covered);
        Assert.False(ContractRules.Evaluate(contract, Guid.NewGuid(), null, "HVAC", Now).Covered);
        contract.ExpiresAtUtc = Now.AddDays(-1);
        Assert.False(ContractRules.Evaluate(contract, contract.CustomerId, null, "HVAC", Now).Covered);
        contract.ExpiresAtUtc = Now.AddYears(1);
        contract.Status = "Suspended";
        Assert.False(ContractRules.Evaluate(contract, contract.CustomerId, null, "HVAC", Now).Covered);
    }

    [Fact]
    public void EquipmentCoverageExclusionsAndVisitAllowanceAreEnforced()
    {
        var contract = ActiveContract();
        contract.CoversAllAssets = false;
        var covered = new CoveredAsset { ContractId = contract.Id, AssetId = Guid.NewGuid(), EffectiveFrom = DateOnly.FromDateTime(Now.UtcDateTime) };
        contract.CoveredAssets.Add(covered);
        Assert.False(ContractRules.Evaluate(contract, contract.CustomerId, null, "HVAC", Now).Covered);
        Assert.True(ContractRules.Evaluate(contract, contract.CustomerId, covered.AssetId, "HVAC", Now).Covered);

        contract.Exclusions.Add(new ContractExclusion { ContractId = contract.Id, AssetId = covered.AssetId, Reason = "Customer-owned coil" });
        Assert.False(ContractRules.Evaluate(contract, contract.CustomerId, covered.AssetId, "HVAC", Now).Covered);
        contract.Exclusions.Clear();

        var line = contract.Lines.Single();
        ContractRules.RecordUsage(contract, line.Id, Guid.NewGuid(), 1, 0, Now);
        Assert.False(ContractRules.Evaluate(contract, contract.CustomerId, covered.AssetId, "HVAC", Now).Covered);
        Assert.Equal(0, ContractRules.Evaluate(contract, contract.CustomerId, covered.AssetId, "HVAC", Now).VisitsRemaining);
    }

    [Fact]
    public void UsageIsIdempotentByWorkOrderAndCannotExceedAllowance()
    {
        var contract = ActiveContract();
        var line = contract.Lines.Single();
        var workOrder = Guid.NewGuid();
        var usage = ContractRules.RecordUsage(contract, line.Id, workOrder, 1, 10m, Now);
        Assert.Single(contract.Usage);
        Assert.Equal(usage.Id, contract.Usage.Single().Id);
        Assert.Throws<DomainException>(() => ContractRules.RecordUsage(contract, line.Id, workOrder, 1, 0, Now));
        Assert.Throws<DomainException>(() => ContractRules.RecordUsage(contract, line.Id, Guid.NewGuid(), 1, 0, Now));
    }

    [Fact]
    public void RecurrenceGeneratesOnlyNewVisitsAndAdvancesThePlan()
    {
        var contract = ActiveContract();
        var plan = new MaintenancePlan
        {
            ContractId = contract.Id,
            ContractLineId = contract.Lines.Single().Id,
            Frequency = "Quarterly",
            IntervalMonths = 3,
            NextDueDate = new DateOnly(2026, 1, 15)
        };
        contract.Plans.Add(plan);
        ContractRules.Validate(contract, Now);

        Assert.Equal(4, ContractRules.GenerateVisits(contract, new DateOnly(2026, 12, 31), Now));
        Assert.Equal(["2026-01-15", "2026-04-15", "2026-07-15", "2026-10-15"],
            contract.Visits.OrderBy(x => x.DueDate).Select(x => x.DueDate.ToString("yyyy-MM-dd")).ToArray());
        Assert.Equal(new DateOnly(2027, 1, 15), plan.NextDueDate);
        Assert.Equal(0, ContractRules.GenerateVisits(contract, new DateOnly(2026, 12, 31), Now));
        Assert.Equal(4, contract.Visits.Count);
    }

    [Fact]
    public void RecurrenceStopsAtContractExpiryAndMonthEndIsStable()
    {
        var contract = ActiveContract();
        contract.ExpiresAtUtc = new DateTimeOffset(2026, 10, 1, 0, 0, 0, TimeSpan.Zero);
        var plan = new MaintenancePlan
        {
            ContractId = contract.Id,
            ContractLineId = contract.Lines.Single().Id,
            Frequency = "Quarterly",
            IntervalMonths = 3,
            NextDueDate = new DateOnly(2026, 1, 31)
        };
        contract.Plans.Add(plan);
        ContractRules.Validate(contract, Now);

        Assert.Equal(3, ContractRules.GenerateVisits(contract, new DateOnly(2026, 12, 31), Now));
        Assert.Equal(["2026-01-31", "2026-04-30", "2026-07-30"],
            contract.Visits.OrderBy(x => x.DueDate).Select(x => x.DueDate.ToString("yyyy-MM-dd")).ToArray());
    }

    [Fact]
    public void ContractLifecycleRejectsInvalidTransitionsAndInvalidTimeZones()
    {
        var contract = ActiveContract();
        contract.Status = "Draft";
        ContractRules.Activate(contract, Now);
        Assert.Equal("Active", contract.Status);
        ContractRules.Suspend(contract, Now);
        ContractRules.Activate(contract, Now);
        ContractRules.Cancel(contract, Now);
        Assert.Equal("Cancelled", contract.Status);
        Assert.Throws<DomainException>(() => ContractRules.Activate(contract, Now));

        var invalid = ActiveContract();
        invalid.TimeZoneId = "Mars/Olympus";
        Assert.Throws<DomainException>(() => ContractRules.Validate(invalid, Now));
    }

    [Fact]
    public void PlansRequireAKnownFrequencyAndOneActivePlanPerCoverageTarget()
    {
        var contract = ActiveContract();
        contract.Plans.Add(new MaintenancePlan
        {
            ContractId = contract.Id,
            ContractLineId = contract.Lines.Single().Id,
            Frequency = "Weekly",
            IntervalMonths = 1,
            NextDueDate = new DateOnly(2026, 1, 2)
        });
        Assert.Throws<DomainException>(() => ContractRules.Validate(contract, Now));

        contract.Plans.Clear();
        var line = contract.Lines.Single();
        contract.Plans.AddRange([
            new MaintenancePlan { ContractId = contract.Id, ContractLineId = line.Id, Frequency = "Annual", IntervalMonths = 12, NextDueDate = new DateOnly(2026, 2, 1) },
            new MaintenancePlan { ContractId = contract.Id, ContractLineId = line.Id, Frequency = "Annual", IntervalMonths = 12, NextDueDate = new DateOnly(2026, 3, 1) }
        ]);
        Assert.Throws<DomainException>(() => ContractRules.Validate(contract, Now));
    }

    private static MaintenanceContract ActiveContract()
    {
        var contract = new MaintenanceContract
        {
            TeamId = "north",
            CustomerId = Guid.NewGuid(),
            Status = "Active",
            EffectiveFromUtc = Now.AddDays(-30),
            ExpiresAtUtc = Now.AddYears(1),
            TimeZoneId = "UTC",
            CoversAllAssets = true,
            CreatedAtUtc = Now,
            UpdatedAtUtc = Now
        };
        contract.Lines.Add(new ContractLine
        {
            ContractId = contract.Id,
            ServiceType = "HVAC",
            LaborCovered = true,
            PartsCovered = true,
            IncludedVisits = 1,
            PartsAllowance = 100m
        });
        return contract;
    }
}
