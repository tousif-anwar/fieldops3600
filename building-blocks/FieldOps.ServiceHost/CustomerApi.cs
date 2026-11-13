using System.Security.Cryptography;
using System.Text;
using FieldOps.Core;
using Microsoft.EntityFrameworkCore;

namespace FieldOps.ServiceHost;

public sealed record CustomerContactInput(Guid? Id, string FullName, string? Email, string? Phone, bool IsPrimary = false, bool EmailConsent = false, bool PhoneConsent = false);
public sealed record ServiceLocationInput(Guid? Id, string Name, string AddressLine1, string? AddressLine2, string City, string? Region, string PostalCode, string CountryCode, string? AccessNotes, string Status = "Active");
public sealed record CreateCustomer(string DisplayName, string CustomerType, string TeamId, string PreferredChannel, CustomerContactInput[]? Contacts, ServiceLocationInput[]? Locations, string Status = "Active");
public sealed record UpdateCustomer(int ExpectedVersion, string DisplayName, string CustomerType, string PreferredChannel, CustomerContactInput[]? Contacts, ServiceLocationInput[]? Locations, string Status = "Active");
public sealed record CustomerContactView(Guid Id, string FullName, string? Email, string? Phone, bool IsPrimary, bool EmailConsent, bool PhoneConsent, DateTimeOffset ConsentUpdatedAtUtc);
public sealed record ServiceLocationView(Guid Id, string Name, string AddressLine1, string? AddressLine2, string City, string Region, string PostalCode, string CountryCode, string? AccessNotes, string Status);
public sealed record CustomerView(Guid Id, string DisplayName, string CustomerType, string TeamId, string Status, string PreferredChannel, int Version, DateTimeOffset CreatedAtUtc, DateTimeOffset UpdatedAtUtc, CustomerContactView[] Contacts, ServiceLocationView[] Locations);

public static class CustomerApi
{
    public static void Map(WebApplication app)
    {
        // Technician access is deliberately a separate, assigned-work-order-only route.
        var office = app.MapGroup("/api/customers").RequireAuthorization("dispatch");
        office.MapGet("", List);
        office.MapGet("/{id:guid}", async (Guid id, ServiceDb db, HttpContext http, CancellationToken ct) => Results.Ok(View(await Find(id, db, http, false, ct))));
        office.MapPost("", Create);
        office.MapPut("/{id:guid}", Update);
        office.MapGet("/{id:guid}/history", async (Guid id, ServiceDb db, HttpContext http, CancellationToken ct) =>
        {
            _ = await Find(id, db, http, false, ct);
            var changes = await db.CustomerChanges.AsNoTracking().Where(x => x.CustomerId == id).OrderByDescending(x => x.Version).Take(500).ToListAsync(ct);
            return Results.Ok(changes.Select(x => new { x.Id, x.CustomerId, x.Version, x.ActorId, x.ActorRole, x.OccurredAtUtc, eventType = x.Action, x.CorrelationId, changedFields = Json.Read<ChangeDetails>(x.DetailsJson).ChangedFields, consentChanges = Json.Read<ChangeDetails>(x.DetailsJson).ConsentChanges }));
        });
        app.MapGet("/api/customers/{id:guid}/service-context", async (Guid id, Guid workOrderId, ServiceDb db, RemoteServices remote, HttpContext http, CancellationToken ct) =>
        {
            // The work-order owner repeats signed-identity and assignment checks. No list of
            // customers, locations, or contacts becomes available to a technician by guessing IDs.
            var order = await remote.Get<WorkOrder>("WorkOrders", $"/api/work-orders/{workOrderId}", http, ct);
            Caller.From(http.User).Demand(order.TeamId, order.TechnicianId);
            if (order.CustomerId != id || order.ServiceLocationId is null) throw new DomainException(404, "Customer service context was not found.");
            var customer = await db.Customers.AsNoTracking().Include(x => x.Contacts).Include(x => x.Locations).AsSplitQuery().SingleOrDefaultAsync(x => x.Id == id && x.TeamId == order.TeamId, ct) ?? throw new DomainException(404, "Customer service context was not found.");
            var location = customer.Locations.SingleOrDefault(x => x.Id == order.ServiceLocationId) ?? throw new DomainException(404, "Service location was not found.");
            http.Response.Headers.CacheControl = "no-store";
            return Results.Ok(new { customerId = customer.Id, customer.DisplayName, customer.CustomerType, customer.PreferredChannel, customer.Version, location = LocationView(location), contacts = customer.Contacts.OrderByDescending(x => x.IsPrimary).ThenBy(x => x.FullName).Select(ContactView) });
        }).RequireAuthorization("operational");
    }

