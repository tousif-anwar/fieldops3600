import { SubmissionError } from './offline/queue';

const baseUrl = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:5100').replace(/\/$/, '');

export async function requestApi<T>(
  path: string,
  token: string,
  options: { method?: string; body?: unknown } = {},
): Promise<{ data: T; serverReceivedAtUtc?: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method ?? 'GET',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json',
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });
    if (!response.ok) {
      const problem = await response.json().catch(() => ({})) as { title?: string; detail?: string };
      throw new SubmissionError(response.status, problem.detail ?? problem.title ?? `Request failed (${response.status}).`);
    }
    const raw = await response.text();
    return { data: raw ? JSON.parse(raw) as T : undefined as T,
      serverReceivedAtUtc: response.headers.get('Date') ?? undefined };
  } finally { clearTimeout(timeout); }
}
