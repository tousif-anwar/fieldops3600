import type { Booking, WorkOrder, WorkflowStage } from '../contracts';

export type Tone = 'success' | 'warning' | 'danger' | 'neutral' | 'info';

const statusLabels: Record<string, string> = {
  InProgress: 'In progress',
  Scheduled: 'Scheduled',
  Completed: 'Completed',
  Cancelled: 'Cancelled',
  Pending: 'Pending',
  Active: 'Active',
  Paused: 'Paused',
  Warning: 'At risk',
  Breached: 'Overdue',
  OnTime: 'On time',
  Overridden: 'Overridden',
  Conflict: 'Needs review',
  Synced: 'Synced',
  Sending: 'Syncing',
  Failed: 'Couldn’t sync',
};

export function formatStatus(value: string): string {
  if (statusLabels[value]) return statusLabels[value];
  const spaced = value.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim().toLowerCase();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : value;
}

export function statusTone(value: string): Tone {
  const normalized = value.toLowerCase();
  if (/breach|critical|overdue|failed|cancel|danger/.test(normalized)) return 'danger';
  if (/warning|risk|pending|paused|conflict|offline/.test(normalized)) return 'warning';
  if (/complete|success|resolved|ontime|on time|confirmed|synced|active/.test(normalized)) return 'success';
  return 'neutral';
}

export function priorityTone(value: string): Tone {
  const normalized = value.toLowerCase();
  if (normalized === 'critical') return 'danger';
  if (normalized === 'high') return 'warning';
  if (normalized === 'low') return 'neutral';
  return 'info';
}

export function jobStatusTone(value: string): Tone {
  if (value === 'InProgress') return 'info';
  return statusTone(value);
}

export function stageStatusTone(value: string): Tone {
  return statusTone(value);
}

export function appointmentForJob(bookings: Booking[], workOrderId: string): Booking | undefined {
  return bookings
    .filter(booking => booking.workOrderId === workOrderId && booking.status !== 'Cancelled')
    .sort((left, right) => left.startUtc.localeCompare(right.startUtc))[0];
}

const priorityRank: Record<string, number> = { Critical: 0, High: 1, Normal: 2, Low: 3 };
const jobRank = (job: WorkOrder) => job.status === 'InProgress' ? 0 : job.status === 'Scheduled' ? 1 : 2;

export function sortJobs(jobs: WorkOrder[], bookings: Booking[] = []): WorkOrder[] {
  const starts = new Map<string, string>();
  bookings
    .filter(booking => booking.status !== 'Cancelled')
    .sort((left, right) => left.startUtc.localeCompare(right.startUtc))
    .forEach(booking => {
      if (!starts.has(booking.workOrderId)) starts.set(booking.workOrderId, booking.startUtc);
    });
  return [...jobs].sort((left, right) => {
    const byStatus = jobRank(left) - jobRank(right);
    if (byStatus !== 0) return byStatus;
    // The next appointment is the technician's immediate task; priority breaks
    // ties between jobs with the same (or no) appointment window.
    const leftStart = starts.get(left.id) ?? '9999';
    const rightStart = starts.get(right.id) ?? '9999';
    const byStart = leftStart.localeCompare(rightStart);
    if (byStart !== 0) return byStart;
    const byPriority = (priorityRank[left.priority] ?? 9) - (priorityRank[right.priority] ?? 9);
    if (byPriority !== 0) return byPriority;
    return left.number.localeCompare(right.number);
  });
}

export function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function formatAppointment(booking: Booking, now = new Date()): string {
  const start = new Date(booking.startUtc);
  const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayDifference = Math.round((startDay.getTime() - today.getTime()) / 86_400_000);
  const day = dayDifference === 0 ? 'Today'
    : dayDifference === 1 ? 'Tomorrow'
      : start.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return `${day}, ${formatTime(booking.startUtc)}–${formatTime(booking.endUtc)}`;
}

export function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString([], {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

export function formatClock(value: string): string {
  return new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function remainingSeconds(stage: WorkflowStage, now: number): number | null {
  if (!stage.deadlineUtc) return null;
  const deadline = new Date(stage.deadlineUtc).getTime();
  const effectiveNow = stage.pausedAtUtc ? new Date(stage.pausedAtUtc).getTime() : now;
  return Math.floor((deadline - effectiveNow) / 1000);
}

export function formatRemaining(seconds: number): string {
  const absoluteMinutes = Math.max(0, Math.ceil(Math.abs(seconds) / 60));
  const duration = absoluteMinutes >= 60
    ? `${Math.floor(absoluteMinutes / 60)} hr${absoluteMinutes % 60 ? ` ${absoluteMinutes % 60} min` : ''}`
    : `${absoluteMinutes} min`;
  if (seconds < 0) return `Overdue by ${duration}`;
  if (seconds === 0) return 'Due now';
  return `${duration} remaining`;
}

export interface SlaPresentation {
  label: string;
  detail: string;
  tone: Tone;
}

export function slaPresentation(stage: WorkflowStage, now: number, online: boolean): SlaPresentation {
  const seconds = remainingSeconds(stage, now);
  if (seconds === null) {
    return {
      label: 'Awaiting server start',
      detail: 'The stage deadline appears when the server starts the clock.',
      tone: 'neutral',
    };
  }
  if (stage.pausedAtUtc) {
    return {
      label: 'Paused by supervisor',
      detail: `${formatRemaining(seconds)} when paused. The server resumes the deadline.`,
      tone: 'warning',
    };
  }
  const normalized = stage.slaStatus.toLowerCase();
  const tone: Tone = seconds <= 0 || normalized === 'breached' ? 'danger'
    : normalized === 'warning' || seconds <= 300 ? 'warning'
      : 'success';
  return {
    label: formatRemaining(seconds),
    detail: online ? `Server deadline ${formatClock(stage.deadlineUtc!)}` : 'Offline estimate. The server deadline continues.',
    tone,
  };
}

export function syncPresentation(status: string): { label: string; detail: string; tone: Tone } {
  switch (status) {
    case 'pending':
      return { label: 'Waiting to sync', detail: 'Saved on this device. It will retry when the server is reachable.', tone: 'warning' };
    case 'sending':
      return { label: 'Syncing', detail: 'The server is checking this stage response now.', tone: 'info' };
    case 'conflict':
      return { label: 'Needs your review', detail: 'The job changed on the server before this response arrived.', tone: 'warning' };
    case 'failed':
      return { label: 'Couldn’t sync', detail: 'The server did not accept this update. Your answers are still on this device.', tone: 'danger' };
    case 'synced':
      return { label: 'Synced', detail: 'The server accepted this update.', tone: 'success' };
    default:
      return { label: formatStatus(status), detail: 'Review this update.', tone: 'neutral' };
  }
}

export function friendlySyncError(error?: string): string {
  if (!error) return 'No further detail is available yet. Try again when connected.';
  if (/409|conflict|version|changed/i.test(error)) {
    return 'The job changed before this update arrived. Your answers are preserved here; refresh the job and review the current stage before submitting again.';
  }
  if (/403|forbidden|access/i.test(error)) {
    return 'You no longer have access to this job. Your answers remain on this device; contact your supervisor before discarding them.';
  }
  if (/401|session|expired|token/i.test(error)) {
    return 'Your secure session expired. Sign in again, then retry synchronization. Your answers remain on this device.';
  }
  if (/400|invalid|required/i.test(error)) {
    return 'Some answers were not accepted by the server. Reopen the job, check the current stage, and review your answers.';
  }
  return 'The server could not accept this update. Your answers remain on this device. Try again when connected.';
}

export function humanizeFieldKey(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase() : key;
}
