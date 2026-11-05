import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OfflineQueue, SubmissionError, type QueueStorage, type Submission, type SubmissionTransport } from '../../apps/technician-mobile/src/offline/queue';

function fixture(transport?: SubmissionTransport) {
  let stored: Submission[] = [];
  let timestamp = 1_000;
  const storage: QueueStorage = {
    read: async () => structuredClone(stored),
    write: async items => { stored = structuredClone(items); },
  };
  const sent: Submission[] = [];
  const queue = new OfflineQueue('tech-01', storage, transport ?? {
    send: async item => { sent.push(structuredClone(item)); return { serverReceivedAtUtc: '2026-11-04T17:00:00Z' }; },
  }, () => timestamp);
  const submission = {
    id: 'stable-key', ownerId: 'tech-01', workOrderId: 'wo-01', workflowId: 'wf-01', stageIndex: 0,
    expectedVersion: 1, answers: { assignment: 'Accept' },
    clientOccurredAtUtc: '2026-11-04T16:59:00Z', createdAt: timestamp, createdOffline: true,
  };
  return { queue, storage, sent, submission, advance: (ms: number) => { timestamp += ms; } };
}

test('offline submission survives recreation and synchronizes with the original key and timestamp', async () => {
  const context = fixture();
  await context.queue.enqueue(context.submission);
  await context.queue.flush(false);
  assert.equal(context.sent.length, 0);
  const recreated = new OfflineQueue('tech-01', context.storage, { send: async item => {
    assert.equal(item.id, 'stable-key');
    assert.equal(item.expectedVersion, 1);
    assert.equal(item.clientOccurredAtUtc, '2026-11-04T16:59:00Z');
    return { serverReceivedAtUtc: '2026-11-04T17:00:00Z' };
  } });
  await recreated.flush(true);
  assert.equal((await recreated.list())[0]?.status, 'synced');
  assert.equal((await recreated.list())[0]?.serverReceivedAtUtc, '2026-11-04T17:00:00Z');
});

test('transient failure backs off then retries the identical logical submission', async () => {
  const keys: string[] = [];
  const context = fixture({ send: async item => {
    keys.push(item.id);
    if (keys.length === 1) throw new SubmissionError(503, 'Service unavailable');
    return {};
  } });
  await context.queue.enqueue(context.submission);
  await context.queue.flush(true);
  assert.equal((await context.queue.list())[0]?.status, 'pending');
  await context.queue.flush(true);
  assert.deepEqual(keys, ['stable-key']);
  context.advance(1000);
  await context.queue.flush(true);
  assert.deepEqual(keys, ['stable-key', 'stable-key']);
  assert.equal((await context.queue.list())[0]?.attempts, 2);
});

test('manual synchronization bypasses retry timing only for pending or interrupted sends', async () => {
  const context = fixture();
  await context.storage.write([
    { ...context.submission, attempts: 1, nextAttemptAt: 60_000, status: 'pending' },
    { ...context.submission, id: 'interrupted-key', workflowId: 'wf-02', workOrderId: 'wo-02', attempts: 1, nextAttemptAt: 60_000, status: 'sending' },
    { ...context.submission, id: 'conflict-key', workflowId: 'wf-03', workOrderId: 'wo-03', attempts: 1, nextAttemptAt: 60_000, status: 'conflict' },
    { ...context.submission, id: 'failed-key', workflowId: 'wf-04', workOrderId: 'wo-04', attempts: 1, nextAttemptAt: 60_000, status: 'failed' },
  ]);
  await context.queue.flush(true);
  assert.equal(context.sent.length, 0);
  await context.queue.flush(true, { ignoreBackoff: true });
  assert.deepEqual(context.sent.map(item => item.id), ['stable-key', 'interrupted-key']);
  assert.ok(context.sent.every(item => item.expectedVersion === 1
    && item.clientOccurredAtUtc === context.submission.clientOccurredAtUtc
    && item.ownerId === 'tech-01'));
  assert.deepEqual((await context.queue.list()).map(item => item.status), ['synced', 'synced', 'conflict', 'failed']);
});

test('server conflict stops retries and keeps the original answers for review', async () => {
  let calls = 0;
  const context = fixture({ send: async () => { calls++; throw new SubmissionError(409, 'Workflow changed'); } });
  await context.queue.enqueue(context.submission);
  await context.queue.flush(true);
  context.advance(60_000);
  await context.queue.flush(true);
  const item = (await context.queue.list())[0]!;
  assert.equal(calls, 1);
  assert.equal(item.status, 'conflict');
  assert.equal(item.expectedVersion, 1);
  assert.equal(item.answers.assignment, 'Accept');
});

test('concurrent flushes send a queued action once', async () => {
  const context = fixture();
  await context.queue.enqueue(context.submission);
  await Promise.all([context.queue.flush(true), context.queue.flush(true), context.queue.flush(true)]);
  assert.equal(context.sent.length, 1);
});

test('a remounted queue shares its owner lock and cannot erase a newly queued action', async () => {
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const context = fixture({ send: async () => { await blocked; return {}; } });
  await context.queue.enqueue(context.submission);
  const flushing = context.queue.flush(true);
  const remounted = new OfflineQueue('tech-01', context.storage, { send: async () => ({}) });
  const enqueue = remounted.enqueue({ ...context.submission, id: 'another-key', workflowId: 'wf-02', workOrderId: 'wo-02' });
  release();
  await Promise.all([flushing, enqueue]);
  assert.deepEqual((await remounted.list()).map(item => [item.id, item.status]), [
    ['stable-key', 'synced'], ['another-key', 'pending'],
  ]);
});

test('crash during network send retries safely instead of losing the sending record', async () => {
  const context = fixture();
  await context.storage.write([{ ...context.submission, attempts: 1, nextAttemptAt: 0, status: 'sending' }]);
  await context.queue.flush(true);
  assert.equal(context.sent[0]?.id, 'stable-key');
  assert.equal((await context.queue.list())[0]?.status, 'synced');
});

test('queue rejects another account and idempotency key mutation', async () => {
  const context = fixture();
  await assert.rejects(context.queue.enqueue({ ...context.submission, ownerId: 'another-user' }), /ownership/);
  await context.queue.enqueue(context.submission);
  await assert.rejects(context.queue.enqueue({ ...context.submission, answers: { assignment: 'Reassign' } }), /different content/);
  const otherAccount = new OfflineQueue('another-user', context.storage, { send: async () => ({}) });
  await assert.rejects(otherAccount.flush(true), /ownership/);
  await assert.rejects(otherAccount.discard('stable-key'), /ownership/);
});

test('a workflow cannot silently queue a later stage before confirmation', async () => {
  const context = fixture();
  await context.queue.enqueue(context.submission);
  await assert.rejects(context.queue.enqueue({ ...context.submission, id: 'next-stage', stageIndex: 1 }), /already queued/);
});

test('forbidden or invalid submissions are retained as failed instead of retried indefinitely', async () => {
  const context = fixture({ send: async () => { throw new SubmissionError(403, 'Not assigned'); } });
  await context.queue.enqueue(context.submission);
  await context.queue.flush(true);
  assert.equal((await context.queue.list())[0]?.status, 'failed');
});
