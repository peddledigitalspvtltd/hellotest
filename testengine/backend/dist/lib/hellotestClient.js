import { resolveTestEngineSharedSecret } from "./testEngineSecurity.js";
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
const appendPath = (base, path) => `${base.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
const getApiBaseCandidates = () => {
    const candidates = [HELLOTEST_API_BASE_URL];
    if (HELLOTEST_API_PATH_PREFIX) {
        candidates.unshift(appendPath(HELLOTEST_API_BASE_URL, HELLOTEST_API_PATH_PREFIX));
    }
    else {
        try {
            const parsedBaseUrl = new URL(HELLOTEST_API_BASE_URL);
            const normalizedPath = parsedBaseUrl.pathname.replace(/\/+$/, "");
            if (!normalizedPath.endsWith("/api")) {
                parsedBaseUrl.pathname = `${normalizedPath || ""}/api`;
                parsedBaseUrl.search = "";
                parsedBaseUrl.hash = "";
                candidates.push(parsedBaseUrl.toString().replace(/\/+$/, ""));
            }
        }
        catch {
            candidates.push(appendPath(HELLOTEST_API_BASE_URL, "api"));
        }
    }
    return Array.from(new Set(candidates.map((candidate) => candidate.replace(/\/+$/, ""))));
};
async function requestOnce(baseUrl, path, init) {
    const headers = new Headers(init?.headers);
    headers.set("authorization", `Bearer ${HELLOTEST_TESTENGINE_SECRET}`);
    if (init?.body && !headers.has("content-type")) {
        headers.set("content-type", "application/json");
    }
    const timeoutController = new AbortController();
    const timeoutHandle = setTimeout(() => timeoutController.abort(), HELLOTEST_REQUEST_TIMEOUT_MS);
    timeoutHandle.unref?.();
    const signal = init?.signal
        ? AbortSignal.any([init.signal, timeoutController.signal])
        : timeoutController.signal;
    let response;
    try {
        response = await fetch(appendPath(baseUrl, path), {
            ...init,
            headers,
            signal
        });
    }
    finally {
        clearTimeout(timeoutHandle);
    }
    const contentType = response.headers.get("content-type") || "";
    const rawBody = await response.text();
    const payload = contentType.includes("application/json") && rawBody
        ? JSON.parse(rawBody)
        : null;
    if (!response.ok) {
        const message = payload && typeof payload === "object" && "message" in payload
            ? String(payload.message || "")
            : "";
        throw new Error(message || `HelloTest internal API returned ${response.status}`);
    }
    return payload;
}
async function request(path, init) {
    ensureConfigured();
    const candidates = getApiBaseCandidates();
    let lastError = null;
    for (const [index, baseUrl] of candidates.entries()) {
        try {
            return await requestOnce(baseUrl, path, init);
        }
        catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error || "HelloTest internal API request failed"));
            if (index === candidates.length - 1 || !/HelloTest internal API returned (404|405)\b/.test(lastError.message)) {
                throw lastError;
            }
        }
    }
    throw lastError || new Error("HelloTest internal API request failed");
}
export function isHelloTestQueueConfigured() {
    return Boolean(HELLOTEST_API_BASE_URL && HELLOTEST_TESTENGINE_SECRET);
}
export async function leaseNextQueuedJob(workerId, engineClass) {
    const response = await request("/testengine/internal/jobs/lease", {
        method: "POST",
        body: JSON.stringify({
            worker_id: workerId,
            engine_class: engineClass || undefined,
            engine_host: ENGINE_PUBLIC_URL || undefined
        })
    });
    return response.job;
}
export async function startQueuedJob(jobId, workerId) {
    return request(`/testengine/internal/jobs/${jobId}/start`, {
        method: "POST",
        body: JSON.stringify({
            worker_id: workerId
        })
    });
}
export async function executeQueuedApiStep(jobId, stepId) {
    return request(`/testengine/internal/jobs/${jobId}/steps/${stepId}/execute`, {
        method: "POST",
        body: JSON.stringify({})
    });
}
export async function reportQueuedStep(jobId, stepId, payload) {
    return request(`/testengine/internal/jobs/${jobId}/steps/${stepId}/report`, {
        method: "POST",
        body: JSON.stringify(payload)
    });
}
export async function completeQueuedJob(jobId, status, error) {
    return request(`/testengine/internal/jobs/${jobId}/complete`, {
        method: "POST",
        body: JSON.stringify({
            status,
            error
        })
    });
}
export async function completeQueuedJobWithMetadata(jobId, payload) {
    return request(`/testengine/internal/jobs/${jobId}/complete`, {
        method: "POST",
        body: JSON.stringify(payload)
    });
}
export async function failQueuedJob(jobId, message) {
    return request(`/testengine/internal/jobs/${jobId}/fail`, {
        method: "POST",
        body: JSON.stringify({
            message
        })
    });
}
