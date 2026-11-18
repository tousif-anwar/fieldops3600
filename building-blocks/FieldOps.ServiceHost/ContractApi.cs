using System.Security.Cryptography;
using System.Text;
using FieldOps.Core;
using Microsoft.EntityFrameworkCore;

namespace FieldOps.ServiceHost;

public sealed record ContractLineInput(string ServiceType, bool LaborCovered, bool PartsCovered, int IncludedVisits, decimal PartsAllowance,
    int? ResponseTargetMinutes = null, int? CompletionTargetMinutes = null);
public sealed record CoveredAssetInput(Guid AssetId, DateOnly EffectiveFrom, DateOnly? EffectiveTo);
public sealed record ContractExclusionInput(string? ServiceType, Guid? AssetId, string Reason);
public sealed record CreateContract(Guid OperationId, Guid CustomerId, DateTimeOffset EffectiveFromUtc, DateTimeOffset? ExpiresAtUtc,
    string TimeZoneId, bool CoversAllAssets, ContractLineInput[] Lines, CoveredAssetInput[]? CoveredAssets, ContractExclusionInput[]? Exclusions,
    string? SlaClockOrigin = null);
public sealed record CreateMaintenancePlan(Guid OperationId, Guid ContractId, Guid ContractLineId, Guid? AssetId, string Frequency,
    DateOnly StartDate, DateOnly? EndsOn, Guid? ServiceLocationId = null);
public sealed record GenerateContractVisits(Guid OperationId, Guid ContractId, DateOnly ThroughDate);
public sealed record RecordContractUsage(Guid OperationId, Guid ContractId, Guid ContractLineId, Guid WorkOrderId, int VisitsUsed = 1,
    decimal PartsCost = 0);
public sealed record ChangeContractStatus(Guid OperationId, Guid ContractId, int ExpectedVersion, string Status, string Reason);

public sealed record ContractLineView(Guid Id, string ServiceType, bool LaborCovered, bool PartsCovered, int IncludedVisits,
    decimal PartsAllowance, int VisitsUsed, decimal PartsUsed, int? VisitsRemaining, bool Active,
    int CommittedVisits = 0, int? VisitsAvailable = null, int? ResponseTargetMinutes = null, int? CompletionTargetMinutes = null);
public sealed record CoveredAssetView(Guid AssetId, DateOnly EffectiveFrom, DateOnly? EffectiveTo, bool Active);
public sealed record MaintenancePlanView(Guid Id, Guid ContractLineId, Guid? AssetId, string Frequency, DateOnly NextDueDate,
    DateOnly? EndsOn, bool Active, int Version, Guid? ServiceLocationId = null);
public sealed record MaintenanceVisitView(Guid Id, Guid ContractLineId, Guid? AssetId, Guid? WorkOrderId, DateOnly DueDate,
    string Status, DateTimeOffset GeneratedAtUtc, Guid? ServiceLocationId = null,
    DateTimeOffset? CompletedAtUtc = null, bool CompletionReviewRequired = false, string? CompletionReviewReason = null);
public sealed record ContractUsageView(Guid Id, Guid ContractLineId, Guid WorkOrderId, int VisitsUsed, decimal PartsCost,
    DateTimeOffset OccurredAtUtc);
public sealed record ContractView(Guid Id, string TeamId, Guid CustomerId, string Status, DateTimeOffset EffectiveFromUtc,
    DateTimeOffset? ExpiresAtUtc, string TimeZoneId, bool CoversAllAssets, int Version, DateTimeOffset CreatedAtUtc,
    DateTimeOffset UpdatedAtUtc, ContractLineView[] Lines, CoveredAssetView[] CoveredAssets, MaintenancePlanView[] Plans,
    MaintenanceVisitView[] Visits, ContractUsageView[] Usage, string? SlaClockOrigin = null);
