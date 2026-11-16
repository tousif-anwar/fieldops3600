using FieldOps.Core;
using FieldOps.ServiceHost;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Xunit;

namespace FieldOps.Tests;

[Collection("PostgreSQL")]
[Trait("Category", "Integration")]
public sealed class ContractPostgresTests(PostgresFixture fixture)
{
    [Fact]
    public async Task ContractMigrationCreatesAppendOnlyUsageAndEventEvidence()
    {
        var connection = await fixture.Database("customers", false);
        var now = DateTimeOffset.UtcNow;
        var customerId = Guid.NewGuid();
        var contractId = Guid.NewGuid();
        var lineId = Guid.NewGuid();
        await using (var db = PostgresFixture.Db(connection, "customers"))
        {
            await SchemaMigrator.Apply(db);
            db.Customers.Add(new Customer
            {
                Id = customerId, DisplayName = "Contract test customer", TeamId = "north",
                Status = "Active", CreatedAtUtc = now, UpdatedAtUtc = now
            });
            var contract = new MaintenanceContract
            {
                Id = contractId, TeamId = "north", CustomerId = customerId, Status = "Active",
                EffectiveFromUtc = now.AddDays(-1), ExpiresAtUtc = now.AddYears(1), TimeZoneId = "UTC",
                CoversAllAssets = true, CreatedAtUtc = now, UpdatedAtUtc = now
            };
            contract.Lines.Add(new ContractLine
            {
                Id = lineId, ContractId = contractId, ServiceType = "HVAC", LaborCovered = true,
                PartsCovered = true, IncludedVisits = 2, PartsAllowance = 100m
            });
            db.Contracts.Add(contract);
            await db.SaveChangesAsync();
            db.ContractEvents.Add(new ContractEvent
            {
                ContractId = contractId, Version = 1, Action = "MaintenanceContractCreated.v1",
                ActorId = "manager-01", ActorRole = "OperationsManager", CorrelationId = "test",
                OccurredAtUtc = now, DetailsJson = "{}"
            });
            db.ContractUsage.Add(new ContractUsage
            {
                ContractId = contractId, ContractLineId = lineId, WorkOrderId = Guid.NewGuid(),
                VisitsUsed = 1, PartsCost = 25m, OccurredAtUtc = now
            });
            await db.SaveChangesAsync();
        }

        await using (var verify = PostgresFixture.Db(connection, "customers"))
        {
            await SchemaMigrator.Apply(verify);
            Assert.Equal(5, await verify.Database.SqlQueryRaw<int>(
                "SELECT count(*)::integer AS \"Value\" FROM fieldops_schema_migrations").SingleAsync());
            Assert.Equal(1, await verify.ContractEvents.CountAsync());
            Assert.Equal(1, await verify.ContractUsage.CountAsync());
            foreach (var forbidden in new[]
                     {
                         "UPDATE contract_events SET \"Action\"='tampered'", "DELETE FROM contract_events", "TRUNCATE contract_events",
                         "UPDATE contract_usage SET \"PartsCost\"=0", "DELETE FROM contract_usage", "TRUNCATE contract_usage"
                     })
            {
                var rejected = await Assert.ThrowsAsync<PostgresException>(() => verify.Database.ExecuteSqlRawAsync(forbidden));
                Assert.Contains(rejected.SqlState, new[] { "42501", "P0001" });
            }
            var rejectedInsert = await Assert.ThrowsAsync<PostgresException>(() => verify.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO contract_lines("Id","ContractId","ServiceType","LaborCovered","PartsCovered","IncludedVisits","PartsAllowance","Active")
                VALUES(gen_random_uuid(),{contractId},'Electrical',true,false,-1,0,true)
                """));
            Assert.Equal("23514", rejectedInsert.SqlState);
        }
    }
}
