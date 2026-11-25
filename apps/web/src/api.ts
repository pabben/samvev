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
/** AbortSignal.any is absent in some otherwise supported browsers. */
export function requestAbortSignal(timeoutMs:number,external?:AbortSignal):{signal:AbortSignal;dispose:()=>void}{
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(new Error('request_timeout')),timeoutMs);
  const abort=()=>controller.abort(external?.reason);
  if(external?.aborted)abort();else external?.addEventListener('abort',abort,{once:true});
  return{signal:controller.signal,dispose:()=>{clearTimeout(timer);external?.removeEventListener('abort',abort);}};
}
export async function api<T = unknown>(
  path: string,
  method = "GET",
  body?: unknown,
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (method !== "GET" && csrf && !path.startsWith("/display/"))
    headers["X-CSRF-Token"] = csrf;
  const requestSignal=requestAbortSignal(options.timeoutMs??12000,options.signal);
  try {
    const response = await fetch(`/api/v1${path}`, {
      method,
      credentials: "same-origin",
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      signal:requestSignal.signal,
    });
    if (!response.ok) {
    const result = await response.json().catch(() => null);
    throw new ApiError(
      result?.error?.code ?? "INTERNAL_ERROR",
      response.status,
      result?.error?.details,
    );
    }
    return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
  }catch(cause){
    if(options.signal?.aborted&&options.signal.reason instanceof Error)throw options.signal.reason;
    if(cause instanceof ApiError)throw cause;
    // Headers can arrive before a timeout, connection loss or invalid JSON.
    // Keep those uncertain outcomes distinct from an HTTP authorization denial.
    throw new ApiError('OFFLINE');
  }finally{requestSignal.dispose();}
}
