const DEFAULT_TIMEOUT_MS = Math.max(5_000, Number.parseInt(process.env.LLM_REQUEST_TIMEOUT_MS || "45000", 10) || 45_000);
const DEFAULT_MAX_ATTEMPTS = Math.max(1, Math.min(4, Number.parseInt(process.env.LLM_MAX_ATTEMPTS || "3", 10) || 3));
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const retryDelayMs = (response, attempt) => {
  const retryAfter = response?.headers?.get?.("retry-after");
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(10_000, seconds * 1000);
  return Math.min(4_000, 300 * (2 ** Math.max(0, attempt - 1)) + Math.floor(Math.random() * 180));
};

const composeSignal = (externalSignal, timeoutSignal) => {
  if (!externalSignal) return timeoutSignal;
  if (typeof AbortSignal.any === "function") return AbortSignal.any([externalSignal, timeoutSignal]);
  return timeoutSignal;
};

exports.fetchLlmWithRetry = async (url, init = {}, options = {}) => {
  const timeoutMs = Math.max(1_000, Number(options.timeoutMs || DEFAULT_TIMEOUT_MS));
  const maxAttempts = Math.max(1, Math.min(4, Number(options.maxAttempts || DEFAULT_MAX_ATTEMPTS)));
  const operation = String(options.operation || "llm.request");
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...init,
        signal: composeSignal(init.signal, controller.signal)
      });

      if (!RETRYABLE_STATUSES.has(response.status) || attempt === maxAttempts) return response;

      await response.body?.cancel().catch(() => null);
      console.warn(JSON.stringify({ event: "llm_request_retry", operation, attempt, status: response.status }));
      await wait(retryDelayMs(response, attempt));
    } catch (error) {
      const timedOut = error?.name === "AbortError" || error?.name === "TimeoutError";
      lastError = new Error(timedOut ? `LLM request timed out after ${timeoutMs}ms` : `LLM provider request failed: ${error instanceof Error ? error.message : String(error)}`);

      if (attempt === maxAttempts || init.signal?.aborted) throw lastError;

      console.warn(JSON.stringify({ event: "llm_request_retry", operation, attempt, error: timedOut ? "timeout" : "network" }));
      await wait(retryDelayMs(null, attempt));
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError || new Error("LLM provider request failed");
};