public sealed record ContractSummary(Guid Id, Guid CustomerId, string Status, DateTimeOffset EffectiveFromUtc, DateTimeOffset? ExpiresAtUtc,
    int Version, int LineCount, int VisitCount, DateOnly? NextVisit);
public sealed record PortalContractView(Guid Id, string Status, DateTimeOffset EffectiveFromUtc, DateTimeOffset? ExpiresAtUtc,
    ContractLineView[] Lines, MaintenanceVisitView[] UpcomingVisits, string TimeZoneId, bool CoversAllAssets,
    CoveredAssetView[] CoveredAssets, string? SlaClockOrigin = null);

public static class ContractApi
{
    public static void Map(WebApplication app)
    {
        var office = app.MapGroup("/api/contracts").RequireAuthorization("dispatch");
        office.MapGet("", List);
        office.MapGet("/{id:guid}", async (Guid id, ServiceDb db, HttpContext http, CancellationToken ct) =>
            Results.Ok(View(await Find(id, db, http, true, ct))));
        office.MapGet("/{id:guid}/history", async (Guid id, ServiceDb db, HttpContext http, CancellationToken ct) =>
        {
            _ = await Find(id, db, http, false, ct);
            return Results.Ok(await db.ContractEvents.AsNoTracking().Where(x => x.ContractId == id)
                .OrderByDescending(x => x.Version).Take(500).ToListAsync(ct));
        });
        office.MapPost("", Create).RequireAuthorization("supervise");
        office.MapPost("/{id:guid}/plans", CreatePlan).RequireAuthorization("supervise");
        office.MapPost("/{id:guid}/visits/generate", Generate).RequireAuthorization("supervise");
        office.MapPost("/{id:guid}/usage", RecordUsage).RequireAuthorization("supervise");
        office.MapPost("/{id:guid}/status", ChangeStatus).RequireAuthorization("supervise");
        // The work-order owner evaluates coverage with an operational token; dispatchers can use the same route.
        app.MapGet("/api/contracts/entitlements", Evaluate).RequireAuthorization("operational");

        app.MapGet("/api/customer-portal/agreements", Portal).RequireAuthorization("customer");
    }

