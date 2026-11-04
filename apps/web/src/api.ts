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
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const user = await manager.getUser();
  if (!user || user.expired)
    throw new ApiError(
      401,
      "Your session has expired. Sign in again to continue.",
    );
  const headers = new Headers(options.headers);
  headers.set("Authorization", `Bearer ${user.access_token}`);
  if (options.body) headers.set("Content-Type", "application/json");
  const response = await fetch(`${apiBase}${path}`, { ...options, headers });
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
