using System.Net;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text.Json;
using FieldOps.Core;
using FieldOps.ServiceHost;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Xunit;

namespace FieldOps.Tests;

[Collection("PostgreSQL")]
[Trait("Category", "Integration")]
public sealed class ContractPlanApiTests(PostgresFixture fixture)
{
    // UTC March 9 remains March 8 locally after New York's spring transition.
    private static readonly DateTimeOffset Now = new(2026, 3, 9, 3, 30, 0, TimeSpan.Zero);
    private static readonly DateOnly NewDue = new(2026, 7, 31);

    [Fact]
    public async Task RacingAmendmentsReplayOneVersionedChangeAndPreserveGeneratedVisits()
    {
        var setup = await Setup();
        var request = Command(setup);
        async Task<ContractPlanAmendmentView> Amend()
        {
            await using var db = PostgresFixture.Db(setup.Connection, "customers");
            return Body(await ContractPlanApi.Amend(setup.ContractId, setup.PlanId, request,
                db, NoRemote(), Actor(), new FixedClock(), default));
        }
        var responses = await Task.WhenAll(Amend(), Amend());
        Assert.Equal(responses[0], responses[1]);
        Assert.Equal(2, responses[0].ContractVersion);
        Assert.Equal(2, responses[0].Plan.Version);
        Assert.Equal("Quarterly", responses[0].Plan.Frequency);
        Assert.Equal(setup.NewSiteId, responses[0].Plan.ServiceLocationId);

        await using (var db = PostgresFixture.Db(setup.Connection, "customers"))
        {
            var plan = await db.MaintenancePlans.SingleAsync();
            Assert.Equal(31, plan.AnchorDay);
            Assert.Equal(3, plan.IntervalMonths);
            Assert.Equal(NewDue, plan.NextDueDate);
            Assert.Equal(2, await db.MaintenanceVisits.CountAsync());
            var scheduled = await db.MaintenanceVisits.SingleAsync(x => x.Status == "Scheduled");
            Assert.Equal(setup.OriginalSiteId, scheduled.ServiceLocationId);
            Assert.Equal(setup.ExistingJobId, scheduled.WorkOrderId);
            Assert.Equal(new DateOnly(2026, 3, 31), scheduled.DueDate);
            Assert.Equal(1, scheduled.AssignmentRevision);
            Assert.Equal(new DateOnly(2026, 6, 30), (await db.MaintenanceVisits.SingleAsync(x => x.Status == "Cancelled")).DueDate);
            var evidence = await db.ContractEvents.SingleAsync();
            Assert.Equal("MaintenancePlanAmended.v1", evidence.Action);
            Assert.Equal("manager-01", evidence.ActorId);
            Assert.Equal("OperationsManager", evidence.ActorRole);
            Assert.Equal("plan-amend-correlation", evidence.CorrelationId);
            using var details = JsonDocument.Parse(evidence.DetailsJson);
            Assert.Equal("Monthly", details.RootElement.GetProperty("before").GetProperty("frequency").GetString());
            Assert.Equal("Quarterly", details.RootElement.GetProperty("after").GetProperty("frequency").GetString());
            Assert.Equal(1, details.RootElement.GetProperty("before").GetProperty("version").GetInt32());
            Assert.Equal(2, details.RootElement.GetProperty("after").GetProperty("version").GetInt32());
            Assert.Equal(request.Reason, details.RootElement.GetProperty("reason").GetString());
            Assert.Single(await db.Receipts.ToArrayAsync());
            var audit = Json.Read<AuditEvent>((await db.Outbox.SingleAsync()).Body);
            Assert.Equal(evidence.Action, audit.EventType);
            Assert.Equal("north", audit.EventPayload.GetProperty("teamId").GetString());
            Assert.Equal(Guid.Empty, audit.WorkOrderId);
        }

        // The established generator consumes only the amended cursor/cadence.
        await using (var db = PostgresFixture.Db(setup.Connection, "customers"))
            await ContractApi.Generate(setup.ContractId, new(Guid.NewGuid(), setup.ContractId, new(2026, 12, 31)),
                db, Actor(), new FixedClock(), default);
        await using (var db = PostgresFixture.Db(setup.Connection, "customers"))
        {
            var newlyGenerated = await db.MaintenanceVisits.Where(x => x.DueDate >= NewDue).OrderBy(x => x.DueDate).ToArrayAsync();
            Assert.Equal([new DateOnly(2026, 7, 31), new(2026, 10, 31)], newlyGenerated.Select(x => x.DueDate));
            Assert.All(newlyGenerated, visit => Assert.Equal(setup.NewSiteId, visit.ServiceLocationId));
            Assert.Equal(4, await db.MaintenanceVisits.CountAsync());
        }
        // Receipt replay remains exact even after generation has advanced versions.
        Assert.Equal(responses[0], await Amend());
    }

