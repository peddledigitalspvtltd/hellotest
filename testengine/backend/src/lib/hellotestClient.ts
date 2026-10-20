import type { EngineQueuedJob } from "../contracts/hellotest.js";
import { resolveTestEngineSharedSecret } from "./testEngineSecurity.js";
import { EngineHttpError, requestEngineService } from "./engineHttpClient.js";

const HELLOTEST_API_BASE_URL = String(process.env.HELLOTEST_API_BASE_URL || "").trim().replace(/\/+$/, "");
const HELLOTEST_API_PATH_PREFIX = String(process.env.HELLOTEST_API_PATH_PREFIX || process.env.HELLOTEST_API_PREFIX || "")
  .trim()
  .replace(/^\/+|\/+$/g, "");
const TESTENGINE_SHARED_SECRET_CONFIG = resolveTestEngineSharedSecret();
const HELLOTEST_TESTENGINE_SECRET = TESTENGINE_SHARED_SECRET_CONFIG.secret || "";
const ENGINE_PUBLIC_URL = String(process.env.ENGINE_PUBLIC_URL || process.env.ENGINE_HOST_URL || "")
  .trim()
  .replace(/\/+$/, "");
const configuredRequestTimeoutMs = Number.parseInt(process.env.TESTENGINE_HELLOTEST_REQUEST_TIMEOUT_MS || "15000", 10);
const HELLOTEST_REQUEST_TIMEOUT_MS = Number.isFinite(configuredRequestTimeoutMs)
  ? Math.max(1_000, Math.min(60_000, configuredRequestTimeoutMs))
  : 15_000;

function ensureConfigured() {
  if (!HELLOTEST_API_BASE_URL) {
    throw new Error("HELLOTEST_API_BASE_URL is required for queue-pull mode");
  }

  if (!HELLOTEST_TESTENGINE_SECRET) {
    throw new Error(TESTENGINE_SHARED_SECRET_CONFIG.reason || "HELLOTEST_TESTENGINE_SECRET is required for queue-pull mode");
  }
}

const appendPath = (base: string, path: string) => `${base.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`;

const getApiBaseCandidates = () => {
  const candidates = [HELLOTEST_API_BASE_URL];

  if (HELLOTEST_API_PATH_PREFIX) {
    candidates.unshift(appendPath(HELLOTEST_API_BASE_URL, HELLOTEST_API_PATH_PREFIX));
  } else {
    try {
      const parsedBaseUrl = new URL(HELLOTEST_API_BASE_URL);
      const normalizedPath = parsedBaseUrl.pathname.replace(/\/+$/, "");

      if (!normalizedPath.endsWith("/api")) {
        parsedBaseUrl.pathname = `${normalizedPath || ""}/api`;
        parsedBaseUrl.search = "";
        parsedBaseUrl.hash = "";
        candidates.push(parsedBaseUrl.toString().replace(/\/+$/, ""));
      }
    } catch {
      candidates.push(appendPath(HELLOTEST_API_BASE_URL, "api"));
    }
  }

  return Array.from(new Set(candidates.map((candidate) => candidate.replace(/\/+$/, ""))));
};

async function requestOnce<T>(baseUrl: string, path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("authorization", `Bearer ${HELLOTEST_TESTENGINE_SECRET}`);

  if (init?.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  return requestEngineService<T>({
    url: appendPath(baseUrl, path),
    service: "HelloTest internal API",
    timeoutMs: HELLOTEST_REQUEST_TIMEOUT_MS,
    init: { ...init, headers }
  });
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  ensureConfigured();

  const candidates = getApiBaseCandidates();
  let lastError: Error | null = null;

  for (const [index, baseUrl] of candidates.entries()) {
    try {
      return await requestOnce<T>(baseUrl, path, init);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error || "HelloTest internal API request failed"));

      if (index === candidates.length - 1 || !(error instanceof EngineHttpError && error.code === "HTTP_ERROR" && [404, 405].includes(error.status || 0))) {
        throw lastError;
      }
    }
  }

  throw lastError || new Error("HelloTest internal API request failed");
}

export function isHelloTestQueueConfigured() {
  return Boolean(HELLOTEST_API_BASE_URL && HELLOTEST_TESTENGINE_SECRET);
}

export async function leaseNextQueuedJob(workerId: string, engineClass?: string | null) {
  const response = await request<{ job: EngineQueuedJob | null }>("/testengine/internal/jobs/lease", {
    method: "POST",
    body: JSON.stringify({
      worker_id: workerId,
      engine_class: engineClass || undefined,
      engine_host: ENGINE_PUBLIC_URL || undefined
    })
  });

  return response.job;
}

export async function startQueuedJob(jobId: string, workerId: string) {
  const acknowledgement = await request<{ job_id: string; status: string; execution_result_id?: string | null }>(`/testengine/internal/jobs/${jobId}/start`, {
    method: "POST",
    body: JSON.stringify({
      worker_id: workerId
    })
  });
  if (acknowledgement.status !== "running") {
    throw new Error("The queued execution start was not authorized. No sections or hooks will execute.");
  }
  return acknowledgement;
}

export async function executeQueuedApiStep(jobId: string, stepId: string) {
  return request<{
    job_id: string;
    step_id: string;
    status: "passed" | "failed";
    note: string;
    captures: Record<string, string>;
  }>(`/testengine/internal/jobs/${jobId}/steps/${stepId}/execute`, {
    method: "POST",
    body: JSON.stringify({})
  });
}

export async function reportQueuedStep(
  jobId: string,
  stepId: string,
  payload: {
    status: "passed" | "failed" | "blocked" | "skipped";
    note?: string;
    evidence?: {
      dataUrl: string;
      fileName?: string;
      mimeType?: string;
    } | null;
    api_detail?: Record<string, unknown> | null;
    web_detail?: unknown;
    automation_detail?: Record<string, unknown> | null;
    captures?: Record<string, string>;
    recovery_attempted?: boolean;
    recovery_succeeded?: boolean;
  }
) {
  return request<{
    job_id: string;
    step_id: string;
    status: "passed" | "failed" | "blocked" | "skipped";
    case_status: "running" | "passed" | "failed" | "blocked";
    execution_result_id?: string | null;
    captures?: Record<string, string>;
  }>(`/testengine/internal/jobs/${jobId}/steps/${stepId}/report`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function completeQueuedJob(jobId: string, status?: "passed" | "failed" | "blocked", error?: string) {
  return request<{ job_id: string; status: string }>(`/testengine/internal/jobs/${jobId}/complete`, {
    method: "POST",
    body: JSON.stringify({
      status,
      error
    })
  });
}

export async function completeQueuedJobWithMetadata(
  jobId: string,
  payload: {
    status?: "passed" | "failed" | "blocked";
    error?: string;
    summary?: string;
    deterministic_attempted?: boolean;
    healing_attempted?: boolean;
    healing_succeeded?: boolean;
    artifact_bundle?: Record<string, unknown> | null;
    patch_proposals?: Array<Record<string, unknown>>;
  }
) {
  return request<{ job_id: string; status: string }>(`/testengine/internal/jobs/${jobId}/complete`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function failQueuedJob(jobId: string, message: string) {
  return request<{ job_id: string; status: string }>(`/testengine/internal/jobs/${jobId}/fail`, {
    method: "POST",
    body: JSON.stringify({
      message
    })
  });
}
