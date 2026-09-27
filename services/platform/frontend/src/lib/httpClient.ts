import { ClientRequestCache } from "./clientRequestCache";
import { consumeApiResponse } from "./clientRequestTransport";
import { getRequestTimeout } from "../platform/lib/requestTimeout";
import type { ApiError, Requirement, SessionPayload, TestCase, TestStep } from "../types";
import { resolveServiceBase } from "../platform/lib/serviceEndpoints";
import { appendCurrentProjectScope } from "../platform/lib/currentScope";

export type PagedResult<T> = {
  items: T[];
  total?: number;
  next_cursor: string | null;
  is_last: boolean;
};

declare global {
  interface Window {
    __HELLOTEST_CONFIG__?: {
      API_BASE_URL?: string;
      CAPABILITY_UI_URLS?: Partial<Record<import("../services/shared").HelloTestService, string>>;
      SERVICE_URLS?: Partial<Record<"platform" | "testing" | "knowledge" | "manual" | "dashboard" | "automation" | "agentic" | "chatbot" | "ai" | "trace" | "integration", string>>;
    };
  }
}

export const API_BASE_URL =
  window.__HELLOTEST_CONFIG__?.API_BASE_URL
  || import.meta.env.VITE_API_BASE_URL
  || "/api";

const SESSION_KEY = "hellotest.session";

const requestCache = new ClientRequestCache();

/** @deprecated Retained for protocol 1 capability releases. Prefer invalidation. */
export const clientGetResponseCache = requestCache.compatibilityResponses;

export const invalidateClientGetResponses = () => requestCache.invalidate();

const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }

  return JSON.stringify(value);
};

export const sessionStorage = {
  read(): SessionPayload | null {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as SessionPayload;
    } catch {
      window.localStorage.removeItem(SESSION_KEY);
      return null;
    }
  },
  write(session: SessionPayload) {
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    readRequestSession();
  },
  clear() {
    window.localStorage.removeItem(SESSION_KEY);
    readRequestSession();
  }
};

let requestSessionFingerprint = "";

let requestSessionRevision = 0;

export function readRequestSession() {
  const session = sessionStorage.read();
  const user = session?.user;
  const fingerprint = stableStringify([session?.token, user?.id, user?.role, user?.role_id, user?.status, user?.permissions, user?.workspace_permissions, user?.project_permissions]);
  if (fingerprint !== requestSessionFingerprint) {
    requestSessionFingerprint = fingerprint;
    requestSessionRevision += 1;
    invalidateClientGetResponses();
  }
  return { token: session?.token || null, revision: requestSessionRevision };
}

const getStoredToken = () => readRequestSession().token;

export const isSessionAuthFailure = (path: string, message: string) => {
  if (path.startsWith("/auth/")) return path === "/auth/session";
  return [
    "missing bearer token",
    "invalid token",
    "invalid token format",
    "invalid token structure",
    "invalid token signature",
    "token expired",
    "token verification failed"
  ].some((needle) => message.toLowerCase().includes(needle));
};

export class HelloTestApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly currentRevision?: number;
  readonly requestId?: string;
  readonly traceId?: string;

  constructor(message: string, status: number, payload: ApiError = {}, diagnostics: { requestId?: string; traceId?: string } = {}) {
    super(message);
    this.name = "HelloTestApiError";
    this.status = status;
    this.code = payload.code;
    this.currentRevision = payload.current_revision;
    this.requestId = diagnostics.requestId;
    this.traceId = diagnostics.traceId;
  }
}

export async function parseApiError(response: Response) {
  const isJson = response.headers.get("content-type")?.includes("application/json");
  const payload = isJson ? await response.json().catch(() => null) : null;
  const error = (payload || {}) as ApiError;
  const message = error.message || (response.status === 403
    ? "You do not have permission to perform this action."
    : `Request failed with status ${response.status}`);
  const requestId = response.headers.get("x-request-id") || undefined;
  const traceId = response.headers.get("x-trace-id") || undefined;
  const diagnosticSuffix = traceId || requestId
    ? ` (support reference: ${traceId || requestId})`
    : "";
  return new HelloTestApiError(`${message}${diagnosticSuffix}`, response.status, error, { requestId, traceId });
}

