export interface ContractLine {
  id: string;
  serviceType: string;
  laborCovered: boolean;
  partsCovered: boolean;
  includedVisits: number;
  partsAllowance: number;
  visitsUsed: number;
  partsUsed: number;
  visitsRemaining: number | null;
  active: boolean;
}

export interface CoveredAsset {
  assetId: string;
  effectiveFrom: string;
  effectiveTo?: string | null;
  active: boolean;
}

export interface MaintenancePlan {
  serviceLocationId?: string | null;
  id: string;
  contractLineId: string;
  assetId?: string | null;
  frequency: string;
  nextDueDate: string;
  endsOn?: string | null;
  active: boolean;
  version: number;
}

export interface MaintenanceVisit {
  serviceLocationId?: string | null;
  id: string;
  contractLineId: string;
  assetId?: string | null;
  workOrderId?: string | null;
  dueDate: string;
  status: string;
  generatedAtUtc: string;
  completedAtUtc?: string | null;
  completionReviewRequired?: boolean;
  completionReviewReason?: string | null;
}

export interface ContractUsage {
  id: string;
  contractLineId: string;
  workOrderId: string;
  visitsUsed: number;
  partsCost: number;
  occurredAtUtc: string;
}

export interface ContractRenewal {
  id: string;
  sourceContractId: string;
  renewedContractId: string;
  sourceVersion: number;
  effectiveFromUtc: string;
  expiresAtUtc: string;
  reason: string;
  actorId: string;
  actorRole: string;
  recordedAtUtc: string;
}

export interface MaintenanceContract {
  id: string;
  teamId: string;
  customerId: string;
  status: string;
  effectiveFromUtc: string;
  expiresAtUtc?: string | null;
  timeZoneId: string;
  coversAllAssets: boolean;
  version: number;
  createdAtUtc: string;
  updatedAtUtc: string;
  lines: ContractLine[];
  coveredAssets: CoveredAsset[];
  plans: MaintenancePlan[];
  visits: MaintenanceVisit[];
  usage: ContractUsage[];
}

export interface ContractSummary {
  id: string;
  customerId: string;
  status: string;
  effectiveFromUtc: string;
  expiresAtUtc?: string | null;
  version: number;
  lineCount: number;
  visitCount: number;
  nextVisit?: string | null;
}

export interface ContractPage {
  items: ContractSummary[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PortalAgreement {
  id: string;
  status: string;
  effectiveFromUtc: string;
  expiresAtUtc?: string | null;
  lines: ContractLine[];
  upcomingVisits: MaintenanceVisit[];
  timeZoneId: string;
  coversAllAssets: boolean;
  coveredAssets: CoveredAsset[];
}

export const contractFrequencies = [
  "Monthly",
  "Quarterly",
  "Semiannual",
  "Annual",
] as const;

export const serviceTypes = [
  "HVAC",
  "Refrigeration",
  "Electrical",
  "Mechanical",
  "Controls",
  "Heating",
  "Cooling",
  "Ventilation",
] as const;
