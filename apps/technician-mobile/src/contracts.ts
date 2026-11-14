export interface WorkOrder {
  id: string;
  number: string;
  title: string;
  reportedProblem?: string;
  customerName: string;
  siteAddress: string;
  customerId?: string | null;
  serviceLocationId?: string | null;
  assetId?: string | null;
  serviceCategory: string;
  priority: string;
  status: string;
  teamId: string;
  technicianId: string | null;
  createdAtUtc: string;
  version: number;
}

export interface CustomerServiceContext {
  customerId: string;
  displayName: string;
  customerType: string;
  preferredChannel: string;
  version: number;
  location: {
    id: string;
    name: string;
    addressLine1: string;
    addressLine2?: string | null;
    city: string;
    region: string;
    postalCode: string;
    countryCode: string;
    accessNotes?: string | null;
    status: string;
  };
  contacts: {
    id: string;
    fullName: string;
    email?: string | null;
    phone?: string | null;
    isPrimary: boolean;
    emailConsent: boolean;
    phoneConsent: boolean;
  }[];
}

export interface AssetSummary {
  id: string;
  name: string;
  assetType: string;
  manufacturer: string;
  model: string;
  serialNumber: string;
  criticality: string;
  status: string;
  warrantyEndUtc?: string | null;
  serviceLocationId: string;
}

export interface Booking {
  id: string;
  workOrderId: string;
  technicianId: string;
  startUtc: string;
  endUtc: string;
  status: string;
  version: number;
}

export interface WorkflowStage {
  id: string;
  index: number;
  name: string;
  status: string;
  startedAtUtc: string | null;
  deadlineUtc: string | null;
  completedAtUtc: string | null;
  pausedAtUtc: string | null;
  pausedSeconds: number;
  slaStatus: string;
  answers: Record<string, string>;
}

export interface Workflow {
  id: string;
  workOrderId: string;
  technicianId: string;
  templateVersion: number;
  currentStageIndex: number;
  version: number;
  status: string;
  startedAtUtc?: string;
  completedAtUtc?: string | null;
  stages: WorkflowStage[];
}

export interface AssignmentOffer {
  id: string;
  workOrderId: string;
  technicianId: string;
  teamId: string;
  workOrderNumber: string;
  title: string;
  siteAddress: string;
  serviceCategory: string;
  priority: string;
  startUtc: string;
  endUtc: string;
  expiresAtUtc: string;
  status: 'Pending' | 'Accepted' | 'Declined' | 'Revoked' | 'Expired';
  version: number;
  createdAtUtc: string;
  respondedAtUtc?: string | null;
  reason?: string | null;
  bookingId?: string | null;
}

export interface FormField {
  key: string;
  label: string;
  options: string[];
  required: boolean;
  conditionField?: string | null;
  conditionValue?: string | null;
  inputType?: 'choice' | 'text' | 'number' | null;
  maxLength?: number | null;
  minimum?: number | null;
  maximum?: number | null;
}

export interface WorkflowTemplate {
  version: number;
  stages: { index: number; name: string; fields: FormField[] }[];
}

export interface Notification {
  id: string;
  workOrderId: string;
  title?: string;
  message?: string;
  eventType?: string;
  severity?: string;
  createdAtUtc: string;
  acknowledgedAtUtc?: string | null;
}