export async function request<T>(path: string, init?: RequestInit, timeoutMs = getRequestTimeout(path, init?.method)): Promise<T> {
  init?.signal?.throwIfAborted();
  const method = String(init?.method || "GET").toUpperCase();
  const scopedPath = appendCurrentProjectScope(path);
  const headers = new Headers(init?.headers);
  const requestSession = readRequestSession();
  const { token } = requestSession;
  if (!headers.has("Content-Type") && init?.body) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const serviceBase = resolveServiceBase(scopedPath, API_BASE_URL);
  const isMutation = !["GET", "HEAD", "OPTIONS"].includes(method);
  if (isMutation) invalidateClientGetResponses();
  const cacheRevision = requestCache.revision;
  const canReuseRequest = method === "GET" && (!init?.cache || init.cache === "default");
  // A component's cancellation must not abort another component's request.
  // React Query already coalesces observers sharing the same query and signal.
  const canSharePendingRequest = canReuseRequest && !init?.signal;
  const requestKey = canReuseRequest
    ? stableStringify({
      method, path: scopedPath, serviceBase, session: requestSession.revision,
      headers: Array.from(headers.entries()), timeoutMs,
      credentials: init?.credentials, mode: init?.mode, redirect: init?.redirect,
      integrity: init?.integrity, referrer: init?.referrer, referrerPolicy: init?.referrerPolicy
    })
    : "";

  if (canReuseRequest) {
    const cached = requestCache.read(requestKey);

    if (cached !== undefined) {
      return cached as T;
    }

    const pending = canSharePendingRequest ? requestCache.getPending(requestKey) : undefined;

    if (pending) {
      return (await pending) as T;
    }
  }

  const executeRequest = () => consumeApiResponse<T>(
    `${serviceBase}${scopedPath}`,
    { ...init, method, headers },
    { timeoutMs, timeoutMessage: "Request timeout: the API took too long to respond." },
    async (response) => {
      if (!response.ok) {
        const apiError = await parseApiError(response);
        if (response.status === 401 && token && isSessionAuthFailure(scopedPath, apiError.message) && readRequestSession().revision === requestSession.revision) {
          sessionStorage.clear();
          if (!scopedPath.startsWith("/auth/")) window.location.assign("/auth");
        }
        throw apiError;
      }

      if (response.status === 204) return undefined as T;
      const isJson = response.headers.get("content-type")?.includes("application/json");
      return (isJson ? await response.json() : await response.text()) as T;
    }
  );

  const pendingRequest = executeRequest();

  if (canSharePendingRequest) {
    requestCache.setPending(requestKey, pendingRequest);
  }

  try {
    const response = await pendingRequest;

    if (canReuseRequest && readRequestSession().revision === requestSession.revision) {
      requestCache.remember(requestKey, response, cacheRevision);
    }

    return response;
  } catch (err) {
    throw err instanceof Error ? err : new Error("HelloTest request failed");
  } finally {
    if (isMutation) invalidateClientGetResponses();
    if (canSharePendingRequest) requestCache.release(requestKey, pendingRequest);
  }
}

export async function requestBlob(path: string, init?: RequestInit): Promise<Blob> {
  const scopedPath = appendCurrentProjectScope(path);
  const serviceBase = resolveServiceBase(scopedPath, API_BASE_URL);
  const headers = new Headers(init?.headers);
  const token = getStoredToken();
  if (!headers.has("Content-Type") && init?.body && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const isMutation = !["GET", "HEAD", "OPTIONS"].includes(String(init?.method || "GET").toUpperCase());
  init?.signal?.throwIfAborted();
  if (isMutation) invalidateClientGetResponses();
  try {
    return await consumeApiResponse(
      `${serviceBase}${scopedPath}`, { ...init, headers },
      { timeoutMs: 120_000, timeoutMessage: "Download timeout: the API took too long to respond." },
      async (response) => {
        if (!response.ok) throw await parseApiError(response);
        return response.blob();
      }
    );
  } finally {
    if (isMutation) invalidateClientGetResponses();
  }
}

export async function requestForm<T>(path: string, formData: FormData, options?: { idempotencyKey?: string; signal?: AbortSignal }): Promise<T> {
  const scopedPath = appendCurrentProjectScope(path);
  const serviceBase = resolveServiceBase(scopedPath, API_BASE_URL);
  const headers = new Headers();
  const token = getStoredToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (options?.idempotencyKey) headers.set("Idempotency-Key", options.idempotencyKey);
  options?.signal?.throwIfAborted();
  invalidateClientGetResponses();
  try {
    return await consumeApiResponse<T>(
      `${serviceBase}${scopedPath}`, { method: "POST", headers, body: formData, signal: options?.signal },
      { timeoutMs: 120_000, timeoutMessage: "Attachment upload timed out. Try a smaller file or check object storage connectivity." },
      async (response) => {
        if (!response.ok) throw await parseApiError(response);
        return await response.json() as T;
      }
    );
  } finally {
    invalidateClientGetResponses();
  }
}

export type BatchQueueResponse = {
  scheduled_at?: string | null;
  id: string;
  transaction_id: string;
  job_id?: string;
  transaction_ids?: string[];
  job_ids?: string[];
  split_count?: number;
  queued: boolean;
  status: string;
  count?: number;
  skipped?: Array<{ id?: string; code?: string; message?: string }>;
  records?: Array<TestCase & { steps?: TestStep[] }>;
  requirement_records?: Requirement[];
};

export type DashboardStyledReportPayload = {
  rendered_snapshot_data_url?: string;
  rendered_snapshot_pages_data_urls?: string[];
  rendered_snapshot_name?: string;
  rendered_snapshot_captured_at?: string;
};

export function toQueryString(query?: Record<string, string | number | boolean | undefined>) {
  if (!query) {
    return "";
  }

  const params = new URLSearchParams();

  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== "") {
      params.set(key, String(value));
    }
  });

  const serialized = params.toString();
  return serialized ? `?${serialized}` : "";
}
