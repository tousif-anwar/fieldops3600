using System.Security.Cryptography;
using System.Text;
using FieldOps.Core;
using Microsoft.EntityFrameworkCore;

namespace FieldOps.ServiceHost;

public sealed record AmendMaintenancePlan(Guid OperationId, int ExpectedContractVersion, int ExpectedPlanVersion,
    string Frequency, DateOnly FirstNewDue, DateOnly? EndsOn, Guid ServiceLocationId, string Reason);
public sealed record ContractPlanAmendmentView(Guid ContractId, int ContractVersion, MaintenancePlanView Plan);

/// <summary>Changes future recurrence without rewriting generated visits or their jobs.</summary>
public static class ContractPlanApi
{
    public static void Map(WebApplication app) => app.MapPut("/api/contracts/{contractId:guid}/plans/{planId:guid}", Amend)
        .RequireAuthorization("supervise");

    public static async Task<IResult> Amend(Guid contractId, Guid planId, AmendMaintenancePlan request,
        ServiceDb db, RemoteServices remote, HttpContext http, TimeProvider clock, CancellationToken ct)
    {
        if (request.OperationId == Guid.Empty || request.ServiceLocationId == Guid.Empty)
            throw new DomainException(400, "A nonempty operation ID and service location are required.");
        ContractRules.Text(request.Reason, 3, 500, "Plan amendment reason");
        var caller = Caller.From(http.User);
        var initial = await ContractApi.Find(contractId, db, http, false, ct);
        var initialPlan = initial.Plans.SingleOrDefault(x => x.Id == planId)
            ?? throw new DomainException(404, "Maintenance plan not found.");
        var key = $"contracts:{caller.Id}:{request.OperationId:D}";
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(
            "contract-plan-amend:" + contractId + ":" + planId + ":" + Json.Write(request))));
        // A valid completed command remains replayable after equipment/site status
        // changes or a remote outage. Current resource authority is still checked.
        var prior = await db.Receipts.AsNoTracking().SingleOrDefaultAsync(x => x.Id == key, ct);
        if (prior is not null) return Replay(prior, caller, hash);

        if (initialPlan.AssetId is { } assetId)
        {
            var asset = await remote.Get<AssetReferenceView>("Assets", $"/api/assets/{assetId:D}/reference", http, ct);
            if (asset.Id != assetId || asset.CustomerId != initial.CustomerId || asset.TeamId != initial.TeamId)
                throw new DomainException(404, "The selected equipment was not found for this customer.");
            if (asset.Status != "Active" || asset.ServiceLocationId != request.ServiceLocationId)
                throw new DomainException(409, "The maintenance plan must use active equipment at its current service location.");
        }

        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        await ContractLifecycleProcessor.Lock(db, initial.TeamId, ct);
        db.ChangeTracker.Clear();
        var contract = await ContractApi.Find(contractId, db, http, true, ct);
        var receipt = await db.Receipts.AsNoTracking().SingleOrDefaultAsync(x => x.Id == key, ct);
        if (receipt is not null) return Replay(receipt, caller, hash);
        var plan = contract.Plans.SingleOrDefault(x => x.Id == planId)
            ?? throw new DomainException(404, "Maintenance plan not found.");
        if (contract.Version != request.ExpectedContractVersion || plan.Version != request.ExpectedPlanVersion)
            throw new DomainException(409, "The agreement or maintenance plan changed; refresh and retry.");
        if (contract.Status is not ("Draft" or "Active" or "Suspended"))
            throw new DomainException(409, "Closed agreements cannot amend recurring plans.");
        if (plan.AssetId != initialPlan.AssetId || plan.ContractLineId != initialPlan.ContractLineId)
            throw new DomainException(409, "The plan's source references changed; refresh and retry.");
        if (!await db.Customers.AnyAsync(x => x.Id == contract.CustomerId && x.Status == "Active", ct))
            throw new DomainException(409, "An active customer is required to amend maintenance recurrence.");
        if (!await db.ServiceLocations.AnyAsync(x => x.Id == request.ServiceLocationId && x.CustomerId == contract.CustomerId && x.Status == "Active", ct))
            throw new DomainException(404, "Active customer service location not found.");
        if (!contract.Lines.Any(x => x.Id == plan.ContractLineId && x.Active))
            throw new DomainException(409, "The plan's coverage line must be active.");
        if (!contract.CoversAllAssets && (plan.AssetId is null ||
            !contract.CoveredAssets.Any(x => x.AssetId == plan.AssetId && x.Active && x.EffectiveFrom <= request.FirstNewDue &&
                (x.EffectiveTo is null || x.EffectiveTo >= request.FirstNewDue))))
            throw new DomainException(409, "The selected equipment is not covered on the first new due date.");
        if (contract.Plans.Any(x => x.Id != plan.Id && x.Active && x.ContractLineId == plan.ContractLineId && x.AssetId == plan.AssetId))
            throw new DomainException(409, "Another active plan already owns this service and equipment recurrence.");

        var now = clock.GetUtcNow();
        ContractRules.Validate(contract, now);
        var zone = TimeZoneInfo.FindSystemTimeZoneById(contract.TimeZoneId);
        var today = LocalDate(now, zone);
        var firstCoveredDate = LocalDate(contract.EffectiveFromUtc, zone);
        if (request.FirstNewDue == default || request.FirstNewDue < today || request.FirstNewDue < firstCoveredDate)
            throw new DomainException(400, "The first new due date must be on or after the agreement's local today and effective start.");
        var latestGenerated = contract.Visits.Where(x => x.ContractLineId == plan.ContractLineId && x.AssetId == plan.AssetId)
            .Select(x => (DateOnly?)x.DueDate).Max();
        if (latestGenerated is not null && request.FirstNewDue <= latestGenerated)
            throw new DomainException(409, "The new recurrence must start after every previously generated visit for this service and equipment.");
        if (request.EndsOn is { } endsOn && endsOn < request.FirstNewDue)
            throw new DomainException(400, "The plan end must be on or after its first new due date.");
        if (contract.ExpiresAtUtc is { } expires)
        {
            var lastCoveredDate = LocalDate(expires.AddTicks(-1), zone);
            if (expires <= now || request.FirstNewDue > lastCoveredDate || request.EndsOn > lastCoveredDate)
                throw new DomainException(400, "The amended recurrence must remain within the agreement's exclusive expiration.");
        }

        var before = Snapshot(plan);
        plan.Frequency = request.Frequency;
        plan.IntervalMonths = ContractRules.IntervalMonths(request.Frequency);
        plan.NextDueDate = request.FirstNewDue;
        plan.AnchorDay = request.FirstNewDue.Day;
        plan.EndsOn = request.EndsOn;
        plan.ServiceLocationId = request.ServiceLocationId;
        plan.Active = true;
        plan.Version++;
        contract.Version++;
        contract.UpdatedAtUtc = now;
        ContractRules.Validate(contract, now);
        ContractApi.AddEvent(db, http, contract, "MaintenancePlanAmended.v1", now,
            new { contract.TeamId, contractId, planId, reason = request.Reason.Trim(), before, after = Snapshot(plan) });
        var response = Json.Write(new ContractPlanAmendmentView(contract.Id, contract.Version,
            new(plan.Id, plan.ContractLineId, plan.AssetId, plan.Frequency, plan.NextDueDate,
                plan.EndsOn, plan.Active, plan.Version, plan.ServiceLocationId)));
        db.Receipts.Add(new IdempotencyReceipt
        {
            Id = key, ActorId = caller.Id, RequestHash = hash, ResponseJson = response, CreatedAtUtc = now
        });
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
        return Results.Content(response, "application/json");
    }

    private static DateOnly LocalDate(DateTimeOffset instant, TimeZoneInfo zone) =>
        DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(instant, zone).DateTime);

    private static IResult Replay(IdempotencyReceipt receipt, Caller caller, string hash)
    {
        if (receipt.ActorId != caller.Id || receipt.RequestHash != hash)
            throw new DomainException(409, "Operation ID was already used for a different contract command.");
        return Results.Content(receipt.ResponseJson, "application/json");
    }

    private static object Snapshot(MaintenancePlan plan) => new
    {
        plan.Id, plan.ContractId, plan.ContractLineId, plan.AssetId, plan.ServiceLocationId,
        plan.Frequency, plan.IntervalMonths, plan.NextDueDate, plan.AnchorDay, plan.EndsOn, plan.Active, plan.Version
    };
}
