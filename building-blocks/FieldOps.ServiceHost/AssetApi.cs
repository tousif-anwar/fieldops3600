using System.Security.Cryptography;
using System.Text;
using FieldOps.Core;
using Microsoft.EntityFrameworkCore;

namespace FieldOps.ServiceHost;

public sealed record CreateAsset(string Name, string AssetType, string Manufacturer, string Model, string SerialNumber, string? QrCode,
    string Criticality, Guid CustomerId, Guid ServiceLocationId, int CustomerVersion, Guid? ParentAssetId,
    DateTimeOffset InstalledAtUtc, DateTimeOffset? WarrantyEndUtc);
public sealed record UpdateAsset(int ExpectedVersion, string Name, string AssetType, string Manufacturer, string Model, string SerialNumber,
    string? QrCode, string Criticality, string Status, Guid CustomerId, Guid ServiceLocationId, int CustomerVersion,
    Guid? ParentAssetId, DateTimeOffset InstalledAtUtc, DateTimeOffset? WarrantyEndUtc);
public sealed record AssetLocationView(Guid Id, Guid CustomerId, Guid ServiceLocationId, int CustomerVersion, DateTimeOffset EffectiveFromUtc, string Reason);
public sealed record AssetView(Guid Id, Guid CustomerId, Guid ServiceLocationId, int CustomerVersion, Guid? ParentAssetId, string TeamId,
    string Name, string AssetType, string Manufacturer, string Model, string SerialNumber, string? QrCode, string Criticality,
    string Status, DateTimeOffset InstalledAtUtc, DateTimeOffset? WarrantyEndUtc, int Version, DateTimeOffset CreatedAtUtc,
    DateTimeOffset UpdatedAtUtc, AssetLocationView[] LocationHistory);

public static class AssetApi
{
    public static void Map(WebApplication app)
    {
        var office = app.MapGroup("/api/assets").RequireAuthorization("dispatch");
        office.MapGet("", List);
        office.MapGet("/{id:guid}", async (Guid id, ServiceDb db, HttpContext http, CancellationToken ct) => Results.Ok(View(await Find(id, db, http, false, ct))));
        office.MapPost("", Create);
        office.MapPut("/{id:guid}", Update);
        office.MapGet("/{id:guid}/history", async (Guid id, ServiceDb db, HttpContext http, CancellationToken ct) =>
        {
            _ = await Find(id, db, http, false, ct);
            var changes = await db.AssetChanges.AsNoTracking().Where(x => x.AssetId == id).OrderByDescending(x => x.Version).Take(500).ToListAsync(ct);
            return Results.Ok(changes.Select(x => new
            {
                x.Id, x.AssetId, x.Version, x.ActorId, x.ActorRole, x.OccurredAtUtc, eventType = x.Action, x.CorrelationId,
                changedFields = Json.Read<ChangeDetails>(x.DetailsJson).ChangedFields
            }));
        });

        // Minimal owner-scoped identity for sibling services. Serial numbers and location history
        // are deliberately excluded from this service-to-service contract.
        app.MapGet("/api/assets/{id:guid}/reference", async (Guid id, ServiceDb db, HttpContext http, CancellationToken ct) =>
        {
            var asset = await db.Assets.AsNoTracking().SingleOrDefaultAsync(x => x.Id == id, ct)
                ?? throw new DomainException(404, "Equipment was not found.");
            Caller.From(http.User).Demand(asset.TeamId);
            http.Response.Headers.CacheControl = "no-store";
            return Results.Ok(new { asset.Id, asset.TeamId, asset.CustomerId, asset.ServiceLocationId, asset.Status });
        }).RequireAuthorization("operational");

        // Technicians receive only equipment installed for the customer on an assigned order.
        app.MapGet("/api/assets/by-work-order/{workOrderId:guid}", async (Guid workOrderId, ServiceDb db, RemoteServices remote, HttpContext http, CancellationToken ct) =>
        {
            var order = await remote.Get<WorkOrder>("WorkOrders", $"/api/work-orders/{workOrderId}", http, ct);
            Caller.From(http.User).Demand(order.TeamId, order.TechnicianId);
            if (order.CustomerId is null) throw new DomainException(404, "This work order has no registered customer equipment.");
            var assets = await db.Assets.AsNoTracking()
                .Where(x => x.CustomerId == order.CustomerId && x.Status != "Retired" && x.TeamId == order.TeamId)
                .OrderBy(x => x.Name).ToListAsync(ct);
            http.Response.Headers.CacheControl = "no-store";
            return Results.Ok(assets.Select(x => new { x.Id, x.Name, x.AssetType, x.Manufacturer, x.Model, x.SerialNumber, x.Criticality, x.Status, x.WarrantyEndUtc, x.ServiceLocationId }));
        }).RequireAuthorization("operational");

        app.MapGet("/api/assets/{id:guid}/service-context", async (Guid id, Guid workOrderId, ServiceDb db, RemoteServices remote, HttpContext http, CancellationToken ct) =>
        {
            var order = await remote.Get<WorkOrder>("WorkOrders", $"/api/work-orders/{workOrderId}", http, ct);
            Caller.From(http.User).Demand(order.TeamId, order.TechnicianId);
            var asset = await db.Assets.AsNoTracking().Include(x => x.LocationHistory).AsSplitQuery().SingleOrDefaultAsync(x => x.Id == id, ct)
                ?? throw new DomainException(404, "Equipment was not found.");
            if (order.CustomerId != asset.CustomerId || order.TeamId != asset.TeamId) throw new DomainException(404, "Equipment was not found for this work order.");
            http.Response.Headers.CacheControl = "no-store";
            return Results.Ok(new
            {
                asset.Id, asset.Name, asset.AssetType, asset.Manufacturer, asset.Model, asset.SerialNumber, asset.QrCode,
                asset.Criticality, asset.Status, asset.InstalledAtUtc, asset.WarrantyEndUtc, asset.Version,
                locationHistory = asset.LocationHistory.OrderByDescending(x => x.EffectiveFromUtc).Take(20).Select(LocationView)
            });
        }).RequireAuthorization("operational");
    }

