using System.Security.Cryptography;
using System.Text;
using FieldOps.Core;
using Microsoft.EntityFrameworkCore;

namespace FieldOps.ServiceHost;

public sealed record DispatchMaintenanceVisit(Guid OperationId, Guid ServiceLocationId);
public sealed record MaintenanceDispatchView(Guid ContractId, Guid VisitId, Guid CustomerId, string TeamId,
    Guid ServiceLocationId, Guid? AssetId, string ServiceType, DateOnly DueDate);
public sealed record MaintenanceDispatchResult(Guid VisitId, Guid? WorkOrderId, Guid ServiceLocationId,
    string Status, bool DispatchComplete);

/// <summary>Durable intent and deterministic owner keys bridge two local transactions without a distributed transaction.</summary>
public static class MaintenanceDispatch
{
    public static void Map(WebApplication app)
    {
        var routes = app.MapGroup("/api/contracts/{contractId:guid}/visits").RequireAuthorization("dispatch");
        routes.MapPost("/{visitId:guid}/dispatch", Dispatch);
        routes.MapGet("/{visitId:guid}/dispatch", Intent);
    }

    public static async Task<IResult> Intent(Guid contractId, Guid visitId, ServiceDb db, HttpContext http,
        TimeProvider clock, CancellationToken ct)
    {
        var contract = await ContractApi.Find(contractId, db, http, false, ct);
        var visit = contract.Visits.SingleOrDefault(x => x.Id == visitId) ?? throw new DomainException(404, "Maintenance visit not found.");
        if (visit.Status is not ("Dispatching" or "Created" or "Scheduled") || visit.ServiceLocationId is null)
            throw new DomainException(409, "The visit must have a committed dispatch intent and service location.");
        if (!ContractRules.IsEffective(contract, clock.GetUtcNow()))
            throw new DomainException(409, "The maintenance agreement is not active and effective.");
        var line = contract.Lines.Single(x => x.Id == visit.ContractLineId);
        var coverage = ContractRules.Evaluate(contract, contract.CustomerId, visit.AssetId, line.ServiceType, clock.GetUtcNow(), visit.Id);
        if (!coverage.Covered) throw new DomainException(409, coverage.Reason);
        http.Response.Headers.CacheControl = "no-store";
        return Results.Ok(new MaintenanceDispatchView(contract.Id, visit.Id, contract.CustomerId, contract.TeamId,
            visit.ServiceLocationId.Value, visit.AssetId, line.ServiceType, visit.DueDate));
    }

