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
        if (from.HasValue && to.HasValue && to - from > TimeSpan.FromDays(366)) throw new DomainException(400, "Choose a reporting interval of at most 366 days.");
        var caller = Caller.From(http.User);
        await using var connection = new NpgsqlConnection(config.GetConnectionString("Warehouse"));
        await connection.OpenAsync(ct);
        // A half-open date interval prevents double counting at adjacent reporting boundaries.
        const string filter = """
            WITH selected AS (
                SELECT o.*, c.category, os.status AS projected_status FROM warehouse.fact_work_order o
                LEFT JOIN warehouse.dim_service_category c USING(category_key)
                LEFT JOIN warehouse.dim_technician t USING(technician_key)
                LEFT JOIN warehouse.dim_work_order_status os USING(status_key)
                WHERE (@admin OR o.team_id=@team)
                AND o.created_at_utc IS NOT NULL
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
            command.Parameters.AddWithValue("from", NpgsqlTypes.NpgsqlDbType.TimestampTz, (object?)from?.ToUniversalTime() ?? DBNull.Value);
            command.Parameters.AddWithValue("to", NpgsqlTypes.NpgsqlDbType.TimestampTz, (object?)to?.ToUniversalTime() ?? DBNull.Value);
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
              count(*) FILTER(WHERE projected_status='InProgress'),
              count(*) FILTER(WHERE (completed_at_utc AT TIME ZONE 'UTC')::date=(now() AT TIME ZONE 'UTC')::date),
              avg(extract(epoch FROM(completed_at_utc-created_at_utc))/60.0)::double precision,
              max(last_ingested_at_utc),
              (SELECT count(*) FILTER(WHERE s.completed_at_utc IS NOT NULL AND NOT s.breached)::double precision/nullif(count(*) FILTER(WHERE s.completed_at_utc IS NOT NULL),0) FROM analytics.v_stage_duration s JOIN selected o USING(work_order_id)),
              (SELECT avg(s.effective_minutes)::double precision FROM analytics.v_stage_duration s JOIN selected o USING(work_order_id) WHERE s.completed_at_utc IS NOT NULL),
              (SELECT count(*) FROM warehouse.fact_workflow_stage s JOIN selected o USING(work_order_id) WHERE s.completed_at_utc IS NULL AND s.status='Active' AND s.sla_status IN ('Warning','Critical')),
              (SELECT count(*) FROM warehouse.fact_workflow_stage s JOIN selected o USING(work_order_id) WHERE s.completed_at_utc IS NULL AND s.status='Active' AND s.breached)
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
        await using (var command = Command("SELECT (created_at_utc AT TIME ZONE 'UTC')::date,count(*),count(*) FILTER(WHERE completed_at_utc IS NOT NULL) FROM selected GROUP BY 1 ORDER BY 1"))
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
        // Appointment overlap and local-shift capacity use the report interval,
        // independently of the creation-date cohort used for order outcome KPIs.
        await using (var command = Command("""
            SELECT technician_id,booked_minutes,capacity_minutes,utilization
            FROM analytics.technician_utilization(@from,@to,@team,@admin,@technician,@category,@priority)
            """))
        await using (var reader = await command.ExecuteReaderAsync(ct))
            while (await reader.ReadAsync(ct))
            {
                var booked = reader.IsDBNull(1) ? 0 : reader.GetDouble(1);
                utilization.Add(new
                {
                    technicianId = reader.GetString(0),
                    bookedMinutes = booked,
                    capacityMinutes = reader.IsDBNull(2) ? (double?)null : reader.GetDouble(2),
                    utilization = reader.IsDBNull(3) ? (double?)null : reader.GetDouble(3)
                });
            }
        return Results.Ok(new
        {
            totalWorkOrders = total,
            completedWorkOrders = completed,
            completionRate,
            slaComplianceRate = compliance,
            averageServiceMinutes = averageService,
            averageStageMinutes = averageStage,
            activeJobs = active,
            atRiskStages = atRisk,
            overdueStages = overdue,
            completedToday = today,
            refreshedAtUtc = refreshed,
            volumeTrend = volume,
            stageMetrics = stages,
            categoryBreakdown = categories,
            technicianUtilization = utilization,
            dataSource = "Independent PostgreSQL dimensional warehouse, incrementally ingested from RabbitMQ; eventually consistent synthetic demonstration data.",
            metricDefinitions = new
            {
                completionRate = "Completed orders / orders created in selected half-open UTC interval.",
                slaComplianceRate = "Completed stages with no recorded breach / completed stages. Approved pauses excluded from effective duration.",
                averageServiceMinutes = "Order creation to completion, includes dispatch wait.",
                activeJobs = "Orders with recorded InProgress lifecycle state in the selected creation-date cohort.",
                atRiskStages = "Active stages with recorded server Warning or Critical events; eventually consistent.",
                technicianUtilization = "Confirmed appointment minutes overlapping the explicit UTC range / published local working-shift minutes overlapping that range. Includes appointments for orders created earlier. Time-off, weekend exclusions and historical working-hours changes are not modeled; null without valid published timezone/hours and both range boundaries."
            }
        });
    }
}
