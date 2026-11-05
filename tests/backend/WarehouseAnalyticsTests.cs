using System.Security.Claims;
using System.Text.Json;
using FieldOps.Core;
using FieldOps.ServiceHost;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using Npgsql;
using Xunit;

namespace FieldOps.Tests;

[Collection("PostgreSQL")]
[Trait("Category", "Integration")]
public sealed class WarehouseAnalyticsTests(PostgresFixture fixture)
{
    private static readonly DateTimeOffset Day = new(2026, 11, 4, 0, 0, 0, TimeSpan.Zero);

    private async Task<string> Warehouse()
    {
        var cs = await fixture.Database("reporting", false);
        await using var connection = new NpgsqlConnection(cs); await connection.OpenAsync();
        foreach (var path in Directory.GetFiles(Path.Combine(AppContext.BaseDirectory, "warehouse-migrations"), "*.sql").Order(StringComparer.Ordinal))
        {
            await using var migration = new NpgsqlCommand(await File.ReadAllTextAsync(path), connection); await migration.ExecuteNonQueryAsync();
        }
        await Execute(connection, "INSERT INTO warehouse.dim_service_category(category) VALUES('HVAC'),('Controls') ON CONFLICT DO NOTHING; INSERT INTO warehouse.dim_technician(technician_id,team_id,effective_from_utc,is_current) VALUES('tech-01','north','-infinity',true),('tech-02','north','-infinity',true),('tech-south','south','-infinity',true); INSERT INTO warehouse.dim_supervisor(supervisor_id,team_id) VALUES('supervisor-01','north'),('supervisor-02','north'),('supervisor-south','south');");
        return cs;
    }

    private static async Task Execute(NpgsqlConnection connection, string sql, params (string Name, object Value)[] parameters)
    {
        await using var command = new NpgsqlCommand(sql, connection);
        foreach (var (name, value) in parameters) command.Parameters.AddWithValue(name, value);
        await command.ExecuteNonQueryAsync();
    }

    private static async Task<Guid> Order(NpgsqlConnection connection, string team, string technician, string category, string priority, DateTimeOffset? created)
    {
        var id = Guid.NewGuid();
        await using var command = new NpgsqlCommand("""
            INSERT INTO warehouse.fact_work_order(work_order_id,team_id,technician_key,category_key,priority,created_at_utc,completed_at_utc,last_occurrence_utc)
            VALUES(@id,@team,(SELECT technician_key FROM warehouse.dim_technician WHERE technician_id=@technician),
              (SELECT category_key FROM warehouse.dim_service_category WHERE category=@category),@priority,@created,@completed,@completed)
            """, connection);
        command.Parameters.AddWithValue("id", id); command.Parameters.AddWithValue("team", team);
        command.Parameters.AddWithValue("technician", technician); command.Parameters.AddWithValue("category", category); command.Parameters.AddWithValue("priority", priority);
        command.Parameters.AddWithValue("created", NpgsqlTypes.NpgsqlDbType.TimestampTz, (object?)created ?? DBNull.Value);
        command.Parameters.AddWithValue("completed", Day.AddDays(1).AddHours(1));
        await command.ExecuteNonQueryAsync(); return id;
    }

    private static async Task<Guid> Stage(NpgsqlConnection connection, Guid order, int index, DateTimeOffset? start, DateTimeOffset? completed, double paused = 0, bool breached = false)
    {
        var id = Guid.NewGuid();
        await using var command = new NpgsqlCommand("""
            INSERT INTO warehouse.fact_workflow_stage(stage_instance_id,work_order_id,stage_key,started_at_utc,completed_at_utc,paused_seconds,breached,status,sla_status)
            VALUES(@id,@order,(SELECT stage_key FROM warehouse.dim_workflow_stage WHERE stage_index=@index),@start,@completed,@paused,@breached,@status,@sla)
            """, connection);
        command.Parameters.AddWithValue("id", id); command.Parameters.AddWithValue("order", order); command.Parameters.AddWithValue("index", index);
        command.Parameters.AddWithValue("start", NpgsqlTypes.NpgsqlDbType.TimestampTz, (object?)start ?? DBNull.Value);
        command.Parameters.AddWithValue("completed", NpgsqlTypes.NpgsqlDbType.TimestampTz, (object?)completed ?? DBNull.Value);
        command.Parameters.AddWithValue("paused", paused); command.Parameters.AddWithValue("breached", breached); command.Parameters.AddWithValue("status", completed.HasValue ? "Completed" : "Active"); command.Parameters.AddWithValue("sla", breached ? "Breached" : "OnTime");
        await command.ExecuteNonQueryAsync(); return id;
    }