    public static async Task<IResult> Dispatch(Guid contractId, Guid visitId, DispatchMaintenanceVisit request,
        ServiceDb db, RemoteServices remote, HttpContext http, TimeProvider clock, CancellationToken ct)
    {
        if (request.OperationId == Guid.Empty || request.ServiceLocationId == Guid.Empty)
            throw new DomainException(400, "An operation ID and service location are required.");
        var caller = Caller.From(http.User);
        var initial = await ContractApi.Find(contractId, db, http, false, ct);
        var initialVisit = initial.Visits.SingleOrDefault(x => x.Id == visitId) ?? throw new DomainException(404, "Maintenance visit not found.");
        // Resource ownership is checked on every retry. Remote equipment checks happen outside locks.
        var site = await db.ServiceLocations.AsNoTracking().SingleOrDefaultAsync(x => x.Id == request.ServiceLocationId && x.CustomerId == initial.CustomerId, ct)
            ?? throw new DomainException(404, "Customer service location not found.");
        if (initialVisit.Status == "Pending" && site.Status != "Active")
            throw new DomainException(409, "A new maintenance dispatch requires an active service location.");
        if (initialVisit.Status == "Pending" && initialVisit.AssetId is { } assetId)
        {
            var asset = await remote.Get<AssetReferenceView>("Assets", $"/api/assets/{assetId:D}/reference", http, ct);
            if (asset.CustomerId != initial.CustomerId || asset.TeamId != initial.TeamId || asset.ServiceLocationId != site.Id || asset.Status != "Active")
                throw new DomainException(409, "The covered equipment must be active at the selected service location.");
        }
        var key = $"maintenance-dispatch:{caller.Id}:{request.OperationId:D}";
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(Json.Write(new { contractId, visitId, request }))));
        await using (var transaction = await db.Database.BeginTransactionAsync(ct))
        {
            await Lock(db, initial.TeamId, ct);
            db.ChangeTracker.Clear();
            var contract = await ContractApi.Find(contractId, db, http, true, ct);
            var visit = contract.Visits.Single(x => x.Id == visitId);
            var receipt = await db.Receipts.SingleOrDefaultAsync(x => x.Id == key, ct);
            if (receipt is not null)
            {
                CheckReceipt(receipt, caller, hash);
                if (Json.Read<MaintenanceDispatchResult>(receipt.ResponseJson).DispatchComplete)
                    return Results.Content(receipt.ResponseJson, "application/json");
            }
            if (visit.ServiceLocationId.HasValue && visit.ServiceLocationId != request.ServiceLocationId)
                throw new DomainException(409, "This visit is already bound to a different service location.");
            if (receipt is not null && visit.WorkOrderId == visit.Id)
            {
                // The owner response may have been lost while its trusted event
                // already linked, scheduled, or completed this exact commitment.
                // Repair the original actor/hash receipt without another owner call
                // and preserve the projected service state and usage evidence.
                var recovered = new MaintenanceDispatchResult(visit.Id, visit.WorkOrderId,
                    request.ServiceLocationId, visit.Status, true);
                receipt.ResponseJson = Json.Write(recovered);
                await db.SaveChangesAsync(ct);
                await transaction.CommitAsync(ct);
                return Results.Ok(recovered);
            }
            if (visit.Status is "Completed" or "Missed" or "Cancelled")
                throw new DomainException(409, "This visit cannot create a work order.");
            if (visit.Status == "Pending")
            {
                var line = contract.Lines.Single(x => x.Id == visit.ContractLineId);
                WorkOrderRules.RequireCategory(line.ServiceType);
                var decision = ContractRules.Evaluate(contract, contract.CustomerId, visit.AssetId, line.ServiceType, clock.GetUtcNow());
                if (!decision.Covered) throw new DomainException(409, decision.Reason);
                visit.ServiceLocationId = request.ServiceLocationId;
                visit.Status = "Dispatching";
                contract.Version++;
                contract.UpdatedAtUtc = clock.GetUtcNow();
                ContractApi.AddEvent(db, http, contract, "MaintenanceVisitDispatchRequested.v1", clock.GetUtcNow(), new { visitId, contractId, siteId = site.Id });
            }
            if (receipt is null)
                db.Receipts.Add(new IdempotencyReceipt { Id = key, ActorId = caller.Id, RequestHash = hash,
                    ResponseJson = Json.Write(new MaintenanceDispatchResult(visit.Id, visit.WorkOrderId, site.Id, visit.Status, false)), CreatedAtUtc = clock.GetUtcNow() });
            await db.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);
        }

        // A timeout here leaves the committed intent recoverable. The work-order owner
        // uses visitId as its deterministic key, so retrying never creates another job.
        var committed = await remote.Post<WorkOrder>("WorkOrders", "/api/work-orders", new CreateOrder(
            "Recurring maintenance", null, null, "HVAC", "Normal", initial.TeamId,
            initial.CustomerId, site.Id, AssetId: initialVisit.AssetId, OperationId: request.OperationId,
            MaintenanceVisitId: visitId, ContractId: contractId), http, ct);
        if (committed.Id != visitId || committed.MaintenanceVisitId != visitId || committed.ContractId != contractId || committed.ServiceLocationId != site.Id)
            throw new DomainException(409, "The work-order owner returned an inconsistent maintenance reference.");

        await using (var transaction = await db.Database.BeginTransactionAsync(ct))
        {
            await Lock(db, initial.TeamId, ct);
            db.ChangeTracker.Clear();
            var contract = await ContractApi.Find(contractId, db, http, true, ct);
            var visit = contract.Visits.Single(x => x.Id == visitId);
            if (visit.WorkOrderId.HasValue && visit.WorkOrderId != committed.Id)
                throw new DomainException(409, "This visit already has a different work order.");
            if (visit.WorkOrderId is null)
            {
                visit.WorkOrderId = committed.Id;
                visit.Status = "Created";
                contract.Version++;
                contract.UpdatedAtUtc = clock.GetUtcNow();
                ContractApi.AddEvent(db, http, contract, "MaintenanceVisitWorkOrderCreated.v1", clock.GetUtcNow(), new { contract.TeamId, visitId, workOrderId = committed.Id, contractId });
            }
            var receipt = await db.Receipts.SingleAsync(x => x.Id == key, ct);
            CheckReceipt(receipt, caller, hash);
            var response = new MaintenanceDispatchResult(visit.Id, committed.Id, site.Id, visit.Status, true);
            receipt.ResponseJson = Json.Write(response);
            await db.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);
            return Results.Ok(response);
        }
    }

    public static async Task<WorkOrder?> ExistingOrder(CreateOrder request, ServiceDb db, HttpContext http, CancellationToken ct)
    {
        if (request.ContractId.HasValue != request.MaintenanceVisitId.HasValue)
            throw new DomainException(400, "Maintenance agreement and visit references must be supplied together.");
        if (request.MaintenanceVisitId is not { } id) return null;
        if (id == Guid.Empty) throw new DomainException(400, "Maintenance visit ID must not be empty.");
        var order = await db.WorkOrders.AsNoTracking().SingleOrDefaultAsync(x => x.Id == id, ct);
        if (order is null) return null;
        Caller.From(http.User).Demand(order.TeamId, order.TechnicianId);
        if (order.MaintenanceVisitId != id || order.ContractId != request.ContractId || order.CustomerId != request.CustomerId || order.ServiceLocationId != request.ServiceLocationId || order.TeamId != request.TeamId)
            throw new DomainException(409, "This visit already created a different work-order commitment.");
        return order;
    }

    public static async Task<CreateOrder> PrepareOrder(CreateOrder request, RemoteServices remote, HttpContext http, CancellationToken ct)
    {
        if (request.MaintenanceVisitId is not { } visitId) return request;
        var source = await remote.Get<MaintenanceDispatchView>("Customers", $"/api/contracts/{request.ContractId:D}/visits/{visitId:D}/dispatch", http, ct);
        if (source.VisitId != visitId || source.ContractId != request.ContractId || source.CustomerId != request.CustomerId || source.TeamId != request.TeamId || source.ServiceLocationId != request.ServiceLocationId)
            throw new DomainException(409, "The committed maintenance intent does not match the requested job.");
        return request with { Title = $"{source.ServiceType} maintenance due {source.DueDate:yyyy-MM-dd}",
            ServiceCategory = source.ServiceType, Priority = "Normal", CustomerName = null, SiteAddress = null,
            AssetId = source.AssetId, UnregisteredCustomerReason = null,
            ReportedProblem = $"Recurring {source.ServiceType} service under agreement {source.ContractId:D}; planned due date {source.DueDate:yyyy-MM-dd}." };
    }

    public static void ApplyDecision(WorkOrder order, EntitlementDecision decision, DateTimeOffset now)
    {
        order.CoverageEvaluatedAtUtc = now;
        order.CoverageReason = decision.Reason;
        order.ContractId = decision.Covered ? decision.ContractId : null;
        order.ContractLineId = decision.Covered ? decision.ContractLineId : null;
        order.ContractLaborCovered = decision.Covered && decision.LaborCovered;
        order.ContractPartsCovered = decision.Covered && decision.PartsCovered;
        order.FinancialAuthorizationRequired = !decision.Covered || !decision.LaborCovered || !decision.PartsCovered || decision.PartsAllowanceRemaining is null or <= 0;
    }

    private static Task Lock(ServiceDb db, string team, CancellationToken ct) =>
        db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({team + ":contracts"},0))", ct);
    private static void CheckReceipt(IdempotencyReceipt receipt, Caller caller, string hash)
    {
        if (receipt.ActorId != caller.Id || receipt.RequestHash != hash)
            throw new DomainException(409, "Operation ID was already used for a different maintenance dispatch command.");
    }
}
