using System.Text.RegularExpressions;

namespace FieldOps.Core;

public sealed class Asset
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid CustomerId { get; set; }
    public Guid ServiceLocationId { get; set; }
    public int CustomerVersion { get; set; } = 1;
    public Guid? ParentAssetId { get; set; }
    public string TeamId { get; set; } = "north";
    public string Name { get; set; } = "";
    public string AssetType { get; set; } = "HVAC";
    public string Manufacturer { get; set; } = "";
    public string Model { get; set; } = "";
    public string SerialNumber { get; set; } = "";
    public string? QrCode { get; set; }
    public string Criticality { get; set; } = "Medium";
    public string Status { get; set; } = "Active";
    public DateTimeOffset InstalledAtUtc { get; set; }
    public DateTimeOffset? WarrantyEndUtc { get; set; }
    public int Version { get; set; } = 1;
    public DateTimeOffset CreatedAtUtc { get; set; }
    public DateTimeOffset UpdatedAtUtc { get; set; }
    public List<AssetLocationChange> LocationHistory { get; set; } = [];
}

/// <summary>Append-only record of where an asset was installed. Current location is on the asset.</summary>
public sealed class AssetLocationChange
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid AssetId { get; set; }
    public Guid CustomerId { get; set; }
    public Guid ServiceLocationId { get; set; }
    public int CustomerVersion { get; set; }
    public DateTimeOffset EffectiveFromUtc { get; set; }
    public string Reason { get; set; } = "Registered";
}

public sealed class AssetChange
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid AssetId { get; set; }
    public int Version { get; set; }
    public string Action { get; set; } = "";
    public string ActorId { get; set; } = "";
    public string ActorRole { get; set; } = "";
    public string CorrelationId { get; set; } = "";
    public DateTimeOffset OccurredAtUtc { get; set; }
    public string DetailsJson { get; set; } = "{}";
}

public static class AssetRules
{
    public static readonly string[] Types = ["HVAC", "Refrigeration", "Electrical", "Plumbing", "Controls", "Other"];
    public static readonly string[] Criticalities = ["Low", "Medium", "High", "Critical"];
    public static readonly string[] Statuses = ["Active", "Inactive", "Retired"];
    public const int MaximumHierarchyDepth = 5;

    public static void Validate(Asset asset, DateTimeOffset now)
    {
        if (asset.Id == Guid.Empty || asset.CustomerId == Guid.Empty || asset.ServiceLocationId == Guid.Empty)
            Reject("Asset, customer and service-location identifiers must not be empty.");
        if (asset.ParentAssetId == asset.Id) Reject("An asset cannot be its own parent.");
        if (!Regex.IsMatch(asset.TeamId, "^[A-Za-z0-9_-]{2,64}$")) Reject("Invalid asset team.");
        Text(asset.Name, 2, 100, "asset name");
        Text(asset.Manufacturer, 2, 100, "manufacturer");
        Text(asset.Model, 1, 100, "model");
        Text(asset.SerialNumber, 2, 64, "serial number");
        if (!Types.Contains(asset.AssetType)) Reject("Unknown asset type.");
        if (!Criticalities.Contains(asset.Criticality)) Reject("Unknown asset criticality.");
        if (!Statuses.Contains(asset.Status)) Reject("Unknown asset status.");
        if (!Regex.IsMatch(asset.SerialNumber, "^[A-Za-z0-9._-]{2,64}$")) Reject("Serial numbers may contain letters, digits, dot, underscore and hyphen only.");
        if (asset.QrCode is not null)
        {
            Text(asset.QrCode, 4, 128, "QR identity");
            if (!Regex.IsMatch(asset.QrCode, "^[A-Za-z0-9._:/-]{4,128}$")) Reject("QR identity contains unsupported characters.");
        }
        if (asset.InstalledAtUtc > now.AddDays(1)) Reject("Installation date cannot be in the future.");
        if (asset.InstalledAtUtc.Year < 1950) Reject("Installation date is not plausible.");
        if (asset.WarrantyEndUtc is not null && asset.WarrantyEndUtc < asset.InstalledAtUtc)
            Reject("Warranty expiry cannot precede installation.");
        if (asset.LocationHistory.Count == 0) Reject("An asset needs an installation location record.");
        if (asset.LocationHistory.Count > 100) Reject("An asset may have at most 100 recorded location changes.");
        if (asset.LocationHistory.Select(x => x.Id).Distinct().Count() != asset.LocationHistory.Count)
            Reject("Location-history identifiers must be distinct.");
        if (asset.LocationHistory.Any(x => x.AssetId != asset.Id)) Reject("Location history does not belong to this asset.");
        if (asset.LocationHistory.Any(x => x.CustomerId != asset.CustomerId)) Reject("Location history must belong to the asset customer.");
        if (asset.LocationHistory.Any(x => x.EffectiveFromUtc > now.AddDays(1))) Reject("Location effective date cannot be in the future.");
        var current = asset.LocationHistory.OrderByDescending(x => x.EffectiveFromUtc).First();
        if (current.ServiceLocationId != asset.ServiceLocationId || current.CustomerVersion != asset.CustomerVersion)
            Reject("The latest location history must match the asset's current service location.");
    }

    public static void Text(string? value, int minimum, int maximum, string field)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Trim().Length < minimum || value.Trim().Length > maximum)
            Reject($"{field} must contain {minimum} to {maximum} characters.");
    }

    private static void Reject(string message) => throw new DomainException(400, message);
}