    private static async Task<IResult> List(ServiceDb db, HttpContext http, CancellationToken ct, string? search = null,
        string? status = null, string? assetType = null, Guid? customerId = null, Guid? serviceLocationId = null, string? sort = null, int page = 1, int pageSize = 25)
    {
        if (page < 1 || page > 1_000_000 || pageSize is < 1 or > 100) throw new DomainException(400, "Invalid asset pagination.");
        if (status is not (null or "" or "Active" or "Inactive" or "Retired")) throw new DomainException(400, "Unknown asset status filter.");
        if (assetType is not (null or "") && !AssetRules.Types.Contains(assetType)) throw new DomainException(400, "Unknown asset type filter.");
        if (sort is not (null or "" or "name" or "-name" or "-created" or "-warranty")) throw new DomainException(400, "Unknown asset sort.");
        if (search?.Length > 100) throw new DomainException(400, "Search must not exceed 100 characters.");
        var caller = Caller.From(http.User);
        var query = db.Assets.AsNoTracking().Where(x => caller.IsAdministrator || x.TeamId == caller.TeamId);
        if (!string.IsNullOrEmpty(status)) query = query.Where(x => x.Status == status);
        if (!string.IsNullOrEmpty(assetType)) query = query.Where(x => x.AssetType == assetType);
        if (customerId.HasValue) query = query.Where(x => x.CustomerId == customerId);
        if (serviceLocationId.HasValue) query = query.Where(x => x.ServiceLocationId == serviceLocationId);
        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.Trim().ToLowerInvariant();
            query = query.Where(x => x.Name.ToLower().Contains(term) || x.SerialNumber.ToLower().Contains(term) || x.Manufacturer.ToLower().Contains(term) || x.Model.ToLower().Contains(term));
        }
        var total = await query.CountAsync(ct);
        query = sort switch
        {
            "-name" => query.OrderByDescending(x => x.Name).ThenBy(x => x.Id),
            "-created" => query.OrderByDescending(x => x.CreatedAtUtc).ThenBy(x => x.Id),
            "-warranty" => query.OrderBy(x => x.WarrantyEndUtc == null).ThenBy(x => x.WarrantyEndUtc).ThenBy(x => x.Id),
            _ => query.OrderBy(x => x.Name).ThenBy(x => x.Id)
        };
        var records = await query.Skip((page - 1) * pageSize).Take(pageSize).Include(x => x.LocationHistory).AsSplitQuery().ToListAsync(ct);
        return Results.Ok(new { items = records.Select(View), total, page, pageSize });
    }

    private static async Task<IResult> Create(CreateAsset request, ServiceDb db, TimeProvider clock, HttpContext http, RemoteServices remote, CancellationToken ct)
    {
        var caller = Caller.From(http.User);
        var customer = await CustomerReference(request.CustomerId, request.ServiceLocationId, request.CustomerVersion, remote, http, ct);
        caller.Demand(customer.TeamId);
        var now = clock.GetUtcNow();
        var key = http.Request.Headers["Idempotency-Key"].ToString();
        string? receiptId = null;
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(Json.Write(request))));
        if (key.Length > 0)
        {
            AssetRules.Text(key, 8, 128, "idempotency key");
            receiptId = $"{caller.Id}:asset-create:{key}";
            var receipt = await db.Receipts.AsNoTracking().SingleOrDefaultAsync(x => x.Id == receiptId, ct);
            if (receipt is not null)
            {
                if (receipt.RequestHash != hash) throw new DomainException(409, "This idempotency key was used for a different request.");
                return Results.Created($"/api/assets/{Json.Read<AssetView>(receipt.ResponseJson).Id}", Json.Read<AssetView>(receipt.ResponseJson));
            }
        }
        await ValidateParent(db, Guid.Empty, request.ParentAssetId, customer.Id, ct);
        var asset = new Asset
        {
            CustomerId = customer.Id, ServiceLocationId = request.ServiceLocationId, CustomerVersion = customer.Version,
            ParentAssetId = request.ParentAssetId, TeamId = customer.TeamId, Name = Trim(request.Name),
            AssetType = request.AssetType, Manufacturer = Trim(request.Manufacturer), Model = Trim(request.Model),
            SerialNumber = Trim(request.SerialNumber), QrCode = Optional(request.QrCode), Criticality = request.Criticality,
            Status = "Active", InstalledAtUtc = request.InstalledAtUtc, WarrantyEndUtc = request.WarrantyEndUtc,
            CreatedAtUtc = now, UpdatedAtUtc = now
        };
        asset.LocationHistory.Add(new AssetLocationChange
        {
            AssetId = asset.Id, CustomerId = asset.CustomerId, ServiceLocationId = asset.ServiceLocationId,
            CustomerVersion = asset.CustomerVersion, EffectiveFromUtc = now, Reason = "Registered"
        });
        AssetRules.Validate(asset, now);
        db.Assets.Add(asset);
        AddChange(db, http, asset, "AssetRegistered.v1", ["name", "assetType", "manufacturer", "model", "serialNumber", "criticality", "customer", "location", "warranty"], now);
        var view = View(asset);
        if (receiptId is not null) db.Receipts.Add(new IdempotencyReceipt { Id = receiptId, ActorId = caller.Id, RequestHash = hash, ResponseJson = Json.Write(view), CreatedAtUtc = now });
        await db.SaveChangesAsync(ct);
        return Results.Created($"/api/assets/{asset.Id}", view);
    }

    private static async Task<IResult> Update(Guid id, UpdateAsset request, ServiceDb db, TimeProvider clock, HttpContext http, RemoteServices remote, CancellationToken ct)
    {
        var asset = await Find(id, db, http, true, ct);
        if (asset.Version != request.ExpectedVersion) throw new DomainException(409, "Asset changed. Refresh before saving.");
        if (asset.Status == "Retired" && request.Status != "Retired") throw new DomainException(409, "A retired asset cannot be reactivated.");
        if (request.Status == "Retired" && await db.Assets.AnyAsync(x => x.ParentAssetId == id && x.Status != "Retired", ct))
            throw new DomainException(409, "Retire or reparent child equipment first.");
        var customer = await CustomerReference(request.CustomerId, request.ServiceLocationId, request.CustomerVersion, remote, http, ct);
        if (customer.TeamId != asset.TeamId) throw new DomainException(404, "Customer was not found in this team.");
        await ValidateParent(db, asset.Id, request.ParentAssetId, customer.Id, ct);
        var now = clock.GetUtcNow();
        var before = View(asset);
        var proposed = new Asset
        {
            Id = id, CustomerId = customer.Id, ServiceLocationId = request.ServiceLocationId, CustomerVersion = customer.Version,
            ParentAssetId = request.ParentAssetId, TeamId = asset.TeamId, Name = Trim(request.Name), AssetType = request.AssetType,
            Manufacturer = Trim(request.Manufacturer), Model = Trim(request.Model), SerialNumber = Trim(request.SerialNumber),
            QrCode = Optional(request.QrCode), Criticality = request.Criticality, Status = request.Status,
            InstalledAtUtc = request.InstalledAtUtc, WarrantyEndUtc = request.WarrantyEndUtc, CreatedAtUtc = asset.CreatedAtUtc,
            UpdatedAtUtc = now, LocationHistory = asset.LocationHistory.Select(LocationCopy).ToList()
        };
        var moved = proposed.CustomerId != asset.CustomerId || proposed.ServiceLocationId != asset.ServiceLocationId;
        if (moved) proposed.LocationHistory.Add(new AssetLocationChange
        {
            AssetId = id, CustomerId = proposed.CustomerId, ServiceLocationId = proposed.ServiceLocationId,
            CustomerVersion = proposed.CustomerVersion, EffectiveFromUtc = now, Reason = "Relocated"
        });
        AssetRules.Validate(proposed, now);

        asset.CustomerId = proposed.CustomerId; asset.ServiceLocationId = proposed.ServiceLocationId; asset.CustomerVersion = proposed.CustomerVersion;
        asset.ParentAssetId = proposed.ParentAssetId; asset.Name = proposed.Name; asset.AssetType = proposed.AssetType;
        asset.Manufacturer = proposed.Manufacturer; asset.Model = proposed.Model; asset.SerialNumber = proposed.SerialNumber;
        asset.QrCode = proposed.QrCode; asset.Criticality = proposed.Criticality; asset.Status = proposed.Status;
        asset.InstalledAtUtc = proposed.InstalledAtUtc; asset.WarrantyEndUtc = proposed.WarrantyEndUtc;
        if (moved) asset.LocationHistory.Add(proposed.LocationHistory[^1]);
        asset.Version++; asset.UpdatedAtUtc = now;
        var after = View(asset);
        AddChange(db, http, asset, "AssetUpdated.v1", ChangedFields(before, after), now);
        await db.SaveChangesAsync(ct);
        return Results.Ok(after);
    }

    private static async Task<CustomerView> CustomerReference(Guid customerId, Guid serviceLocationId, int customerVersion, RemoteServices remote, HttpContext http, CancellationToken ct)
    {
        var customer = await remote.Get<CustomerView>("Customers", $"/api/customers/{customerId}", http, ct);
        if (customer.Status != "Active") throw new DomainException(400, "Equipment can be registered only for an active customer.");
        if (customer.Locations.All(x => x.Id != serviceLocationId || x.Status != "Active")) throw new DomainException(400, "The service location must be active and belong to the customer.");
        if (customer.Version != customerVersion) throw new DomainException(409, "Customer changed. Reload the customer before saving equipment.");
        return customer;
    }

    private static async Task ValidateParent(ServiceDb db, Guid assetId, Guid? parentId, Guid customerId, CancellationToken ct)
    {
        if (parentId is null) return;
        if (parentId == assetId) throw new DomainException(400, "An asset cannot be its own parent.");
        var depth = 0;
        Guid? current = parentId;
        while (current is not null)
        {
            var parent = await db.Assets.AsNoTracking().SingleOrDefaultAsync(x => x.Id == current, ct)
                ?? throw new DomainException(400, "Parent equipment was not found.");
            if (parent.CustomerId != customerId) throw new DomainException(400, "Parent equipment must belong to the same customer.");
            if (parent.Status == "Retired") throw new DomainException(400, "Retired equipment cannot be a parent.");
            if (parent.Id == assetId) throw new DomainException(400, "The requested hierarchy would create a cycle.");
            if (++depth > AssetRules.MaximumHierarchyDepth) throw new DomainException(400, $"Equipment hierarchy cannot exceed {AssetRules.MaximumHierarchyDepth} levels.");
            current = parent.ParentAssetId;
        }
    }

    private static async Task<Asset> Find(Guid id, ServiceDb db, HttpContext http, bool tracking, CancellationToken ct)
    {
        var query = db.Assets.Include(x => x.LocationHistory).AsSplitQuery().AsQueryable();
        if (!tracking) query = query.AsNoTracking();
        var asset = await query.SingleOrDefaultAsync(x => x.Id == id, ct) ?? throw new DomainException(404, "Equipment was not found.");
        Caller.From(http.User).Demand(asset.TeamId);
        return asset;
    }

    private static void AddChange(ServiceDb db, HttpContext http, Asset asset, string type, string[] fields, DateTimeOffset now)
    {
        var audit = EventFactory.Create(http, "assets", type, Guid.Empty, new
        {
            assetId = asset.Id, asset.TeamId, asset.CustomerId, asset.ServiceLocationId, asset.CustomerVersion,
            asset.AssetType, asset.Criticality, asset.Status, asset.Manufacturer, asset.Model, asset.ParentAssetId,
            asset.InstalledAtUtc, asset.WarrantyEndUtc, asset.Version, asset.CreatedAtUtc, asset.UpdatedAtUtc,
            locationCount = asset.LocationHistory.Count
        }, asset.Version, now);
        db.Enqueue(audit);
        db.AssetChanges.Add(new AssetChange
        {
            Id = audit.EventId, AssetId = asset.Id, Version = asset.Version, Action = type, ActorId = audit.ActorId,
            ActorRole = audit.ActorRole, CorrelationId = audit.CorrelationId, OccurredAtUtc = now,
            DetailsJson = Json.Write(new ChangeDetails(fields))
        });
    }

    private static string[] ChangedFields(AssetView before, AssetView after)
    {
        var fields = new List<string>();
        if (before.Name != after.Name) fields.Add("name");
        if (before.AssetType != after.AssetType) fields.Add("assetType");
        if (before.Manufacturer != after.Manufacturer) fields.Add("manufacturer");
        if (before.Model != after.Model) fields.Add("model");
        if (before.SerialNumber != after.SerialNumber) fields.Add("serialNumber");
        if (before.QrCode != after.QrCode) fields.Add("qrCode");
        if (before.Criticality != after.Criticality) fields.Add("criticality");
        if (before.Status != after.Status) fields.Add("status");
        if (before.CustomerId != after.CustomerId || before.ServiceLocationId != after.ServiceLocationId) fields.Add("location");
        if (before.ParentAssetId != after.ParentAssetId) fields.Add("hierarchy");
        if (before.InstalledAtUtc != after.InstalledAtUtc) fields.Add("installedAtUtc");
        if (before.WarrantyEndUtc != after.WarrantyEndUtc) fields.Add("warrantyEndUtc");
        return fields.ToArray();
    }

    private static AssetLocationChange LocationCopy(AssetLocationChange x) => new()
    {
        Id = x.Id, AssetId = x.AssetId, CustomerId = x.CustomerId, ServiceLocationId = x.ServiceLocationId,
        CustomerVersion = x.CustomerVersion, EffectiveFromUtc = x.EffectiveFromUtc, Reason = x.Reason
    };
    public static AssetView View(Asset x) => new(x.Id, x.CustomerId, x.ServiceLocationId, x.CustomerVersion, x.ParentAssetId, x.TeamId,
        x.Name, x.AssetType, x.Manufacturer, x.Model, x.SerialNumber, x.QrCode, x.Criticality, x.Status, x.InstalledAtUtc,
        x.WarrantyEndUtc, x.Version, x.CreatedAtUtc, x.UpdatedAtUtc,
        x.LocationHistory.OrderByDescending(h => h.EffectiveFromUtc).Select(LocationView).ToArray());
    private static AssetLocationView LocationView(AssetLocationChange x) => new(x.Id, x.CustomerId, x.ServiceLocationId, x.CustomerVersion, x.EffectiveFromUtc, x.Reason);
    private static string Trim(string? value) => value?.Trim() ?? "";
    private static string? Optional(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
    private sealed record ChangeDetails(string[] ChangedFields);
}
