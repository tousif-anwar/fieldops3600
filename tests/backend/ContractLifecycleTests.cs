using FieldOps.Core;
using FieldOps.ServiceHost;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Xunit;

namespace FieldOps.Tests;

public sealed class ContractLifecycleTests
{
    private static readonly DateTimeOffset Now = new(2026, 1, 15, 12, 0, 0, TimeSpan.Zero);

    [Fact]
    public void RenewalClonesCoverageIntoFutureDraftWithoutRewritingTermsOrHistory()
    {
        var source = Contract();
        source.CoversAllAssets = false;
        source.TimeZoneId = "America/New_York";
        source.CoveredAssets.Add(new CoveredAsset
        {
            ContractId = source.Id, AssetId = Guid.NewGuid(), EffectiveFrom = new(2025, 1, 1)
        });
        source.Exclusions.Add(new ContractExclusion { ContractId = source.Id, ServiceType = "Emergency", Reason = "Excluded from standard coverage" });
        source.Plans.Add(Plan(source, new(2026, 1, 31)));
        source.Usage.Add(new ContractUsage { ContractId = source.Id, ContractLineId = source.Lines[0].Id, WorkOrderId = Guid.NewGuid() });
        source.Visits.Add(Visit(source, new(2026, 1, 31)));
        source.Events.Add(new ContractEvent { ContractId = source.Id, Action = "Prior evidence" });
        var original = Json.Write(source);
        var from = new DateTimeOffset(2027, 1, 1, 0, 0, 0, TimeSpan.Zero);
        var expires = new DateTimeOffset(2028, 1, 1, 0, 0, 0, TimeSpan.Zero);

        var renewed = ContractLifecycleRules.Renew(source, source.Version, from, expires, "Annual renewal agreed", Now);

        Assert.Equal(original, Json.Write(source));
        Assert.NotEqual(source.Id, renewed.Id);
        Assert.Equal(source.CustomerId, renewed.CustomerId);
        Assert.Equal("Draft", renewed.Status);
        Assert.Equal(1, renewed.Version);
        Assert.Equal(from, renewed.EffectiveFromUtc);
        Assert.False(ContractRules.IsEffective(renewed, from));
        Assert.NotEqual(source.Lines[0].Id, renewed.Lines[0].Id);
        Assert.Equal(source.Lines[0].PartsAllowance, renewed.Lines[0].PartsAllowance);
        Assert.Equal(renewed.Id, renewed.Lines[0].ContractId);
        Assert.NotEqual(source.Exclusions[0].Id, renewed.Exclusions[0].Id);
        Assert.NotEqual(source.CoveredAssets[0].Id, renewed.CoveredAssets[0].Id);
        Assert.Equal(new DateOnly(2026, 12, 31), renewed.CoveredAssets[0].EffectiveFrom);
        Assert.Equal(new DateOnly(2027, 12, 31), renewed.CoveredAssets[0].EffectiveTo);
        Assert.Empty(renewed.Plans);
        Assert.Empty(renewed.Visits);
        Assert.Empty(renewed.Usage);
        Assert.Empty(renewed.Events);
    }

    [Theory]
    [InlineData("Draft")]
    [InlineData("Cancelled")]
    public void RenewalRejectsUnsupportedSourceStates(string status)
    {
        var source = Contract();
        source.Status = status;
        Assert.Throws<DomainException>(() => ContractLifecycleRules.Renew(source, source.Version,
            source.ExpiresAtUtc!.Value, source.ExpiresAtUtc.Value.AddYears(1), "Renewal requested", Now));
    }

    [Fact]
    public void RenewalRejectsStaleVersionOverlapOpenEndedAndExpiredWindows()
    {
        var source = Contract();
        var end = source.ExpiresAtUtc!.Value;
        Assert.Throws<DomainException>(() => ContractLifecycleRules.Renew(source, 99, end, end.AddYears(1), "Renewal requested", Now));
        Assert.Throws<DomainException>(() => ContractLifecycleRules.Renew(source, 1, end.AddTicks(-1), end.AddYears(1), "Renewal requested", Now));
        Assert.Throws<DomainException>(() => ContractLifecycleRules.Renew(source, 1, end, end, "Renewal requested", Now));
        Assert.Throws<DomainException>(() => ContractLifecycleRules.Renew(source, 1, end, end.AddYears(1), " ", Now));
        source.ExpiresAtUtc = null;
        Assert.Throws<DomainException>(() => ContractLifecycleRules.Renew(source, 1, end, end.AddYears(1), "Renewal requested", Now));
        source.ExpiresAtUtc = Now.AddYears(-2);
        Assert.Throws<DomainException>(() => ContractLifecycleRules.Renew(source, 1, Now.AddYears(-1), Now, "Renewal requested", Now));
    }

    [Theory]
    [InlineData("Active", true)]
    [InlineData("Suspended", true)]
    [InlineData("Draft", false)]
    [InlineData("Cancelled", false)]
    [InlineData("Expired", false)]
    public void ExpiryUsesExactInstantAndOnlyApplicableStates(string status, bool changes)
    {
        var contract = Contract();
        contract.Status = status;
        contract.ExpiresAtUtc = Now;
        Assert.False(ContractLifecycleRules.Expire(contract, Now.AddTicks(-1)));
        Assert.Equal(changes, ContractLifecycleRules.Expire(contract, Now));
        Assert.Equal(changes ? "Expired" : status, contract.Status);
        Assert.Equal(changes ? 2 : 1, contract.Version);
        Assert.False(ContractLifecycleRules.Expire(contract, Now.AddDays(1)));
    }

