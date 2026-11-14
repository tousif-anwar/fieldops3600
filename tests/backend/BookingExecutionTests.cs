using FieldOps.Core;
using FieldOps.ServiceHost;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Xunit;

namespace FieldOps.Tests;

public sealed class BookingExecutionRuleTests
{
    [Fact]
    public void BeginningServiceIsIdempotentAndMakesAppointmentImmutable()
    {
        var booking = new Booking();
        var now = DateTimeOffset.UtcNow;
        BookingExecutionRules.RequireUnstarted(booking);
        Assert.True(BookingExecutionRules.BeginService(booking, now));
        Assert.False(BookingExecutionRules.BeginService(booking, now.AddHours(1)));
        Assert.Equal(now, booking.ServiceStartedAtUtc);
        Assert.Equal(2, booking.Version);
        Assert.Throws<DomainException>(() => BookingExecutionRules.RequireUnstarted(booking));
    }

    [Fact]
    public void CancelledAppointmentCannotStartService() =>
        Assert.Throws<DomainException>(() => BookingExecutionRules.BeginService(new Booking { Status = "Cancelled" }, DateTimeOffset.UtcNow));
}

[Collection("PostgreSQL")]
[Trait("Category", "Integration")]
public sealed class BookingExecutionPostgresTests(PostgresFixture fixture)
{
    [Fact]
    public async Task CancellationIntentAndNewAllocationCannotBothCommit()
    {
        var cs = await fixture.Database("scheduling", false);
        var now = DateTimeOffset.UtcNow;
        var orderId = Guid.NewGuid();
        await using (var setup = PostgresFixture.Db(cs, "scheduling")) await SchemaMigrator.Apply(setup);
        async Task<bool> Change(bool cancel)
        {
            await using var db = PostgresFixture.Db(cs, "scheduling");
            await using var transaction = await db.Database.BeginTransactionAsync();
            await AssignmentOfferApi.LockOrder(db, orderId, CancellationToken.None);
            try
            {
                if (cancel) await AssignmentOfferApi.RecordCancellationIntent(db, orderId, now, CancellationToken.None);
                else
                {
                    await AssignmentOfferApi.RequireNotCancelling(db, orderId, CancellationToken.None);
                    db.Bookings.Add(new Booking { WorkOrderId = orderId, TechnicianId = "tech-01", StartUtc = now, EndUtc = now.AddHours(1) });
                    await db.SaveChangesAsync();
                }
            }
            catch (DomainException) { return false; }
            await transaction.CommitAsync();
            return true;
        }
        var results = await Task.WhenAll(Change(true), Change(false));
        Assert.Single(results, x => x);
        await using var inspect = PostgresFixture.Db(cs, "scheduling");
        Assert.Equal(results[0], await inspect.Database.SqlQuery<bool>($"SELECT EXISTS(SELECT 1 FROM work_order_cancellations WHERE work_order_id={orderId}) AS \"Value\"").SingleAsync());
        Assert.Equal(results[1] ? 1 : 0, await inspect.Bookings.CountAsync());
    }

    [Fact]
    public async Task CancellationIntentIsIdempotentAndRemainsARecoveryFenceAfterWorkOrderWriteFailure()
    {
        var cs = await fixture.Database("scheduling", false);
        await using var db = PostgresFixture.Db(cs, "scheduling");
        await SchemaMigrator.Apply(db);
        var orderId = Guid.NewGuid();
        await using (var transaction = await db.Database.BeginTransactionAsync())
        {
            await AssignmentOfferApi.LockOrder(db, orderId, CancellationToken.None);
            Assert.True(await AssignmentOfferApi.RecordCancellationIntent(db, orderId, DateTimeOffset.UtcNow, CancellationToken.None));
            await transaction.CommitAsync();
        }
        await using (var retry = PostgresFixture.Db(cs, "scheduling"))
        {
            await using var transaction = await retry.Database.BeginTransactionAsync();
            await AssignmentOfferApi.LockOrder(retry, orderId, CancellationToken.None);
            Assert.False(await AssignmentOfferApi.RecordCancellationIntent(retry, orderId, DateTimeOffset.UtcNow.AddMinutes(1), CancellationToken.None));
            await Assert.ThrowsAsync<DomainException>(() => AssignmentOfferApi.RequireNotCancelling(retry, orderId, CancellationToken.None));
            await transaction.CommitAsync();
        }
    }

    [Fact]
    public async Task ConcurrentServiceStartAndCancellationCannotBothCommit()
    {
        var cs = await fixture.Database("scheduling", false);
        var now = DateTimeOffset.UtcNow;
        var booking = new Booking { WorkOrderId = Guid.NewGuid(), TechnicianId = "tech-01", StartUtc = now.AddHours(1), EndUtc = now.AddHours(2) };
        await using (var setup = PostgresFixture.Db(cs, "scheduling"))
        {
            await SchemaMigrator.Apply(setup);
            setup.Bookings.Add(booking);
            await setup.SaveChangesAsync();
        }
        async Task<bool> Change(bool begin)
        {
            await using var db = PostgresFixture.Db(cs, "scheduling");
            await using var transaction = await db.Database.BeginTransactionAsync();
            await AssignmentOfferApi.LockOrder(db, booking.WorkOrderId, CancellationToken.None);
            var current = await db.Bookings.SingleAsync();
            try
            {
                if (begin) BookingExecutionRules.BeginService(current, now);
                else
                {
                    BookingExecutionRules.RequireUnstarted(current);
                    if (current.Status != "Confirmed") return false;
                    current.Status = "Cancelled";
                    current.Version++;
                }
            }
            catch (DomainException) { return false; }
            var revision = await AssignmentOfferApi.NextAssignmentRevision(db, current.WorkOrderId, CancellationToken.None);
            db.Enqueue(EventFactory.Create(null, "scheduling", begin ? "BookingServiceStarted.v1" : "BookingCancelled.v1", current.WorkOrderId, current, revision, now));
            await db.SaveChangesAsync();
            await transaction.CommitAsync();
            return true;
        }
        var results = await Task.WhenAll(Change(true), Change(false));
        Assert.Single(results, x => x);
        await using var inspect = PostgresFixture.Db(cs, "scheduling");
        var final = await inspect.Bookings.SingleAsync();
        Assert.Equal(results[0], final.ServiceStartedAtUtc.HasValue);
        Assert.Equal(results[0] ? "Confirmed" : "Cancelled", final.Status);
        Assert.Single(await inspect.Outbox.ToListAsync());
    }

    [Fact]
    public async Task DatabaseRejectsCancellingClaimedAppointmentEvenWhenApplicationGuardIsBypassed()
    {
        var cs = await fixture.Database("scheduling", false);
        var now = DateTimeOffset.UtcNow;
        await using var db = PostgresFixture.Db(cs, "scheduling");
        await SchemaMigrator.Apply(db);
        db.Bookings.Add(new Booking { WorkOrderId = Guid.NewGuid(), TechnicianId = "tech-01", StartUtc = now, EndUtc = now.AddHours(1), ServiceStartedAtUtc = now });
        await db.SaveChangesAsync();
        var rejected = await Assert.ThrowsAsync<PostgresException>(() => db.Database.ExecuteSqlRawAsync("UPDATE bookings SET \"Status\"='Cancelled'"));
        Assert.Equal("23514", rejected.SqlState);
    }
}