    private static async Task EventFact(NpgsqlConnection connection, Guid order, Guid stage, string kind, DateTimeOffset occurred, string? supervisor = null)
    {
        var eventId = Guid.NewGuid();
        await Execute(connection, "INSERT INTO warehouse.ingestion_ledger(event_id,event_type,source_service,occurred_at_utc,payload_hash,schema_version) VALUES(@id,@kind,'workflows',@occurred,repeat('a',64),1)", ("id", eventId), ("kind", kind), ("occurred", occurred));
        if (supervisor is null) await Execute(connection, "INSERT INTO warehouse.fact_sla_breach(event_id,work_order_id,stage_instance_id,occurred_at_utc) VALUES(@id,@order,@stage,@occurred)", ("id", eventId), ("order", order), ("stage", stage), ("occurred", occurred));
        else await Execute(connection, "INSERT INTO warehouse.fact_supervisor_intervention(event_id,work_order_id,supervisor_key,intervention_type,occurred_at_utc) VALUES(@id,@order,(SELECT supervisor_key FROM warehouse.dim_supervisor WHERE supervisor_id=@supervisor),@kind,@occurred)", ("id", eventId), ("order", order), ("supervisor", supervisor), ("kind", kind), ("occurred", occurred));
    }

    private static async Task<JsonElement> Summary(string cs, string? technician = null, string? category = null, string? priority = null)
    {
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["ConnectionStrings:Warehouse"] = cs }).Build();
        var http = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity([new("sub", "analyst-01"), new("team_id", "north"), new(ClaimTypes.Role, "Analyst")], "test")) };
        var result = await WarehouseQueries.Summary(configuration, http, Day, Day.AddDays(1), technician, category, priority, CancellationToken.None);
        return JsonSerializer.SerializeToElement(((IValueHttpResult)result).Value, Json.Options);
    }

    [Fact]
    public async Task TrendsRatiosAndHistogramUseOneScopedCreationCohortAndObservedUtcDates()
    {
        var cs = await Warehouse();
        await using (var db = new NpgsqlConnection(cs))
        {
            await db.OpenAsync();
            var first = await Order(db, "north", "tech-01", "HVAC", "High", Day.AddHours(12));
            var second = await Order(db, "north", "tech-01", "HVAC", "High", Day.AddHours(14));
            var breached = await Stage(db, first, 1, Day.AddHours(22).AddMinutes(20), Day.AddHours(23).AddMinutes(10), 300, true); //45 effective minutes
            var active = await Stage(db, first, 2, Day.AddHours(22), null, 0, true);
            await Stage(db, first, 0, Day.AddHours(23).AddMinutes(50), Day.AddDays(1).AddMinutes(10), 600); //10 effective minutes
            await Stage(db, second, 0, null, Day.AddDays(1).AddMinutes(20)); //unknown, never zero-filled
            await Stage(db, second, 3, Day.AddHours(23), Day.AddDays(1).AddMinutes(30), 6000); //invalid pause exceeds90 elapsed minutes
            await Stage(db, second, 4, Day.AddDays(1).AddMinutes(40), Day.AddDays(1).AddMinutes(40)); //true observed zero
            await EventFact(db, first, breached, "StageSLABreached.v1", Day.AddHours(23));
            await EventFact(db, first, active, "StageSLABreached.v1", Day.AddHours(23).AddMinutes(1)); //same order must not double count escalation ratio
            await EventFact(db, first, breached, "StagePaused.v1", Day.AddHours(23).AddMinutes(55), "supervisor-01");
            await EventFact(db, first, breached, "StageResumed.v1", Day.AddDays(1).AddMinutes(5), "supervisor-01");
            await EventFact(db, second, breached, "RecommendationDecisionRecorded.v1", Day.AddDays(1).AddMinutes(10), "supervisor-02");
            await Execute(db, "INSERT INTO warehouse.fact_booking(booking_id,work_order_id,start_utc,end_utc,status) VALUES(@id,@order,@start,@end,'Confirmed'),(@other,@order,@start,@end,'Confirmed')", ("id", Guid.NewGuid()), ("other", Guid.NewGuid()), ("order", first), ("start", Day.AddHours(13)), ("end", Day.AddHours(14)));
            foreach (var excluded in new[]
            {
                await Order(db, "south", "tech-south", "HVAC", "High", Day.AddHours(12)),
                await Order(db, "north", "tech-02", "Controls", "Low", Day.AddHours(12)),
                await Order(db, "north", "tech-01", "HVAC", "High", null),
                await Order(db, "north", "tech-01", "HVAC", "High", Day.AddDays(1))
            })
            {
                var stage = await Stage(db, excluded, 0, Day.AddHours(12), Day.AddHours(13), 0, true);
                await EventFact(db, excluded, stage, "StageSLABreached.v1", Day.AddHours(13));
                await EventFact(db, excluded, stage, "StagePaused.v1", Day.AddHours(13), "supervisor-south");
            }
        }
        var report = await Summary(cs, "tech-01", "HVAC", "High");
        Assert.Equal(2, report.GetProperty("totalWorkOrders").GetInt64());
        Assert.Equal(0.5, report.GetProperty("escalationFrequency").GetDouble());
        Assert.Equal(0.5, report.GetProperty("schedulingEfficiency").GetDouble());
        Assert.Equal(3, report.GetProperty("stageDurationSampleCount").GetInt64());
        Assert.Equal(55d / 3, report.GetProperty("averageStageMinutes").GetDouble(), 8);
        Assert.Equal(new long[] { 1, 1, 0, 0, 1, 0 }, report.GetProperty("stageDurationDistribution").EnumerateArray().Select(x => x.GetProperty("count").GetInt64()));
        var trend = report.GetProperty("slaComplianceTrend").EnumerateArray().ToArray();
        Assert.Equal(new[] { "2026-11-04", "2026-11-05" }, trend.Select(x => x.GetProperty("date").GetString()));
        Assert.Equal(new long[] { 1, 4 }, trend.Select(x => x.GetProperty("completedStages").GetInt64()));
        Assert.Equal(new double[] { 0, 1 }, trend.Select(x => x.GetProperty("complianceRate").GetDouble()));
        var intervention = report.GetProperty("supervisorInterventionTrend").EnumerateArray().ToArray();
        Assert.Equal(new long[] { 1, 2 }, intervention.Select(x => x.GetProperty("interventions").GetInt64()));
        Assert.Equal(new long[] { 1, 2 }, intervention.Select(x => x.GetProperty("affectedWorkOrders").GetInt64()));
        Assert.Equal(new long[] { 1, 2 }, intervention.Select(x => x.GetProperty("supervisors").GetInt64()));
    }

    [Fact]
    public async Task EmptyCohortReturnsNullRatesAndNoInventedObservations()
    {
        var cs = await Warehouse();
        var report = await Summary(cs, priority: "Critical");
        Assert.Equal(0, report.GetProperty("totalWorkOrders").GetInt64());
        foreach (var field in new[] { "escalationFrequency", "schedulingEfficiency", "slaComplianceRate", "averageStageMinutes" }) Assert.Equal(JsonValueKind.Null, report.GetProperty(field).ValueKind);
        Assert.Empty(report.GetProperty("slaComplianceTrend").EnumerateArray());
        Assert.Empty(report.GetProperty("supervisorInterventionTrend").EnumerateArray());
        Assert.Equal(0, report.GetProperty("stageDurationSampleCount").GetInt64());
        Assert.All(report.GetProperty("stageDurationDistribution").EnumerateArray(), bin => Assert.Equal(0, bin.GetProperty("count").GetInt64()));
    }
}
