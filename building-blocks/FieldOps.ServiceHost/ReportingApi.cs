using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using FieldOps.Core;
using Microsoft.EntityFrameworkCore;

namespace FieldOps.ServiceHost;

public static class ReportingApi
{
    public static void Map(WebApplication app)
    {
        app.MapGet("/api/notifications", async (ServiceDb db, HttpContext http, CancellationToken ct) =>
        {
            var caller = Caller.From(http.User);
            return Results.Ok(await db.Notifications.AsNoTracking().Where(x => caller.IsAdministrator || (x.TeamId == caller.TeamId && (!caller.IsTechnician || (x.TechnicianId == caller.Id && x.Audience == "Technician")))).OrderByDescending(x => x.CreatedAtUtc).Take(200).ToListAsync(ct));
        }).RequireAuthorization("operational");
        app.MapPost("/api/notifications/{id:guid}/acknowledge", async (Guid id, ServiceDb db, HttpContext http, TimeProvider clock, CancellationToken ct) =>
        {
            var notification = await db.Notifications.FindAsync([id], ct) ?? throw new DomainException(404, "Notification not found.");
            var caller = Caller.From(http.User);
            caller.Demand(notification.TeamId, notification.TechnicianId);
            if (caller.IsTechnician && notification.Audience != "Technician") throw new DomainException(404, "Notification not found.");
            if (notification.AcknowledgedAtUtc is null)
            {
                notification.AcknowledgedAtUtc = clock.GetUtcNow(); notification.AcknowledgedBy = caller.Id;
                db.Enqueue(EventFactory.Create(http, "notifications", "NotificationAcknowledged.v1", notification.WorkOrderId, new { notification.Id, notification.TeamId, notification.TechnicianId, notification.AcknowledgedAtUtc }, 0, clock.GetUtcNow()));
                await db.SaveChangesAsync(ct);
            }
            return Results.Ok(notification);
        }).RequireAuthorization("operational");
    }

