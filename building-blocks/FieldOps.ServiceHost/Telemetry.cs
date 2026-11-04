using System.Diagnostics;
using Prometheus;

namespace FieldOps.ServiceHost;

public static class Telemetry
{
    public static readonly ActivitySource Activities = new("FieldOps");
    public static readonly Counter Published = Metrics.CreateCounter("fieldops_outbox_publications_total", "Broker-confirmed outbox publication attempts (at-least-once transport).", new CounterConfiguration { LabelNames = ["service", "outcome"] });
    public static readonly Counter Consumed = Metrics.CreateCounter("fieldops_event_deliveries_total", "Successful or deduplicated event deliveries per consuming service.", new CounterConfiguration { LabelNames = ["service", "outcome"] });
    public static readonly Counter Retries = Metrics.CreateCounter("fieldops_consumer_retry_attempts_total", "Observed broker consumer retry attempts.", new CounterConfiguration { LabelNames = ["service"] });
    public static readonly Histogram Delay = Metrics.CreateHistogram("fieldops_event_processing_delay_seconds", "Elapsed server event occurrence to consumer processing; not a measure of client device time.", new HistogramConfiguration { LabelNames = ["service"], Buckets = [0.1, 0.5, 1, 2, 5, 10, 30, 60, 300, 1800] });
}
