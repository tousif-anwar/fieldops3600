using FieldOps.Core;
using Npgsql;

namespace FieldOps.ServiceHost;

/// <summary>Aggregate customer metrics from the privacy-limited warehouse only.</summary>
public static class CustomerAnalytics
{
    public static void Map(WebApplication app)
    {
        app.MapGet("/api/reports/customers", async (IConfiguration config, HttpContext http, CancellationToken ct) =>
        {
            var dsn = config.GetConnectionString("Warehouse");
            if (string.IsNullOrWhiteSpace(dsn)) throw new DomainException(503, "Customer analytics requires the analytical warehouse.");
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
            long registered, active, archived, contacts, locations, activeLocations, emailConsent, phoneConsent;
            DateTimeOffset? refreshed;
            await using (var command = Command("""
                SELECT count(*),count(*) FILTER(WHERE status='Active'),count(*) FILTER(WHERE status='Archived'),
                coalesce(sum(contact_count),0)::bigint,coalesce(sum(location_count),0)::bigint,
                coalesce(sum(active_location_count),0)::bigint,coalesce(sum(email_consent_count),0)::bigint,
                coalesce(sum(phone_consent_count),0)::bigint,max(last_ingested_at_utc)
                FROM warehouse.dim_customer WHERE source_version>0 AND (@admin OR team_id=@team)
                """))
            await using (var reader = await command.ExecuteReaderAsync(ct))
            {
                await reader.ReadAsync(ct);
                registered = reader.GetInt64(0); active = reader.GetInt64(1); archived = reader.GetInt64(2);
                contacts = reader.GetInt64(3); locations = reader.GetInt64(4); activeLocations = reader.GetInt64(5);
                emailConsent = reader.GetInt64(6); phoneConsent = reader.GetInt64(7);
                refreshed = reader.IsDBNull(8) ? null : reader.GetFieldValue<DateTimeOffset>(8);
            }
            long linkedOrders, unregisteredOrders, pendingVersions;
            await using (var command = Command("""
                SELECT count(*) FILTER(WHERE o.customer_version_key IS NOT NULL),
                  count(*) FILTER(WHERE o.customer_version_key IS NULL),count(*) FILTER(WHERE v.inferred)
                FROM warehouse.fact_work_order o LEFT JOIN warehouse.dim_customer_version v USING(customer_version_key)
                WHERE o.created_at_utc IS NOT NULL AND (@admin OR o.team_id=@team)
                """))
            await using (var reader = await command.ExecuteReaderAsync(ct))
            {
                await reader.ReadAsync(ct); linkedOrders = reader.GetInt64(0); unregisteredOrders = reader.GetInt64(1); pendingVersions = reader.GetInt64(2);
            }
            var breakdown = new List<object>();
            await using (var command = Command("""
                SELECT customer_type,status,count(*) FROM warehouse.dim_customer
                WHERE source_version>0 AND (@admin OR team_id=@team) GROUP BY customer_type,status ORDER BY customer_type,status
                """))
            await using (var reader = await command.ExecuteReaderAsync(ct))
                while (await reader.ReadAsync(ct)) breakdown.Add(new { customerType = reader.GetString(0), status = reader.GetString(1), count = reader.GetInt64(2) });
            await snapshot.CommitAsync(ct);
            return Results.Ok(new { registeredCustomers = registered, activeCustomers = active, archivedCustomers = archived, contactCount = contacts, locationCount = locations, activeLocationCount = activeLocations, emailConsentCount = emailConsent, phoneConsentCount = phoneConsent, linkedWorkOrders = linkedOrders, unregisteredWorkOrders = unregisteredOrders, pendingCustomerVersions = pendingVersions, breakdown, refreshedAtUtc = refreshed,
                definitions = new { registry = "Current highest-source-version customer attributes. Source-version snapshots preserve history; no customer names, addresses or contact values are loaded.", consent = "Counts of contacts with a recorded channel consent, not counts of customers and not proof that a message was sent.", orders = "Persisted work orders with a known creation event. Legacy and explicit unregistered exceptions remain unlinked; no identity is inferred.", freshness = "Event ingestion is eventually consistent. An inferred version waits for its owning customer event." } });
        }).RequireAuthorization("report");
    }
}
