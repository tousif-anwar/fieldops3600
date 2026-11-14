using FieldOps.Core;
using FieldOps.ServiceHost;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Xunit;

namespace FieldOps.Tests;

public sealed class AssignmentOfferRuleTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 13, 14, 0, 0, TimeSpan.Zero);
    private static AssignmentOffer Offer() => new()
    {
        WorkOrderId = Guid.NewGuid(), TechnicianId = "tech-01", TeamId = "north",
        StartUtc = Now.AddHours(2), EndUtc = Now.AddHours(3), ExpiresAtUtc = Now.AddMinutes(30), CreatedAtUtc = Now
    };

    [Fact]
    public void OfferWindowRequiresFutureBoundedExpirationBeforeAppointment()
    {
        AssignmentOfferRules.ValidateWindow(Now.AddHours(2), Now.AddHours(3), Now.AddMinutes(30), Now);
        Assert.Throws<DomainException>(() => AssignmentOfferRules.ValidateWindow(Now, Now.AddHours(1), Now.AddMinutes(10), Now));
        Assert.Throws<DomainException>(() => AssignmentOfferRules.ValidateWindow(Now.AddHours(2), Now.AddHours(3), Now, Now));
        Assert.Throws<DomainException>(() => AssignmentOfferRules.ValidateWindow(Now.AddHours(2), Now.AddHours(3), Now.AddHours(3), Now));
        Assert.Throws<DomainException>(() => AssignmentOfferRules.ValidateWindow(Now.AddDays(3), Now.AddDays(3).AddHours(1), Now.AddHours(25), Now));
        Assert.Throws<DomainException>(() => AssignmentOfferRules.ValidateWindow(Now.AddHours(2), Now.AddHours(11), Now.AddMinutes(1), Now));
    }

    [Theory]
    [InlineData("Declined")]
    [InlineData("Revoked")]
    public void DeclineAndRevokeRequireReasonAndCannotBeRepeated(string response)
    {
        var offer = Offer();
        Assert.Throws<DomainException>(() => AssignmentOfferRules.Respond(offer, response, 1, Now, " "));
        AssignmentOfferRules.Respond(offer, response, 1, Now.AddMinutes(1), "Conflicts with approved assignment");
        Assert.Equal(response, offer.Status);
        Assert.Equal(2, offer.Version);
        Assert.NotNull(offer.RespondedAtUtc);
        Assert.Throws<DomainException>(() => AssignmentOfferRules.Respond(offer, "Accepted", 2, Now.AddMinutes(2), bookingId: Guid.NewGuid()));
    }

    [Fact]
    public void AcceptanceRequiresBookingCurrentVersionAndLiveOffer()
    {
        var offer = Offer();
        Assert.Throws<DomainException>(() => AssignmentOfferRules.Respond(offer, "Accepted", 1, Now));
        Assert.Throws<DomainException>(() => AssignmentOfferRules.Respond(offer, "Accepted", 2, Now, bookingId: Guid.NewGuid()));
        Assert.Throws<DomainException>(() => AssignmentOfferRules.Respond(offer, "Accepted", 1, offer.ExpiresAtUtc, bookingId: Guid.NewGuid()));
        var booking = Guid.NewGuid();
        AssignmentOfferRules.Respond(offer, "Accepted", 1, Now.AddMinutes(1), bookingId: booking);
        Assert.Equal(booking, offer.BookingId);
        Assert.Equal("Accepted", offer.Status);
    }

    [Fact]
    public void ExpirationIsAnIdempotentTerminalTransition()
    {
        var offer = Offer();
        Assert.False(AssignmentOfferRules.Expire(offer, Now));
        Assert.True(AssignmentOfferRules.Expire(offer, offer.ExpiresAtUtc));
        Assert.False(AssignmentOfferRules.Expire(offer, offer.ExpiresAtUtc.AddMinutes(1)));
        Assert.Equal(2, offer.Version);
        Assert.Equal("Expired", offer.Status);
        Assert.Throws<DomainException>(() => AssignmentOfferRules.Respond(offer, "Accepted", 2, offer.ExpiresAtUtc, bookingId: Guid.NewGuid()));
    }

    [Theory]
    [InlineData("InProgress")]
    [InlineData("Completed")]
    [InlineData("Cancelled")]
    public void StartedAndClosedOrdersCannotReceiveOffers(string status) =>
        Assert.Throws<DomainException>(() => AssignmentOfferApi.RequireSchedulable(new WorkOrder { Status = status }));
}