    public static async Task<IResult> Portal(ServiceDb db, HttpContext http, TimeProvider clock, CancellationToken ct)
    {
        var scope = CustomerScope.From(http.User);
        var now = clock.GetUtcNow();
        var contracts = await ContractsQuery(db, scope.CustomerId, scope.TeamId)
            .Where(x => x.Status == "Active" || x.Status == "Suspended")
            .OrderBy(x => x.ExpiresAtUtc).ThenBy(x => x.Id)
            .Include(x => x.Lines).Include(x => x.Visits).Include(x => x.Usage).Include(x => x.CoveredAssets)
            .AsSplitQuery().Take(50).ToListAsync(ct);
        http.Response.Headers.CacheControl = "no-store";
        return Results.Ok(contracts.Select(contract =>
        {
            var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(now, TimeZoneInfo.FindSystemTimeZoneById(contract.TimeZoneId)).DateTime);
            return new PortalContractView(contract.Id,
                contract.ExpiresAtUtc <= now ? "Expired" : contract.Status,
                contract.EffectiveFromUtc, contract.ExpiresAtUtc, LineViews(contract),
                contract.Visits.Where(x => x.DueDate >= today && (x.Status is "Pending" or "Dispatching" or "Created" or "Scheduled"))
                    .OrderBy(x => x.DueDate).Take(50).Select(VisitView).ToArray(), contract.TimeZoneId, contract.CoversAllAssets,
                contract.CoveredAssets.OrderBy(x => x.EffectiveFrom).Select(x => new CoveredAssetView(x.AssetId, x.EffectiveFrom, x.EffectiveTo, x.Active)).ToArray(), contract.SlaClockOrigin);
        }).ToArray());
    }

    public static async Task<IResult> Create(CreateContract request, ServiceDb db, RemoteServices remote, HttpContext http,
        TimeProvider clock, CancellationToken ct)
    {
        var caller = Caller.From(http.User);
        var customer = await db.Customers.AsNoTracking().SingleOrDefaultAsync(x => x.Id == request.CustomerId, ct)
            ?? throw new DomainException(404, "Customer not found.");
        caller.Demand(customer.TeamId);
        if (customer.Status != "Active") throw new DomainException(409, "Contracts require an active customer.");
        if (request.Lines is null || request.Lines.Length is 0 or > 50) throw new DomainException(400, "A contract needs at least one coverage line.");
        var assets = request.CoveredAssets ?? [];
        foreach (var covered in assets)
        {
            var reference = await remote.Get<AssetReferenceView>("Assets", $"/api/assets/{covered.AssetId:D}/reference", http, ct);
            if (reference.CustomerId != customer.Id || reference.TeamId != customer.TeamId || reference.Status == "Retired")
                throw new DomainException(404, "Covered equipment was not found for this customer.");
        }
        return await Commit(request.OperationId, request, "contract-create", customer.TeamId, db, http, clock, async now =>
        {
            var contract = new MaintenanceContract
            {
                TeamId = customer.TeamId,
                CustomerId = customer.Id,
                EffectiveFromUtc = request.EffectiveFromUtc,
                ExpiresAtUtc = request.ExpiresAtUtc,
                TimeZoneId = request.TimeZoneId,
                SlaClockOrigin = request.SlaClockOrigin,
                CoversAllAssets = request.CoversAllAssets,
                CreatedAtUtc = now,
                UpdatedAtUtc = now
            };
            contract.Lines = request.Lines.Select(line => new ContractLine
            {
                ContractId = contract.Id,
                ServiceType = line.ServiceType?.Trim() ?? "",
                LaborCovered = line.LaborCovered,
                PartsCovered = line.PartsCovered,
                IncludedVisits = line.IncludedVisits,
                PartsAllowance = line.PartsAllowance,
                ResponseTargetMinutes = line.ResponseTargetMinutes,
                CompletionTargetMinutes = line.CompletionTargetMinutes
            }).ToList();
            contract.CoveredAssets = assets.Select(asset => new CoveredAsset
            {
                ContractId = contract.Id,
                AssetId = asset.AssetId,
                EffectiveFrom = asset.EffectiveFrom,
                EffectiveTo = asset.EffectiveTo
            }).ToList();
            contract.Exclusions = (request.Exclusions ?? []).Select(exclusion => new ContractExclusion
            {
                ContractId = contract.Id,
                ServiceType = exclusion.ServiceType?.Trim(),
                AssetId = exclusion.AssetId,
                Reason = exclusion.Reason.Trim()
            }).ToList();
            ContractRules.Validate(contract, now);
            db.Contracts.Add(contract);
            AddEvent(db, http, contract, "MaintenanceContractCreated.v1", now,
                new { contract.Id, contract.CustomerId, contract.TeamId, contract.EffectiveFromUtc, contract.ExpiresAtUtc });
            return View(contract);
        }, ct);
    }

    public static async Task<IResult> CreatePlan(CreateMaintenancePlan request, ServiceDb db, RemoteServices remote,
        HttpContext http, TimeProvider clock, CancellationToken ct)
    {
        var contract = await Find(request.ContractId, db, http, true, ct);
        var serviceLocationId = request.ServiceLocationId;
        if (request.AssetId is { } assetId)
        {
            var reference = await remote.Get<AssetReferenceView>("Assets", $"/api/assets/{assetId:D}/reference", http, ct);
            if (reference.CustomerId != contract.CustomerId || reference.TeamId != contract.TeamId || reference.Status == "Retired")
                throw new DomainException(404, "The selected equipment was not found for this customer.");
            serviceLocationId ??= reference.ServiceLocationId;
            if (serviceLocationId != reference.ServiceLocationId)
                throw new DomainException(400, "The maintenance plan must use the equipment's current service location.");
        }
        if (serviceLocationId.HasValue && !await db.ServiceLocations.AnyAsync(x => x.Id == serviceLocationId && x.CustomerId == contract.CustomerId && x.Status == "Active", ct))
            throw new DomainException(404, "Active customer service location not found.");
        return await Commit(request.OperationId, request, "contract-plan-create", contract.TeamId, db, http, clock, now =>
        {
            var line = contract.Lines.SingleOrDefault(x => x.Id == request.ContractLineId && x.Active)
                ?? throw new DomainException(404, "Coverage line not found.");
            if (request.AssetId is null && !contract.CoversAllAssets)
                throw new DomainException(400, "Select covered equipment for this plan.");
            if (request.AssetId is not null && !contract.CoversAllAssets &&
                contract.CoveredAssets.All(x => x.AssetId != request.AssetId || !x.Active))
                throw new DomainException(404, "The selected equipment is not covered.");
            ContractRules.IntervalMonths(request.Frequency);
            var plan = new MaintenancePlan
            {
                ContractId = contract.Id,
                ContractLineId = line.Id,
                AssetId = request.AssetId,
                ServiceLocationId = serviceLocationId,
                Frequency = request.Frequency,
                IntervalMonths = ContractRules.IntervalMonths(request.Frequency),
                NextDueDate = request.StartDate,
                AnchorDay = request.StartDate.Day,
                EndsOn = request.EndsOn
            };
            // Explicit state avoids treating a client-generated key added through a tracked
            // navigation as an existing row during change detection. Do not call DbSet.Add
            // here: relationship fixup would add the plan to the collection a second time.
            contract.Plans.Add(plan);
            db.Entry(plan).State = EntityState.Added;
            contract.UpdatedAtUtc = now;
            contract.Version++;
            ContractRules.Validate(contract, now);
            AddEvent(db, http, contract, "MaintenancePlanCreated.v1", now,
                new { contractId = contract.Id, planId = plan.Id, plan.ContractLineId, plan.AssetId, plan.Frequency, plan.NextDueDate });
            return Task.FromResult<object>(View(contract));
        }, ct);
    }

    public static async Task<IResult> Generate(Guid id, GenerateContractVisits request, ServiceDb db, HttpContext http,
        TimeProvider clock, CancellationToken ct)
    {
        if (id != request.ContractId) throw new DomainException(400, "Contract identifier does not match the route.");
        var contract = await Find(id, db, http, true, ct);
        return await Commit(request.OperationId, request, "contract-visits-generate:" + id, contract.TeamId, db, http, clock, now =>
        {
            var existing = contract.Visits.Select(x => x.Id).ToHashSet();
            var generated = ContractRules.GenerateVisits(contract, request.ThroughDate, now);
            foreach (var visit in contract.Visits.Where(x => !existing.Contains(x.Id)))
                db.Entry(visit).State = EntityState.Added;
            AddEvent(db, http, contract, "MaintenanceVisitsGenerated.v1", now,
                new { contract.Id, generated, request.ThroughDate });
            return Task.FromResult<object>(new { contractId = contract.Id, generated, throughDate = request.ThroughDate, visits = contract.Visits.OrderBy(x => x.DueDate).Select(VisitView).ToArray() });
        }, ct);
    }

    public static async Task<IResult> RecordUsage(Guid id, RecordContractUsage request, ServiceDb db, RemoteServices remote,
        HttpContext http, TimeProvider clock, CancellationToken ct)
    {
        if (id != request.ContractId) throw new DomainException(400, "Contract identifier does not match the route.");
        var contract = await Find(id, db, http, true, ct);
        var order = await remote.Get<WorkOrder>("WorkOrders", $"/api/work-orders/{request.WorkOrderId:D}", http, ct);
        Caller.From(http.User).Demand(order.TeamId, order.TechnicianId);
        if (order.CustomerId != contract.CustomerId) throw new DomainException(404, "The work order belongs to another customer.");
        if (order.Status != "Completed" || order.CompletedAtUtc is null)
            throw new DomainException(409, "Contract usage requires completed service confirmed by the work-order owner.");
        if (order.MaintenanceVisitId.HasValue)
            throw new DomainException(409, "Maintenance visit usage is recorded automatically from completion events.");
        if (order.ContractId != contract.Id || order.ContractLineId != request.ContractLineId || order.TeamId != contract.TeamId)
            throw new DomainException(409, "Usage must match the work order's evaluated agreement and coverage line.");
        if (request.VisitsUsed != 1 || request.PartsCost != 0)
            throw new DomainException(400, "Record one completed visit with zero parts cost; verified material costing is recorded separately.");
        return await Commit(request.OperationId, request, "contract-usage:" + id, contract.TeamId, db, http, clock, now =>
        {
            var decision = MaintenanceVisitConsumer.EvaluateCompletion(contract, order.AssetId, order.ServiceCategory, order.CompletedAtUtc.Value);
            if (!decision.Covered || decision.ContractLineId != request.ContractLineId)
                throw new DomainException(409, "Completed service does not match eligible contract coverage: " + decision.Reason);
            var usage = ContractRules.RecordUsage(contract, request.ContractLineId, order.Id, request.VisitsUsed,
                request.PartsCost, order.CompletedAtUtc.Value);
            contract.UpdatedAtUtc = now;
            // Usage is append-only and has a client-generated key: a navigation add can
            // otherwise be detected as an update, which the runtime role must not perform.
            db.Entry(usage).State = EntityState.Added;
            AddEvent(db, http, contract, "ContractUsageRecorded.v1", now,
                new { contractId = contract.Id, usageId = usage.Id, usage.ContractLineId, usage.WorkOrderId, usage.VisitsUsed, usage.PartsCost });
            return Task.FromResult<object>(View(contract));
        }, ct);
    }

    public static async Task<IResult> ChangeStatus(Guid id, ChangeContractStatus request, ServiceDb db, HttpContext http,
        TimeProvider clock, CancellationToken ct)
    {
        if (id != request.ContractId) throw new DomainException(400, "Contract identifier does not match the route.");
        var contract = await Find(id, db, http, true, ct);
        return await Commit(request.OperationId, request, "contract-status:" + id, contract.TeamId, db, http, clock, now =>
        {
            if (contract.Version != request.ExpectedVersion) throw new DomainException(409, "The contract changed; refresh and retry.");
            ContractRules.Text(request.Reason, 3, 500, "Status reason");
            switch (request.Status)
            {
                case "Active": ContractRules.Activate(contract, now); break;
                case "Suspended": ContractRules.Suspend(contract, now); break;
                case "Cancelled": ContractRules.Cancel(contract, now); break;
                default: throw new DomainException(400, "Only activation, suspension, or cancellation may be requested here.");
            }
            AddEvent(db, http, contract, "MaintenanceContractStatusChanged.v1", now,
                new { contract.Id, contract.Status, request.Reason });
            return Task.FromResult<object>(View(contract));
        }, ct);
    }

    public static async Task<IResult> Evaluate(ServiceDb db, HttpContext http, CancellationToken ct, Guid customerId,
        string serviceType, Guid? assetId = null, Guid? contractId = null, Guid? allocationVisitId = null)
    {
        var caller = Caller.From(http.User);
        var customer = await db.Customers.AsNoTracking().SingleOrDefaultAsync(x => x.Id == customerId, ct)
            ?? throw new DomainException(404, "Customer not found.");
        caller.Demand(customer.TeamId);
        if (string.IsNullOrWhiteSpace(serviceType) || serviceType.Length > 80) throw new DomainException(400, "A service type is required.");
        if (allocationVisitId.HasValue && !contractId.HasValue)
            throw new DomainException(400, "An explicit agreement is required when validating an allocated visit.");
        var now = DateTimeOffset.UtcNow;
        var contracts = await ContractsQuery(db, customerId, customer.TeamId)
            .Where(x => x.Status == "Active" && (!contractId.HasValue || x.Id == contractId)).Include(x => x.Lines).Include(x => x.CoveredAssets)
            .Include(x => x.Exclusions).Include(x => x.Usage).Include(x => x.Visits).AsSplitQuery().ToListAsync(ct);
        var decisions = contracts.Select(contract => ContractRules.Evaluate(contract, customerId, assetId, serviceType, now, allocationVisitId)).ToArray();
        var covered = decisions.Where(x => x.Covered).OrderByDescending(x => x.VisitsRemaining ?? int.MaxValue).FirstOrDefault();
        http.Response.Headers.CacheControl = "no-store";
        return Results.Ok(covered ?? decisions.FirstOrDefault() ?? new EntitlementDecision(false, "No active contract covers this service."));
    }

    private static async Task<IResult> List(ServiceDb db, HttpContext http, CancellationToken ct, Guid? customerId = null,
        string? status = null, int page = 1, int pageSize = 100)
    {
        if (page is < 1 or > 1_000_000 || pageSize is < 1 or > 100) throw new DomainException(400, "Invalid contract pagination.");
        if (status is not (null or "" or "Draft" or "Active" or "Suspended" or "Cancelled" or "Expired"))
            throw new DomainException(400, "Unknown contract status filter.");
        var caller = Caller.From(http.User);
        var query = db.Contracts.AsNoTracking().Where(x => caller.IsAdministrator || x.TeamId == caller.TeamId);
        if (customerId.HasValue) query = query.Where(x => x.CustomerId == customerId.Value);
        if (!string.IsNullOrWhiteSpace(status)) query = query.Where(x => x.Status == status);
        var total = await query.CountAsync(ct);
        var items = await query.OrderByDescending(x => x.CreatedAtUtc).ThenBy(x => x.Id)
            .Skip((page - 1) * pageSize).Take(pageSize)
            .Select(x => new ContractSummary(x.Id, x.CustomerId, x.Status, x.EffectiveFromUtc, x.ExpiresAtUtc, x.Version,
                x.Lines.Count, x.Visits.Count, x.Visits.Where(v => v.Status == "Pending").OrderBy(v => v.DueDate).Select(v => (DateOnly?)v.DueDate).FirstOrDefault()))
            .ToListAsync(ct);
        return Results.Ok(new { items, total, page, pageSize });
    }

    private static IQueryable<MaintenanceContract> ContractsQuery(ServiceDb db, Guid customerId, string teamId) =>
        db.Contracts.Where(x => x.CustomerId == customerId && x.TeamId == teamId);

    internal static async Task<MaintenanceContract> Find(Guid id, ServiceDb db, HttpContext http, bool tracking, CancellationToken ct)
    {
        var query = tracking ? db.Contracts : db.Contracts.AsNoTracking();
        var contract = await query.Include(x => x.Lines).Include(x => x.CoveredAssets).Include(x => x.Exclusions)
            .Include(x => x.Plans).Include(x => x.Visits).Include(x => x.Usage)
            .AsSplitQuery().SingleOrDefaultAsync(x => x.Id == id, ct)
            ?? throw new DomainException(404, "Maintenance contract not found.");
        Caller.From(http.User).Demand(contract.TeamId);
        return contract;
    }

    private static async Task<IResult> Commit(Guid operationId, object request, string operation, string team, ServiceDb db,
        HttpContext http, TimeProvider clock, Func<DateTimeOffset, Task<object>> change, CancellationToken ct)
    {
        if (operationId == Guid.Empty) throw new DomainException(400, "A nonempty operation ID is required.");
        var caller = Caller.From(http.User);
        var key = $"contracts:{caller.Id}:{operationId:D}";
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(operation + ":" + Json.Write(request))));
        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({team + ":contracts"},0))", ct);
        var receipt = await db.Receipts.AsNoTracking().SingleOrDefaultAsync(x => x.Id == key, ct);
        if (receipt is not null)
        {
            if (receipt.ActorId != caller.Id || receipt.RequestHash != hash)
                throw new DomainException(409, "Operation ID was already used for a different contract command.");
            return Results.Content(receipt.ResponseJson, "application/json");
        }
        var now = clock.GetUtcNow();
        var response = Json.Write(await change(now));
        db.Receipts.Add(new IdempotencyReceipt { Id = key, ActorId = caller.Id, RequestHash = hash, ResponseJson = response, CreatedAtUtc = now });
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
        return Results.Content(response, "application/json");
    }

    internal static void AddEvent(ServiceDb db, HttpContext http, MaintenanceContract contract, string action, DateTimeOffset now,
        object details)
    {
        var caller = Caller.From(http.User);
        var item = new ContractEvent
        {
            ContractId = contract.Id,
            Version = contract.Version,
            Action = action,
            ActorId = caller.Id,
            ActorRole = caller.Role,
            CorrelationId = http.Items["CorrelationId"]?.ToString() ?? Guid.NewGuid().ToString("N"),
            OccurredAtUtc = now,
            DetailsJson = Json.Write(details)
        };
        contract.Events.Add(item);
        db.ContractEvents.Add(item);
        db.Enqueue(EventFactory.Create(http, "customers", action, Guid.Empty, details, contract.Version, now));
    }

    private static ContractView View(MaintenanceContract contract) => new(contract.Id, contract.TeamId, contract.CustomerId,
        contract.Status, contract.EffectiveFromUtc, contract.ExpiresAtUtc, contract.TimeZoneId, contract.CoversAllAssets,
        contract.Version, contract.CreatedAtUtc, contract.UpdatedAtUtc, LineViews(contract),
        contract.CoveredAssets.OrderBy(x => x.EffectiveFrom).Select(x => new CoveredAssetView(x.AssetId, x.EffectiveFrom, x.EffectiveTo, x.Active)).ToArray(),
        contract.Plans.OrderBy(x => x.NextDueDate).Select(x => new MaintenancePlanView(x.Id, x.ContractLineId, x.AssetId, x.Frequency,
            x.NextDueDate, x.EndsOn, x.Active, x.Version, x.ServiceLocationId)).ToArray(),
        contract.Visits.OrderBy(x => x.DueDate).Select(VisitView).ToArray(),
        contract.Usage.OrderByDescending(x => x.OccurredAtUtc).Select(x => new ContractUsageView(x.Id, x.ContractLineId, x.WorkOrderId,
            x.VisitsUsed, x.PartsCost, x.OccurredAtUtc)).ToArray(), contract.SlaClockOrigin);

    private static ContractLineView[] LineViews(MaintenanceContract contract) => contract.Lines.OrderBy(x => x.ServiceType).Select(line =>
    {
        var used = contract.Usage.Where(x => x.ContractLineId == line.Id).ToArray();
        var visits = used.Sum(x => x.VisitsUsed);
        var parts = used.Sum(x => x.PartsCost);
        return new ContractLineView(line.Id, line.ServiceType, line.LaborCovered, line.PartsCovered, line.IncludedVisits,
            line.PartsAllowance, visits, parts, line.IncludedVisits == 0 ? null : Math.Max(0, line.IncludedVisits - visits), line.Active,
            ContractRules.CommittedVisits(contract, line.Id), ContractRules.AvailableVisits(contract, line.Id),
            line.ResponseTargetMinutes, line.CompletionTargetMinutes);
    }).ToArray();

    private static MaintenanceVisitView VisitView(MaintenanceVisit visit) => new(visit.Id, visit.ContractLineId, visit.AssetId,
        visit.WorkOrderId, visit.DueDate, visit.Status, visit.GeneratedAtUtc, visit.ServiceLocationId,
        visit.CompletedAtUtc, visit.CompletionReviewRequired, visit.CompletionReviewReason);
}
