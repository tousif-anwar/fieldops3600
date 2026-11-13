using FieldOps.Core;
using Npgsql;

namespace FieldOps.ServiceHost;

/// <summary>Asset registry metrics from the privacy-limited warehouse.</summary>
public static class AssetAnalytics
{
    public static void Map(WebApplication app)
    {
        app.MapGet("/api/reports/assets", async (IConfiguration config, HttpContext http, CancellationToken ct) =>
        {
            var dsn = config.GetConnectionString("Warehouse");
            if (string.IsNullOrWhiteSpace(dsn)) throw new DomainException(503, "Asset analytics requires the analytical warehouse.");
            var caller = Caller.From(http.User);
            await using var connection = new NpgsqlConnection(dsn);
            await connection.OpenAsync(ct);
            await using var snapshot = await connection.BeginTransactionAsync(System.Data.IsolationLevel.RepeatableRead, ct);
            await using (var readOnly = new NpgsqlCommand("SET TRANSACTION READ ONLY", connection, snapshot)) await readOnly.ExecuteNonQueryAsync(ct);
            NpgsqlCommand Command(string sql)
            {
                var command = new NpgsqlCommand(sql, connection, snapshot);
                command.Parameters.AddWithValue("admin", caller.IsAdministrator);
                command.Parameters.AddWithValue("team", caller.TeamId);
                return command;
            }
            long registered, active, inactive, retired, warrantyExpiring, customers, pendingVersions, linkedWorkOrders;
            DateTimeOffset? lastRefresh;
            await using (var command = Command("""
                SELECT count(*),count(*) FILTER(WHERE status='Active'),count(*) FILTER(WHERE status='Inactive'),
                count(*) FILTER(WHERE status='Retired'),
                count(*) FILTER(WHERE status<>'Retired' AND warranty_end_utc IS NOT NULL
                    AND warranty_end_utc BETWEEN now() AND now()+interval '90 days'),
                count(DISTINCT customer_key),
                count(*) FILTER(WHERE source_version=0)
                FROM warehouse.dim_asset WHERE (@admin OR team_id=@team)
                """))
            await using (var reader = await command.ExecuteReaderAsync(ct))
            {
                await reader.ReadAsync(ct);
                registered = reader.GetInt64(0); active = reader.GetInt64(1); inactive = reader.GetInt64(2); retired = reader.GetInt64(3);
                warrantyExpiring = reader.GetInt64(4); customers = reader.GetInt64(5); pendingVersions = reader.GetInt64(6);
            }
            await using (var command = Command("SELECT max(last_ingested_at_utc) FROM warehouse.dim_asset WHERE (@admin OR team_id=@team)"))
            await using (var reader = await command.ExecuteReaderAsync(ct))
            {
                await reader.ReadAsync(ct);
                lastRefresh = reader.IsDBNull(0) ? null : reader.GetFieldValue<DateTimeOffset>(0);
            }
            await using (var command = Command("SELECT count(*) FROM warehouse.fact_work_order WHERE asset_reference IS NOT NULL AND (@admin OR team_id=@team)"))
                linkedWorkOrders = (long)(await command.ExecuteScalarAsync(ct))!;
            var byType = new List<object>();
            await using (var command = Command("""
                SELECT asset_type,count(*) FROM warehouse.dim_asset
                WHERE (@admin OR team_id=@team) GROUP BY asset_type ORDER BY asset_type
                """))
            await using (var reader = await command.ExecuteReaderAsync(ct))
                while (await reader.ReadAsync(ct)) byType.Add(new { assetType = reader.GetString(0), count = reader.GetInt64(1) });
            var byCriticality = new List<object>();
            await using (var command = Command("""
                SELECT criticality,count(*) FROM warehouse.dim_asset
                WHERE (@admin OR team_id=@team) AND status<>'Retired' GROUP BY criticality ORDER BY criticality
                """))
            await using (var reader = await command.ExecuteReaderAsync(ct))
                while (await reader.ReadAsync(ct)) byCriticality.Add(new { criticality = reader.GetString(0), count = reader.GetInt64(1) });
            await snapshot.CommitAsync(ct);
            return Results.Ok(new
            {
                registeredAssets = registered, activeAssets = active, inactiveAssets = inactive, retiredAssets = retired,
                warrantyExpiring90Days = warrantyExpiring, customersWithAssets = customers, pendingAssetVersions = pendingVersions,
                linkedWorkOrders, byType, byCriticality, refreshedAtUtc = lastRefresh,
                definitions = new
                {
                    registry = "Current highest-source-version asset attributes. Serial numbers and QR identities are excluded from the warehouse.",
                    warranty = "Assets whose recorded warranty end falls in the next 90 days; this is not a warranty claim or provider confirmation.",
                    pending = "Assets projected before their owning source event; they await registration evidence.",
                    serviceHistory = "Work orders with an explicit asset reference. Legacy customer-only orders are excluded, so this is not the customer's total order count.",
                    freshness = "Event ingestion is eventually consistent. Source-version history is retained separately."
                }
            });
        }).RequireAuthorization("report");
    }
}
