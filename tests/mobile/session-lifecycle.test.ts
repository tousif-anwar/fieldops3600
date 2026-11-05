import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SessionLifecycle, StaleAuthenticationError, withDeadline } from '../../apps/technician-mobile/src/session-lifecycle';

test('a refresh started before logout cannot commit after the same user signs in again', async () => {
  const lifecycle = new SessionLifecycle();
  const oldLogin = lifecycle.advance();
  lifecycle.advance(); // logout
  const newLogin = lifecycle.advance();
  const writes: string[] = [];
  await lifecycle.save(newLogin, async () => { writes.push('new token'); }, () => writes.push('new session'));
  await assert.rejects(lifecycle.save(oldLogin, async () => { writes.push('stale token'); }, () => writes.push('stale session')), StaleAuthenticationError);
  assert.deepEqual(writes, ['new token', 'new session']);
});

test('logout clears a secure write already in flight before a new session is persisted', async () => {
  const lifecycle = new SessionLifecycle();
  const oldLogin = lifecycle.advance();
  let release!: () => void;
  let started!: () => void;
  const startedWriting = new Promise<void>(resolve => { started = resolve; });
  const pending = new Promise<void>(resolve => { release = resolve; });
  const writes: string[] = [];
  const saving = lifecycle.save(oldLogin, async () => { started(); await pending; writes.push('old token'); }, () => writes.push('old session'));
  const rejection = assert.rejects(saving, StaleAuthenticationError);
  await startedWriting;
  lifecycle.advance();
  const clearing = lifecycle.clear(async () => { writes.push('erase'); });
  const newLogin = lifecycle.advance();
  const replacement = lifecycle.save(newLogin, async () => { writes.push('new token'); }, () => writes.push('new session'));
  release();
  await Promise.all([rejection, clearing, replacement]);
  assert.deepEqual(writes, ['old token', 'erase', 'new token', 'new session']);
});

test('failed secure storage never exposes a successful in-memory session and does not poison later writes', async () => {
  const lifecycle = new SessionLifecycle();
  const generation = lifecycle.advance();
  let committed = false;
  await assert.rejects(lifecycle.save(generation, async () => { throw new Error('locked'); }, () => { committed = true; }), /locked/);
  assert.equal(committed, false);
  await lifecycle.save(generation, async () => undefined, () => { committed = true; });
  assert.equal(committed, true);
});

test('identity discovery/token requests time out and later attempts can succeed', async () => {
  await assert.rejects(withDeadline(new Promise(() => undefined), 1), /timed out/);
  assert.equal(await withDeadline(Promise.resolve('retried'), 1000), 'retried');
});
