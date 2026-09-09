export class ApiError extends Error {
  constructor(
    public code: string,
    public status = 0,
    public details?: Record<string, unknown>,
  ) {
    super(code);
  }
}
let csrf = "";
export const setCsrf = (value: string) => {
  csrf = value;
};
export async function api<T = unknown>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (method !== "GET" && csrf && !path.startsWith("/display/"))
    headers["X-CSRF-Token"] = csrf;
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      method,
      credentials: "same-origin",
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(12000),
    });
  } catch {
    throw new ApiError("OFFLINE");
  }
  if (!response.ok) {
    const result = await response.json().catch(() => null);
    throw new ApiError(
      result?.error?.code ?? "INTERNAL_ERROR",
      response.status,
      result?.error?.details,
    );
  }
  return response.status === 204
    ? (undefined as T)
    : ((await response.json()) as T);
}
