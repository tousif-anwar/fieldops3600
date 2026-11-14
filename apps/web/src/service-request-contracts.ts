import type { ServiceLocation } from "./customer-contracts";

export interface PortalAccount {
  id: string;
  displayName: string;
  customerType: string;
  status: string;
  teamId: string;
  locations: (ServiceLocation & { id: string })[];
}

export interface PortalEquipment {
  id: string;
  name: string;
  assetType: string;
  manufacturer: string;
  model: string;
  serialNumber: string;
  status: string;
  serviceLocationId: string;
  warrantyEndUtc?: string | null;
}

export interface ServiceRequest {
  id: string;
  customerId: string;
  serviceLocationId: string;
  assetId?: string | null;
  title: string;
  description: string;
  serviceType:
    | "Repair"
    | "Maintenance"
    | "Installation"
    | "Replacement"
    | "Warranty"
    | "Diagnostic";
  urgency: "Routine" | "Urgent" | "Emergency";
  status: "Submitted" | "Qualified" | "Rejected";
  workOrderId?: string | null;
  decisionReason?: string | null;
  version: number;
  createdAtUtc: string;
  updatedAtUtc: string;
  customerName: string;
  siteAddress: string;
}

export interface PortalWorkOrder {
  id: string;
  number: string;
  title: string;
  siteAddress: string;
  status: string;
  serviceCategory: string;
  priority: string;
  createdAtUtc: string;
  completedAtUtc?: string | null;
  customerId: string;
  serviceLocationId: string;
  assetId?: string | null;
}

export interface PortalAppointment {
  id: string;
  workOrderId: string;
  startUtc: string;
  endUtc: string;
  status: string;
  version: number;
}
