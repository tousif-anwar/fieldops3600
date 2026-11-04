using System.Text.Json;
using FieldOps.Core;
using FieldOps.ServiceHost;
using Xunit;

namespace FieldOps.Tests;

public sealed class FaultEvidenceTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 4, 13, 0, 0, TimeSpan.Zero);

    [Fact]
    public void DiagnosticEvidencePreservesOriginalTimeAndLinksCausationWithoutCopyingExceptionMessages()
    {
        var original = new AuditEvent(Guid.NewGuid(), "StageStarted.v1", 1, Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(),
            "tech-01", "Technician", "workflows", "correlation", null, "trace", "span", Now, Now, 2,
            JsonSerializer.SerializeToElement(new { teamId = "north", technicianId = "tech-01", stageName = "Diagnosis" }, Json.Options));
        var observation = new FaultObservation(Guid.NewGuid(), original.EventId, original, Now.AddSeconds(5), "notifications",
            ["System.InvalidOperationException", "Secret customer@example.com and password=hidden"]);
        var diagnostics = FaultEvidence.DiagnosticEvents(observation, Now.AddSeconds(15));
        Assert.Equal("MessageProcessingFailed.v1", diagnostics[0].EventType);
        Assert.Equal("DeadLetterRecorded.v1", diagnostics[1].EventType);
        Assert.Equal(original.EventId, diagnostics[0].CausationId);
        Assert.Equal(diagnostics[0].EventId, diagnostics[1].CausationId);
        Assert.Equal(original.OccurredAtUtc, diagnostics[0].EventPayload.GetProperty("originalOccurredAtUtc").GetDateTimeOffset());
        Assert.Equal(Now.AddSeconds(5), diagnostics[0].OccurredAtUtc);
        Assert.Equal(Now.AddSeconds(15), diagnostics[0].RecordedAtUtc);
        Assert.Equal(original.StageInstanceId, diagnostics[0].StageInstanceId);
        Assert.Equal(original.TraceId, diagnostics[0].TraceId);
        Assert.Equal(JsonValueKind.Null, diagnostics[0].EventPayload.GetProperty("retryCount").ValueKind);
        Assert.DoesNotContain("customer@example.com", Json.Write(diagnostics));
        Assert.DoesNotContain("password=hidden", Json.Write(diagnostics));
        Assert.Contains("UnknownException", Json.Write(diagnostics));
    }

    [Fact]
    public void FaultSourceIsARecognizedConsumerOrExplicitlyUnknown()
    {
        Assert.Equal("notifications", FaultEvidence.ResolveConsumer("FieldOps.Notifications", null));
        Assert.Equal("work-orders", FaultEvidence.ResolveConsumer(null, new Uri("rabbitmq://broker/fieldops-work-orders-events")));
        Assert.Equal("unknown", FaultEvidence.ResolveConsumer("UnrelatedHost", new Uri("rabbitmq://broker/arbitrary-queue")));
    }

    [Fact]
    public void UnknownTerminalAttemptsStayUnknownAndMixedConsumerResultsShowPartialFailure()
    {
        var processed = new DeliveryAttempt { ConsumerService = "reporting", Attempt = 1, Status = "Processed", OccurredAtUtc = Now, ProcessedAtUtc = Now };
        var faulted = new DeliveryAttempt { ConsumerService = "notifications", Attempt = null, Status = "DeadLettered", OccurredAtUtc = Now.AddSeconds(5), ProcessedAtUtc = Now.AddSeconds(10) };
        Assert.Equal("PartiallyFailed", DeliveryObservations.ProcessingStatus([processed, faulted]));
        Assert.Null(DeliveryObservations.RetryCount([processed, faulted]));
        Assert.Equal("DeadLettered", DeliveryObservations.ProcessingStatus([faulted]));
        Assert.Equal("Unknown", DeliveryObservations.ProcessingStatus([]));
        Assert.Equal("EvidenceRecorded", DeliveryObservations.ProcessingStatus([], true));
    }

    [Fact]
    public void LateFaultArrivalDoesNotReplaceARecordedLaterRecoveryAndRetriesRequireObservedAttempts()
    {
        var failed = new DeliveryAttempt { ConsumerService = "reporting", Attempt = 1, Status = "Failed", OccurredAtUtc = Now, ProcessedAtUtc = Now };
        var recovered = new DeliveryAttempt { ConsumerService = "reporting", Attempt = 2, Status = "Processed", OccurredAtUtc = Now.AddSeconds(20), ProcessedAtUtc = Now.AddSeconds(20) };
        var lateFault = new DeliveryAttempt { ConsumerService = "reporting", Attempt = null, Status = "DeadLettered", OccurredAtUtc = Now.AddSeconds(5), ProcessedAtUtc = Now.AddSeconds(30) };
        Assert.Equal(0, DeliveryObservations.RetryCount([failed]));
        Assert.Equal(1, DeliveryObservations.RetryCount([failed, recovered]));
        Assert.Equal("Processed", DeliveryObservations.ProcessingStatus([failed, recovered, lateFault]));
        Assert.Null(DeliveryObservations.RetryCount([failed, recovered, lateFault]));
    }
}
