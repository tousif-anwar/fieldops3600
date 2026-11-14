import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AssignmentOffer, Booking, WorkOrder, Workflow } from '../../apps/technician-mobile/src/contracts';
import {
  completedVisitsToday, dailyItinerary, directionsUrl, nextStop, sameLocalDay,
  scheduledMinutes, serviceActivity,
} from '../../apps/technician-mobile/src/itinerary';
import { offerDisplayStatus, offerIsActionable, pendingOffers } from '../../apps/technician-mobile/src/offers';

const local = (day: number, hour: number) => new Date(2026, 10, day, hour).toISOString();
const job = (id: string, status = 'Scheduled'): WorkOrder => ({
  id, number: `WO-${id}`, title: 'Maintenance', customerName: 'Test customer',
  siteAddress: '12 Main St', serviceCategory: 'HVAC', priority: 'Normal',
  status, teamId: 'north', technicianId: 'tech-01', createdAtUtc: local(12, 9), version: 1,
});
const booking = (id: string, startHour: number, status = 'Confirmed'): Booking => ({
  id, workOrderId: id, technicianId: 'tech-01', startUtc: local(13, startHour),
  endUtc: local(13, startHour + 1), status, version: 1,
});
const workflow = (id: string, status = 'Active'): Workflow => ({
  id: `workflow-${id}`, workOrderId: id, technicianId: 'tech-01', templateVersion: 1,
  currentStageIndex: 0, version: 1, status, completedAtUtc: status === 'Completed' ? local(13, 10) : null,
  stages: [{ id: `stage-${id}`, index: 0, name: 'Job accepted', status: 'Completed',
    startedAtUtc: local(13, 8), completedAtUtc: local(13, 9), deadlineUtc: local(13, 10),
    pausedAtUtc: null, pausedSeconds: 0, slaStatus: 'OnTime', answers: { assignment: 'Accept' } }],
});
const offer = (override: Partial<AssignmentOffer> = {}): AssignmentOffer => ({
  id: 'offer-1', workOrderId: 'job-1', technicianId: 'tech-01', teamId: 'north',
  workOrderNumber: 'WO-1', title: 'Emergency repair', siteAddress: '12 Main St', serviceCategory: 'HVAC',
  priority: 'High', startUtc: local(13, 15), endUtc: local(13, 16), expiresAtUtc: local(13, 14),
  status: 'Pending', version: 1, createdAtUtc: local(13, 12), ...override,
});

test('itinerary uses confirmed local-day bookings, joins job context, and preserves dispatch order', () => {
  const bookings = [booking('late', 15), booking('done', 9), booking('cancelled', 10, 'Cancelled'),
    booking('cancelled-order', 11), { ...booking('tomorrow', 8), startUtc: local(14, 8), endUtc: local(14, 9) }];
  const before = structuredClone(bookings);
  const stops = dailyItinerary(bookings, [job('late'), job('done', 'Completed'), job('cancelled-order', 'Cancelled')], [], new Date(local(13, 12)));
  assert.deepEqual(stops.map(stop => stop.booking.id), ['done', 'late']);
  assert.equal(stops[0]!.completed, true);
  assert.equal(stops[1]!.job!.siteAddress, '12 Main St');
  assert.equal(nextStop(stops)?.booking.id, 'late');
  assert.equal(scheduledMinutes(stops), 120);
  assert.deepEqual(bookings, before);
});

test('active workflow and completion evidence take precedence over eventually consistent job status', () => {
  const stops = dailyItinerary([booking('first', 9), booking('working', 13), booking('done', 15)],
    [job('first'), job('working'), job('done')], [workflow('working'), workflow('done', 'Completed')], new Date(local(13, 12)));
  assert.equal(nextStop(stops)?.booking.id, 'working');
  assert.equal(stops[0]!.windowPassed, true);
  assert.equal(stops[2]!.completed, true);
  assert.equal(stops[2]!.windowPassed, false);
});

test('local-day comparison includes year and handles daylight saving calendar days', () => {
  assert.equal(sameLocalDay(new Date(2026, 10, 1, 1), new Date(2026, 10, 1, 23)), true);
  assert.equal(sameLocalDay(new Date(2026, 10, 1), new Date(2027, 10, 1)), false);
  assert.equal(sameLocalDay(new Date(2026, 10, 1, 23), new Date(2026, 10, 2, 0)), false);
});

test('activity reports stored accepted stages and counts completion only on the recorded local day', () => {
  const completed = workflow('done', 'Completed');
  const active = workflow('working');
  active.stages[0]!.status = 'Active';
  active.stages[0]!.completedAtUtc = null;
  const overridden = workflow('override');
  overridden.stages[0]!.status = 'Overridden';
  overridden.stages[0]!.completedAtUtc = local(13, 11);
  assert.deepEqual(serviceActivity([completed, active, overridden]).map(item => item.workOrderId), ['override', 'done']);
  assert.match(serviceActivity([overridden])[0]!.label, /supervisor override/);
  assert.equal(completedVisitsToday([completed, active], new Date(local(13, 17))), 1);
  assert.equal(completedVisitsToday([completed], new Date(local(14, 10))), 0);
});

test('directions are explicit destination handoffs with safely encoded addresses and no location collection', () => {
  assert.equal(directionsUrl('   '), null);
  const url = new URL(directionsUrl('  10 Main St #2 & Park, NY  ' )!);
  assert.equal(url.origin, 'https://www.google.com');
  assert.equal(url.searchParams.get('api'), '1');
  assert.equal(url.searchParams.get('destination'), '10 Main St #2 & Park, NY');
  assert.equal(url.searchParams.get('travelmode'), 'driving');
  assert.equal(url.searchParams.has('origin'), false);
});

test('offer actions require connection and a pending unexpired authoritative offer', () => {
  const now = Date.parse(local(13, 13));
  assert.equal(offerIsActionable(offer(), true, now), true);
  assert.equal(offerIsActionable(offer(), false, now), false);
  assert.equal(offerIsActionable(offer({ status: 'Accepted' }), true, now), false);
  assert.equal(offerIsActionable(offer(), true, Date.parse(local(13, 14))), false);
  assert.equal(offerDisplayStatus(offer(), Date.parse(local(13, 14))), 'Expired');
  assert.equal(offerDisplayStatus(offer({ status: 'Accepted' }), Date.parse(local(13, 15))), 'Accepted');
  assert.deepEqual(pendingOffers([
    offer({ id: 'expired', expiresAtUtc: local(13, 12) }),
    offer({ id: 'later', expiresAtUtc: local(13, 15) }),
    offer({ id: 'first', expiresAtUtc: local(13, 14) }),
    offer({ id: 'declined', status: 'Declined' }),
  ], now).map(item => item.id), ['first', 'later']);
});
