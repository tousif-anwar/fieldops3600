import type { Booking, WorkOrder, Workflow } from './contracts';

export interface ItineraryStop {
  booking: Booking;
  job?: WorkOrder;
  completed: boolean;
  inProgress: boolean;
  windowPassed: boolean;
}

export function sameLocalDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

/** Device-local display only. This never reorders or commits server bookings. */
export function dailyItinerary(
  bookings: Booking[],
  jobs: WorkOrder[],
  workflows: Workflow[] = [],
  now = new Date(),
): ItineraryStop[] {
  const byOrder = new Map(jobs.map((job) => [job.id, job]));
  const byWorkflow = new Map(workflows.map((workflow) => [workflow.workOrderId, workflow]));
  return bookings
    .filter(
      (booking) => booking.status === 'Confirmed' && sameLocalDay(new Date(booking.startUtc), now),
    )
    .filter((booking) => byOrder.get(booking.workOrderId)?.status !== 'Cancelled')
    .sort(
      (left, right) =>
        Date.parse(left.startUtc) - Date.parse(right.startUtc) || left.id.localeCompare(right.id),
    )
    .map((booking) => {
      const job = byOrder.get(booking.workOrderId);
      const workflow = byWorkflow.get(booking.workOrderId);
      const completed = job?.status === 'Completed' || workflow?.status === 'Completed';
      return {
        booking,
        job,
        completed,
        inProgress: !completed && (job?.status === 'InProgress' || workflow?.status === 'Active'),
        windowPassed: !completed && Date.parse(booking.endUtc) < now.getTime(),
      };
    });
}

export function nextStop(stops: ItineraryStop[]): ItineraryStop | undefined {
  return stops.find((stop) => stop.inProgress) ?? stops.find((stop) => !stop.completed);
}

export function scheduledMinutes(stops: ItineraryStop[]): number {
  return Math.round(
    stops.reduce(
      (minutes, stop) =>
        minutes +
        Math.max(0, Date.parse(stop.booking.endUtc) - Date.parse(stop.booking.startUtc)) / 60_000,
      0,
    ),
  );
}

export interface ServiceActivity {
  id: string;
  workOrderId: string;
  label: string;
  occurredAtUtc: string;
}

export function serviceActivity(workflows: Workflow[]): ServiceActivity[] {
  return workflows
    .flatMap((workflow) =>
      workflow.stages
        .filter(
          (stage) => stage.completedAtUtc && ['Completed', 'Overridden'].includes(stage.status),
        )
        .map((stage) => ({
          id: stage.id,
          workOrderId: workflow.workOrderId,
          label: `${stage.name}${stage.status === 'Overridden' ? ' · supervisor override' : ' completed'}`,
          occurredAtUtc: stage.completedAtUtc!,
        })),
    )
    .sort(
      (left, right) =>
        Date.parse(right.occurredAtUtc) - Date.parse(left.occurredAtUtc) ||
        left.id.localeCompare(right.id),
    );
}

export function completedVisitsToday(workflows: Workflow[], now = new Date()): number {
  return workflows.filter(
    (workflow) =>
      workflow.status === 'Completed' &&
      workflow.completedAtUtc &&
      sameLocalDay(new Date(workflow.completedAtUtc), now),
  ).length;
}

/** Google Maps universal URL opens its app or browser. No routing API/key is used.
 * https://developers.google.com/maps/documentation/urls/get-started#directions-action
 * Only the destination is shared on an explicit tap; no location history is collected.
 */
export function directionsUrl(address: string): string | null {
  const destination = address.trim();
  if (!destination) return null;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=driving`;
}