    public static void MapReporting(WebApplication app)
    {
        var group = app.MapGroup("/api/reports").RequireAuthorization("report");
        group.MapGet("/summary", async (DateTimeOffset? from, DateTimeOffset? to, string? technicianId, string? serviceCategory, string? priority, ServiceDb db, IConfiguration configuration, HttpContext http, TimeProvider clock, CancellationToken ct) =>
        {
            if (!string.IsNullOrWhiteSpace(configuration.GetConnectionString("Warehouse"))) return await WarehouseQueries.Summary(configuration, http, from, to, technicianId, serviceCategory, priority, ct);
            var caller = Caller.From(http.User);
            var ordersQuery = db.WorkOrderFacts.AsNoTracking().Where(x => caller.IsAdministrator || x.TeamId == caller.TeamId);
            if (from.HasValue) ordersQuery = ordersQuery.Where(x => x.CreatedAtUtc >= from.Value);
            if (to.HasValue) ordersQuery = ordersQuery.Where(x => x.CreatedAtUtc < to.Value);
            if (!string.IsNullOrEmpty(technicianId)) ordersQuery = ordersQuery.Where(x => x.TechnicianId == technicianId);
            if (!string.IsNullOrEmpty(serviceCategory)) ordersQuery = ordersQuery.Where(x => x.ServiceCategory == serviceCategory);
            if (!string.IsNullOrEmpty(priority)) ordersQuery = ordersQuery.Where(x => x.Priority == priority);
            var orders = await ordersQuery.ToListAsync(ct);
            var orderIds = orders.Select(x => x.WorkOrderId).ToArray();
            var stages = await db.StageFacts.AsNoTracking().Where(x => orderIds.Contains(x.WorkOrderId)).ToListAsync(ct);
            var now = clock.GetUtcNow();
            var completed = orders.Count(x => x.CompletedAtUtc.HasValue);
            var completedStages = stages.Where(x => x.StartedAtUtc.HasValue && x.CompletedAtUtc.HasValue).ToArray();
            double Minutes(StageFact s) => Math.Max(0, (s.CompletedAtUtc!.Value - s.StartedAtUtc!.Value).TotalMinutes - s.PausedSeconds / 60);
            return Results.Ok(new
            {
                totalWorkOrders = orders.Count, completedWorkOrders = completed,
                completionRate = orders.Count == 0 ? 0 : (double)completed / orders.Count,
                slaComplianceRate = completedStages.Length == 0 ? (double?)null : (double)completedStages.Count(s => !s.Breached) / completedStages.Length,
                averageServiceMinutes = completed == 0 ? (double?)null : orders.Where(x => x.CompletedAtUtc.HasValue).Average(x => (x.CompletedAtUtc!.Value - x.CreatedAtUtc).TotalMinutes),
                averageStageMinutes = completedStages.Length == 0 ? (double?)null : completedStages.Average(Minutes),
                activeJobs = orders.Count(x => x.Status == "InProgress"), atRiskStages = stages.Count(x => x.CompletedAtUtc is null && x.SlaStatus is "Warning" or "Critical"), overdueStages = stages.Count(x => x.CompletedAtUtc is null && x.Breached),
                completedToday = orders.Count(x => x.CompletedAtUtc.HasValue && x.CompletedAtUtc.Value.UtcDateTime.Date == now.UtcDateTime.Date),
                refreshedAtUtc = orders.Count == 0 ? (DateTimeOffset?)null : orders.Max(x => x.UpdatedAtUtc),
                volumeTrend = orders.GroupBy(x => x.CreatedAtUtc.UtcDateTime.Date).OrderBy(x => x.Key).Select(x => new { date = x.Key.ToString("yyyy-MM-dd"), total = x.Count(), completed = x.Count(o => o.CompletedAtUtc.HasValue) }),
                stageMetrics = stages.GroupBy(x => x.Stage).Select(x => new { stage = x.Key, averageMinutes = x.Any(s => s.CompletedAtUtc.HasValue && s.StartedAtUtc.HasValue) ? x.Where(s => s.CompletedAtUtc.HasValue && s.StartedAtUtc.HasValue).Average(Minutes) : (double?)null, breaches = x.Count(s => s.Breached), count = x.Count() }),
                categoryBreakdown = orders.GroupBy(x => x.ServiceCategory).Select(x => new { category = x.Key, count = x.Count() }),
                technicianUtilization = Array.Empty<object>(),
                metricDefinitions = new { completionRate = "Completed work orders divided by work orders created in the selected period.", slaComplianceRate = "Completed stage instances without a recorded breach divided by all completed stage instances; null when no completed stages exist.", averageServiceMinutes = "Wall-clock minutes from work order creation to completion; includes dispatch wait.", technicianUtilization = "Unavailable until booking-duration and working-hours warehouse dimensions are populated." },
                dataSource = "Event-ingested reporting PostgreSQL facts; eventually consistent; synthetic demonstration data only."
            });
        });
        group.MapGet("/export.csv", async (DateTimeOffset? from, DateTimeOffset? to, string? technicianId, string? serviceCategory, string? priority, ServiceDb db, IConfiguration configuration, HttpContext http, CancellationToken ct) =>
        {
            var caller = Caller.From(http.User);
            var orders = !string.IsNullOrWhiteSpace(configuration.GetConnectionString("Warehouse")) ? await WarehouseExport.Load(configuration, http, from, to, technicianId, serviceCategory, priority, ct) : (await db.WorkOrderFacts.AsNoTracking().Where(x => caller.IsAdministrator || x.TeamId == caller.TeamId).OrderBy(x => x.CreatedAtUtc).ToListAsync(ct)).Select(x => new ExportOrder(x.WorkOrderId, x.Number, x.ServiceCategory, x.Priority, x.Status, x.CreatedAtUtc, x.CompletedAtUtc)).ToList();
            var csv = "WorkOrderId,Number,ServiceCategory,Priority,Status,CreatedAtUtc,CompletedAtUtc\r\n" + string.Join("\r\n", orders.Select(x => string.Join(",", new[] { x.WorkOrderId.ToString(), x.Number, x.ServiceCategory, x.Priority, x.Status, x.CreatedAtUtc?.ToString("O") ?? "", x.CompletedAtUtc?.ToString("O") ?? "" }.Select(Csv))));
            return Results.File(Encoding.UTF8.GetBytes(csv), "text/csv", "fieldops-report.csv");
        });
        group.MapGet("/export.pdf", async (DateTimeOffset? from, DateTimeOffset? to, string? technicianId, string? serviceCategory, string? priority, ServiceDb db, IConfiguration configuration, HttpContext http, CancellationToken ct) =>
        {
            var caller = Caller.From(http.User);
            var orders = !string.IsNullOrWhiteSpace(configuration.GetConnectionString("Warehouse")) ? await WarehouseExport.Load(configuration, http, from, to, technicianId, serviceCategory, priority, ct) : (await db.WorkOrderFacts.AsNoTracking().Where(x => caller.IsAdministrator || x.TeamId == caller.TeamId).OrderBy(x => x.CreatedAtUtc).ToListAsync(ct)).Select(x => new ExportOrder(x.WorkOrderId, x.Number, x.ServiceCategory, x.Priority, x.Status, x.CreatedAtUtc, x.CompletedAtUtc)).ToList();
            return Results.File(Pdf.Create(["FieldOps 360 operational report", $"Work orders: {orders.Count}", $"Completed: {orders.Count(x => x.CompletedAtUtc.HasValue)}", .. orders.Select(x => $"{x.Number} | {x.ServiceCategory} | {x.Priority} | {x.Status}")]), "application/pdf", "fieldops-report.pdf");
        });

        var replay = app.MapGroup("/api/replay").RequireAuthorization("replay");
        replay.MapPost("/projections/rebuild", async (ServiceDb db, TimeProvider clock, CancellationToken ct) =>
        {
            var stored = await db.Events.AsNoTracking().Where(x => x.WorkOrderId != Guid.Empty).ToListAsync(ct);
            await using var transaction = await db.Database.BeginTransactionAsync(ct);
            await db.ReplayProjections.ExecuteDeleteAsync(ct);
            foreach (var history in stored.GroupBy(x => x.WorkOrderId))
                db.ReplayProjections.Add(new ReplayProjection { WorkOrderId = history.Key, TeamId = history.First().TeamId, StateJson = Json.Write(ReplayEngine.Reconstruct(history.Select(x => Json.Read<AuditEvent>(x.Body)))), EventCount = history.Count(), UpdatedAtUtc = clock.GetUtcNow() });
            await db.SaveChangesAsync(ct); await transaction.CommitAsync(ct);
            return Results.Ok(new { rebuiltWorkOrders = stored.Select(x => x.WorkOrderId).Distinct().Count(), immutableEventsRetained = stored.Count });
        }).RequireAuthorization("admin");
        replay.MapGet("/{workOrderId:guid}", async (Guid workOrderId, string? eventType, string? service, string? actor, string? correlationId, string? traceId, DateTimeOffset? from, DateTimeOffset? to, ServiceDb db, HttpContext http, CancellationToken ct) =>
        {
            var records = await AuthorizedEvents(workOrderId, db, http, ct);
            var all = records.Select(x => Json.Read<AuditEvent>(x.Body)).ToArray();
            var ordered = ReplayEngine.Order(all);
            var attempts = await db.DeliveryAttempts.AsNoTracking().Where(x => records.Select(e => e.EventId).Contains(x.EventId)).OrderBy(x => x.ReceivedAtUtc).ToListAsync(ct);
            var filtered = ordered.Where(x => (eventType is null || x.Event.EventType == eventType) && (service is null || x.Event.SourceService == service) && (actor is null || x.Event.ActorId == actor) && (correlationId is null || x.Event.CorrelationId == correlationId) && (traceId is null || x.Event.TraceId == traceId) && (!from.HasValue || x.Event.OccurredAtUtc >= from.Value) && (!to.HasValue || x.Event.OccurredAtUtc <= to.Value));
            return Results.Ok(new { workOrderId, events = filtered.Select(item =>
            {
                var e = item.Event; var stored = records.Single(x => x.EventId == e.EventId); var deliveries = attempts.Where(x => x.EventId == e.EventId).ToArray();
                return new { e.EventId, e.EventType, e.EventVersion, e.WorkOrderId, e.WorkflowId, e.StageInstanceId, e.ActorId, e.ActorRole, e.SourceService, e.CorrelationId, e.CausationId, e.TraceId, e.SpanId, e.OccurredAtUtc, e.RecordedAtUtc, stored.ReceivedAtUtc, stored.ProcessedAtUtc, e.SequenceNumber, e.EventPayload, e.SchemaVersion, retryCount = deliveries.Count(x => x.Status == "Failed"), processingStatus = "Processed", processingDelaySeconds = (stored.ReceivedAtUtc - e.OccurredAtUtc).TotalSeconds, item.OrderingUncertain, item.MissingCausation, integrityVerified = stored.IntegrityHash == Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(stored.Body))), attempts = deliveries.Select(x => new { x.Attempt, x.ReceivedAtUtc, x.ProcessedAtUtc, x.Status, x.Error }) };
            }), summary = Summary(all), state = ReplayEngine.Reconstruct(all), orderingPolicy = "Causation, source sequence, authoritative occurrence timestamp. Independent cross-service ordering is marked uncertain.", traceRetention = "Trace identifiers persist with audit events. A trace may have expired from Jaeger independently; inspect trace availability before following a trace link." });
        });
        replay.MapGet("/{workOrderId:guid}/export.csv", async (Guid workOrderId, ServiceDb db, HttpContext http, CancellationToken ct) =>
        {
            var records = await AuthorizedEvents(workOrderId, db, http, ct);
            var rows = ReplayEngine.Order(records.Select(x => Json.Read<AuditEvent>(x.Body)));
            var ids = records.Select(x => x.EventId).ToArray();
            var attempts = await db.DeliveryAttempts.AsNoTracking().Where(x => ids.Contains(x.EventId)).ToListAsync(ct);
            var csv = "EventId,EventType,EventVersion,WorkOrderId,WorkflowId,StageInstanceId,OccurredAtUtc,RecordedAtUtc,ReceivedAtUtc,ProcessedAtUtc,SourceService,ActorId,ActorRole,CorrelationId,CausationId,TraceId,SpanId,SequenceNumber,OrderingUncertain,MissingCausation,RetryCount,ProcessingStatus,Payload\r\n" + string.Join("\r\n", rows.Select(x =>
            {
                var e = x.Event; var stored = records.Single(r => r.EventId == e.EventId);
                return string.Join(",", new[] { e.EventId.ToString(), e.EventType, e.EventVersion.ToString(), e.WorkOrderId.ToString(), e.WorkflowId?.ToString() ?? "", e.StageInstanceId?.ToString() ?? "", e.OccurredAtUtc.ToString("O"), e.RecordedAtUtc.ToString("O"), stored.ReceivedAtUtc.ToString("O"), stored.ProcessedAtUtc.ToString("O"), e.SourceService, e.ActorId, e.ActorRole, e.CorrelationId, e.CausationId?.ToString() ?? "", e.TraceId ?? "", e.SpanId ?? "", e.SequenceNumber.ToString(), x.OrderingUncertain.ToString(), x.MissingCausation.ToString(), attempts.Count(a => a.EventId == e.EventId && a.Status == "Failed").ToString(), "Processed", Json.Write(e.EventPayload) }.Select(Csv));
            }));
            return Results.File(Encoding.UTF8.GetBytes(csv), "text/csv", $"incident-{workOrderId}.csv");
        });
        replay.MapGet("/{workOrderId:guid}/export.pdf", async (Guid workOrderId, ServiceDb db, HttpContext http, CancellationToken ct) =>
        {
            var records = await AuthorizedEvents(workOrderId, db, http, ct);
            var events = records.Select(x => Json.Read<AuditEvent>(x.Body)).ToArray();
            var summary = IncidentSummaries.Create(events);
            var lines = new List<string> { "FieldOps 360 incident investigation", $"Work order: {workOrderId}", $"Incident: {summary.IncidentStartUtc:O} to {summary.IncidentEndUtc:O}", $"Final observed outcome: {summary.Outcome}", "Facts (customer details excluded):" };
            lines.AddRange(summary.Facts);
            foreach (var stage in summary.StageIncidents)
            {
                lines.Add($"Affected stage: {stage.AffectedStage} ({stage.StageInstanceId})");
                lines.Add($"Breach deadline: {stage.SlaDeadlineUtc:O}; effective deadline after pauses: {stage.EffectiveDeadlineUtc:O}");
                lines.Add($"Recorded completion: {stage.ActualCompletionAtUtc:O}; effective delay: {stage.DelayMinutes?.ToString("0.##", CultureInfo.InvariantCulture) ?? "not yet observed"} minutes; {stage.CompletionKind}");
            }
            lines.Add("Supervisor actions:");
            lines.AddRange(summary.SupervisorActions.Select(x => $"{x.OccurredAtUtc:O} | {x.ActorId} ({x.ActorRole}) | {x.EventType} | {x.Reason}"));
            var ids = records.Select(x => x.EventId).ToArray();
            var attempts = await db.DeliveryAttempts.AsNoTracking().Where(x => ids.Contains(x.EventId)).OrderBy(x => x.ReceivedAtUtc).ToListAsync(ct);
            lines.Add("Delivery attempts (separate from business actions):");
            lines.AddRange(attempts.Select(a => $"Event {a.EventId}; attempt {a.Attempt}; {a.Status}; received {a.ReceivedAtUtc:O}; processed {a.ProcessedAtUtc:O}; {a.Error}"));
            lines.Add("Chronological business evidence:");
            lines.AddRange(ReplayEngine.Order(events).Select(x => $"{x.Event.OccurredAtUtc:O} | {x.Event.EventType} | {x.Event.SourceService} | {x.Event.ActorId}; uncertain order={x.OrderingUncertain}"));
            lines.Add("Inferred causes: None. Event evidence alone does not establish a root cause.");
            lines.Add("Trace identifiers:"); lines.AddRange(events.Where(x => x.TraceId is not null).Select(x => x.TraceId!).Distinct());
            return Results.File(Pdf.Create(lines), "application/pdf", $"incident-{workOrderId}.pdf");
        });
    }

    private static async Task<List<StoredEvent>> AuthorizedEvents(Guid order, ServiceDb db, HttpContext http, CancellationToken ct)
    {
        var caller = Caller.From(http.User);
        var records = await db.Events.AsNoTracking().Where(x => x.WorkOrderId == order && (caller.IsAdministrator || x.TeamId == caller.TeamId)).Take(10000).ToListAsync(ct);
        if (records.Count == 0) throw new DomainException(404, "No authorized replay evidence was found. Events may still be arriving.");
        return records;
    }
    private static object Summary(AuditEvent[] events) => IncidentSummaries.Create(events);
    private static string Csv(string value)
    {
        if (value.Length > 0 && "=+-@\t\r".Contains(value[0])) value = "'" + value;
        return "\"" + value.Replace("\"", "\"\"") + "\"";
    }
}

