import { getRequestTimeout } from "../platform/lib/requestTimeout";
import type { ApiError, JiraAttachment, JiraComment, Requirement, SessionPayload, TestCase, TestStep } from "../types";
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

const CLIENT_GET_CACHE_TTL_MS = 1_500;

const CLIENT_GET_CACHE_MAX_ENTRIES = 120;

const inFlightClientRequests = new Map<string, Promise<unknown>>();

export const clientGetResponseCache = new Map<string, { expiresAt: number; value: unknown }>();

const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }

  return JSON.stringify(value);
};

const rememberClientGetResponse = (key: string, value: unknown) => {
  clientGetResponseCache.set(key, {
    expiresAt: Date.now() + CLIENT_GET_CACHE_TTL_MS,
    value
  });

  while (clientGetResponseCache.size > CLIENT_GET_CACHE_MAX_ENTRIES) {
    const oldestKey = clientGetResponseCache.keys().next().value;
    if (!oldestKey) break;
    clientGetResponseCache.delete(oldestKey);
  }
};

const readClientGetResponse = (key: string) => {
  const cached = clientGetResponseCache.get(key);

  if (!cached) {
    return undefined;
  }

  if (cached.expiresAt <= Date.now()) {
    clientGetResponseCache.delete(key);
    return undefined;
  }

  return cached.value;
};

async function ensureJiraResponse(response: Response, action: string) {
  if (response.ok) {
    return response;
  }

  let detail = "";
  try {
    const raw = await response.text();
    try {
      const payload = JSON.parse(raw) as { errorMessages?: string[]; errors?: Record<string, string>; message?: string };
      detail = payload.message
        || payload.errorMessages?.filter(Boolean).join(" ")
        || Object.values(payload.errors || {}).filter(Boolean).join(" ");
    } catch {
      detail = raw;
    }
  } catch {
    detail = "";
  }

  throw new Error(detail || `${action} failed with HelloTest status ${response.status}.`);
}

function normalizeJiraAttachment(value: unknown): JiraAttachment {
  const attachment = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const authorValue = attachment.author && typeof attachment.author === "object"
    ? attachment.author as Record<string, unknown>
    : null;

  return {
    id: String(attachment.id || ""),
    filename: String(attachment.filename || "attachment"),
    size: Number(attachment.size || 0),
    storedSize: Number(attachment.storedSize || attachment.stored_size || attachment.size || 0),
    compression: typeof attachment.compression === "string" ? attachment.compression : "none",
    savedBytes: Number(attachment.savedBytes || attachment.saved_bytes || 0),
    mimeType: String(attachment.mimeType || attachment.mime_type || "application/octet-stream"),
    created: typeof attachment.created === "string" ? attachment.created : null,
    content: typeof attachment.content === "string" ? attachment.content : null,
    thumbnail: typeof attachment.thumbnail === "string" ? attachment.thumbnail : null,
    author: authorValue ? {
      accountId: typeof authorValue.accountId === "string" ? authorValue.accountId : undefined,
      displayName: typeof authorValue.displayName === "string" ? authorValue.displayName : undefined,
      avatarUrls: authorValue.avatarUrls && typeof authorValue.avatarUrls === "object"
        ? authorValue.avatarUrls as Record<string, string>
        : undefined
    } : null
  };
}

function jiraAdfToPlainText(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(jiraAdfToPlainText).filter(Boolean).join("");
  if (typeof value !== "object") return "";
  const node = value as { type?: string; text?: string; content?: unknown[] };
  if (typeof node.text === "string") return node.text;
  const content = (node.content || []).map(jiraAdfToPlainText).join("");
  return ["paragraph", "heading", "listItem", "blockquote", "codeBlock"].includes(node.type || "") ? `${content}\n` : content;
}

function normalizeJiraComment(value: unknown): JiraComment {
  const comment = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const authorValue = comment.author && typeof comment.author === "object"
    ? comment.author as Record<string, unknown>
    : null;
  return {
    id: String(comment.id || ""),
    body: jiraAdfToPlainText(comment.body).trim(),
    created: typeof comment.created === "string" ? comment.created : null,
    updated: typeof comment.updated === "string" ? comment.updated : null,
    author: authorValue ? {
      accountId: typeof authorValue.accountId === "string" ? authorValue.accountId : undefined,
      displayName: typeof authorValue.displayName === "string" ? authorValue.displayName : undefined,
      avatarUrls: authorValue.avatarUrls && typeof authorValue.avatarUrls === "object"
        ? authorValue.avatarUrls as Record<string, string>
        : undefined
    } : null
  };
}