    private static async Task<IResult> List(ServiceDb db, HttpContext http, CancellationToken ct, string? search = null, string? status = null, string? sort = null, int page = 1, int pageSize = 25)
    {
        if (page < 1 || page > 1_000_000 || pageSize is < 1 or > 100) throw new DomainException(400, "Invalid customer pagination.");
        if (status is not (null or "" or "Active" or "Archived")) throw new DomainException(400, "Unknown customer status filter.");
        if (sort is not (null or "" or "name" or "-name" or "-created")) throw new DomainException(400, "Unknown customer sort.");
        if (search?.Length > 100) throw new DomainException(400, "Search must not exceed 100 characters.");
        var caller = Caller.From(http.User);
        var query = db.Customers.AsNoTracking().Where(x => caller.IsAdministrator || x.TeamId == caller.TeamId);
        if (!string.IsNullOrEmpty(status)) query = query.Where(x => x.Status == status);
        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.Trim().ToLowerInvariant();
            query = query.Where(x => x.DisplayName.ToLower().Contains(term));
        }
        var total = await query.CountAsync(ct);
        query = sort switch { "-name" => query.OrderByDescending(x => x.DisplayName).ThenBy(x => x.Id), "-created" => query.OrderByDescending(x => x.CreatedAtUtc).ThenBy(x => x.Id), _ => query.OrderBy(x => x.DisplayName).ThenBy(x => x.Id) };
        var records = await query.Skip((page - 1) * pageSize).Take(pageSize).Include(x => x.Contacts).Include(x => x.Locations).AsSplitQuery().ToListAsync(ct);
        return Results.Ok(new { items = records.Select(View), total, page, pageSize });
    }

    private static async Task<IResult> Create(CreateCustomer request, ServiceDb db, TimeProvider clock, HttpContext http, CancellationToken ct)
    {
        var caller = Caller.From(http.User); caller.Demand(request.TeamId);
        var now = clock.GetUtcNow();
        var key = http.Request.Headers["Idempotency-Key"].ToString();
        string? receiptId = null;
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(Json.Write(request))));
        if (key.Length > 0)
        {
            CustomerRules.Text(key, 8, 128, "idempotency key");
            receiptId = $"{caller.Id}:customer-create:{key}";
            var receipt = await db.Receipts.AsNoTracking().SingleOrDefaultAsync(x => x.Id == receiptId, ct);
            if (receipt is not null)
            {
                if (receipt.RequestHash != hash) throw new DomainException(409, "This idempotency key was used for a different request.");
                var response = Json.Read<CustomerView>(receipt.ResponseJson);
                return Results.Created($"/api/customers/{response.Id}", response);
            }
        }
        var customer = new Customer { TeamId = Trim(request.TeamId), DisplayName = Trim(request.DisplayName), CustomerType = request.CustomerType, PreferredChannel = request.PreferredChannel, Status = request.Status, CreatedAtUtc = now, UpdatedAtUtc = now };
        ApplyChildren(customer, request.Contacts, request.Locations, now, false);
        CustomerRules.Validate(customer);
        db.Customers.Add(customer);
        AddChange(db, http, customer, "CustomerRegistered.v1", ["displayName", "customerType", "status", "preferredChannel", "contacts", "locations"], customer.Contacts.Select(x => new ConsentChange(x.Id, null, x.EmailConsent, null, x.PhoneConsent)).ToArray(), now);
        var view = View(customer);
        if (receiptId is not null) db.Receipts.Add(new IdempotencyReceipt { Id = receiptId, ActorId = caller.Id, RequestHash = hash, ResponseJson = Json.Write(view), CreatedAtUtc = now });
        await db.SaveChangesAsync(ct);
        return Results.Created($"/api/customers/{customer.Id}", view);
    }

    private static async Task<IResult> Update(Guid id, UpdateCustomer request, ServiceDb db, TimeProvider clock, HttpContext http, CancellationToken ct)
    {
        var customer = await Find(id, db, http, true, ct);
        if (customer.Version != request.ExpectedVersion) throw new DomainException(409, "Customer changed. Refresh before saving.");
        var now = clock.GetUtcNow();
        var before = View(customer);
        // Validate a detached proposed aggregate before touching tracked data.
        var proposed = new Customer { Id = id, DisplayName = Trim(request.DisplayName), CustomerType = request.CustomerType, TeamId = customer.TeamId, PreferredChannel = request.PreferredChannel, Status = request.Status };
        proposed.Contacts = customer.Contacts.Select(x => new CustomerContact { Id = x.Id, CustomerId = id, FullName = x.FullName, Email = x.Email, Phone = x.Phone, IsPrimary = x.IsPrimary, EmailConsent = x.EmailConsent, PhoneConsent = x.PhoneConsent, ConsentUpdatedAtUtc = x.ConsentUpdatedAtUtc }).ToList();
        proposed.Locations = customer.Locations.Select(x => new ServiceLocation { Id = x.Id, CustomerId = id, Name = x.Name, AddressLine1 = x.AddressLine1, AddressLine2 = x.AddressLine2, City = x.City, Region = x.Region, PostalCode = x.PostalCode, CountryCode = x.CountryCode, AccessNotes = x.AccessNotes, Status = x.Status }).ToList();
        ApplyChildren(proposed, request.Contacts, request.Locations, now, true);
        CustomerRules.Validate(proposed);
        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        // Clearing a prior primary inside the same transaction permits an atomic primary
        // contact swap without temporarily violating PostgreSQL's partial unique index.
        foreach (var contact in customer.Contacts) contact.IsPrimary = false;
        await db.SaveChangesAsync(ct);
        customer.DisplayName = proposed.DisplayName; customer.CustomerType = proposed.CustomerType; customer.Status = proposed.Status; customer.PreferredChannel = proposed.PreferredChannel;
        var incomingContacts = proposed.Contacts.Select(x => x.Id).ToHashSet();
        foreach (var removed in customer.Contacts.Where(x => !incomingContacts.Contains(x.Id)).ToArray()) { db.CustomerContacts.Remove(removed); customer.Contacts.Remove(removed); }
        foreach (var source in proposed.Contacts)
        {
            var target = customer.Contacts.SingleOrDefault(x => x.Id == source.Id);
            if (target is null) { target = new CustomerContact { Id = source.Id, CustomerId = id }; customer.Contacts.Add(target); }
            target.FullName = source.FullName; target.Email = source.Email; target.Phone = source.Phone; target.IsPrimary = source.IsPrimary;
            target.EmailConsent = source.EmailConsent; target.PhoneConsent = source.PhoneConsent; target.ConsentUpdatedAtUtc = source.ConsentUpdatedAtUtc;
        }
        foreach (var source in proposed.Locations)
        {
            var target = customer.Locations.SingleOrDefault(x => x.Id == source.Id);
            if (target is null) { target = new ServiceLocation { Id = source.Id, CustomerId = id }; customer.Locations.Add(target); }
            CopyLocation(source, target);
        }
        customer.Version++; customer.UpdatedAtUtc = now;
        var after = View(customer);
        var changed = ChangedFields(before, after);
        var consents = before.Contacts.Select(x => x.Id).Union(after.Contacts.Select(x => x.Id)).Select(contactId => new ConsentChange(contactId, before.Contacts.SingleOrDefault(x => x.Id == contactId)?.EmailConsent, after.Contacts.SingleOrDefault(x => x.Id == contactId)?.EmailConsent, before.Contacts.SingleOrDefault(x => x.Id == contactId)?.PhoneConsent, after.Contacts.SingleOrDefault(x => x.Id == contactId)?.PhoneConsent)).Where(x => x.EmailConsentBefore != x.EmailConsentAfter || x.PhoneConsentBefore != x.PhoneConsentAfter).ToArray();
        AddChange(db, http, customer, "CustomerUpdated.v1", changed, consents, now);
        await db.SaveChangesAsync(ct); await transaction.CommitAsync(ct);
        return Results.Ok(after);
    }

    private static void ApplyChildren(Customer customer, CustomerContactInput[]? contacts, ServiceLocationInput[]? locations, DateTimeOffset now, bool updating)
    {
        if (contacts?.Length > 25 || locations?.Length > 100) throw new DomainException(400, "Too many customer contacts or service locations.");
        var priorContacts = customer.Contacts.ToDictionary(x => x.Id);
        var newContacts = new List<CustomerContact>();
        foreach (var input in contacts ?? [])
        {
            if (input is null) throw new DomainException(400, "A contact must be an object.");
            if (updating && input.Id.HasValue && !priorContacts.ContainsKey(input.Id.Value)) throw new DomainException(400, "Contact reference does not belong to this customer.");
            var id = input.Id ?? Guid.NewGuid();
            var prior = priorContacts.GetValueOrDefault(id);
            newContacts.Add(new CustomerContact { Id = id, CustomerId = customer.Id, FullName = Trim(input.FullName), Email = Optional(input.Email), Phone = Optional(input.Phone), IsPrimary = input.IsPrimary, EmailConsent = input.EmailConsent, PhoneConsent = input.PhoneConsent,
                ConsentUpdatedAtUtc = prior is not null && prior.EmailConsent == input.EmailConsent && prior.PhoneConsent == input.PhoneConsent && prior.Email == Optional(input.Email) && prior.Phone == Optional(input.Phone) ? prior.ConsentUpdatedAtUtc : now });
        }
        var priorLocations = customer.Locations.ToDictionary(x => x.Id);
        var nextLocations = new List<ServiceLocation>();
        foreach (var input in locations ?? [])
        {
            if (input is null) throw new DomainException(400, "A service location must be an object.");
            if (updating && input.Id.HasValue && !priorLocations.ContainsKey(input.Id.Value)) throw new DomainException(400, "Location reference does not belong to this customer.");
            nextLocations.Add(new ServiceLocation { Id = input.Id ?? Guid.NewGuid(), CustomerId = customer.Id, Name = Trim(input.Name), AddressLine1 = Trim(input.AddressLine1), AddressLine2 = Optional(input.AddressLine2), City = Trim(input.City), Region = Trim(input.Region), PostalCode = Trim(input.PostalCode), CountryCode = Trim(input.CountryCode).ToUpperInvariant(), AccessNotes = Optional(input.AccessNotes), Status = input.Status });
        }
        // Removed locations remain readable for past work orders. A new work order
        // may reference only an Active customer and an Active owned location.
        foreach (var prior in priorLocations.Values.Where(x => nextLocations.All(y => y.Id != x.Id))) { prior.Status = "Archived"; nextLocations.Add(prior); }
        customer.Contacts = newContacts; customer.Locations = nextLocations;
    }

    private static void CopyLocation(ServiceLocation source, ServiceLocation target)
    {
        target.Name = source.Name; target.AddressLine1 = source.AddressLine1; target.AddressLine2 = source.AddressLine2; target.City = source.City; target.Region = source.Region; target.PostalCode = source.PostalCode; target.CountryCode = source.CountryCode; target.AccessNotes = source.AccessNotes; target.Status = source.Status;
    }
    private static async Task<Customer> Find(Guid id, ServiceDb db, HttpContext http, bool tracking, CancellationToken ct)
    {
        var query = db.Customers.Include(x => x.Contacts).Include(x => x.Locations).AsSplitQuery().AsQueryable();
        if (!tracking) query = query.AsNoTracking();
        var customer = await query.SingleOrDefaultAsync(x => x.Id == id, ct) ?? throw new DomainException(404, "Customer not found.");
        Caller.From(http.User).Demand(customer.TeamId); return customer;
    }
    public static CustomerView View(Customer x) => new(x.Id, x.DisplayName, x.CustomerType, x.TeamId, x.Status, x.PreferredChannel, x.Version, x.CreatedAtUtc, x.UpdatedAtUtc, x.Contacts.OrderByDescending(c => c.IsPrimary).ThenBy(c => c.FullName).Select(ContactView).ToArray(), x.Locations.OrderBy(l => l.Name).Select(LocationView).ToArray());
    private static CustomerContactView ContactView(CustomerContact x) => new(x.Id, x.FullName, x.Email, x.Phone, x.IsPrimary, x.EmailConsent, x.PhoneConsent, x.ConsentUpdatedAtUtc);
    private static ServiceLocationView LocationView(ServiceLocation x) => new(x.Id, x.Name, x.AddressLine1, x.AddressLine2, x.City, x.Region, x.PostalCode, x.CountryCode, x.AccessNotes, x.Status);
    private static string Trim(string? value) => value?.Trim() ?? "";
    private static string? Optional(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
    private static string[] ChangedFields(CustomerView before, CustomerView after)
    {
        var fields = new List<string>();
        if (before.DisplayName != after.DisplayName) fields.Add("displayName");
        if (before.CustomerType != after.CustomerType) fields.Add("customerType");
        if (before.Status != after.Status) fields.Add("status");
        if (before.PreferredChannel != after.PreferredChannel) fields.Add("preferredChannel");
        if (Json.Write(before.Contacts) != Json.Write(after.Contacts)) fields.Add("contacts");
        if (Json.Write(before.Locations) != Json.Write(after.Locations)) fields.Add("locations");
        return fields.ToArray();
    }
    private static void AddChange(ServiceDb db, HttpContext http, Customer customer, string type, string[] fields, ConsentChange[] consentChanges, DateTimeOffset now)
    {
        var audit = EventFactory.Create(http, "customers", type, Guid.Empty, new { customerId = customer.Id, customer.TeamId, customer.CustomerType, customer.Status, customer.PreferredChannel, customer.Version, customer.CreatedAtUtc, customer.UpdatedAtUtc, locationCount = customer.Locations.Count, activeLocationCount = customer.Locations.Count(x => x.Status == "Active"), contactCount = customer.Contacts.Count, emailConsentCount = customer.Contacts.Count(x => x.EmailConsent), phoneConsentCount = customer.Contacts.Count(x => x.PhoneConsent), locations = customer.Locations.Select(x => new { serviceLocationId = x.Id, x.Status }) }, customer.Version, now);
        db.Enqueue(audit);
        db.CustomerChanges.Add(new CustomerChange { Id = audit.EventId, CustomerId = customer.Id, Version = customer.Version, Action = type, ActorId = audit.ActorId, ActorRole = audit.ActorRole, CorrelationId = audit.CorrelationId, OccurredAtUtc = now, DetailsJson = Json.Write(new ChangeDetails(fields, consentChanges)) });
    }
    private sealed record ConsentChange(Guid ContactId, bool? EmailConsentBefore, bool? EmailConsentAfter, bool? PhoneConsentBefore, bool? PhoneConsentAfter);
    private sealed record ChangeDetails(string[] ChangedFields, ConsentChange[] ConsentChanges);
}
