export interface WorkOrder {
  id: string;
  number: string;
  title: string;
  customerName: string;
  siteAddress: string;
  serviceCategory: string;
  priority: string;
  status: string;
  teamId: string;
  technicianId: string | null;
  createdAtUtc: string;
  version: number;
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
  stages: WorkflowStage[];
}

export interface FormField {
  key: string;
  label: string;
  options: string[];
  required: boolean;
  conditionField?: string | null;
  conditionValue?: string | null;
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