    [Fact]
    public void MissedPolicyIsExplicitAndUsesFullGraceDaysInContractTimeZone()
    {
        var contract = Contract();
        contract.TimeZoneId = "America/New_York";
        var old = Visit(contract, new(2026, 3, 6));
        var graceBoundary = Visit(contract, new(2026, 3, 7));
        var linkedPending = Visit(contract, new(2026, 3, 1));
        linkedPending.WorkOrderId = Guid.NewGuid();
        var dispatching = Visit(contract, new(2026, 3, 1));
        dispatching.Status = "Dispatching";
        contract.Visits.AddRange([old, graceBoundary, linkedPending, dispatching]);
        // UTC March 9 is still March 8 in New York, after the spring DST change.
        var lateLocalDay = new DateTimeOffset(2026, 3, 9, 3, 30, 0, TimeSpan.Zero);
        Assert.Empty(ContractLifecycleRules.MarkMissed(contract, null, lateLocalDay));
        Assert.Equal([old.Id], ContractLifecycleRules.MarkMissed(contract, 1, lateLocalDay).Select(x => x.Id));
        Assert.Equal("Pending", graceBoundary.Status);
        Assert.Equal("Pending", linkedPending.Status);
        Assert.Equal("Dispatching", dispatching.Status);
        Assert.Empty(ContractLifecycleRules.MarkMissed(contract, 1, lateLocalDay));
        Assert.Equal([graceBoundary.Id], ContractLifecycleRules.MarkMissed(contract, 1, lateLocalDay.AddHours(1)).Select(x => x.Id));
    }

    [Theory]
    [InlineData(2026, 28)]
    [InlineData(2028, 29)]
    public void MonthlyRecurrenceRetainsJanuary31AnchorAcrossFebruary(int year, int februaryDay)
    {
        var contract = Contract();
        var now = new DateTimeOffset(year, 1, 1, 12, 0, 0, TimeSpan.Zero);
        contract.EffectiveFromUtc = now.AddDays(-1);
        contract.ExpiresAtUtc = now.AddYears(1);
        var plan = Plan(contract, new(year, 1, 31));
        contract.Plans.Add(plan);
        Assert.Equal(3, ContractRules.GenerateVisits(contract, new(year, 3, 31), now));
        Assert.Equal([new DateOnly(year, 1, 31), new(year, 2, februaryDay), new(year, 3, 31)], contract.Visits.Select(x => x.DueDate));
        Assert.Equal(31, plan.AnchorDay);
        Assert.Equal(new DateOnly(year, 4, 30), plan.NextDueDate);
        Assert.Equal(0, ContractRules.GenerateVisits(contract, new(year, 3, 31), now));
    }

    [Theory]
    [InlineData(2, 28, 5, false)]
    [InlineData(2, 28, 7, true)]
    [InlineData(3, 1, 2, true)]
    [InlineData(3, 1, 5, true)]
    public void RecurrenceExpiryUsesAgreementLocalDateAndExclusiveMidnight(int month, int day, int utcHour, bool february28Covered)
    {
        var contract = Contract();
        contract.TimeZoneId = "America/New_York";
        contract.ExpiresAtUtc = new DateTimeOffset(2026, month, day, utcHour, 0, 0, TimeSpan.Zero);
        contract.Plans.Add(Plan(contract, new(2026, 2, 28)));
        ContractRules.GenerateVisits(contract, new(2026, 3, 31), Now);
        Assert.Equal(february28Covered ? 1 : 0, contract.Visits.Count);
        if (february28Covered) Assert.Equal(new DateOnly(2026, 2, 28), contract.Visits[0].DueDate);
    }

    [Fact]
    public void LifecycleRegistrationIsDisabledByDefaultAndRejectsIncompleteEnabledPolicy()
    {
        var services = new ServiceCollection();
        services.AddContractLifecycle(new ConfigurationBuilder().Build());
        Assert.DoesNotContain(services, x => x.ServiceType == typeof(IHostedService));
        Assert.Throws<InvalidOperationException>(() => new ContractLifecyclePolicy(true).Validate());
        Assert.Throws<InvalidOperationException>(() => new ContractLifecyclePolicy(true, 30, -1).Validate());
        Assert.Throws<InvalidOperationException>(() => new ContractLifecyclePolicy(true, 367).Validate());
        new ContractLifecyclePolicy(true, 30, null).Validate();
    }

    internal static MaintenanceContract Contract()
    {
        var contract = new MaintenanceContract
        {
            TeamId = "north", CustomerId = Guid.NewGuid(), Status = "Active",
            EffectiveFromUtc = Now.AddYears(-1), ExpiresAtUtc = new DateTimeOffset(2027, 1, 1, 0, 0, 0, TimeSpan.Zero),
            CoversAllAssets = true, CreatedAtUtc = Now.AddDays(-1), UpdatedAtUtc = Now.AddDays(-1)
        };
        contract.Lines.Add(new ContractLine
        {
            ContractId = contract.Id, ServiceType = "HVAC", PartsCovered = true, PartsAllowance = 100m, IncludedVisits = 10
        });
        return contract;
    }

    internal static MaintenancePlan Plan(MaintenanceContract contract, DateOnly due) => new()
    {
        ContractId = contract.Id, ContractLineId = contract.Lines[0].Id, Frequency = "Monthly", IntervalMonths = 1, NextDueDate = due
    };

    internal static MaintenanceVisit Visit(MaintenanceContract contract, DateOnly due) => new()
    {
        ContractId = contract.Id, ContractLineId = contract.Lines[0].Id, CustomerId = contract.CustomerId,
        DueDate = due, GeneratedAtUtc = Now
    };
}
