using Npgsql;

namespace FieldOps.ServiceHost;

public sealed record SlaCompliancePoint(string Date, long CompletedStages, long CompliantStages, long BreachedStages, double? ComplianceRate);
public sealed record DurationBin(string Bucket, double LowerMinutes, double? UpperMinutes, long Count);
public sealed record InterventionPoint(string Date, long Interventions, long AffectedWorkOrders, long Supervisors);
public sealed record WarehouseAnalyticsResult(double? EscalationFrequency, double? SchedulingEfficiency,
    IReadOnlyList<SlaCompliancePoint> SlaComplianceTrend, IReadOnlyList<DurationBin> StageDurationDistribution,
    long StageDurationSampleCount, IReadOnlyList<InterventionPoint> SupervisorInterventionTrend);

/// <summary>Additional charts use the exact same authorized creation-date cohort as order KPIs.</summary>
public static class WarehouseAnalytics
{
    public static async Task<WarehouseAnalyticsResult> Read(Func<string, NpgsqlCommand> scopedCommand, CancellationToken ct)
    {
        double? escalation, scheduling;
        await using (var command = scopedCommand("""
            SELECT count(*) FILTER(WHERE EXISTS(SELECT 1 FROM warehouse.fact_sla_breach b WHERE b.work_order_id=o.work_order_id))::double precision/nullif(count(*),0),
              count(*) FILTER(WHERE EXISTS(SELECT 1 FROM warehouse.fact_booking b WHERE b.work_order_id=o.work_order_id AND b.status='Confirmed'))::double precision/nullif(count(*),0)
            FROM selected o
            """))
        await using (var reader = await command.ExecuteReaderAsync(ct))
        {
            await reader.ReadAsync(ct);
            escalation = reader.IsDBNull(0) ? null : reader.GetDouble(0);
            scheduling = reader.IsDBNull(1) ? null : reader.GetDouble(1);
        }
        var compliance = new List<SlaCompliancePoint>();
        await using (var command = scopedCommand("""
            SELECT (s.completed_at_utc AT TIME ZONE 'UTC')::date,count(*),
              count(*) FILTER(WHERE NOT s.breached),count(*) FILTER(WHERE s.breached),
              count(*) FILTER(WHERE NOT s.breached)::double precision/nullif(count(*),0)
            FROM warehouse.fact_workflow_stage s JOIN selected o USING(work_order_id)
            WHERE s.completed_at_utc IS NOT NULL GROUP BY 1 ORDER BY 1
            """))
        await using (var reader = await command.ExecuteReaderAsync(ct))
            while (await reader.ReadAsync(ct)) compliance.Add(new(reader.GetFieldValue<DateOnly>(0).ToString("yyyy-MM-dd"), reader.GetInt64(1), reader.GetInt64(2), reader.GetInt64(3), reader.IsDBNull(4) ? null : reader.GetDouble(4)));

        var duration = new List<DurationBin>();
        await using (var command = scopedCommand("""
            , known_duration AS (
              SELECT (extract(epoch FROM(s.completed_at_utc-s.started_at_utc))-s.paused_seconds)/60.0 AS minutes
              FROM warehouse.fact_workflow_stage s JOIN selected o USING(work_order_id)
              WHERE s.completed_at_utc IS NOT NULL AND s.started_at_utc IS NOT NULL
                AND s.completed_at_utc>=s.started_at_utc
                AND s.paused_seconds<=extract(epoch FROM(s.completed_at_utc-s.started_at_utc))
            ), bins(ordinal,bucket,lower_minutes,upper_minutes) AS (
              VALUES (0,'0–<10',0.0::double precision,10.0::double precision),
                (1,'10–<20',10.0,20.0),(2,'20–<30',20.0,30.0),
                (3,'30–<45',30.0,45.0),(4,'45–<60',45.0,60.0),(5,'60+',60.0,NULL::double precision)
            )
            SELECT b.bucket,b.lower_minutes,b.upper_minutes,count(k.minutes)
            FROM bins b LEFT JOIN known_duration k ON k.minutes>=b.lower_minutes AND (b.upper_minutes IS NULL OR k.minutes<b.upper_minutes)
            GROUP BY b.ordinal,b.bucket,b.lower_minutes,b.upper_minutes ORDER BY b.ordinal
            """))
        await using (var reader = await command.ExecuteReaderAsync(ct))
            while (await reader.ReadAsync(ct)) duration.Add(new(reader.GetString(0), reader.GetDouble(1), reader.IsDBNull(2) ? null : reader.GetDouble(2), reader.GetInt64(3)));

        var intervention = new List<InterventionPoint>();
        await using (var command = scopedCommand("""
            SELECT (i.occurred_at_utc AT TIME ZONE 'UTC')::date,count(*),
              count(DISTINCT i.work_order_id),count(DISTINCT i.supervisor_key)
            FROM warehouse.fact_supervisor_intervention i JOIN selected o USING(work_order_id)
            GROUP BY 1 ORDER BY 1
            """))
        await using (var reader = await command.ExecuteReaderAsync(ct))
            while (await reader.ReadAsync(ct)) intervention.Add(new(reader.GetFieldValue<DateOnly>(0).ToString("yyyy-MM-dd"), reader.GetInt64(1), reader.GetInt64(2), reader.GetInt64(3)));
        return new(escalation, scheduling, compliance, duration, duration.Sum(bin => bin.Count), intervention);
    }
}
