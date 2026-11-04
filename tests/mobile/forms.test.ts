import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanAnswers, validateAnswers, visibleFields } from '../../apps/technician-mobile/src/offline/forms';

const fields = [
  { key: 'travelStatus', label: 'Travel status', required: true, options: ['Departed', 'Delayed', 'Arrived'] },
  { key: 'delayReason', label: 'Delay reason', required: true, options: ['Traffic', 'Weather'],
    conditionField: 'travelStatus', conditionValue: 'Delayed' },
];

test('conditional required field is enforced only while its controlling answer matches', () => {
  assert.equal(visibleFields(fields, { travelStatus: 'Arrived' }).length, 1);
  assert.deepEqual(validateAnswers(fields, { travelStatus: 'Arrived' }), []);
  assert.deepEqual(validateAnswers(fields, { travelStatus: 'Delayed' }), ['Select delay reason.']);
});

test('changing a controlling answer removes obsolete hidden values from the outgoing payload', () => {
  assert.deepEqual(cleanAnswers(fields, { travelStatus: 'Arrived', delayReason: 'Traffic', injected: 'ignored' }), {
    travelStatus: 'Arrived',
  });
});

test('unknown dropdown options cannot pass client validation', () => {
  assert.match(validateAnswers(fields, { travelStatus: 'Teleport' })[0]!, /invalid selection/);
});
