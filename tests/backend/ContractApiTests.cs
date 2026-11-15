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
public sealed class ContractApiTests(PostgresFixture fixture)
{
    [Fact]
    public async Task CreateActivateGenerateAndEvaluateContractThroughTheApi()
    {
        var connection = await fixture.Database("customers", false);
        var now = DateTimeOffset.UtcNow;
        Guid customerId;
        await using (var db = PostgresFixture.Db(connection, "customers"))
        {
            await SchemaMigrator.Apply(db);
            var customer = new Customer
            {
                DisplayName = "API contract customer", TeamId = "north", Status = "Active",
                CreatedAtUtc = now, UpdatedAtUtc = now
            };
            db.Customers.Add(customer);
            await db.SaveChangesAsync();
            customerId = customer.Id;
        }

        var remote = new RemoteServices(new NoRemote(), new ConfigurationBuilder().Build());
        var request = new CreateContract(Guid.NewGuid(), customerId, now.AddDays(-1), now.AddYears(1), "UTC", true,
            [new ContractLineInput("HVAC", true, true, 2, 100m)], null, null);
        ContractView created;
        await using (var db = PostgresFixture.Db(connection, "customers"))
            created = Body<ContractView>(await ContractApi.Create(request, db, remote, Actor(), TimeProvider.System, default));
        Assert.Equal("Draft", created.Status);
        Assert.Single(created.Lines);
        Assert.Equal(2, created.Lines[0].IncludedVisits);

        await using (var db = PostgresFixture.Db(connection, "customers"))
            Assert.Equal(created.Id, Body<ContractView>(await ContractApi.Create(request, db, remote, Actor(), TimeProvider.System, default)).Id);

        ContractView activated;
        await using (var db = PostgresFixture.Db(connection, "customers"))
            activated = Body<ContractView>(await ContractApi.ChangeStatus(created.Id,
                new(Guid.NewGuid(), created.Id, created.Version, "Active", "Agreement executed"), db, Actor(), TimeProvider.System, default));
        Assert.Equal("Active", activated.Status);
        await using (var versionCheck = PostgresFixture.Db(connection, "customers"))
            Assert.Equal(2, await versionCheck.Contracts.Where(x => x.Id == created.Id).Select(x => x.Version).SingleAsync());

        var start = DateOnly.FromDateTime(now.UtcDateTime);
        ContractView planned;
        await using (var db = PostgresFixture.Db(connection, "customers"))
        {
            try
            {
                planned = Body<ContractView>(await ContractApi.CreatePlan(new(Guid.NewGuid(), created.Id, created.Lines[0].Id, null,
                    "Quarterly", start, null), db, remote, Actor(), TimeProvider.System, default));
            }
            catch (DbUpdateConcurrencyException exception)
            {
                foreach (var entry in exception.Entries)
                    Console.WriteLine($"CONCURRENCY {entry.Metadata.Name} {entry.State} {entry.Property("Version").CurrentValue} {entry.Property("Version").OriginalValue}");
                throw;
            }
        }
        Assert.Single(planned.Plans);

        await using (var db = PostgresFixture.Db(connection, "customers"))
        {
            var generated = Body<JsonElement>(await ContractApi.Generate(created.Id,
                new(Guid.NewGuid(), created.Id, start.AddMonths(6)), db, Actor(), TimeProvider.System, default));
            Assert.Equal(3, generated.GetProperty("generated").GetInt32());
        }

        EntitlementDecision decision;
        await using (var db = PostgresFixture.Db(connection, "customers"))
            decision = Assert.IsType<Ok<EntitlementDecision>>(await ContractApi.Evaluate(db, Actor(), default, customerId, "HVAC")).Value!;
        Assert.True(decision.Covered);
        Assert.Equal(created.Id, decision.ContractId);
        Assert.Equal(2, decision.VisitsRemaining);

        await using var verify = PostgresFixture.Db(connection, "customers");
        Assert.Equal(1, await verify.Contracts.CountAsync());
        Assert.Equal(1, await verify.MaintenancePlans.CountAsync());
        Assert.Equal(3, await verify.MaintenanceVisits.CountAsync());
        Assert.Equal(4, await verify.Receipts.CountAsync());
        Assert.Equal(4, await verify.ContractEvents.CountAsync());
    }

    private static T Body<T>(IResult result) => Json.Read<T>(Assert.IsType<ContentHttpResult>(result).ResponseContent!);
    private static DefaultHttpContext Actor()
    {
        var http = new DefaultHttpContext
        {
            User = new ClaimsPrincipal(new ClaimsIdentity([
                new Claim("sub", "manager-01"), new Claim("team_id", "north"), new Claim(ClaimTypes.Role, "OperationsManager")
            ], "test"))
        };
        http.Items["CorrelationId"] = Guid.NewGuid().ToString();
        return http;
    }

    private sealed class NoRemote : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => throw new InvalidOperationException("No remote call expected in this test.");
    }
}
