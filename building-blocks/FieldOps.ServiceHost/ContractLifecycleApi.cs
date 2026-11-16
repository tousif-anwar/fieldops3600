using System.Security.Cryptography;
using System.Text;
using FieldOps.Core;
using Microsoft.EntityFrameworkCore;

namespace FieldOps.ServiceHost;

public sealed record RenewContract(Guid OperationId, int ExpectedVersion, DateTimeOffset EffectiveFromUtc,
    DateTimeOffset ExpiresAtUtc, string Reason);
public sealed record ContractRenewalView(Guid Id, Guid SourceContractId, Guid RenewedContractId, int SourceVersion,
    DateTimeOffset EffectiveFromUtc, DateTimeOffset ExpiresAtUtc, string Reason, string ActorId, string ActorRole,
    DateTimeOffset RecordedAtUtc);

public static class ContractLifecycleApi
{
    public static void Map(WebApplication app)
    {
        var routes = app.MapGroup("/api/contracts/{id:guid}/renewals").RequireAuthorization("supervise");
        routes.MapPost("", Renew);
        routes.MapGet("", History);
    }

    public static async Task<IResult> History(Guid id, ServiceDb db, HttpContext http, CancellationToken ct)
    {
        _ = await ContractApi.Find(id, db, http, false, ct);
        http.Response.Headers.CacheControl = "no-store";
        var evidence = await db.ContractRenewals.AsNoTracking()
            .Where(x => x.SourceContractId == id || x.RenewedContractId == id)
            .OrderByDescending(x => x.RecordedAtUtc).ToArrayAsync(ct);
        return Results.Ok(evidence.Select(View).ToArray());
    }

    public static async Task<IResult> Renew(Guid id, RenewContract request, ServiceDb db, HttpContext http,
        TimeProvider clock, CancellationToken ct)
    {
        if (request.OperationId == Guid.Empty) throw new DomainException(400, "A nonempty operation ID is required.");
        var caller = Caller.From(http.User);
        var initial = await ContractApi.Find(id, db, http, false, ct);
        var key = $"contracts:{caller.Id}:{request.OperationId:D}";
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes("contract-renew:" + id + ":" + Json.Write(request))));
        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        await ContractLifecycleProcessor.Lock(db, initial.TeamId, ct);
        db.ChangeTracker.Clear();
        // Re-read only after the shared team lock, including authority and version.
        var source = await ContractApi.Find(id, db, http, true, ct);
        var receipt = await db.Receipts.AsNoTracking().SingleOrDefaultAsync(x => x.Id == key, ct);
        if (receipt is not null)
        {
            if (receipt.ActorId != caller.Id || receipt.RequestHash != hash)
                throw new DomainException(409, "Operation ID was already used for a different contract command.");
            return Results.Content(receipt.ResponseJson, "application/json");
        }
        if (await db.ContractRenewals.AnyAsync(x => x.SourceContractId == id, ct))
            throw new DomainException(409, "This agreement already has a renewal; review the linked draft.");
        var customer = await db.Customers.SingleAsync(x => x.Id == source.CustomerId, ct);
        if (customer.Status != "Active") throw new DomainException(409, "Renewal requires an active customer.");
        var now = clock.GetUtcNow();
        var renewed = ContractLifecycleRules.Renew(source, request.ExpectedVersion,
            request.EffectiveFromUtc, request.ExpiresAtUtc, request.Reason, now);
        var renewal = new ContractRenewalRecord
        {
            SourceContractId = source.Id, RenewedContractId = renewed.Id, TeamId = source.TeamId,
            SourceVersion = source.Version, OperationId = request.OperationId,
            EffectiveFromUtc = renewed.EffectiveFromUtc, ExpiresAtUtc = request.ExpiresAtUtc,
            Reason = request.Reason.Trim(), ActorId = caller.Id, ActorRole = caller.Role, RecordedAtUtc = now
        };
        db.Contracts.Add(renewed);
        db.ContractRenewals.Add(renewal);
        ContractApi.AddEvent(db, http, source, "MaintenanceContractRenewed.v1", now,
            new { source.TeamId, sourceContractId = source.Id, renewedContractId = renewed.Id, renewalId = renewal.Id,
                renewal.SourceVersion, renewal.Reason, renewal.EffectiveFromUtc, renewal.ExpiresAtUtc });
        ContractApi.AddEvent(db, http, renewed, "MaintenanceContractRenewalDraftCreated.v1", now,
            new { source.TeamId, sourceContractId = source.Id, renewedContractId = renewed.Id, renewalId = renewal.Id });
        var response = Json.Write(View(renewal));
        db.Receipts.Add(new IdempotencyReceipt
        {
            Id = key, ActorId = caller.Id, RequestHash = hash, ResponseJson = response, CreatedAtUtc = now
        });
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
        return Results.Content(response, "application/json");
    }

    private static ContractRenewalView View(ContractRenewalRecord x) => new(x.Id, x.SourceContractId,
        x.RenewedContractId, x.SourceVersion, x.EffectiveFromUtc, x.ExpiresAtUtc, x.Reason, x.ActorId,
        x.ActorRole, x.RecordedAtUtc);
}

