const BASE = '';

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      detail = body.detail || JSON.stringify(body);
    } catch {
      /* keep status text */
    }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

export async function getJSON<T = any>(path: string): Promise<T> {
  return handle<T>(await fetch(BASE + path));
}

export async function postJSON<T = any>(path: string, body?: unknown): Promise<T> {
  return handle<T>(
    await fetch(BASE + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

export async function patchJSON<T = any>(path: string, body: unknown): Promise<T> {
  return handle<T>(
    await fetch(BASE + path, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

export async function del<T = any>(path: string): Promise<T> {
  return handle<T>(await fetch(BASE + path, { method: 'DELETE' }));
}

export const fmt = (v: number | null | undefined, digits = 2): string =>
  v === null || v === undefined || Number.isNaN(v)
    ? '–'
    : v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });

export const money = (v: number | null | undefined): string =>
  v === null || v === undefined
    ? '–'
    : `${v < 0 ? '−' : ''}$${Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

export const pct = (v: number | null | undefined, digits = 1): string =>
  v === null || v === undefined ? '–' : `${v.toFixed(digits)}%`;

export function etTime(ts: number, withDate = false): string {
  const d = new Date(ts * 1000);
  return d.toLocaleString('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    ...(withDate ? { month: 'short', day: '2-digit' } : {}),
  });
}

export function etDateTime(ts: number): string {
  return new Date(ts * 1000).toLocaleString('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}
