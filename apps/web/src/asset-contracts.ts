export type AssetType =
  "HVAC" | "Refrigeration" | "Electrical" | "Plumbing" | "Controls" | "Other";
export type AssetCriticality = "Low" | "Medium" | "High" | "Critical";
export type AssetStatus = "Active" | "Inactive" | "Retired";

export interface AssetLocationChange {
  id: string;
  customerId: string;
  serviceLocationId: string;
  customerVersion: number;
  effectiveFromUtc: string;
  reason: string;
}

export interface AssetInput {
  name: string;
  assetType: AssetType;
  manufacturer: string;
  model: string;
  serialNumber: string;
  qrCode?: string | null;
  criticality: AssetCriticality;
  status?: AssetStatus;
  customerId: string;
  serviceLocationId: string;
  customerVersion: number;
  parentAssetId?: string | null;
  installedAtUtc: string;
  warrantyEndUtc?: string | null;
}

export interface Asset extends AssetInput {
  id: string;
  teamId: string;
  status: AssetStatus;
  version: number;
  createdAtUtc: string;
  updatedAtUtc: string;
  locationHistory: AssetLocationChange[];
}

export interface AssetChange {
  id: string;
  assetId: string;
  version: number;
  actorId: string;
  occurredAtUtc: string;
  eventType: string;
  changedFields: string[];
}

export interface AssetSummary {
  id: string;
  name: string;
  assetType: AssetType;
  manufacturer: string;
  model: string;
  serialNumber: string;
  criticality: AssetCriticality;
  status: AssetStatus;
  warrantyEndUtc?: string | null;
  serviceLocationId: string;
}

export type WarrantyState = "none" | "expired" | "expiring" | "active";

export function warrantyState(
  asset: Pick<Asset, "warrantyEndUtc">,
  now = new Date(),
): WarrantyState {
  if (!asset.warrantyEndUtc) return "none";
  const end = new Date(asset.warrantyEndUtc);
  if (Number.isNaN(end.getTime())) return "none";
  if (end.getTime() < now.getTime()) return "expired";
  const ninetyDays = 90 * 24 * 60 * 60 * 1000;
  return end.getTime() - now.getTime() <= ninetyDays ? "expiring" : "active";
}

export function warrantyLabel(
  asset: Pick<Asset, "warrantyEndUtc">,
  now = new Date(),
): string {
  switch (warrantyState(asset, now)) {
    case "none":
      return "No warranty recorded";
    case "expired":
      return "Warranty expired";
    case "expiring":
      return "Warranty expires within 90 days";
    default:
      return "Warranty active";
  }
}

export function assetIdentity(
  asset: Pick<Asset, "manufacturer" | "model" | "serialNumber">,
): string {
  return [asset.manufacturer, asset.model, `Serial ${asset.serialNumber}`]
    .filter(Boolean)
    .join(" · ");
}