/// <summary>No worker is registered unless the operator explicitly enables a complete policy.</summary>
public sealed record ContractLifecyclePolicy(bool Enabled = false, int? RecurrenceHorizonDays = null,
    int? MissedVisitGraceDays = null, int IntervalSeconds = 60)
{
    public void Validate()
    {
        if (!Enabled) return;
        if (RecurrenceHorizonDays is null or < 0 or > 366)
            throw new InvalidOperationException("Enabled contract lifecycle requires RecurrenceHorizonDays between zero and 366.");
        if (MissedVisitGraceDays is < 0 or > 366)
            throw new InvalidOperationException("MissedVisitGraceDays must be omitted or between zero and 366.");
        if (IntervalSeconds is < 15 or > 3600)
            throw new InvalidOperationException("Contract lifecycle IntervalSeconds must be between 15 and 3600.");
    }
}

public sealed record ContractLifecycleSweep(int Expired, int Generated, int Missed, int Failed = 0);

public static class ContractLifecycleProcessor
{
    public static Task<int> Lock(ServiceDb db, string teamId, CancellationToken ct) =>
        db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({teamId + ":contracts"},0))", ct);

    public static async Task<ContractLifecycleSweep> Run(ServiceDb db, TimeProvider clock,
        ContractLifecyclePolicy policy, CancellationToken ct = default, ILogger? logger = null)
    {
        policy.Validate();
        if (!policy.Enabled) return new(0, 0, 0);
        if (db.ServiceName != "customers") throw new InvalidOperationException("Contract lifecycle belongs to the customers service.");
        // Snapshot identities only. Re-read each aggregate under the same lock used
        // by renewal, dispatch, and operator commands; overlapping workers converge.
        var identities = await db.Contracts.AsNoTracking().Where(x => x.Status == "Active" || x.Status == "Suspended" ||
            (policy.MissedVisitGraceDays != null && x.Status == "Expired" && x.Visits.Any(v => v.Status == "Pending" && v.WorkOrderId == null)))
            .OrderBy(x => x.TeamId).ThenBy(x => x.Id).Select(x => new { x.Id, x.TeamId }).ToArrayAsync(ct);
        var expired = 0;
        var generated = 0;
        var missed = 0;
        var failed = 0;
        foreach (var identity in identities)
        {
            ct.ThrowIfCancellationRequested();
            try
            {
                var committed = await ProcessAgreement(db, identity.Id, identity.TeamId, clock, policy, ct);
                expired += committed.Expired;
                generated += committed.Generated;
                missed += committed.Missed;
            }
            catch (Exception exception) when (exception is not OperationCanceledException)
            {
                // ProcessAgreement has disposed its transaction and rolled back before
                // this handler. Discard uncommitted tracked state before the next owner.
                db.ChangeTracker.Clear();
                failed++;
                logger?.LogError(exception,
                    "Contract lifecycle failed for agreement {ContractId} in team {TeamId}; its transaction rolled back and will retry.",
                    identity.Id, identity.TeamId);
            }
        }
        return new(expired, generated, missed, failed);
    }

    private static async Task<ContractLifecycleSweep> ProcessAgreement(ServiceDb db, Guid id, string teamId,
        TimeProvider clock, ContractLifecyclePolicy policy, CancellationToken ct)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        await Lock(db, teamId, ct);
        db.ChangeTracker.Clear();
        var contract = await db.Contracts.Include(x => x.Lines).Include(x => x.CoveredAssets).Include(x => x.Exclusions)
            .Include(x => x.Plans).Include(x => x.Visits).AsSplitQuery().SingleAsync(x => x.Id == id, ct);
        var now = clock.GetUtcNow();
        var expired = 0;
        var generated = 0;
        var missed = 0;
        if (ContractLifecycleRules.Expire(contract, now))
        {
            expired++;
            AddSystemEvent(db, contract, "MaintenanceContractExpired.v1", now,
                new { contract.TeamId, contractId = contract.Id, contract.ExpiresAtUtc });
        }
        if (ContractRules.IsEffective(contract, now))
        {
            var localToday = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(now, TimeZoneInfo.FindSystemTimeZoneById(contract.TimeZoneId)).DateTime);
            var before = contract.Visits.Select(x => x.Id).ToHashSet();
            var previousUpdatedAt = contract.UpdatedAtUtc;
            var plansBefore = Json.Write(contract.Plans);
            var count = ContractRules.GenerateVisits(contract, localToday.AddDays(policy.RecurrenceHorizonDays!.Value), now);
            if (count > 0)
            {
                // EF must INSERT assigned-ID children, never infer an UPDATE.
                foreach (var visit in contract.Visits.Where(x => !before.Contains(x.Id)))
                    db.Entry(visit).State = EntityState.Added;
                generated += count;
                AddSystemEvent(db, contract, "MaintenanceVisitsGenerated.v1", now,
                    new { contract.TeamId, contractId = contract.Id, generated = count, throughDate = localToday.AddDays(policy.RecurrenceHorizonDays.Value) });
            }
            else if (plansBefore != Json.Write(contract.Plans))
            {
                contract.Version++;
                AddSystemEvent(db, contract, "MaintenancePlanCursorAdvanced.v1", now,
                    new { contract.TeamId, contractId = contract.Id, generated = 0, throughDate = localToday.AddDays(policy.RecurrenceHorizonDays.Value) });
            }
            else contract.UpdatedAtUtc = previousUpdatedAt;
        }
        foreach (var visit in ContractLifecycleRules.MarkMissed(contract, policy.MissedVisitGraceDays, now))
        {
            missed++;
            AddSystemEvent(db, contract, "MaintenanceVisitMissed.v1", now,
                new { contract.TeamId, contractId = contract.Id, visitId = visit.Id, visit.DueDate, graceDays = policy.MissedVisitGraceDays });
        }
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
        return new(expired, generated, missed);
    }

    private static void AddSystemEvent(ServiceDb db, MaintenanceContract contract, string type,
        DateTimeOffset now, object details)
    {
        var audit = EventFactory.Create(null, "customers", type, Guid.Empty, details, contract.Version, now);
        db.ContractEvents.Add(new ContractEvent
        {
            Id = audit.EventId, ContractId = contract.Id, Version = contract.Version, Action = type,
            ActorId = "system", ActorRole = "System", CorrelationId = audit.CorrelationId,
            OccurredAtUtc = now, DetailsJson = Json.Write(details)
        });
        db.Enqueue(audit);
    }
}

