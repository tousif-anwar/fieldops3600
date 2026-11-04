export type Role =
  | "Technician"
  | "Dispatcher"
  | "Supervisor"
  | "OperationsManager"
  | "Analyst"
  | "Administrator";
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
  technicianId?: string;
  createdAtUtc: string;
  completedAtUtc?: string;
  version: number;
}
export interface Technician {
  id: string;
  name: string;
  teamId: string;
  supervisorId: string;
  skills: string[];
  certifications: string[];
  workingStartHour: number;
  workingEndHour: number;
}
export interface Booking {
  id: string;
  workOrderId: string;
  technicianId: string;
  teamId: string;
  startUtc: string;
  endUtc: string;
  status: string;
  version: number;
}
export interface Stage {
  id: string;
  index: number;
  name: string;
  status: string;
  startedAtUtc?: string;
  deadlineUtc?: string;
  completedAtUtc?: string;
  pausedAtUtc?: string;
  pausedSeconds: number;
  slaStatus: string;
  answers: Record<string, string>;
}
export interface Workflow {
  id: string;
  workOrderId: string;
  technicianId: string;
  teamId: string;
  templateVersion: number;
  currentStageIndex: number;
  version: number;
  status: string;
  stages: Stage[];
}
export interface FormField {
  key: string;
  label: string;
  options: string[];
  required: boolean;
  conditionField?: string;
  conditionValue?: string;
}
export interface Template {
  version: number;
  stages: { index: number; name: string; fields: FormField[] }[];
}
export interface Notification {
  id: string;
  workOrderId: string;
  message?: string;
  title?: string;
  eventType?: string;
  severity?: string;
  createdAtUtc: string;
  acknowledgedAtUtc?: string;
}
export interface Reports {
  totalWorkOrders: number;
  completedWorkOrders: number;
  completionRate: number;
  slaComplianceRate: number;
  averageServiceMinutes: number;
  averageStageMinutes: number;
  activeJobs: number;
  atRiskStages: number;
  overdueStages: number;
  completedToday: number;
  refreshedAtUtc: string;
  volumeTrend: { date: string; total: number; completed: number }[];
  stageMetrics: {
    stage: string;
    averageMinutes: number;
    breaches: number;
    count: number;
  }[];
  categoryBreakdown: { category: string; count: number }[];
  technicianUtilization: {
    technicianId: string;
    bookedMinutes: number;
    utilization: number;
  }[];
}
export interface DeliveryAttempt {
  attempt: number;
  receivedAtUtc: string;
  processedAtUtc?: string;
  status: string;
  error?: string;
}
export interface ReplayEvent {
  eventId: string;
  eventType: string;
  eventVersion: number;
  workOrderId: string;
  workflowId?: string;
  stageInstanceId?: string;
  actorId: string;
  actorRole: string;
  sourceService: string;
  correlationId: string;
  causationId?: string;
  traceId?: string;
  spanId?: string;
  occurredAtUtc: string;
  recordedAtUtc: string;
  receivedAtUtc?: string;
  processedAtUtc?: string;
  sequenceNumber: number;
  eventPayload: Record<string, unknown>;
  schemaVersion: number;
  retryCount: number;
  processingStatus: string;
  attempts: DeliveryAttempt[];
  orderingUncertain?: boolean;
  missingCausation?: boolean;
  integrityVerified?: boolean;
}
export interface Replay {
  workOrderId: string;
  events: ReplayEvent[];
  summary: {
    incidentStartUtc?: string;
    incidentEndUtc?: string;
    breachCount: number;
    interventionCount: number;
    outcome: string;
    facts: string[];
    inferences: string[];
  };
}
export interface Recommendation {
  strategy?: string;
  solverStatus?: string;
  runtimeMilliseconds?: number;
  technicianId: string;
  technicianName?: string;
  score: number;
  bookedMinutes?: number;
  estimatedTravelMinutes?: number | null;
  explanation?: string[];
  reasons?: string[];
  feasible?: boolean;
}
export interface Risk {
  probability: number;
  riskCategory: string;
  factors: string[];
  predictedAtUtc: string;
  modelVersion: string;
  intervention: string;
  synthetic?: boolean;
}