public static class Pdf
{
    public static byte[] Create(IEnumerable<string> lines)
    {
        var pages = lines.SelectMany(Wrap).Chunk(44).ToArray();
        if (pages.Length == 0) pages = [["No recorded facts."]];
        var objects = new List<string> { "<< /Type /Catalog /Pages 2 0 R >>", "", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>" };
        var pageIds = new List<int>();
        foreach (var page in pages)
        {
            var pageId = objects.Count + 1; var streamId = pageId + 1; pageIds.Add(pageId);
            objects.Add($"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents {streamId} 0 R >>");
            var content = "BT /F1 9 Tf 40 750 Td 15 TL\n" + string.Join("\n", page.Select(line => "(" + Escape(line) + ") Tj T*")) + "\nET";
            objects.Add($"<< /Length {Encoding.ASCII.GetByteCount(content)} >>\nstream\n{content}\nendstream");
        }
        objects[1] = $"<< /Type /Pages /Kids [{string.Join(' ', pageIds.Select(id => $"{id} 0 R"))}] /Count {pages.Length} >>";
        var output = new StringBuilder("%PDF-1.4\n"); var offsets = new List<int> { 0 };
        for (var i = 0; i < objects.Count; i++) { offsets.Add(Encoding.ASCII.GetByteCount(output.ToString())); output.Append(CultureInfo.InvariantCulture, $"{i + 1} 0 obj\n{objects[i]}\nendobj\n"); }
        var xref = Encoding.ASCII.GetByteCount(output.ToString()); output.Append(CultureInfo.InvariantCulture, $"xref\n0 {objects.Count + 1}\n0000000000 65535 f \n");
        foreach (var offset in offsets.Skip(1)) output.Append(CultureInfo.InvariantCulture, $"{offset:D10} 00000 n \n");
        output.Append(CultureInfo.InvariantCulture, $"trailer\n<< /Size {objects.Count + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF"); return Encoding.ASCII.GetBytes(output.ToString());
    }
    private static string Escape(string value) => new string(value.Select(c => c is >= ' ' and <= '~' ? c : '?').ToArray()).Replace("\\", "\\\\").Replace("(", "\\(").Replace(")", "\\)");
    private static IEnumerable<string> Wrap(string line)
    {
        if (line.Length == 0) { yield return ""; yield break; }
        for (var offset = 0; offset < line.Length; offset += 105) yield return line.Substring(offset, Math.Min(105, line.Length - offset));
    }
}
