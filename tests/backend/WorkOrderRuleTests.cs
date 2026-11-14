using System.Text.Json;
using FieldOps.Core;
using FieldOps.ServiceHost;
using Xunit;

namespace FieldOps.Tests;

public sealed class WorkOrderRuleTests
{
    [Fact]
    public void BookingProjectionIgnoresOldCancellationAndLateCreation()
    {
        var order = new WorkOrder();
        Assert.True(WorkOrderRules.ApplyBookingEvent(order, "BookingCreated.v1", "tech-01", 1));
        Assert.True(WorkOrderRules.ApplyBookingEvent(order, "BookingCancelled.v1", "tech-01", 2));
        Assert.True(WorkOrderRules.ApplyBookingEvent(order, "BookingCreated.v1", "tech-02", 3));
        Assert.False(WorkOrderRules.ApplyBookingEvent(order, "BookingCancelled.v1", "tech-01", 2));
        Assert.Equal("tech-02", order.TechnicianId); Assert.Equal("Scheduled", order.Status);
        Assert.True(WorkOrderRules.ApplyBookingEvent(order, "BookingCancelled.v1", "tech-02", 4));
        Assert.False(WorkOrderRules.ApplyBookingEvent(order, "BookingCreated.v1", "tech-02", 3));
        Assert.Null(order.TechnicianId); Assert.Equal("Created", order.Status);
    }

    [Fact]
    public void RescheduleCanArriveBeforeCreationWithoutLosingAssignmentAndCannotReopenCompletedWork()
    {
        var order = new WorkOrder();
        Assert.True(WorkOrderRules.ApplyBookingEvent(order, "BookingRescheduled.v1", "tech-01", 2));
        Assert.False(WorkOrderRules.ApplyBookingEvent(order, "BookingCreated.v1", "tech-01", 1));
        Assert.Equal("Scheduled", order.Status); Assert.Equal("tech-01", order.TechnicianId);
        order.Status = "Completed";
        Assert.True(WorkOrderRules.ApplyBookingEvent(order, "BookingCancelled.v1", "tech-01", 3));
        Assert.Equal("Completed", order.Status);
    }

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
