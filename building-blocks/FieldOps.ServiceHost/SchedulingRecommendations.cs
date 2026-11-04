using System.Net.Http.Json;
using FieldOps.Core;
using Microsoft.EntityFrameworkCore;

namespace FieldOps.ServiceHost;

public sealed record DispatchCandidate(string TechnicianId, string TechnicianName, double Score, double BookedMinutes,
    double? EstimatedTravelMinutes, string[] Explanation, string Strategy, string? SolverStatus = null,
    double? RuntimeMilliseconds = null, double? ObjectiveValue = null);
public sealed record MinuteWindow(int StartMinute, int EndMinute);
public sealed record SolverTechnician(string Id, string[] Skills, string[] Certifications, MinuteWindow WorkingHours,
    MinuteWindow[] Availability, MinuteWindow[] ExistingBookings, int WorkloadMinutes, double X = 0, double Y = 0);
public sealed record SolverJob(string Id, string[] RequiredSkills, string[] RequiredCertifications, int EarliestStartMinute,
    int LatestEndMinute, int DurationMinutes, string Priority, double X = 0, double Y = 0);
public sealed record SolverAssignment(string JobId, string TechnicianId, int StartMinute, int EndMinute, string[] Explanation);
public sealed record SolverMetrics(bool Feasible, string[] HardConstraintViolations, double RuntimeMilliseconds);
public sealed record SolverResponse(string Strategy, string SolverStatus, SolverAssignment[] Assignments, SolverMetrics Metrics, double? ObjectiveValue);

