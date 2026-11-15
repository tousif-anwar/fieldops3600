using FieldOps.Core;
using FieldOps.ServiceHost;
using MassTransit;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace FieldOps.Tests;

[Collection("PostgreSQL")]
[Trait("Category", "Integration")]
public sealed class InventoryReportingTests(PostgresFixture fixture)
{
    [Fact]
    public async Task RelatedConsumptionIsRetainedAndDeduplicatedWithoutInventingOrderOrStageFacts()
    {
        var orderId = Guid.NewGuid();
        var stageId = Guid.NewGuid();
        var occurred = DateTimeOffset.UtcNow;
        var message = EventFactory.Create(null, "inventory", "PartConsumed.v1", orderId,
            new { teamId = "north", technicianId = "tech-01", quantity = 2m }, 1, occurred, stageId: stageId);

        await WithConsumer(async (bus, connection) =>
        {
            await PublishAndObserve(bus, connection, message, 1);
            await PublishAndObserve(bus, connection, message, 2);
            await using var inspect = PostgresFixture.Db(connection, "reporting");
            var retained = Assert.Single(await inspect.Events.AsNoTracking().ToListAsync());
            Assert.Equal(message.EventId, retained.EventId);
            Assert.Equal(Json.Write(message), retained.Body);
            Assert.Equal("inventory", retained.SourceService);
            Assert.Equal(orderId, retained.WorkOrderId);
            Assert.Single(await inspect.Inbox.ToListAsync());
            Assert.Equal(2, await inspect.DeliveryAttempts.CountAsync());
            Assert.Equal(1, (await inspect.ReplayProjections.SingleAsync()).EventCount);
            Assert.Empty(await inspect.WorkOrderFacts.ToListAsync());
            Assert.Empty(await inspect.StageFacts.ToListAsync());
        });
    }

    [Fact]
    public async Task UnrelatedStockReceiptDoesNotCreateAnEmptyOrderReplayOrAnalyticalFact()
    {
        var message = EventFactory.Create(null, "inventory", "InventoryMovementRecorded.v1", Guid.Empty,
            new { teamId = "north", quantity = 5m }, 1, DateTimeOffset.UtcNow);
        await WithConsumer(async (bus, connection) =>
        {
            await PublishAndObserve(bus, connection, message, 1);
            await using var inspect = PostgresFixture.Db(connection, "reporting");
            Assert.Equal(Json.Write(message), (await inspect.Events.SingleAsync()).Body);
            Assert.Empty(await inspect.ReplayProjections.ToListAsync());
            Assert.Empty(await inspect.WorkOrderFacts.ToListAsync());
            Assert.Empty(await inspect.StageFacts.ToListAsync());
        });
    }

    [Fact]
    public async Task InventoryActivityDoesNotChangeAnObservedOrdersStateAssignmentOrFreshness()
    {
        var orderId = Guid.NewGuid();
        var createdAt = DateTimeOffset.FromUnixTimeSeconds(DateTimeOffset.UtcNow.ToUnixTimeSeconds());
        var created = EventFactory.Create(null, "work-orders", "WorkOrderCreated.v1", orderId,
            new { teamId = "north", number = "WO-INVENTORY-PROJECTION", serviceCategory = "HVAC", priority = "Normal", createdAtUtc = createdAt }, 1, createdAt);
        var consumed = EventFactory.Create(null, "inventory", "PartConsumed.v1", orderId,
            new { teamId = "north", technicianId = "another-technician", quantity = 1m }, 1, createdAt.AddMinutes(30));

        await WithConsumer(async (bus, connection) =>
        {
            await PublishAndObserve(bus, connection, created, 1);
            WorkOrderFact before;
            await using (var read = PostgresFixture.Db(connection, "reporting")) before = await read.WorkOrderFacts.AsNoTracking().SingleAsync();
            await PublishAndObserve(bus, connection, consumed, 1);
            await using var inspect = PostgresFixture.Db(connection, "reporting");
            var after = await inspect.WorkOrderFacts.SingleAsync();
            Assert.Equal(before.Status, after.Status);
            Assert.Equal(before.TechnicianId, after.TechnicianId);
            Assert.Equal(before.UpdatedAtUtc, after.UpdatedAtUtc);
            Assert.Equal(before.CreatedAtUtc, after.CreatedAtUtc);
            Assert.Equal(2, await inspect.Events.CountAsync());
            Assert.Equal(2, (await inspect.ReplayProjections.SingleAsync()).EventCount);
        });
    }

    private async Task WithConsumer(Func<IBusControl, string, Task> verify)
    {
        var connection = await fixture.Database("reporting", false);
        await using (var migrate = PostgresFixture.Db(connection, "reporting")) await SchemaMigrator.Apply(migrate);
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton(TimeProvider.System);
        services.AddSingleton(new ServiceIdentity("reporting"));
        services.AddSingleton<IConfiguration>(new ConfigurationBuilder().Build());
        services.AddDbContext<ServiceDb>(options => options.UseNpgsql(connection).ReplaceService<IModelCacheKeyFactory, ServiceModelKeyFactory>());
        services.AddSignalR();
        services.AddMassTransit(config =>
        {
            config.AddConsumer<OperationalConsumer>();
            config.UsingInMemory((context, transport) => transport.ConfigureEndpoints(context));
        });
        await using var provider = services.BuildServiceProvider();
        var bus = provider.GetRequiredService<IBusControl>();
        await bus.StartAsync();
        try { await verify(bus, connection); }
        finally { await bus.StopAsync(); }
    }

    private static async Task PublishAndObserve(IBusControl bus, string connection, AuditEvent message, int expectedDeliveries)
    {
        await bus.Publish(message, context => context.MessageId = message.EventId);
        for (var attempt = 0; attempt < 100; attempt++)
        {
            await using var read = PostgresFixture.Db(connection, "reporting");
            if (await read.DeliveryAttempts.CountAsync(x => x.EventId == message.EventId) >= expectedDeliveries) return;
            await Task.Delay(50);
        }
        Assert.Fail("The actual reporting consumer did not commit the expected delivery observation.");
    }
}