    [Fact]
    public async Task DifferentConcurrentCommandsCannotBothUseTheSameVersions()
    {
        var setup = await Setup();
        async Task<int> Execute(AmendMaintenancePlan request)
        {
            await using var db = PostgresFixture.Db(setup.Connection, "customers");
            try
            {
                await ContractPlanApi.Amend(setup.ContractId, setup.PlanId, request,
                    db, NoRemote(), Actor(), new FixedClock(), default);
                return 200;
            }
            catch (DomainException failure) { return failure.Status; }
        }
        var statuses = await Task.WhenAll(Execute(Command(setup)), Execute(Command(setup) with { Frequency = "Annual" }));
        Assert.Equal([200, 409], statuses.Order());
        await using var verify = PostgresFixture.Db(setup.Connection, "customers");
        Assert.Equal(2, (await verify.Contracts.SingleAsync()).Version);
        Assert.Equal(2, (await verify.MaintenancePlans.SingleAsync()).Version);
        Assert.Single(await verify.Receipts.ToArrayAsync());
        Assert.Single(await verify.ContractEvents.ToArrayAsync());
    }

    [Fact]
    public async Task ChangedCommandConflictsAndReceiptReplaysWithoutRemoteEquipmentAfterClosure()
    {
        var setup = await Setup(assetPlan: true);
        var request = Command(setup);
        var owner = new AssetOwner(new(setup.AssetId!.Value, "north", setup.CustomerId, setup.NewSiteId, "Active"));
        ContractPlanAmendmentView original;
        await using (var db = PostgresFixture.Db(setup.Connection, "customers"))
            original = Body(await ContractPlanApi.Amend(setup.ContractId, setup.PlanId, request,
                db, owner.Remote(), Actor(), new FixedClock(), default));
        Assert.Equal(1, owner.Reads);
        await using (var db = PostgresFixture.Db(setup.Connection, "customers"))
        {
            (await db.Contracts.SingleAsync()).Status = "Cancelled";
            await db.SaveChangesAsync();
        }
        await using (var db = PostgresFixture.Db(setup.Connection, "customers"))
            Assert.Equal(original, Body(await ContractPlanApi.Amend(setup.ContractId, setup.PlanId, request,
                db, NoRemote(), Actor(), new FixedClock(), default)));
        await using (var db = PostgresFixture.Db(setup.Connection, "customers"))
            Assert.Equal(409, (await Assert.ThrowsAsync<DomainException>(() => ContractPlanApi.Amend(setup.ContractId,
                setup.PlanId, request with { Frequency = "Annual" }, db, NoRemote(), Actor(), new FixedClock(), default))).Status);
        await using var verify = PostgresFixture.Db(setup.Connection, "customers");
        Assert.Single(await verify.ContractEvents.ToArrayAsync());
        Assert.Single(await verify.Receipts.ToArrayAsync());
        Assert.Single(await verify.Outbox.ToArrayAsync());
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task StaleContractOrPlanVersionCannotChangeTheCursor(bool staleContract)
    {
        var setup = await Setup();
        var request = Command(setup) with
        {
            ExpectedContractVersion = staleContract ? 99 : 1,
            ExpectedPlanVersion = staleContract ? 1 : 99
        };
        await Reject(setup, request, 409);
    }

    [Theory]
    [InlineData("Cancelled")]
    [InlineData("Expired")]
    public async Task ClosedAgreementsCannotChangeRecurrence(string status)
    {
        var setup = await Setup(contract => contract.Status = status);
        await Reject(setup, Command(setup), 409);
    }

    [Theory]
    [InlineData("Draft")]
    [InlineData("Suspended")]
    public async Task EligibleAgreementCanExplicitlyRestartAnEndedPlan(string status)
    {
        var setup = await Setup(contract =>
        {
            contract.Status = status;
            contract.Plans[0].Active = false;
        });
        await using var db = PostgresFixture.Db(setup.Connection, "customers");
        var amended = Body(await ContractPlanApi.Amend(setup.ContractId, setup.PlanId, Command(setup),
            db, NoRemote(), Actor(), new FixedClock(), default));
        Assert.True(amended.Plan.Active);
        Assert.Equal(2, amended.Plan.Version);
    }

    [Fact]
    public async Task HistoryIncludesCancelledFutureVisitsAndTheAmendmentCannotOverwriteThem()
    {
        var setup = await Setup();
        await Reject(setup, Command(setup) with { FirstNewDue = new(2026, 6, 30) }, 409);
        await Reject(setup, Command(setup) with { FirstNewDue = new(2026, 5, 1) }, 409);
    }

    [Theory]
    [InlineData("past")]
    [InlineData("missing")]
    [InlineData("expired-first")]
    [InlineData("early-end")]
    [InlineData("expired-end")]
    [InlineData("frequency")]
    public async Task InvalidDatesAndCadenceAreRejectedWithoutAuditOrReceipt(string invalid)
    {
        var setup = await Setup(contract => contract.Visits.Clear());
        var request = invalid switch
        {
            "past" => Command(setup) with { FirstNewDue = new(2026, 3, 7) },
            "missing" => Command(setup) with { FirstNewDue = default },
            "expired-first" => Command(setup) with { FirstNewDue = new(2027, 1, 1), EndsOn = null },
            "early-end" => Command(setup) with { EndsOn = NewDue.AddDays(-1) },
            "expired-end" => Command(setup) with { EndsOn = new(2027, 1, 1) },
            _ => Command(setup) with { Frequency = "Weekly" }
        };
        await Reject(setup, request, 400);
    }

    [Fact]
    public async Task LocalTodayAndExclusiveMidnightExpirationUseTheAgreementTimeZone()
    {
        var setup = await Setup(contract =>
        {
            contract.Visits.Clear();
            contract.ExpiresAtUtc = new(2026, 3, 10, 4, 0, 0, TimeSpan.Zero); // Midnight March 10 locally.
        });
        await Reject(setup, Command(setup) with { FirstNewDue = new(2026, 3, 10), EndsOn = null }, 400);
        await using var db = PostgresFixture.Db(setup.Connection, "customers");
        var amended = Body(await ContractPlanApi.Amend(setup.ContractId, setup.PlanId,
            Command(setup) with { FirstNewDue = new(2026, 3, 8), EndsOn = new(2026, 3, 9) },
            db, NoRemote(), Actor(), new FixedClock(), default));
        Assert.Equal(new DateOnly(2026, 3, 8), amended.Plan.NextDueDate);
        Assert.Equal(new DateOnly(2026, 3, 9), amended.Plan.EndsOn);
    }

    [Fact]
    public async Task FutureDraftCannotStartItsPlanBeforeTheLocalEffectiveDate()
    {
        var setup = await Setup(contract =>
        {
            contract.Status = "Draft";
            contract.EffectiveFromUtc = new(2026, 11, 1, 4, 0, 0, TimeSpan.Zero);
            contract.Visits.Clear();
        });
        await Reject(setup, Command(setup) with { FirstNewDue = new(2026, 10, 31) }, 400);
        await using var db = PostgresFixture.Db(setup.Connection, "customers");
        var amended = Body(await ContractPlanApi.Amend(setup.ContractId, setup.PlanId,
            Command(setup) with { FirstNewDue = new(2026, 11, 1) }, db, NoRemote(), Actor(), new FixedClock(), default));
        Assert.Equal(new DateOnly(2026, 11, 1), amended.Plan.NextDueDate);
    }

    [Fact]
    public async Task ForeignTeamSiteAndArchivedSiteCannotAmendThePlan()
    {
        var setup = await Setup();
        await using (var db = PostgresFixture.Db(setup.Connection, "customers"))
            Assert.Equal(404, (await Assert.ThrowsAsync<DomainException>(() => ContractPlanApi.Amend(setup.ContractId,
                setup.PlanId, Command(setup), db, NoRemote(), Actor("south"), new FixedClock(), default))).Status);
        await Reject(setup, Command(setup) with { ServiceLocationId = setup.ForeignSiteId }, 404);
        await using (var db = PostgresFixture.Db(setup.Connection, "customers"))
        {
            (await db.ServiceLocations.SingleAsync(x => x.Id == setup.NewSiteId)).Status = "Archived";
            await db.SaveChangesAsync();
        }
        await Reject(setup, Command(setup), 404);
    }

    [Fact]
    public async Task AssetOwnerIsCheckedOutsideTheLockAndLocalSiteIsRecheckedBeforeCommit()
    {
        var setup = await Setup(assetPlan: true);
        var owner = new AssetOwner(new(setup.AssetId!.Value, "north", setup.CustomerId, setup.NewSiteId, "Active"));
        owner.BeforeResponse = async () =>
        {
            await using var db = PostgresFixture.Db(setup.Connection, "customers");
            // Successfully taking the same team lock during the owner callback proves
            // the handler has not kept its customer transaction open across HTTP.
            await using var transaction = await db.Database.BeginTransactionAsync();
            await db.Database.ExecuteSqlInterpolatedAsync($"SET LOCAL lock_timeout = '1s'");
            await ContractLifecycleProcessor.Lock(db, "north", default);
            (await db.ServiceLocations.SingleAsync(x => x.Id == setup.NewSiteId)).Status = "Archived";
            await db.SaveChangesAsync();
            await transaction.CommitAsync();
        };
        await Reject(setup, Command(setup), 404, owner.Remote());
        Assert.Equal(1, owner.Reads);
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task EquipmentForAnotherTeamOrCustomerIsRejected(bool foreignTeam)
    {
        var setup = await Setup(assetPlan: true);
        var owner = new AssetOwner(new(setup.AssetId!.Value, foreignTeam ? "south" : "north",
            foreignTeam ? setup.CustomerId : Guid.NewGuid(), setup.NewSiteId, "Active"));
        await Reject(setup, Command(setup), 404, owner.Remote());
    }

    [Theory]
    [InlineData("Inactive", false)]
    [InlineData("Active", true)]
    public async Task InactiveEquipmentOrEquipmentAtAnotherSiteCannotAmend(string assetStatus, bool anotherSite)
    {
        var setup = await Setup(assetPlan: true);
        var owner = new AssetOwner(new(setup.AssetId!.Value, "north", setup.CustomerId,
            anotherSite ? setup.OriginalSiteId : setup.NewSiteId, assetStatus));
        await Reject(setup, Command(setup), 409, owner.Remote());
    }

    private async Task Reject(SetupData setup, AmendMaintenancePlan request, int expectedStatus, RemoteServices? remote = null)
    {
        await using (var db = PostgresFixture.Db(setup.Connection, "customers"))
            Assert.Equal(expectedStatus, (await Assert.ThrowsAsync<DomainException>(() => ContractPlanApi.Amend(setup.ContractId,
                setup.PlanId, request, db, remote ?? NoRemote(), Actor(), new FixedClock(), default))).Status);
        await using var verify = PostgresFixture.Db(setup.Connection, "customers");
        Assert.Equal(1, (await verify.Contracts.SingleAsync()).Version);
        Assert.Equal(1, (await verify.MaintenancePlans.SingleAsync()).Version);
        Assert.Empty(await verify.Receipts.ToArrayAsync());
        Assert.Empty(await verify.ContractEvents.ToArrayAsync());
        Assert.Empty(await verify.Outbox.ToArrayAsync());
    }

    private static AmendMaintenancePlan Command(SetupData setup) => new(Guid.NewGuid(), 1, 1, "Quarterly", NewDue,
        new(2026, 12, 31), setup.NewSiteId, "Move future recurrence to the agreed quarterly window");

    private async Task<SetupData> Setup(Action<MaintenanceContract>? configure = null, bool assetPlan = false)
    {
        var connection = await fixture.Database("customers", false);
        await using var db = PostgresFixture.Db(connection, "customers");
        await SchemaMigrator.Apply(db);
        var customer = new Customer { DisplayName = "Plan amendment customer", TeamId = "north", CreatedAtUtc = Now, UpdatedAtUtc = Now };
        var originalSite = Site(customer.Id, "Original site");
        var newSite = Site(customer.Id, "New recurrence site");
        customer.Locations.AddRange([originalSite, newSite]);
        var foreign = new Customer { DisplayName = "Another customer", TeamId = "north", CreatedAtUtc = Now, UpdatedAtUtc = Now };
        var foreignSite = Site(foreign.Id, "Another customer's site");
        foreign.Locations.Add(foreignSite);
        var contract = new MaintenanceContract
        {
            TeamId = "north", CustomerId = customer.Id, Status = "Active", TimeZoneId = "America/New_York",
            EffectiveFromUtc = Now.AddYears(-1), ExpiresAtUtc = new(2027, 1, 1, 0, 0, 0, TimeSpan.Zero),
            CoversAllAssets = true, CreatedAtUtc = Now, UpdatedAtUtc = Now
        };
        var line = new ContractLine { ContractId = contract.Id, ServiceType = "HVAC", IncludedVisits = 10, LaborCovered = true };
        contract.Lines.Add(line);
        Guid? assetId = assetPlan ? Guid.NewGuid() : null;
        var plan = new MaintenancePlan
        {
            ContractId = contract.Id, ContractLineId = line.Id, AssetId = assetId, ServiceLocationId = originalSite.Id,
            Frequency = "Monthly", IntervalMonths = 1, AnchorDay = 31, NextDueDate = new(2026, 4, 30), EndsOn = new(2026, 12, 31)
        };
        contract.Plans.Add(plan);
        var existingJob = Guid.NewGuid();
        contract.Visits.Add(new MaintenanceVisit
        {
            ContractId = contract.Id, ContractLineId = line.Id, CustomerId = customer.Id, AssetId = assetId,
            ServiceLocationId = originalSite.Id, DueDate = new(2026, 3, 31), GeneratedAtUtc = Now,
            Status = "Scheduled", WorkOrderId = existingJob, AssignmentRevision = 1
        });
        contract.Visits.Add(new MaintenanceVisit
        {
            ContractId = contract.Id, ContractLineId = line.Id, CustomerId = customer.Id, AssetId = assetId,
            ServiceLocationId = originalSite.Id, DueDate = new(2026, 6, 30), GeneratedAtUtc = Now, Status = "Cancelled"
        });
        configure?.Invoke(contract);
        db.Customers.AddRange(customer, foreign);
        // Match the owner API lifecycle: customer sites exist before a plan or
        // visit refers to them. The EF model does not order these opaque site FKs.
        await db.SaveChangesAsync();
        db.Contracts.Add(contract);
        await db.SaveChangesAsync();
        return new(connection, customer.Id, contract.Id, plan.Id, originalSite.Id, newSite.Id, foreignSite.Id, assetId, existingJob);
    }

    private static ServiceLocation Site(Guid customerId, string name) => new()
    {
        CustomerId = customerId, Name = name, AddressLine1 = "100 Synthetic Avenue", City = "Test City", Region = "NY", PostalCode = "10000"
    };
    private sealed record SetupData(string Connection, Guid CustomerId, Guid ContractId, Guid PlanId,
        Guid OriginalSiteId, Guid NewSiteId, Guid ForeignSiteId, Guid? AssetId, Guid ExistingJobId);
    private static ContractPlanAmendmentView Body(IResult result) =>
        Json.Read<ContractPlanAmendmentView>(Assert.IsType<ContentHttpResult>(result).ResponseContent!);
    private static DefaultHttpContext Actor(string team = "north")
    {
        var http = new DefaultHttpContext
        {
            User = new ClaimsPrincipal(new ClaimsIdentity([new("sub", "manager-01"), new("team_id", team),
                new(ClaimTypes.Role, "OperationsManager")], "test"))
        };
        http.Items["CorrelationId"] = "plan-amend-correlation";
        return http;
    }
    private sealed class FixedClock : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => Now;
    }
    private static RemoteServices NoRemote() => new(new RejectRemote(), new ConfigurationBuilder().Build());
    private sealed class RejectRemote : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => throw new InvalidOperationException("No remote owner read expected.");
    }
    private sealed class AssetOwner(AssetReferenceView asset) : IHttpClientFactory
    {
        private AssetReferenceView Asset => asset;
        public int Reads { get; private set; }
        public Func<Task>? BeforeResponse { get; set; }
        public RemoteServices Remote() => new(this, new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["Services:Assets"] = "http://assets" }).Build());
        public HttpClient CreateClient(string name) => new(new Handler(this));
        private sealed class Handler(AssetOwner owner) : HttpMessageHandler
        {
            protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
            {
                Assert.Equal(HttpMethod.Get, request.Method);
                Assert.Equal($"/api/assets/{owner.Asset.Id:D}/reference", request.RequestUri!.AbsolutePath);
                owner.Reads++;
                if (owner.BeforeResponse is not null) await owner.BeforeResponse();
                return new(HttpStatusCode.OK) { Content = JsonContent.Create(owner.Asset, options: Json.Options) };
            }
        }
    }
}
