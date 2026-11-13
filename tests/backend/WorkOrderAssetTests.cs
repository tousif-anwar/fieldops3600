using FieldOps.Core;
using FieldOps.ServiceHost;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Xunit;

namespace FieldOps.Tests;

[Collection("PostgreSQL")]
[Trait("Category", "Integration")]
public sealed class WorkOrderAssetTests(PostgresFixture fixture)
{
    [Fact]
    public async Task AssetReferenceRequiresRegisteredCustomerAndPersistsOnTheOrder()
    {
        var cs = await fixture.Database("work-orders", false);
        await using var db = PostgresFixture.Db(cs, "work-orders");
        await SchemaMigrator.Apply(db);

        var assetId = Guid.NewGuid();
        var order = new WorkOrder
        {
            Number = "WO-ASSET-1", Title = "Asset linked service", CustomerName = "Synthetic Customer",
            SiteAddress = "1 Example Street", CustomerId = Guid.NewGuid(), ServiceLocationId = Guid.NewGuid(),
            CustomerVersion = 1, AssetId = assetId, TeamId = "north", CreatedAtUtc = DateTimeOffset.UtcNow
        };
        db.WorkOrders.Add(order);
        await db.SaveChangesAsync();

        await using var reload = PostgresFixture.Db(cs, "work-orders");
        Assert.Equal(assetId, (await reload.WorkOrders.SingleAsync()).AssetId);

        await using var invalid = PostgresFixture.Db(cs, "work-orders");
        invalid.WorkOrders.Add(new WorkOrder
        {
            Number = "WO-LEGACY-ASSET", Title = "Legacy order", CustomerName = "Legacy Customer",
            SiteAddress = "Legacy address", UnregisteredCustomerReason = "Legacy record without a registry customer.",
            AssetId = Guid.NewGuid(), TeamId = "north", CreatedAtUtc = DateTimeOffset.UtcNow
        });
        var error = await Assert.ThrowsAsync<DbUpdateException>(() => invalid.SaveChangesAsync());
        Assert.Equal("23514", Assert.IsType<PostgresException>(error.InnerException).SqlState);
    }
}
