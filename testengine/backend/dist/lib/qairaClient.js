const QAIRA_API_BASE_URL = String(process.env.QAIRA_API_BASE_URL || "").trim().replace(/\/+$/, "");
const QAIRA_API_PATH_PREFIX = String(process.env.QAIRA_API_PATH_PREFIX || process.env.QAIRA_API_PREFIX || "")
    .trim()
    .replace(/^\/+|\/+$/g, "");
const QAIRA_TESTENGINE_SECRET = String(process.env.QAIRA_TESTENGINE_SECRET
    || process.env.TESTENGINE_SHARED_SECRET
    || "qaira-testengine-dev-secret").trim();
const ENGINE_PUBLIC_URL = String(process.env.ENGINE_PUBLIC_URL || process.env.ENGINE_HOST_URL || "")
    .trim()
    .replace(/\/+$/, "");
function ensureConfigured() {
    if (!QAIRA_API_BASE_URL) {
        throw new Error("QAIRA_API_BASE_URL is required for queue-pull mode");
    }
    if (!QAIRA_TESTENGINE_SECRET) {
        throw new Error("QAIRA_TESTENGINE_SECRET is required for queue-pull mode");
    }
}
const appendPath = (base, path) => `${base.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
const getApiBaseCandidates = () => {
    const candidates = [QAIRA_API_BASE_URL];
    if (QAIRA_API_PATH_PREFIX) {
        candidates.unshift(appendPath(QAIRA_API_BASE_URL, QAIRA_API_PATH_PREFIX));
    }
    else {
        try {
            const parsedBaseUrl = new URL(QAIRA_API_BASE_URL);
            const normalizedPath = parsedBaseUrl.pathname.replace(/\/+$/, "");
            if (!normalizedPath.endsWith("/api")) {
                parsedBaseUrl.pathname = `${normalizedPath || ""}/api`;
                parsedBaseUrl.search = "";
                parsedBaseUrl.hash = "";
                candidates.push(parsedBaseUrl.toString().replace(/\/+$/, ""));
            }
        }
        catch {
            candidates.push(appendPath(QAIRA_API_BASE_URL, "api"));
        }
    }
    return Array.from(new Set(candidates.map((candidate) => candidate.replace(/\/+$/, ""))));
};
async function requestOnce(baseUrl, path, init) {
    const headers = new Headers(init?.headers);
    headers.set("authorization", `Bearer ${QAIRA_TESTENGINE_SECRET}`);
    if (init?.body && !headers.has("content-type")) {
        headers.set("content-type", "application/json");
    }
    const response = await fetch(appendPath(baseUrl, path), {
        ...init,
        headers
    });
    const contentType = response.headers.get("content-type") || "";
    const rawBody = await response.text();
    const payload = contentType.includes("application/json") && rawBody
        ? JSON.parse(rawBody)
        : null;
    if (!response.ok) {
        const message = payload && typeof payload === "object" && "message" in payload
            ? String(payload.message || "")
            : "";
        throw new Error(message || `QAira internal API returned ${response.status}`);
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
            lastError = error instanceof Error ? error : new Error(String(error || "QAira internal API request failed"));
            if (index === candidates.length - 1 || !/QAira internal API returned (404|405)\b/.test(lastError.message)) {
                throw lastError;
            }
        }
    }
    throw lastError || new Error("QAira internal API request failed");
}
export function isQairaQueueConfigured() {
    return Boolean(QAIRA_API_BASE_URL && QAIRA_TESTENGINE_SECRET);
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
