using FieldOps.Core;
using Npgsql;

namespace FieldOps.ServiceHost;

/// <summary>Read-only queries against the independent analytical warehouse, never operational databases.</summary>
public static class WarehouseQueries
{
    public static async Task<IResult> Summary(IConfiguration config, HttpContext http, DateTimeOffset? from,
        DateTimeOffset? to, string? technicianId, string? serviceCategory, string? priority, CancellationToken ct)
    {
        if (from.HasValue && to.HasValue && from >= to) throw new DomainException(400, "The report end must follow its start.");
        var caller = Caller.From(http.User);
        await using var connection = new NpgsqlConnection(config.GetConnectionString("Warehouse"));
        await connection.OpenAsync(ct);
        // A half-open date interval prevents double counting at adjacent reporting boundaries.
        const string filter = """
            WITH selected AS (
                SELECT o.*, c.category FROM warehouse.fact_work_order o
                LEFT JOIN warehouse.dim_service_category c USING(category_key)
                LEFT JOIN warehouse.dim_technician t USING(technician_key)
                WHERE (@admin OR o.team_id=@team)
                AND (@from::timestamptz IS NULL OR o.created_at_utc>=@from)
                AND (@to::timestamptz IS NULL OR o.created_at_utc<@to)
                AND (@technician::text IS NULL OR t.technician_id=@technician)
                AND (@category::text IS NULL OR c.category=@category)
                AND (@priority::text IS NULL OR o.priority=@priority)
            )
            """;
        NpgsqlCommand Command(string sql)
        {
            var command = new NpgsqlCommand(filter + sql, connection);
            command.Parameters.AddWithValue("admin", caller.IsAdministrator);
            command.Parameters.AddWithValue("team", caller.TeamId);
            command.Parameters.AddWithValue("from", NpgsqlTypes.NpgsqlDbType.TimestampTz, (object?)from ?? DBNull.Value);
            command.Parameters.AddWithValue("to", NpgsqlTypes.NpgsqlDbType.TimestampTz, (object?)to ?? DBNull.Value);
            command.Parameters.AddWithValue("technician", NpgsqlTypes.NpgsqlDbType.Text, (object?)technicianId ?? DBNull.Value);
            command.Parameters.AddWithValue("category", NpgsqlTypes.NpgsqlDbType.Text, (object?)serviceCategory ?? DBNull.Value);
            command.Parameters.AddWithValue("priority", NpgsqlTypes.NpgsqlDbType.Text, (object?)priority ?? DBNull.Value);
            return command;
        }
        long total, completed, active, atRisk, overdue, today;
        double? completionRate, compliance, averageService, averageStage;
        DateTimeOffset? refreshed;
        await using (var command = Command("""
            SELECT count(*) FILTER(WHERE created_at_utc IS NOT NULL),
              count(*) FILTER(WHERE completed_at_utc IS NOT NULL),
              count(*) FILTER(WHERE completed_at_utc IS NULL),
              count(*) FILTER(WHERE completed_at_utc::date=(now() AT TIME ZONE 'UTC')::date),
              avg(extract(epoch FROM(completed_at_utc-created_at_utc))/60.0)::double precision,
              max(last_ingested_at_utc),
              (SELECT count(*) FILTER(WHERE s.completed_at_utc IS NOT NULL AND NOT s.breached)::double precision/nullif(count(*) FILTER(WHERE s.completed_at_utc IS NOT NULL),0) FROM analytics.v_stage_duration s JOIN selected o USING(work_order_id)),
              (SELECT avg(s.effective_minutes)::double precision FROM analytics.v_stage_duration s JOIN selected o USING(work_order_id) WHERE s.completed_at_utc IS NOT NULL),
              (SELECT count(*) FROM warehouse.fact_workflow_stage s JOIN selected o USING(work_order_id) WHERE s.completed_at_utc IS NULL AND s.status='Active' AND s.deadline_utc>now() AND s.deadline_utc<=now()+interval '10 minutes'),
              (SELECT count(*) FROM warehouse.fact_workflow_stage s JOIN selected o USING(work_order_id) WHERE s.completed_at_utc IS NULL AND s.status='Active' AND s.deadline_utc<=now())
            FROM selected
            """))
        await using (var reader = await command.ExecuteReaderAsync(ct))
        {
            await reader.ReadAsync(ct);
            total = reader.GetInt64(0); completed = reader.GetInt64(1); active = reader.GetInt64(2); today = reader.GetInt64(3);
            averageService = reader.IsDBNull(4) ? null : reader.GetDouble(4);
            refreshed = reader.IsDBNull(5) ? null : reader.GetFieldValue<DateTimeOffset>(5);
            compliance = reader.IsDBNull(6) ? null : reader.GetDouble(6);
            averageStage = reader.IsDBNull(7) ? null : reader.GetDouble(7);
            atRisk = reader.GetInt64(8); overdue = reader.GetInt64(9);
            completionRate = total == 0 ? null : (double)completed / total;
        }
        var volume = new List<object>();
        await using (var command = Command("SELECT created_at_utc::date,count(*),count(*) FILTER(WHERE completed_at_utc IS NOT NULL) FROM selected WHERE created_at_utc IS NOT NULL GROUP BY 1 ORDER BY 1"))
        await using (var reader = await command.ExecuteReaderAsync(ct))
            while (await reader.ReadAsync(ct)) volume.Add(new { date = reader.GetFieldValue<DateOnly>(0).ToString("yyyy-MM-dd"), total = reader.GetInt64(1), completed = reader.GetInt64(2) });
        var stages = new List<object>();
        await using (var command = Command("""
            SELECT d.stage_name,avg(s.effective_minutes) FILTER(WHERE s.completed_at_utc IS NOT NULL)::double precision,count(*) FILTER(WHERE s.breached),count(*)
            FROM analytics.v_stage_duration s JOIN selected o USING(work_order_id)
            LEFT JOIN warehouse.dim_workflow_stage d USING(stage_key) GROUP BY d.stage_index,d.stage_name ORDER BY d.stage_index
            """))
        await using (var reader = await command.ExecuteReaderAsync(ct))
            while (await reader.ReadAsync(ct)) stages.Add(new { stage = reader.IsDBNull(0) ? "Awaiting stage metadata" : reader.GetString(0), averageMinutes = reader.IsDBNull(1) ? (double?)null : reader.GetDouble(1), breaches = reader.GetInt64(2), count = reader.GetInt64(3) });
        var categories = new List<object>();
        await using (var command = Command("SELECT coalesce(category,'Unknown'),count(*) FROM selected GROUP BY 1 ORDER BY 1"))
        await using (var reader = await command.ExecuteReaderAsync(ct))
            while (await reader.ReadAsync(ct)) categories.Add(new { category = reader.GetString(0), count = reader.GetInt64(1) });
        var utilization = new List<object>();
        // Without an explicit date range and authoritative working hours, utilization has no defensible denominator.
        var reportingDays = from.HasValue && to.HasValue ? Math.Max(1, (to.Value.UtcDateTime.Date - from.Value.UtcDateTime.Date).TotalDays) : (double?)null;
        await using (var command = Command("""
            SELECT t.technician_id,sum(extract(epoch FROM(b.end_utc-b.start_utc))/60.0)::double precision,
              max(t.working_minutes_per_day),bool_and(t.capacity_authoritative)
            FROM warehouse.fact_booking b JOIN selected o USING(work_order_id) JOIN warehouse.dim_technician t ON t.technician_key=b.technician_key
            WHERE b.status='Confirmed' GROUP BY t.technician_id ORDER BY t.technician_id
            """))
        await using (var reader = await command.ExecuteReaderAsync(ct))
            while (await reader.ReadAsync(ct))
            {
                var booked = reader.IsDBNull(1) ? 0 : reader.GetDouble(1);
                utilization.Add(new { technicianId = reader.GetString(0), bookedMinutes = booked,
                    utilization = reportingDays.HasValue && reader.GetBoolean(3) ? booked / (reader.GetInt32(2) * reportingDays) : (double?)null });
            }
        return Results.Ok(new { totalWorkOrders = total, completedWorkOrders = completed, completionRate, slaComplianceRate = compliance,
            averageServiceMinutes = averageService, averageStageMinutes = averageStage, activeJobs = active, atRiskStages = atRisk,
            overdueStages = overdue, completedToday = today, refreshedAtUtc = refreshed, volumeTrend = volume, stageMetrics = stages,
            categoryBreakdown = categories, technicianUtilization = utilization,
            dataSource = "Independent PostgreSQL dimensional warehouse, incrementally ingested from RabbitMQ; eventually consistent synthetic demonstration data.",
            metricDefinitions = new { completionRate = "Completed orders / orders created in selected half-open UTC interval.",
                slaComplianceRate = "Completed stages with no recorded breach / completed stages. Approved pauses excluded from effective duration.",
                averageServiceMinutes = "Order creation to completion, includes dispatch wait.",
                technicianUtilization = "Confirmed booked minutes / known daily working minutes across calendar dates in explicit range. Time-off and weekend exclusions are not modeled; null without authoritative capacity and an explicit range." } });
    }
}
