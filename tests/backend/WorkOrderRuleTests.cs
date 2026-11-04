using FieldOps.Core;
using Xunit;

namespace FieldOps.Tests;

public sealed class WorkOrderRuleTests
{
    [Fact]
    public void ScheduledCancellationRequiresReleasingItsBookingFirst()
    {
        var error = Assert.Throws<DomainException>(() => WorkOrderRules.RequireAllowedUpdate("Scheduled", "Cancelled"));
        Assert.Equal(409, error.Status);
        Assert.Contains("booking first", error.Message);
        WorkOrderRules.RequireAllowedUpdate("Created", "Cancelled");
    }

    [Theory]
    [InlineData("InProgress", "Cancelled")]
    [InlineData("Created", "Completed")]
    [InlineData("Scheduled", "InProgress")]
    [InlineData("Cancelled", "Created")]
    public void ManualUpdatesCannotBypassTheOperationalLifecycle(string current, string requested)
    {
        Assert.Equal(409, Assert.Throws<DomainException>(() => WorkOrderRules.RequireAllowedUpdate(current, requested)).Status);
    }
}
