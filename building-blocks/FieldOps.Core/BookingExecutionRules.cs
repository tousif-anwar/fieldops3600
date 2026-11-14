namespace FieldOps.Core;

public static class BookingExecutionRules
{
    public static bool BeginService(Booking booking, DateTimeOffset now)
    {
        if (booking.Status != "Confirmed") throw new DomainException(409, "A confirmed appointment is required before starting service.");
        if (booking.ServiceStartedAtUtc.HasValue) return false;
        booking.ServiceStartedAtUtc = now.ToUniversalTime();
        booking.Version++;
        return true;
    }

    public static void RequireUnstarted(Booking booking)
    {
        if (booking.ServiceStartedAtUtc.HasValue)
            throw new DomainException(409, "Service has already started for this appointment. Ask a supervisor to manage the active service.");
    }
}