public static class ContractLifecycleRegistration
{
    public static IServiceCollection AddContractLifecycle(this IServiceCollection services, IConfiguration configuration)
    {
        var policy = new ContractLifecyclePolicy(
            configuration.GetValue<bool>("Contracts:Lifecycle:Enabled"),
            configuration.GetValue<int?>("Contracts:Lifecycle:RecurrenceHorizonDays"),
            configuration.GetValue<int?>("Contracts:Lifecycle:MissedVisitGraceDays"),
            configuration.GetValue("Contracts:Lifecycle:IntervalSeconds", 60));
        policy.Validate();
        if (policy.Enabled)
        {
            services.AddSingleton(policy);
            services.AddHostedService<ContractLifecycleWorker>();
        }
        return services;
    }
}

public sealed class ContractLifecycleWorker(IServiceScopeFactory scopes, TimeProvider clock,
    ContractLifecyclePolicy policy, ILogger<ContractLifecycleWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!policy.Enabled) return;
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(policy.IntervalSeconds));
        do
        {
            try
            {
                await using var scope = scopes.CreateAsyncScope();
                await ContractLifecycleProcessor.Run(scope.ServiceProvider.GetRequiredService<ServiceDb>(), clock, policy, stoppingToken, logger);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { return; }
            catch (Exception exception)
            {
                logger.LogError(exception, "Contract lifecycle sweep failed; committed changes are retained and remaining work will retry.");
            }
        } while (await timer.WaitForNextTickAsync(stoppingToken));
    }
}
