/** Durable at-least-once queue. Stable keys rely on backend idempotency.
 * Server version conflicts always require review, never silent rebasing.
 */
export type QueueStatus = 'pending' | 'sending' | 'conflict' | 'failed' | 'synced';

export interface Submission {
  id: string;
  ownerId: string;
  workOrderId: string;
  workflowId: string;
  stageIndex: number;
  expectedVersion: number;
  answers: Record<string, string>;
  clientOccurredAtUtc: string;
  createdOffline: boolean;
  createdAt: number;
  attempts: number;
  nextAttemptAt: number;
  status: QueueStatus;
  lastError?: string;
  serverReceivedAtUtc?: string;
}

export interface QueueStorage {
  read(): Promise<Submission[]>;
  write(items: Submission[]): Promise<void>;
}

export class SubmissionError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

export interface SubmissionTransport {
  send(item: Submission): Promise<{ serverReceivedAtUtc?: string }>;
}

// Keep one owner lock even when an auth refresh/remount creates another queue.
// Backend idempotency protects delivery; this lock also prevents lost local writes.
const ownerLocks = new Map<string, Promise<unknown>>();

const orderedAnswers = (answers: Record<string, string>) => JSON.stringify(
  Object.entries(answers).sort(([left], [right]) => left.localeCompare(right)),
);

export class OfflineQueue {
  private listeners = new Set<() => void>();

  constructor(
    private readonly ownerId: string,
    private readonly storage: QueueStorage,
    private readonly transport: SubmissionTransport,
    private readonly now = () => Date.now(),
  ) {}

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private notify() { this.listeners.forEach(listener => listener()); }

  private async serialized<T>(action: () => Promise<T>): Promise<T> {
    const previous = ownerLocks.get(this.ownerId) ?? Promise.resolve();
    const next = previous.then(action, action);
    ownerLocks.set(this.ownerId, next.catch(() => undefined));
    return next;
  }

  async list(): Promise<Submission[]> {
    await ownerLocks.get(this.ownerId);
    const items = await this.storage.read();
    if (items.some(item => item.ownerId !== this.ownerId)) {
      throw new Error('Queue ownership mismatch. Sign in as the queue owner.');
    }
    return items;
  }

  async enqueue(item: Omit<Submission, 'attempts' | 'nextAttemptAt' | 'status'>): Promise<void> {
    return this.serialized(async () => {
      if (item.ownerId !== this.ownerId) throw new Error('Queue ownership mismatch.');
      const items = await this.storage.read();
      if (items.some(existing => existing.ownerId !== this.ownerId)) throw new Error('Queue ownership mismatch.');
      const existing = items.find(existing => existing.id === item.id);
      if (existing) {
        if (orderedAnswers(existing.answers) !== orderedAnswers(item.answers)
            || existing.workflowId !== item.workflowId || existing.workOrderId !== item.workOrderId
            || existing.stageIndex !== item.stageIndex || existing.expectedVersion !== item.expectedVersion
            || existing.clientOccurredAtUtc !== item.clientOccurredAtUtc || existing.createdOffline !== item.createdOffline) {
          throw new Error('An idempotency key cannot be reused with different content.');
        }
        return;
      }
      if (items.some(existing => existing.workflowId === item.workflowId
          && existing.status !== 'synced')) {
        throw new Error('A submission for this workflow is already queued. Review synchronization first.');
      }
      items.push({ ...item, attempts: 0, nextAttemptAt: 0, status: 'pending' });
      await this.storage.write(items);
      this.notify();
    });
  }

  async discard(id: string): Promise<void> {
    return this.serialized(async () => {
      const items = await this.storage.read();
      if (items.some(item => item.ownerId !== this.ownerId)) throw new Error('Queue ownership mismatch.');
      await this.storage.write(items.filter(item => item.id !== id));
      this.notify();
    });
  }

  async flush(online: boolean): Promise<void> {
    if (!online) return;
    return this.serialized(async () => {
      const items = await this.storage.read();
      if (items.some(item => item.ownerId !== this.ownerId)) throw new Error('Queue ownership mismatch.');
      for (const item of items) {
        // A crash during send leaves 'sending'. Retrying the same key is safe.
        if (!['pending', 'sending'].includes(item.status) || item.nextAttemptAt > this.now()) continue;
        item.status = 'sending';
        item.attempts += 1;
        await this.storage.write(items);
        this.notify();
        try {
          const receipt = await this.transport.send(item);
          item.status = 'synced';
          item.serverReceivedAtUtc = receipt.serverReceivedAtUtc;
          item.lastError = undefined;
        } catch (error) {
          const status = error instanceof SubmissionError ? error.status : 0;
          item.lastError = error instanceof Error ? error.message : 'Synchronization failed.';
          item.status = status === 409 ? 'conflict'
            : (status >= 400 && status < 500 && ![401, 408, 429].includes(status)) ? 'failed' : 'pending';
          item.nextAttemptAt = this.now() + Math.min(60_000, 1000 * 2 ** Math.min(item.attempts - 1, 6));
        }
        await this.storage.write(items.filter((entry, index) => entry.status !== 'synced' || index >= items.length - 20));
        this.notify();
        // A failed connection/authentication should not generate a burst of retries.
        if (item.status === 'pending') break;
      }
    });
  }
}
