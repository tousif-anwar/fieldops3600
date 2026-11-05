/** Prevent asynchronous credentials from reviving a session invalidated by logout. */
export class StaleAuthenticationError extends Error {
  constructor() { super('Authentication changed. Complete sign-in again.'); }
}

export class SessionLifecycle {
  private revision = 0;
  private writes: Promise<unknown> = Promise.resolve();

  get generation(): number { return this.revision; }
  advance(): number { this.revision += 1; return this.revision; }
  isCurrent(generation: number): boolean { return generation === this.revision; }

  private serialize<T>(action: () => Promise<T>): Promise<T> {
    const next = this.writes.then(action, action);
    this.writes = next.catch(() => undefined);
    return next;
  }

  save(generation: number, write: () => Promise<void>, commit: () => void): Promise<void> {
    return this.serialize(async () => {
      if (!this.isCurrent(generation)) throw new StaleAuthenticationError();
      await write();
      if (!this.isCurrent(generation)) throw new StaleAuthenticationError();
      commit();
    });
  }

  clear(write: () => Promise<void>): Promise<void> { return this.serialize(write); }
}

export async function withDeadline<T>(operation: Promise<T>, milliseconds = 15_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Identity provider timed out. Check your connection and try again.')), milliseconds);
  });
  try { return await Promise.race([operation, deadline]); }
  finally { if (timer !== undefined) clearTimeout(timer); }
}
