using System.Net.Mail;
using System.Text.RegularExpressions;

namespace FieldOps.Core;

public sealed class Customer
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string DisplayName { get; set; } = "";
    public string CustomerType { get; set; } = "Commercial";
    public string TeamId { get; set; } = "north";
    public string Status { get; set; } = "Active";
    public string PreferredChannel { get; set; } = "None";
    public int Version { get; set; } = 1;
    public DateTimeOffset CreatedAtUtc { get; set; }
    public DateTimeOffset UpdatedAtUtc { get; set; }
    public List<CustomerContact> Contacts { get; set; } = [];
    public List<ServiceLocation> Locations { get; set; } = [];
}

public sealed class CustomerContact
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid CustomerId { get; set; }
    public string FullName { get; set; } = "";
    public string? Email { get; set; }
    public string? Phone { get; set; }
    public bool IsPrimary { get; set; }
    public bool EmailConsent { get; set; }
    public bool PhoneConsent { get; set; }
    public DateTimeOffset ConsentUpdatedAtUtc { get; set; }
}

public sealed class ServiceLocation
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid CustomerId { get; set; }
    public string Name { get; set; } = "";
    public string AddressLine1 { get; set; } = "";
    public string? AddressLine2 { get; set; }
    public string City { get; set; } = "";
    public string Region { get; set; } = "";
    public string PostalCode { get; set; } = "";
    public string CountryCode { get; set; } = "US";
    public string? AccessNotes { get; set; }
    public string Status { get; set; } = "Active";
    public string AddressSnapshot() => string.Join(", ", new[] { AddressLine1, AddressLine2, City, Region, PostalCode, CountryCode }.Where(x => !string.IsNullOrWhiteSpace(x)));
}

// Private operational history. Only opaque identifiers and aggregate counts leave this context.
public sealed class CustomerChange
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid CustomerId { get; set; }
    public int Version { get; set; }
    public string Action { get; set; } = "";
    public string ActorId { get; set; } = "";
    public string ActorRole { get; set; } = "";
    public string CorrelationId { get; set; } = "";
    public DateTimeOffset OccurredAtUtc { get; set; }
    public string DetailsJson { get; set; } = "{}";
}

public static class CustomerRules
{
    public static void Validate(Customer customer)
    {
        if (customer.Id == Guid.Empty || customer.Contacts.Any(x => x.Id == Guid.Empty) || customer.Locations.Any(x => x.Id == Guid.Empty)) Reject("Identifiers must not be empty.");
        Text(customer.DisplayName, 2, 100, "customer name");
        if (!Regex.IsMatch(customer.TeamId, "^[A-Za-z0-9_-]{2,64}$")) Reject("Invalid customer team.");
        if (customer.CustomerType is not ("Residential" or "Commercial")) Reject("Unknown customer type.");
        if (customer.Status is not ("Active" or "Archived")) Reject("Unknown customer status.");
        if (customer.PreferredChannel is not ("None" or "Email" or "Phone")) Reject("Unknown communication preference.");
        if (customer.Contacts.Count > 25) Reject("A customer may have at most 25 contacts.");
        if (customer.Locations.Count is < 1 or > 100) Reject("A customer needs between one and 100 service locations.");
        if (customer.Contacts.Count(x => x.IsPrimary) > 1) Reject("Only one contact may be primary.");
        if (customer.Contacts.Select(x => x.Id).Distinct().Count() != customer.Contacts.Count || customer.Locations.Select(x => x.Id).Distinct().Count() != customer.Locations.Count) Reject("Child identifiers must be distinct.");
        foreach (var contact in customer.Contacts)
        {
            Text(contact.FullName, 2, 100, "contact name");
            if (contact.Email is not null && (contact.Email.Length > 254 || !MailAddress.TryCreate(contact.Email, out var email) || email.Address != contact.Email)) Reject("Invalid contact email.");
            if (contact.Phone is not null && !Regex.IsMatch(contact.Phone, @"^\+?[0-9 .()x-]{5,40}$")) Reject("Invalid contact phone.");
            if (contact.Email is null && contact.Phone is null) Reject("A contact needs an email address or phone number.");
            if (contact.EmailConsent && contact.Email is null || contact.PhoneConsent && contact.Phone is null) Reject("Communication consent requires the corresponding contact detail.");
        }
        foreach (var location in customer.Locations)
        {
            Text(location.Name, 2, 100, "location name"); Text(location.AddressLine1, 3, 200, "address");
            Text(location.City, 2, 100, "city"); Text(location.PostalCode, 1, 20, "postal code");
            if (location.AddressLine2?.Length > 100 || location.Region.Length > 100 || location.AccessNotes?.Length > 1000) Reject("Location detail exceeds its maximum length.");
            if (!Regex.IsMatch(location.CountryCode, "^[A-Z]{2}$")) Reject("Country code must contain two letters.");
            if (location.Status is not ("Active" or "Archived")) Reject("Unknown location status.");
            if (location.AddressSnapshot().Length > 240) Reject("The full service address must not exceed 240 characters.");
        }
        if (customer.Status == "Active" && customer.Locations.All(x => x.Status != "Active")) Reject("An active customer needs an active service location.");
        if (customer.PreferredChannel == "Email" && !customer.Contacts.Any(x => x.EmailConsent) || customer.PreferredChannel == "Phone" && !customer.Contacts.Any(x => x.PhoneConsent)) Reject("The preferred channel needs a consenting contact.");
    }

    public static void Text(string? value, int minimum, int maximum, string field)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Trim().Length < minimum || value.Trim().Length > maximum) Reject($"{field} must contain {minimum} to {maximum} characters.");
    }

    private static void Reject(string message) => throw new DomainException(400, message);
}