[Collection("PostgreSQL")]
[Trait("Category", "Integration")]
public sealed class AssignmentOfferPostgresTests(PostgresFixture fixture)
{
    private static AssignmentOffer Offer(DateTimeOffset now, Guid? orderId = null) => new()
    {
        WorkOrderId = orderId ?? Guid.NewGuid(), TechnicianId = "tech-01", TeamId = "north", Title = "Synthetic maintenance",
        WorkOrderNumber = "WO-OFFER-TEST", SiteAddress = "Synthetic test location", ServiceCategory = "HVAC", Priority = "Normal",
        StartUtc = now.AddHours(2), EndUtc = now.AddHours(3), ExpiresAtUtc = now.AddMinutes(30), CreatedAtUtc = now
    };

    private async Task<string> Database()
    {
        var cs = await fixture.Database("scheduling", false);
        await using var db = PostgresFixture.Db(cs, "scheduling");
        await SchemaMigrator.Apply(db);
        return cs;
    }

    [Fact]
    public async Task ConcurrentAcceptanceCommitsExactlyOneBookingAndOfferResponse()
    {
        var cs = await Database();
        var now = DateTimeOffset.UtcNow;
        var offer = Offer(now);
        await using (var setup = PostgresFixture.Db(cs, "scheduling")) { setup.AssignmentOffers.Add(offer); await setup.SaveChangesAsync(); }
        async Task<bool> Accept()
        {
            await using var db = PostgresFixture.Db(cs, "scheduling");
            await using var transaction = await db.Database.BeginTransactionAsync();
            await AssignmentOfferApi.LockOrder(db, offer.WorkOrderId, CancellationToken.None);
            var candidate = await db.AssignmentOffers.SingleAsync();
            try { AssignmentOfferRules.RequirePending(candidate, 1, now); } catch (DomainException) { return false; }
            var booking = new Booking { WorkOrderId = candidate.WorkOrderId, TechnicianId = candidate.TechnicianId,
                TeamId = candidate.TeamId, StartUtc = candidate.StartUtc, EndUtc = candidate.EndUtc };
            AssignmentOfferRules.Respond(candidate, "Accepted", 1, now, bookingId: booking.Id);
            db.Bookings.Add(booking);
            var revision = await AssignmentOfferApi.NextAssignmentRevision(db, candidate.WorkOrderId, CancellationToken.None);
            db.Enqueue(EventFactory.Create(null, "scheduling", "BookingCreated.v1", candidate.WorkOrderId, booking, revision, now));
            await db.SaveChangesAsync();
            await transaction.CommitAsync();
            return true;
        }
        var outcomes = await Task.WhenAll(Accept(), Accept());
        Assert.Single(outcomes, x => x);
        await using var inspect = PostgresFixture.Db(cs, "scheduling");
        Assert.Single(await inspect.Bookings.ToListAsync());
        Assert.Single(await inspect.Outbox.ToListAsync());
        var accepted = await inspect.AssignmentOffers.SingleAsync();
        Assert.Equal("Accepted", accepted.Status);
        Assert.Equal(2, accepted.Version);
        Assert.Equal((await inspect.Bookings.SingleAsync()).Id, accepted.BookingId);
    }

    [Fact]
    public async Task DirectBookingRevokesInvitationInItsOwnTransactionAndRollbackPreservesIt()
    {
        var cs = await Database();
        var now = DateTimeOffset.UtcNow;
        var offer = Offer(now);
        await using (var setup = PostgresFixture.Db(cs, "scheduling")) { setup.AssignmentOffers.Add(offer); await setup.SaveChangesAsync(); }
        await using (var rollback = PostgresFixture.Db(cs, "scheduling"))
        {
            await using var transaction = await rollback.Database.BeginTransactionAsync();
            await AssignmentOfferApi.LockOrder(rollback, offer.WorkOrderId, CancellationToken.None);
            await AssignmentOfferApi.RevokeForDirectBooking(rollback, offer.WorkOrderId, now, new DefaultHttpContext(), CancellationToken.None);
            await rollback.SaveChangesAsync();
            await transaction.RollbackAsync();
        }
        await using var db = PostgresFixture.Db(cs, "scheduling");
        Assert.Equal("Pending", (await db.AssignmentOffers.AsNoTracking().SingleAsync()).Status);
        Assert.Empty(await db.Outbox.ToListAsync());
        await using (var transaction = await db.Database.BeginTransactionAsync())
        {
            await AssignmentOfferApi.LockOrder(db, offer.WorkOrderId, CancellationToken.None);
            await AssignmentOfferApi.RevokeForDirectBooking(db, offer.WorkOrderId, now, new DefaultHttpContext(), CancellationToken.None);
            db.Bookings.Add(new Booking { WorkOrderId = offer.WorkOrderId, TechnicianId = "tech-02", TeamId = "north", StartUtc = offer.StartUtc, EndUtc = offer.EndUtc });
            await db.SaveChangesAsync();
            await transaction.CommitAsync();
        }
        Assert.Equal("Revoked", (await db.AssignmentOffers.SingleAsync()).Status);
        Assert.Single(await db.Bookings.ToListAsync());
        Assert.Single(await db.Outbox.ToListAsync());
    }

