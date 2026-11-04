import { manager } from "./auth";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
export const apiBase = import.meta.env.VITE_API_BASE ?? "";
async function authenticatedFetch(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const user = await manager.getUser();
  if (!user || user.expired)
    throw new ApiError(
      401,
      "Your session has expired. Sign in again to continue.",
    );
  const headers = new Headers(options.headers);
  headers.set("Authorization", `Bearer ${user.access_token}`);
  if (options.body) headers.set("Content-Type", "application/json");
  return fetch(`${apiBase}${path}`, { ...options, headers });
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await authenticatedFetch(path, options);
  if (!response.ok) {
    const problem = await response.json().catch(() => null);
    throw new ApiError(
      response.status,
      problem?.detail ??
        problem?.title ??
        `Request failed (${response.status}).`,
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export interface TraceAvailability {
  available: boolean;
  reason:
    | "available"
    | "not_retained"
    | "not_configured"
    | "unreachable"
    | "timeout"
    | "upstream_error";
  checkedAtUtc: string;
  spanCount: number | null;
}

export async function getTraceAvailability(
  workOrderId: string,
  traceId: string,
): Promise<TraceAvailability> {
  const response = await authenticatedFetch(
    `/api/replay/${encodeURIComponent(workOrderId)}/traces/${encodeURIComponent(traceId)}/availability`,
    { signal: AbortSignal.timeout(8000) },
  );
  const body = await response.json().catch(() => null);
  // This endpoint deliberately distinguishes a retained audit record whose
  // trace expired from an inaccessible work order, even though both use 404.
  if (
    (response.status === 200 &&
      body?.available === true &&
      body.reason === "available") ||
    (response.status === 404 &&
      body?.available === false &&
      body.reason === "not_retained") ||
    (response.status === 503 &&
      body?.available === false &&
      ["not_configured", "unreachable", "timeout", "upstream_error"].includes(
        body.reason,
      ))
  ) {
    return body as TraceAvailability;
  }
  throw new ApiError(
    response.ok ? 502 : response.status,
    body?.detail ?? body?.title ?? "Trace availability could not be confirmed.",
  );
}
export function post<T>(path: string, body: unknown) {
  return api<T>(path, { method: "POST", body: JSON.stringify(body) });
}
export async function download(path: string, filename: string) {
  const user = await manager.getUser();
  if (!user || user.expired)
    throw new ApiError(401, "Sign in again before exporting.");
  const response = await fetch(`${apiBase}${path}`, {
    headers: { Authorization: `Bearer ${user.access_token}` },
  });
  if (!response.ok)
    throw new ApiError(
      response.status,
      "Export could not be generated. Please try again.",
    );
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
