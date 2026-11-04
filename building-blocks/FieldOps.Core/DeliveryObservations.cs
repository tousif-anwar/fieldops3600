namespace FieldOps.Core;

public static class DeliveryObservations
{
    public static int? RetryCount(IEnumerable<DeliveryAttempt> source)
    {
        var attempts = source.ToArray();
        if (attempts.Any(a => a.Attempt is null)) return null;
        // A failed initial attempt is not itself an observed retry. Count only
        // the maximum numbered retry actually observed, not guessed policy totals.
        return attempts.Length == 0 ? null : Math.Max(0, attempts.Max(a => a.Attempt!.Value) - 1);
    }

    public static string ProcessingStatus(IEnumerable<DeliveryAttempt> source, bool diagnosticEvidence = false)
    {
        var latest = source.GroupBy(a => a.ConsumerService).Select(g => g.OrderBy(a => a.OccurredAtUtc ?? a.ProcessedAtUtc).ThenBy(a => a.ProcessedAtUtc).Last()).ToArray();
        var succeeded = latest.Any(a => a.Status is "Processed" or "Duplicate");
        var deadLettered = latest.Any(a => a.Status == "DeadLettered");
        var failed = latest.Any(a => a.Status == "Failed");
        if (succeeded && (deadLettered || failed)) return "PartiallyFailed";
        if (deadLettered) return "DeadLettered";
        if (failed) return "Failed";
        if (succeeded) return "Processed";
        return diagnosticEvidence ? "EvidenceRecorded" : "Unknown";
    }
}
