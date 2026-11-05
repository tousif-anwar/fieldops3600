import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Booking, WorkOrder, WorkflowStage } from '../../apps/technician-mobile/src/contracts';
import { contrastRatio } from '../../apps/technician-mobile/src/ui/contrast';
import { colors } from '../../apps/technician-mobile/src/ui/palette';
import {
  formatRemaining, friendlySyncError, greetingFor, humanizeFieldKey, slaPresentation,
  sortJobs, syncPresentation,
} from '../../apps/technician-mobile/src/ui/model';

const job = (overrides: Partial<WorkOrder>): WorkOrder => ({
  id: 'job-1', number: 'WO-1', title: 'Service', customerName: 'Customer',
  siteAddress: '1 Main St', serviceCategory: 'HVAC', priority: 'Normal',
  status: 'Scheduled', teamId: 'team-1', technicianId: 'tech-1',
  createdAtUtc: '2026-11-05T12:00:00Z', version: 1, ...overrides,
});

const booking = (overrides: Partial<Booking>): Booking => ({
  id: 'booking-1', workOrderId: 'job-1', technicianId: 'tech-1',
  startUtc: '2026-11-06T15:00:00Z', endUtc: '2026-11-06T17:00:00Z',
  status: 'Confirmed', version: 1, ...overrides,
});

const stage = (overrides: Partial<WorkflowStage>): WorkflowStage => ({
  id: 'stage-1', index: 0, name: 'Job Accepted', status: 'Active',
  startedAtUtc: '2026-11-05T12:00:00Z', deadlineUtc: '2026-11-05T12:30:00Z',
  completedAtUtc: null, pausedAtUtc: null, pausedSeconds: 0, slaStatus: 'OnTime',
  answers: {}, ...overrides,
});

test('active jobs sort before scheduled jobs, then by priority and appointment', () => {
  const jobs = [
    job({ id: 'scheduled', number: 'WO-3', status: 'Scheduled', priority: 'Critical' }),
    job({ id: 'active', number: 'WO-2', status: 'InProgress', priority: 'Normal' }),
    job({ id: 'early', number: 'WO-1', status: 'Scheduled', priority: 'High' }),
  ];
  const sorted = sortJobs(jobs, [booking({ workOrderId: 'early', startUtc: '2026-11-06T09:00:00Z' })]);
  assert.deepEqual(sorted.map(item => item.id), ['active', 'early', 'scheduled']);
});

test('technician Home greets by the technician device time', () => {
  assert.equal(greetingFor(new Date('2026-11-05T08:00:00')), 'Good morning');
  assert.equal(greetingFor(new Date('2026-11-05T14:00:00')), 'Good afternoon');
  assert.equal(greetingFor(new Date('2026-11-05T19:00:00')), 'Good evening');
});

test('remaining time uses plain minutes and distinguishes overdue work', () => {
  assert.equal(formatRemaining(1080), '18 min remaining');
  assert.equal(formatRemaining(3720), '1 hr 2 min remaining');
  assert.equal(formatRemaining(-180), 'Overdue by 3 min');
});

test('SLA presentation never implies a paused or offline timer is authoritative', () => {
  const now = new Date('2026-11-05T12:10:00Z').getTime();
  const normal = slaPresentation(stage({}), now, true);
  assert.equal(normal.label, '20 min remaining');
  assert.equal(normal.tone, 'success');
  const offline = slaPresentation(stage({}), now, false);
  assert.match(offline.detail, /server deadline continues/i);
  const paused = slaPresentation(stage({ pausedAtUtc: '2026-11-05T12:05:00Z' }), now, true);
  assert.equal(paused.label, 'Paused by supervisor');
  assert.equal(paused.tone, 'warning');
  const overdue = slaPresentation(stage({ deadlineUtc: '2026-11-05T11:57:00Z' }), now, true);
  assert.equal(overdue.tone, 'danger');
  assert.match(overdue.label, /Overdue/);
});

test('sync states use plain language and preserve recovery guidance', () => {
  assert.equal(syncPresentation('conflict').label, 'Needs your review');
  assert.match(friendlySyncError('HTTP 409 version conflict'), /answers are preserved/i);
  assert.match(friendlySyncError('401 token expired'), /sign in again/i);
  assert.equal(humanizeFieldKey('systemPressureReading'), 'System pressure reading');
});

test('semantic mobile text and control colors meet WCAG AA contrast', () => {
  assert.ok(contrastRatio(colors.ink, colors.canvas) >= 7);
  assert.ok(contrastRatio(colors.muted, colors.surface) >= 4.5);
  assert.ok(contrastRatio(colors.primary, colors.onPrimary) >= 4.5);
  assert.ok(contrastRatio(colors.warning, colors.surface) >= 4.5);
  assert.ok(contrastRatio(colors.danger, colors.surface) >= 4.5);
  assert.ok(contrastRatio(colors.borderStrong, colors.surface) >= 3);
});
