using FieldOps.Core;
using Npgsql;
using NpgsqlTypes;

namespace FieldOps.ServiceHost;

public sealed record ExportOrder(Guid WorkOrderId, string Number, string ServiceCategory, string Priority, string Status, DateTimeOffset? CreatedAtUtc, DateTimeOffset? CompletedAtUtc);

public static class WarehouseExport
{
    public static async Task<List<ExportOrder>> Load(IConfiguration configuration, HttpContext http, DateTimeOffset? from, DateTimeOffset? to, string? technicianId, string? serviceCategory, string? priority, CancellationToken ct)
    {
        if (from.HasValue && to.HasValue && from >= to) throw new DomainException(400, "The report end must follow its start.");
        var caller = Caller.From(http.User);
        await using var connection = new NpgsqlConnection(configuration.GetConnectionString("Warehouse")); await connection.OpenAsync(ct);
        await using var command = new NpgsqlCommand("""
            SELECT o.work_order_id,coalesce(o.number,''),coalesce(c.category,'Unknown'),o.priority,
                CASE WHEN o.completed_at_utc IS NOT NULL THEN 'Completed' ELSE coalesce(s.status,'Created') END,
                o.created_at_utc,o.completed_at_utc
            FROM warehouse.fact_work_order o
            LEFT JOIN warehouse.dim_service_category c USING(category_key)
            LEFT JOIN warehouse.dim_technician t USING(technician_key)
            LEFT JOIN warehouse.dim_work_order_status s USING(status_key)
            WHERE (@admin OR o.team_id=@team)
                AND (@from::timestamptz IS NULL OR o.created_at_utc>=@from)
                AND (@to::timestamptz IS NULL OR o.created_at_utc<@to)
                AND (@technician::text IS NULL OR t.technician_id=@technician)
                AND (@category::text IS NULL OR c.category=@category)
                AND (@priority::text IS NULL OR o.priority=@priority)
            ORDER BY o.created_at_utc NULLS LAST,o.work_order_id LIMIT 10001
            """, connection);
        command.Parameters.AddWithValue("admin", caller.IsAdministrator); command.Parameters.AddWithValue("team", caller.TeamId);
        command.Parameters.AddWithValue("from", NpgsqlDbType.TimestampTz, (object?)from ?? DBNull.Value); command.Parameters.AddWithValue("to", NpgsqlDbType.TimestampTz, (object?)to ?? DBNull.Value);
        command.Parameters.AddWithValue("technician", NpgsqlDbType.Text, (object?)technicianId ?? DBNull.Value); command.Parameters.AddWithValue("category", NpgsqlDbType.Text, (object?)serviceCategory ?? DBNull.Value); command.Parameters.AddWithValue("priority", NpgsqlDbType.Text, (object?)priority ?? DBNull.Value);
        await using var reader = await command.ExecuteReaderAsync(ct); var result = new List<ExportOrder>();
        while (await reader.ReadAsync(ct)) result.Add(new(reader.GetGuid(0), reader.GetString(1), reader.GetString(2), reader.GetString(3), reader.GetString(4), reader.IsDBNull(5) ? null : reader.GetFieldValue<DateTimeOffset>(5), reader.IsDBNull(6) ? null : reader.GetFieldValue<DateTimeOffset>(6)));
        if (result.Count > 10000) throw new DomainException(400, "Narrow the report filters to at most 10,000 work orders before exporting.");
        return result;
    }
}