public static class SchedulingRecommendations
{
    public static async Task<IResult> Handle(RecommendationRequest request, ServiceDb db, RemoteServices remote,
        IHttpClientFactory clients, IConfiguration configuration, HttpContext http, CancellationToken ct)
    {
        if (request.DurationMinutes is < 15 or > 480) throw new DomainException(400, "Duration must be 15–480 minutes.");
        if (request.Strategy is not ("baseline" or "optimized")) throw new DomainException(400, "Choose baseline or optimized dispatch.");
        if (request.StartUtc.Ticks % TimeSpan.TicksPerMinute != 0) throw new DomainException(400, "Appointment recommendations use whole-minute start times.");
        var start = request.StartUtc.ToUniversalTime(); var end = start.AddMinutes(request.DurationMinutes);
        var day = new DateTimeOffset(start.UtcDateTime.Date, TimeSpan.Zero);
        if (end > day.AddDays(1)) throw new DomainException(400, "A recommendation must fit within one UTC service day. Choose another appointment window.");
        var order = await remote.Get<WorkOrder>("WorkOrders", $"/api/work-orders/{request.WorkOrderId}", http, ct);
        Caller.From(http.User).Demand(order.TeamId);
        if (order.Status is "Completed" or "Cancelled" or "InProgress") throw new DomainException(409, "This work order cannot be scheduled in its current state.");
        var technicians = await remote.Get<OperationsApi.TechnicianDto[]>("Technicians", "/api/technicians", http, ct);
        // Include bookings beginning before the requested day and extending into it.
        var bookings = await db.Bookings.AsNoTracking().Where(x => x.Status == "Confirmed" && x.StartUtc < day.AddDays(1) && x.EndUtc > day).ToListAsync(ct);
        var candidates = new List<DispatchCandidate>(); var solverTechnicians = new List<SolverTechnician>();
        foreach (var dto in technicians.Where(t => t.TeamId == order.TeamId && t.Available))
        {
            var technician = dto.ToEntity();
            var timeOff = await remote.Get<TimeOff[]>("Technicians", $"/api/technicians/{technician.Id}/time-off", http, ct);
            try { BookingRules.Validate(technician, order, start, end, timeOff); } catch (DomainException) { continue; }
            var occupied = bookings.Where(x => x.TechnicianId == technician.Id).ToArray();
            if (occupied.Any(x => BookingRules.Overlaps(x.StartUtc, x.EndUtc, start, end))) continue;
            var booked = occupied.Sum(x => (Min(x.EndUtc, day.AddDays(1)) - Max(x.StartUtc, day)).TotalMinutes);
            var explanation = new[]
            {
                $"Qualified for {order.ServiceCategory} with HVAC Safety certification.",
                "Requested appointment fits the technician's local working hours and approved availability; no confirmed booking overlaps.",
                $"{booked:0.#} minutes booked in this UTC service day; lower existing workload ranks first in the baseline.",
                "Travel unavailable: no geocoded route or depot data is recorded, so travel does not contribute to this recommendation."
            };
            candidates.Add(new(technician.Id, technician.Name, 100 - booked / 6, booked, null, explanation, request.Strategy));
            var hours = WorkingWindow(technician, start, day);
            var availability = Subtract(hours, timeOff.Select(t => Clip(t.StartUtc, t.EndUtc, day)).Where(w => w is not null).Select(w => w!));
            var existing = Merge(occupied.Select(b => Clip(b.StartUtc, b.EndUtc, day)).Where(w => w is not null).Select(w => w!));
            solverTechnicians.Add(new(technician.Id, technician.Skills, technician.Certifications, hours, availability, existing, (int)Math.Ceiling(booked)));
        }
        var ranked = candidates.OrderByDescending(x => x.Score).ThenBy(x => x.TechnicianId, StringComparer.Ordinal).ToArray();
        if (request.Strategy == "baseline" || ranked.Length == 0) return Results.Ok(ranked);
        if (solverTechnicians.Count > 50) throw new DomainException(400, "Limit the team to at most 50 technicians for optimization.");
        var endpoint = configuration["Services:Intelligence"];
        if (string.IsNullOrWhiteSpace(endpoint)) throw new DomainException(503, "The optimizer is not configured. Choose the baseline strategy explicitly to continue.");
        var job = new SolverJob(order.Id.ToString(), [order.ServiceCategory], ["HVAC Safety"], (int)(start - day).TotalMinutes, (int)(end - day).TotalMinutes, request.DurationMinutes, order.Priority);
        SolverResponse? result;
        try
        {
            using var response = await clients.CreateClient("services").PostAsJsonAsync(endpoint.TrimEnd('/') + "/optimize", new { technicians = solverTechnicians, jobs = new[] { job }, strategy = "optimized", timeLimitSeconds = 3 }, Json.Options, ct);
            if (!response.IsSuccessStatusCode) throw new DomainException(503, "The optimizer could not evaluate this appointment. Choose baseline explicitly or retry later.");
            result = await response.Content.ReadFromJsonAsync<SolverResponse>(Json.Options, ct);
        }
        catch (HttpRequestException) { throw new DomainException(503, "The optimizer is unavailable. Choose baseline explicitly or retry later."); }
        catch (TaskCanceledException) when (!ct.IsCancellationRequested) { throw new DomainException(503, "Optimization timed out. Choose baseline explicitly or retry later."); }
        if (result is null || result.Strategy != "optimized" || !result.Metrics.Feasible || result.Metrics.HardConstraintViolations.Length != 0) throw new DomainException(502, "The optimizer returned a result that failed independent feasibility checks.");
        if (result.SolverStatus is not ("OPTIMAL" or "FEASIBLE")) throw new DomainException(503, $"The optimizer did not produce a feasible assignment (status {result.SolverStatus}). Choose baseline or retry.");
        if (result.Assignments.Length != 1) throw new DomainException(502, "The optimizer did not return exactly one assignment for this feasible appointment.");
        var assignment = result.Assignments[0];
        var selected = ranked.SingleOrDefault(x => x.TechnicianId == assignment.TechnicianId);
        ValidateOutput(job, assignment, selected is not null);
        var explanationLines = selected!.Explanation.Concat(new[]
        {
            $"OR-Tools CP-SAT selected this technician using hard qualification/availability constraints and the workload-balance objective ({result.SolverStatus}).",
            $"Measured optimizer runtime: {result.Metrics.RuntimeMilliseconds:0.##} milliseconds. This is one execution, not a performance-improvement claim.",
            "The integer-minute model uses a fixed appointment window and zero travel weight because coordinates are unavailable.",
            "This advice does not reserve capacity. Confirming a booking revalidates current constraints and commits through PostgreSQL conflict protection."
        }).ToArray();
        return Results.Ok(new[] { selected with { Explanation = explanationLines, SolverStatus = result.SolverStatus, RuntimeMilliseconds = result.Metrics.RuntimeMilliseconds, ObjectiveValue = result.ObjectiveValue } });
    }

