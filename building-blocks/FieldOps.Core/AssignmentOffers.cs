namespace FieldOps.Core;

// Scheduling owns offers. A pending offer is an invitation, never a capacity reservation.
public sealed class AssignmentOffer
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid WorkOrderId { get; set; }
    public string TechnicianId { get; set; } = "";
    public string TeamId { get; set; } = "";
    public string WorkOrderNumber { get; set; } = "";
    public string Title { get; set; } = "";
    public string SiteAddress { get; set; } = "";
    public string ServiceCategory { get; set; } = "";
    public string Priority { get; set; } = "";
    public DateTimeOffset StartUtc { get; set; }
    public DateTimeOffset EndUtc { get; set; }
    public DateTimeOffset ExpiresAtUtc { get; set; }
    public DateTimeOffset CreatedAtUtc { get; set; }
    public DateTimeOffset? RespondedAtUtc { get; set; }
    public string Status { get; set; } = "Pending";
    public int Version { get; set; } = 1;
    public string? Reason { get; set; }
    public Guid? BookingId { get; set; }
}

public static class AssignmentOfferRules
{
    public static void ValidateWindow(DateTimeOffset start, DateTimeOffset end, DateTimeOffset expires, DateTimeOffset now)
    {
        if (start <= now) throw new DomainException(400, "An offer must be for a future appointment.");
        if (end <= start || end - start > TimeSpan.FromHours(8)) throw new DomainException(400, "Appointment duration must be positive and at most eight hours.");
        if (expires <= now || expires > start || expires > now.AddHours(24))
            throw new DomainException(400, "Offer expiration must be in the next 24 hours and no later than the appointment start.");
    }

    public static bool IsLive(AssignmentOffer offer, DateTimeOffset now) => offer.Status == "Pending" && offer.ExpiresAtUtc > now;

    public static void RequirePending(AssignmentOffer offer, int expectedVersion, DateTimeOffset now)
    {
        if (offer.Version != expectedVersion) throw new DomainException(409, "This offer changed. Refresh before responding.");
        if (!IsLive(offer, now)) throw new DomainException(409, "This assignment offer is no longer available.");
    }

    public static void Respond(AssignmentOffer offer, string status, int expectedVersion, DateTimeOffset now, string? reason = null, Guid? bookingId = null)
    {
        RequirePending(offer, expectedVersion, now);
        if (status is not ("Accepted" or "Declined" or "Revoked")) throw new DomainException(400, "Unknown assignment offer response.");
        if (status != "Accepted" && (string.IsNullOrWhiteSpace(reason) || reason.Trim().Length is < 3 or > 500))
            throw new DomainException(400, "A reason containing 3–500 characters is required.");
        if (status == "Accepted" && bookingId is null) throw new DomainException(409, "Acceptance requires a confirmed booking.");
        offer.Status = status;
        offer.RespondedAtUtc = now;
        offer.Reason = reason?.Trim();
        offer.BookingId = bookingId;
        offer.Version++;
    }

    public static bool Expire(AssignmentOffer offer, DateTimeOffset now)
    {
        if (offer.Status != "Pending" || offer.ExpiresAtUtc > now) return false;
        offer.Status = "Expired";
        offer.RespondedAtUtc = now;
        offer.Version++;
        return true;
    }
}
