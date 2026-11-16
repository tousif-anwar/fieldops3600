using System.Security.Claims;
using FieldOps.Core;
using FieldOps.ServiceHost;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace FieldOps.Tests;

[Collection("PostgreSQL")]
[Trait("Category", "Integration")]
public sealed class ContractPortalTests(PostgresFixture fixture)
{
    [Fact]
    public async Task PortalUsesPersistedUsageLocalDueDateAndSignedCustomerScope()
    {
        var now = new DateTimeOffset(2026, 11, 16, 2, 0, 0, TimeSpan.Zero);
        var connection = await fixture.Database("customers", false);
        var agreement = ContractLifecycleTests.Contract();
        agreement.TimeZoneId = "Pacific/Honolulu";
        agreement.CoversAllAssets = false;
        agreement.CoveredAssets.Add(new CoveredAsset
        {
            ContractId = agreement.Id, AssetId = Guid.NewGuid(), EffectiveFrom = new(2026, 1, 1)
        });
        agreement.Usage.Add(new ContractUsage
        {
            ContractId = agreement.Id, ContractLineId = agreement.Lines[0].Id,
            WorkOrderId = Guid.NewGuid(), VisitsUsed = 3, PartsCost = 12m, OccurredAtUtc = now
        });
        agreement.Visits.Add(ContractLifecycleTests.Visit(agreement, new(2026, 11, 15)));
        agreement.Visits.Add(ContractLifecycleTests.Visit(agreement, new(2026, 11, 14)));
        var other = ContractLifecycleTests.Contract();
        await using (var db = PostgresFixture.Db(connection, "customers"))
        {
            await SchemaMigrator.Apply(db);
            foreach (var contract in new[] { agreement, other })
                db.Customers.Add(new Customer
                {
                    Id = contract.CustomerId, DisplayName = "Portal agreement test", TeamId = contract.TeamId,
                    Status = "Active", CreatedAtUtc = now, UpdatedAtUtc = now
                });
            db.Contracts.AddRange(agreement, other);
            await db.SaveChangesAsync();
        }
        await using (var db = PostgresFixture.Db(connection, "customers"))
        {
            var http = Actor(agreement.CustomerId);
            var result = Assert.IsType<Ok<PortalContractView[]>>(await ContractApi.Portal(db, http, new Clock(now), default));
            var visible = Assert.Single(result.Value!);
            Assert.Equal(agreement.Id, visible.Id);
            Assert.Equal("Pacific/Honolulu", visible.TimeZoneId);
            Assert.Equal(7, Assert.Single(visible.Lines).VisitsRemaining);
            Assert.Equal(3, visible.Lines[0].VisitsUsed);
            Assert.Equal(12m, visible.Lines[0].PartsUsed);
            Assert.Equal(new DateOnly(2026, 11, 15), Assert.Single(visible.UpcomingVisits).DueDate);
            Assert.Equal(agreement.CoveredAssets[0].AssetId, Assert.Single(visible.CoveredAssets).AssetId);
            Assert.Equal("no-store", http.Response.Headers.CacheControl);
        }
        await using (var db = PostgresFixture.Db(connection, "customers"))
        {
            var hidden = Assert.IsType<Ok<PortalContractView[]>>(await ContractApi.Portal(db, Actor(agreement.CustomerId, "south"), new Clock(now), default));
            Assert.Empty(hidden.Value!);
        }
    }

    private static DefaultHttpContext Actor(Guid customer, string team = "north") => new()
    {
        User = new ClaimsPrincipal(new ClaimsIdentity([
            new Claim("sub", "test-customer"), new Claim("customer_id", customer.ToString()),
            new Claim("team_id", team), new Claim(ClaimTypes.Role, "Customer")
        ], "test"))
    };
    private sealed class Clock(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }
}