    [Fact]
    public async Task ExpiredPendingOfferCanBeReplacedWithoutDuplicatingExpirationEvent()
    {
        var cs = await Database();
        var now = DateTimeOffset.UtcNow;
        var old = Offer(now.AddHours(-1));
        await using var db = PostgresFixture.Db(cs, "scheduling");
        db.AssignmentOffers.Add(old); await db.SaveChangesAsync();
        await using var transaction = await db.Database.BeginTransactionAsync();
        await AssignmentOfferApi.LockOrder(db, old.WorkOrderId, CancellationToken.None);
        await AssignmentOfferApi.ExpireForOrder(db, old.WorkOrderId, now, null, CancellationToken.None);
        db.AssignmentOffers.Add(Offer(now, old.WorkOrderId));
        await db.SaveChangesAsync();
        await AssignmentOfferApi.ExpireForOrder(db, old.WorkOrderId, now, null, CancellationToken.None);
        await transaction.CommitAsync();
        Assert.Equal(2, await db.AssignmentOffers.CountAsync());
        Assert.Equal(1, await db.AssignmentOffers.CountAsync(x => x.Status == "Pending"));
        Assert.Single(await db.Outbox.ToListAsync());
    }

    [Fact]
    public async Task DatabaseRejectsDuplicatePendingOfferAndAcceptanceWithoutBooking()
    {
        var cs = await Database();
        var offer = Offer(DateTimeOffset.UtcNow);
        await using var db = PostgresFixture.Db(cs, "scheduling");
        db.AssignmentOffers.Add(offer); await db.SaveChangesAsync();
        db.AssignmentOffers.Add(Offer(offer.CreatedAtUtc, offer.WorkOrderId));
        var duplicate = await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
        Assert.Equal("23505", Assert.IsType<PostgresException>(duplicate.InnerException).SqlState);
        db.ChangeTracker.Clear();
        var invalid = await Assert.ThrowsAsync<PostgresException>(() => db.Database.ExecuteSqlRawAsync("UPDATE assignment_offers SET \"Status\"='Accepted',\"RespondedAtUtc\"=now()"));
        Assert.Equal("23514", invalid.SqlState);
    }

    [Fact]
    public async Task AssignmentRevisionSurvivesConcurrentWritersAndRollsBackWithFailedBooking()
    {
        var cs = await Database();
        var orderId = Guid.NewGuid();
        async Task<long> Advance()
        {
            await using var db = PostgresFixture.Db(cs, "scheduling");
            await using var transaction = await db.Database.BeginTransactionAsync();
            await AssignmentOfferApi.LockOrder(db, orderId, CancellationToken.None);
            var revision = await AssignmentOfferApi.NextAssignmentRevision(db, orderId, CancellationToken.None);
            await transaction.CommitAsync();
            return revision;
        }
        var revisions = await Task.WhenAll(Enumerable.Range(0, 8).Select(_ => Advance()));
        Assert.Equal(Enumerable.Range(1, 8).Select(x => (long)x), revisions.Order());
        await using (var db = PostgresFixture.Db(cs, "scheduling"))
        {
            await using var transaction = await db.Database.BeginTransactionAsync();
            await AssignmentOfferApi.LockOrder(db, orderId, CancellationToken.None);
            Assert.Equal(9, await AssignmentOfferApi.NextAssignmentRevision(db, orderId, CancellationToken.None));
            await transaction.RollbackAsync();
        }
        Assert.Equal(9, await Advance());
        await using var inspect = PostgresFixture.Db(cs, "scheduling");
        Assert.Equal(9, await inspect.Database.SqlQuery<long>($"SELECT revision AS \"Value\" FROM assignment_revisions WHERE work_order_id={orderId}").SingleAsync());
    }
}