type ForgeBlobPayload = {
  __hellotest_blob__: true;
  base64: string;
  mimeType?: string;
  fileName?: string;
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
    clientGetResponseCache.clear();
    inFlightClientRequests.clear();
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
  const canReuseRequest = method === "GET" && init?.cache !== "no-store";
  // A component's cancellation must not abort another component's request.
  // React Query already coalesces observers sharing the same query and signal.
  const canSharePendingRequest = canReuseRequest && !init?.signal;
  const requestKey = canReuseRequest
    ? stableStringify({ method, path: scopedPath, session: requestSession.revision })
    : "";

  if (canReuseRequest) {
    const cached = readClientGetResponse(requestKey);

    if (cached !== undefined) {
      return cached as T;
    }

    const pending = canSharePendingRequest ? inFlightClientRequests.get(requestKey) : undefined;

    if (pending) {
      return (await pending) as T;
    }
  }

  const executeRequest = async (): Promise<T> => {
    const serviceBase = resolveServiceBase(scopedPath, API_BASE_URL);
    let response: Response;
    try {
      const timeoutSignal = AbortSignal.timeout(timeoutMs);
      const signal = init?.signal
        ? AbortSignal.any([init.signal, timeoutSignal])
        : timeoutSignal;
      response = await fetch(`${serviceBase}${scopedPath}`, {
        ...init,
        method,
        headers,
        signal
      });
    } catch (err) {
      if (init?.signal?.aborted) throw err;
      if (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")) {
        throw new Error(`Request timeout: ${scopedPath} took too long to respond`);
      }
      throw new Error(`Unable to reach API at ${serviceBase}. Check your connection and try again.`);
    }

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
  };

  const pendingRequest = executeRequest();

  if (canSharePendingRequest) {
    inFlightClientRequests.set(requestKey, pendingRequest);
  }

  try {
    const response = await pendingRequest;

    if (canReuseRequest && readRequestSession().revision === requestSession.revision) {
      rememberClientGetResponse(requestKey, response);
    } else if (method !== "GET") {
      clientGetResponseCache.clear();
    }

    return response;
  } catch (err) {
    throw err instanceof Error ? err : new Error("HelloTest request failed");
  } finally {
    if (canSharePendingRequest && inFlightClientRequests.get(requestKey) === pendingRequest) {
      inFlightClientRequests.delete(requestKey);
    }
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
  let response: Response;
  try {
    response = await fetch(`${serviceBase}${scopedPath}`, {
      ...init,
      headers,
      signal: AbortSignal.timeout(120_000)
    });
  } catch (err) {
    if (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")) {
      throw new Error(`Download timeout: ${scopedPath} took too long to respond`);
    }
    throw new Error(`Unable to reach API at ${serviceBase}. Check your connection and try again.`);
  }
  if (!response.ok) throw await parseApiError(response);
  return response.blob();
}

export async function requestForm<T>(path: string, formData: FormData, options?: { idempotencyKey?: string; signal?: AbortSignal }): Promise<T> {
  const scopedPath = appendCurrentProjectScope(path);
  const serviceBase = resolveServiceBase(scopedPath, API_BASE_URL);
  const headers = new Headers();
  const token = getStoredToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (options?.idempotencyKey) headers.set("Idempotency-Key", options.idempotencyKey);
  let response: Response;
  try {
    const timeoutSignal = AbortSignal.timeout(120_000);
    const signal = options?.signal
      ? AbortSignal.any([options.signal, timeoutSignal])
      : timeoutSignal;
    response = await fetch(`${serviceBase}${scopedPath}`, {
      method: "POST",
      headers,
      body: formData,
      signal
    });
  } catch (err) {
    if (options?.signal?.aborted) throw err;
    if (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")) {
      throw new Error("Attachment upload timed out. Try a smaller file or check object storage connectivity.");
    }
    throw new Error(`Unable to reach API at ${serviceBase}. Check your connection and try again.`);
  }
  if (!response.ok) throw await parseApiError(response);
  return await response.json() as T;
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
