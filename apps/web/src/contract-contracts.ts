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
  committedVisits?: number;
  visitsAvailable?: number | null;
  active: boolean;
  responseTargetMinutes?: number | null;
  completionTargetMinutes?: number | null;
}

export type ContractSlaClockOrigin = "WorkOrderCreated" | "AppointmentStart";

export const contractSlaClockLabel = (value?: ContractSlaClockOrigin | null) =>
  value === "WorkOrderCreated"
    ? "Work order creation"
    : value === "AppointmentStart"
      ? "Appointment start"
      : "Not selected";

export function parseContractSlaInput(
  clock: string,
  responseValue: string,
  completionValue: string,
) {
  if (
    clock !== "" &&
    clock !== "WorkOrderCreated" &&
    clock !== "AppointmentStart"
  )
    throw new Error(
      "Choose work order creation or appointment start for the service target clock.",
    );
  const minutes = (value: string, label: string) => {
    if (!value.trim()) return null;
    const parsed = Number(value);
    if (
      !/^\d+$/.test(value.trim()) ||
      !Number.isInteger(parsed) ||
      parsed <= 0 ||
      parsed > 2147483647
    )
      throw new Error(`${label} must use positive whole elapsed minutes.`);
    return parsed;
  };
  const responseTargetMinutes = minutes(responseValue, "Service start target");
  const completionTargetMinutes = minutes(
    completionValue,
    "Service completion target",
  );
  if (
    (responseTargetMinutes !== null || completionTargetMinutes !== null) &&
    !clock
  )
    throw new Error("Select a clock origin before setting service targets.");
  if (
    responseTargetMinutes !== null &&
    completionTargetMinutes !== null &&
    completionTargetMinutes < responseTargetMinutes
  )
    throw new Error(
      "The service completion target must be at or after the service start target, measured from the same origin.",
    );
  return {
    clockOrigin: clock === "" ? null : clock,
    responseTargetMinutes,
    completionTargetMinutes,
  };
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
  slaClockOrigin?: ContractSlaClockOrigin | null;
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
  slaClockOrigin?: ContractSlaClockOrigin | null;
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