    public static void ValidateOutput(SolverJob job, SolverAssignment assignment, bool knownTechnician)
    {
        if (!knownTechnician || assignment.JobId != job.Id || assignment.StartMinute != job.EarliestStartMinute || assignment.EndMinute != job.LatestEndMinute || assignment.EndMinute - assignment.StartMinute != job.DurationMinutes)
            throw new DomainException(502, "The optimizer returned an unknown technician, job, or appointment interval.");
    }

    public static MinuteWindow WorkingWindow(Technician technician, DateTimeOffset appointment, DateTimeOffset day)
    {
        var zone = TimeZoneInfo.FindSystemTimeZoneById(technician.TimeZone);
        var localDay = TimeZoneInfo.ConvertTime(appointment, zone).Date;
        var start = new DateTimeOffset(TimeZoneInfo.ConvertTimeToUtc(DateTime.SpecifyKind(localDay.AddHours(technician.WorkingStartHour), DateTimeKind.Unspecified), zone), TimeSpan.Zero);
        var end = new DateTimeOffset(TimeZoneInfo.ConvertTimeToUtc(DateTime.SpecifyKind(localDay.AddHours(technician.WorkingEndHour), DateTimeKind.Unspecified), zone), TimeSpan.Zero);
        return Clip(start, end, day) ?? throw new DomainException(409, "Technician working hours do not overlap this service day.");
    }
    public static MinuteWindow? Clip(DateTimeOffset start, DateTimeOffset end, DateTimeOffset day)
    {
        var first = Math.Clamp((int)Math.Floor((start - day).TotalMinutes), 0, 1440);
        var last = Math.Clamp((int)Math.Ceiling((end - day).TotalMinutes), 0, 1440);
        return last > first ? new(first, last) : null;
    }
    public static MinuteWindow[] Merge(IEnumerable<MinuteWindow> windows)
    {
        var result = new List<MinuteWindow>();
        foreach (var window in windows.OrderBy(w => w.StartMinute))
        {
            if (result.Count > 0 && window.StartMinute <= result[^1].EndMinute) result[^1] = result[^1] with { EndMinute = Math.Max(window.EndMinute, result[^1].EndMinute) };
            else result.Add(window);
        }
        return result.ToArray();
    }
    public static MinuteWindow[] Subtract(MinuteWindow hours, IEnumerable<MinuteWindow> unavailable)
    {
        var windows = new List<MinuteWindow>(); var cursor = hours.StartMinute;
        foreach (var off in Merge(unavailable))
        {
            if (off.EndMinute <= cursor || off.StartMinute >= hours.EndMinute) continue;
            if (off.StartMinute > cursor) windows.Add(new(cursor, Math.Min(off.StartMinute, hours.EndMinute)));
            cursor = Math.Max(cursor, off.EndMinute);
        }
        if (cursor < hours.EndMinute) windows.Add(new(cursor, hours.EndMinute));
        return windows.ToArray();
    }
    private static DateTimeOffset Max(DateTimeOffset a, DateTimeOffset b) => a > b ? a : b;
    private static DateTimeOffset Min(DateTimeOffset a, DateTimeOffset b) => a < b ? a : b;
}
