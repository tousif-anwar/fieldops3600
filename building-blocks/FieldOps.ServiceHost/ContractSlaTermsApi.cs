using System.Security.Cryptography;
using System.Text;
using FieldOps.Core;
using Microsoft.EntityFrameworkCore;

namespace FieldOps.ServiceHost;

public sealed record ContractSlaLineInput(Guid ContractLineId, int? ResponseTargetMinutes, int? CompletionTargetMinutes);
public sealed record AmendContractSlaTerms(Guid OperationId, int ExpectedVersion, string? ClockOrigin,
    ContractSlaLineInput[] Lines, string Reason);
public sealed record ContractSlaTermsView(Guid ContractId, int Version, string? ClockOrigin, ContractSlaLineInput[] Lines);

/// <summary>Changes future contract promises; existing job snapshots are immutable.</summary>
public static class ContractSlaTermsApi
{
    public static void Map(WebApplication app) => app.MapPut("/api/contracts/{id:guid}/sla-terms", Amend)
        .RequireAuthorization("supervise");

    public static async Task<IResult> Amend(Guid id, AmendContractSlaTerms request, ServiceDb db,
        HttpContext http, TimeProvider clock, CancellationToken ct)
    {
        if (request.OperationId == Guid.Empty) throw new DomainException(400, "A nonempty operation ID is required.");
        var caller = Caller.From(http.User);
        var initial = await ContractApi.Find(id, db, http, false, ct);
        var key = $"contracts:{caller.Id}:{request.OperationId:D}";
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes("contract-sla-terms:" + id + ":" + Json.Write(request))));
        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        await ContractLifecycleProcessor.Lock(db, initial.TeamId, ct);
        db.ChangeTracker.Clear();
        var contract = await ContractApi.Find(id, db, http, true, ct);
        var receipt = await db.Receipts.AsNoTracking().SingleOrDefaultAsync(x => x.Id == key, ct);
        if (receipt is not null)
        {
            if (receipt.ActorId != caller.Id || receipt.RequestHash != hash)
                throw new DomainException(409, "Operation ID was already used for a different contract command.");
            return Results.Content(receipt.ResponseJson, "application/json");
        }
        ContractRules.Text(request.Reason, 3, 500, "SLA terms change reason");
        if (request.Lines is null || request.Lines.Length is < 1 or > 50 || request.Lines.Any(x => x is null))
            throw new DomainException(400, "Supply SLA terms for every agreement line.");
        if (contract.Version != request.ExpectedVersion)
            throw new DomainException(409, "The agreement changed; refresh before changing SLA terms.");
        if (contract.Status is not ("Draft" or "Active" or "Suspended"))
            throw new DomainException(409, "Closed agreement SLA terms cannot be changed.");
        if (!await db.Customers.AnyAsync(x => x.Id == contract.CustomerId && x.Status == "Active", ct))
            throw new DomainException(409, "An active customer is required to change agreement SLA terms.");
        if (request.Lines.Select(x => x.ContractLineId).Distinct().Count() != request.Lines.Length ||
            !request.Lines.Select(x => x.ContractLineId).ToHashSet().SetEquals(contract.Lines.Select(x => x.Id)))
            throw new DomainException(400, "SLA terms must include each agreement line exactly once.");
        var before = View(contract);
        contract.SlaClockOrigin = request.ClockOrigin;
        foreach (var input in request.Lines)
        {
            var line = contract.Lines.Single(x => x.Id == input.ContractLineId);
            line.ResponseTargetMinutes = input.ResponseTargetMinutes;
            line.CompletionTargetMinutes = input.CompletionTargetMinutes;
        }
        var now = clock.GetUtcNow();
        ContractRules.Validate(contract, now);
        contract.Version++;
        contract.UpdatedAtUtc = now;
        var after = View(contract);
        ContractApi.AddEvent(db, http, contract, "MaintenanceContractSlaTermsChanged.v1", now,
            new { contract.TeamId, contractId = contract.Id, reason = request.Reason.Trim(), before, after });
        var response = Json.Write(after);
        db.Receipts.Add(new IdempotencyReceipt { Id = key, ActorId = caller.Id, RequestHash = hash,
            ResponseJson = response, CreatedAtUtc = now });
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
        return Results.Content(response, "application/json");
    }

    private static ContractSlaTermsView View(MaintenanceContract contract) => new(contract.Id, contract.Version,
        contract.SlaClockOrigin, contract.Lines.OrderBy(x => x.Id).Select(x =>
            new ContractSlaLineInput(x.Id, x.ResponseTargetMinutes, x.CompletionTargetMinutes)).ToArray());
}
