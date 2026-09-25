const execution = require("@hellotest/knowledge/backend/services/knowledgeExecution.service");
const { modelFailureCode } = require("./knowledgeAssistantErrors");

const TRANSIENT_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const TRANSIENT_CODES = new Set([
  "MODEL_TIMEOUT", "MODEL_RATE_LIMITED", "MODEL_UNAVAILABLE", "DEADLINE_EXCEEDED",
  "DEPENDENCY_NETWORK_ERROR", "DEPENDENCY_TIMEOUT", "DEPENDENCY_UNAVAILABLE",
  "DEPENDENCY_OVERLOADED", "DEPENDENCY_CIRCUIT_OPEN", "ECONNRESET", "ECONNREFUSED",
  "EPIPE", "ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_SOCKET"
]);
const isTransientModelFailure = (error) => {
  if (["MODEL_AUTHENTICATION_FAILED", "MODEL_QUOTA_EXCEEDED", "MODEL_NOT_FOUND", "MODEL_CONFIGURATION_ERROR"].includes(error?.code)
    || error?.name === "AbortError" || error?.retryable === false) return false;
  const status = Number(error?.upstreamStatus || error?.upstreamStatusCode);
  if (status) return TRANSIENT_STATUSES.has(status) || (status >= 500 && status <= 599);
  return TRANSIENT_CODES.has(error?.code) || error?.name === "TimeoutError";
};

const validateModelEndpoint = (endpoint) => {
  try {
    const url = new URL(endpoint);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error();
  } catch { throw Object.assign(new Error("The model provider URL is not configured correctly."), { code: "MODEL_CONFIGURATION_ERROR" }); }
};

// Do not clamp a provider's Retry-After down: if it cannot fit, return the
// current failure instead of sending another request earlier than requested.
const readRetryAfterMs = (response, now = Date.now()) => {
  const raw = response?.headers?.get?.("retry-after");
  if (raw == null || !String(raw).trim()) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return seconds >= 0 ? Math.ceil(seconds * 1000) : null;
  const date = Date.parse(raw);
  return Number.isFinite(date) ? Math.max(0, date - now) : null;
};

const waitForRetry = (milliseconds, signal) => new Promise((resolve, reject) => {
  if (signal.aborted) { reject(execution.abortError()); return; }
  const cleanup = () => signal.removeEventListener("abort", cancel);
  const timer = setTimeout(() => { cleanup(); resolve(); }, milliseconds);
  const cancel = () => { clearTimeout(timer); cleanup(); reject(execution.abortError()); };
  signal.addEventListener("abort", cancel, { once: true });
});

// Only buffered, read-only Knowledge model operations use this policy. The
// enclosing deadline covers attempts AND backoff; nested transports receive
// its cancellation signal. Other LLM POST callers retain their own policy.
const retryKnowledgeModel = (task, { timeoutMs = 45_000, attemptTimeoutMs = 30_000, maxAttempts = 3, baseDelayMs = 200, signal, stage = "GENERATION", canRetry = () => true } = {}) => {
  const totalMs = Number.isFinite(Number(timeoutMs)) ? Number(timeoutMs) : 45_000;
  const attempts = Math.max(1, Math.min(3, Number.parseInt(maxAttempts, 10) || 3));
  const attemptLimit = Math.max(1, Number(attemptTimeoutMs) || 30_000);
  const signals = [...new Set([signal, execution.current()?.signal].filter(Boolean))];
  return execution.bounded(async (activeSignal) => {
    const deadlineAt = Date.now() + totalMs;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      execution.assertActive();
      try {
        const attemptBudgetMs = Math.min(attemptLimit, Math.max(0, deadlineAt - Date.now()));
        return await execution.bounded((attemptSignal) => task({ signal: attemptSignal, timeoutMs: attemptBudgetMs, attempt }), { timeoutMs: attemptBudgetMs, signal: activeSignal });
      } catch (error) {
        execution.assertActive();
        error.modelAttempts = attempt;
        if (attempt === attempts || !isTransientModelFailure(error) || !canRetry()) throw error;
        const retryAfterMs = error.retryAfterMs ?? (["DEPENDENCY_CIRCUIT_OPEN", "DEPENDENCY_OVERLOADED"].includes(error.code) && error.retryAfterSeconds != null ? error.retryAfterSeconds * 1000 : null);
        const backoffMs = Math.min(2000, Math.max(0, baseDelayMs) * 2 ** (attempt - 1));
        const delayMs = retryAfterMs == null ? backoffMs + Math.floor(Math.random() * backoffMs) : Math.max(0, retryAfterMs);
        if (delayMs + 25 >= deadlineAt - Date.now()) throw error;
        execution.emit(stage, "started", { error_code: modelFailureCode(error), model_attempt: attempt + 1, model_max_attempts: attempts, retry_delay_ms: delayMs });
        await waitForRetry(delayMs, activeSignal);
      }
    }
  }, { timeoutMs: totalMs, signal: signals.length > 1 ? AbortSignal.any(signals) : signals[0] });
};

module.exports = { retryKnowledgeModel, isTransientModelFailure, readRetryAfterMs, validateModelEndpoint };
