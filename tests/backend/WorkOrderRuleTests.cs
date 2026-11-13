using System.Text.Json;
using FieldOps.Core;
using FieldOps.ServiceHost;
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

    [Fact]
    public void OrderPayloadCarriesOnlyTheOpaqueAssetReference()
    {
        var assetId = Guid.NewGuid();
        var payload = JsonSerializer.SerializeToElement(
            OperationsApi.OrderPayload(new WorkOrder { Number = "WO-1", TeamId = "north", AssetId = assetId }),
            Json.Options);
        Assert.Equal(assetId, payload.GetProperty("assetId").GetGuid());
        Assert.False(payload.TryGetProperty("serialNumber", out _));
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
