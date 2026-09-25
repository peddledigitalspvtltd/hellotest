const {
  SERVICE_ERROR_CODES,
  ServiceBoundaryError,
  classifyServiceFailure,
  normalizeDependency,
  serviceError
} = require("./serviceErrors");
const { cloneWithBoundedBody } = require("./boundedResponse");

const IDEMPOTENT_METHODS = new Set(["GET", "HEAD", "OPTIONS", "PUT", "DELETE"]);
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_CONCURRENT = 20;
const DEFAULT_FAILURE_THRESHOLD = 5;
const DEFAULT_RESET_TIMEOUT_MS = 30_000;
const MAX_RETRY_DELAY_MS = 30_000;

const registry = new Map();

const clampInteger = (value, fallback, min, max) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.trunc(parsed))) : fallback;
};

const wait = (milliseconds, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) {
    reject(signal.reason || new DOMException("The operation was aborted", "AbortError"));
    return;
  }

  const cleanup = () => signal?.removeEventListener("abort", abort);
  const timer = setTimeout(() => {
    cleanup();
    resolve();
  }, milliseconds);
  timer.unref?.();
  const abort = () => {
    clearTimeout(timer);
    cleanup();
    reject(signal.reason || new DOMException("The operation was aborted", "AbortError"));
  };
  signal?.addEventListener("abort", abort, { once: true });
});

const endpointOrigin = (url) => {
  try {
    const parsed = new URL(url);
    return parsed.origin;
  } catch {
    return "invalid-endpoint";
  }
};

const boundaryKey = (dependency, url) => `${normalizeDependency(dependency)}|${endpointOrigin(url)}`;

const createState = ({ dependency, url, maxConcurrent, failureThreshold, resetTimeoutMs }) => ({
  key: boundaryKey(dependency, url),
  dependency: normalizeDependency(dependency),
  endpoint: endpointOrigin(url),
  circuit: "closed",
  consecutiveFailures: 0,
  openedAt: null,
  nextProbeAt: null,
  probeInFlight: false,
  inflight: 0,
  maxConcurrent,
  failureThreshold,
  resetTimeoutMs,
  counters: {
    requests: 0,
    attempts: 0,
    successes: 0,
    failures: 0,
    retries: 0,
    rejected: 0,
    shortCircuited: 0
  },
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastFailureAt: null,
  lastFailureCode: null,
  lastUpstreamStatus: null
});

const getState = (policy) => {
  const key = boundaryKey(policy.dependency, policy.url);
  let state = registry.get(key);
  if (!state) {
    state = createState(policy);
    registry.set(key, state);
  }
  state.maxConcurrent = policy.maxConcurrent;
  state.failureThreshold = policy.failureThreshold;
  state.resetTimeoutMs = policy.resetTimeoutMs;
  return state;
};

const parseRetryAfterMs = (response, now = Date.now()) => {
  const value = response?.headers?.get?.("retry-after");
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(MAX_RETRY_DELAY_MS, Math.ceil(seconds * 1_000));
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return null;
  return Math.max(0, Math.min(MAX_RETRY_DELAY_MS, date - now));
};

const fullJitterDelayMs = (attempt, baseDelayMs, maxDelayMs) => {
  const ceiling = Math.min(maxDelayMs, baseDelayMs * (2 ** Math.max(0, attempt - 1)));
  return Math.floor(Math.random() * Math.max(1, ceiling + 1));
};

const isReplayableBody = (body) => {
  if (body === undefined || body === null || typeof body === "string") return true;
  if (Buffer.isBuffer(body) || body instanceof ArrayBuffer || ArrayBuffer.isView(body)) return true;
  if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) return true;
  if (typeof Blob !== "undefined" && body instanceof Blob) return true;
  if (typeof FormData !== "undefined" && body instanceof FormData) return true;
  return false;
};

const normalizePolicy = (url, init, options) => {
  const method = String(init.method || "GET").trim().toUpperCase();
  const deadlineMs = clampInteger(options.deadlineMs ?? options.timeoutMs, DEFAULT_TIMEOUT_MS, 100, 300_000);
  const attemptTimeoutMs = clampInteger(options.attemptTimeoutMs, deadlineMs, 100, deadlineMs);
  const methodIsReplaySafe = options.idempotent === true || (options.idempotent !== false && IDEMPOTENT_METHODS.has(method));
  const replaySafe = methodIsReplaySafe && isReplayableBody(init.body);
  const requestedAttempts = clampInteger(options.maxAttempts, replaySafe ? 3 : 1, 1, 5);

  return {
    url: String(url),
    dependency: normalizeDependency(options.dependency || "external-service"),
    operation: String(options.operation || `${method.toLowerCase()}.request`).slice(0, 120),
    method,
    replaySafe,
    maxAttempts: replaySafe ? requestedAttempts : 1,
    deadlineMs,
    attemptTimeoutMs,
    maxResponseBytes: clampInteger(options.maxResponseBytes, DEFAULT_MAX_RESPONSE_BYTES, 1_024, 128 * 1024 * 1024),
    bufferResponse: options.bufferResponse !== false,
    throwOnHttpError: options.throwOnHttpError === true,
    maxConcurrent: clampInteger(options.maxConcurrent, DEFAULT_MAX_CONCURRENT, 1, 1_000),
    failureThreshold: clampInteger(options.failureThreshold, DEFAULT_FAILURE_THRESHOLD, 1, 100),
    resetTimeoutMs: clampInteger(options.resetTimeoutMs, DEFAULT_RESET_TIMEOUT_MS, 1_000, 30 * 60_000),
    baseDelayMs: clampInteger(options.baseDelayMs, 200, 10, 10_000),
    maxDelayMs: clampInteger(options.maxDelayMs, 5_000, 10, MAX_RETRY_DELAY_MS),
    retryableStatuses: options.retryableStatuses instanceof Set ? options.retryableStatuses : RETRYABLE_STATUSES,
    now: typeof options.now === "function" ? options.now : Date.now,
    fetchImpl: options.fetchImpl || globalThis.fetch,
    onEvent: typeof options.onEvent === "function" ? options.onEvent : null
  };
};

const emit = (policy, event, details = {}) => {
  policy.onEvent?.({
    event,
    dependency: policy.dependency,
    operation: policy.operation,
    endpoint: endpointOrigin(policy.url),
    ...details
  });
};

const markCircuitFailure = (state, policy, error) => {
  if (!error.retryable || error.code === SERVICE_ERROR_CODES.CANCELLED) return;
  state.consecutiveFailures += 1;
  state.lastFailureAt = new Date(policy.now()).toISOString();
  state.lastFailureCode = error.code;
  state.lastUpstreamStatus = error.upstreamStatus;
  if (state.circuit === "half-open" || state.consecutiveFailures >= state.failureThreshold) {
    state.circuit = "open";
    state.openedAt = state.lastFailureAt;
    state.nextProbeAt = new Date(policy.now() + state.resetTimeoutMs).toISOString();
    emit(policy, "dependency.circuit_opened", { error_type: error.code });
  }
};

const markSuccess = (state, policy) => {
  const recovered = state.circuit !== "closed";
  state.circuit = "closed";
  state.consecutiveFailures = 0;
  state.openedAt = null;
  state.nextProbeAt = null;
  state.probeInFlight = false;
  state.counters.successes += 1;
  state.lastSuccessAt = new Date(policy.now()).toISOString();
  state.lastFailureCode = null;
  state.lastUpstreamStatus = null;
  if (recovered) emit(policy, "dependency.circuit_closed");
};

const acquireCircuit = (state, policy) => {
  // A recovering dependency gets one probe, even when its bulkhead has room.
  if (state.circuit === "half-open") {
    if (!state.probeInFlight) {
      state.probeInFlight = true;
      return;
    }
    state.counters.shortCircuited += 1;
    throw serviceError(SERVICE_ERROR_CODES.CIRCUIT_OPEN, {
      dependency: policy.dependency,
      operation: policy.operation,
      retryable: true,
      statusCode: 503,
      retryAfterSeconds: 1
    });
  }
  if (state.circuit !== "open") return;
  const nextProbeAt = Date.parse(state.nextProbeAt || "");
  if (Number.isFinite(nextProbeAt) && policy.now() < nextProbeAt) {
    state.counters.shortCircuited += 1;
    throw serviceError(SERVICE_ERROR_CODES.CIRCUIT_OPEN, {
      dependency: policy.dependency,
      operation: policy.operation,
      retryable: true,
      statusCode: 503,
      retryAfterSeconds: Math.max(1, Math.ceil((nextProbeAt - policy.now()) / 1_000))
    });
  }
  if (state.probeInFlight) {
    state.counters.shortCircuited += 1;
    throw serviceError(SERVICE_ERROR_CODES.CIRCUIT_OPEN, {
      dependency: policy.dependency,
      operation: policy.operation,
      retryable: true,
      statusCode: 503,
      retryAfterSeconds: 1
    });
  }
  state.circuit = "half-open";
  state.probeInFlight = true;
};

const acquireBulkhead = (state, policy) => {
  if (state.inflight >= state.maxConcurrent) {
    state.counters.rejected += 1;
    throw serviceError(SERVICE_ERROR_CODES.OVERLOADED, {
      dependency: policy.dependency,
      operation: policy.operation,
      retryable: true,
      statusCode: 503,
      retryAfterSeconds: 1
    });
  }
  state.inflight += 1;
};

const responseFailure = (status, policy, retryAfterMs = null) => serviceError(
  RETRYABLE_STATUSES.has(status) ? SERVICE_ERROR_CODES.UNAVAILABLE : SERVICE_ERROR_CODES.UPSTREAM_REJECTED,
  {
    dependency: policy.dependency,
    operation: policy.operation,
    retryable: policy.retryableStatuses.has(status),
    statusCode: status === 429 ? 503 : status >= 500 ? 502 : 502,
    retryAfterSeconds: retryAfterMs === null ? null : Math.max(1, Math.ceil(retryAfterMs / 1_000)),
    upstreamStatus: status
  }
);

const forwardAbort = (externalSignal, controller) => {
  if (!externalSignal) return () => {};
  if (externalSignal.aborted) {
    controller.abort(externalSignal.reason);
    return () => {};
  }
  const abort = () => controller.abort(externalSignal.reason);
  externalSignal.addEventListener("abort", abort, { once: true });
  return () => externalSignal.removeEventListener("abort", abort);
};

async function resilientHttpRequest(url, init = {}, options = {}) {
  const policy = normalizePolicy(url, init, options);
  if (init.signal?.aborted) {
    throw classifyServiceFailure(init.signal.reason, {
      dependency: policy.dependency,
      operation: policy.operation,
      callerAborted: true
    });
  }
  if (typeof policy.fetchImpl !== "function") {
    throw serviceError(SERVICE_ERROR_CODES.CONFIGURATION, {
      dependency: policy.dependency,
      operation: policy.operation,
      statusCode: 500,
      retryable: false
    });
  }

  const state = getState(policy);
  acquireCircuit(state, policy);
  try {
    acquireBulkhead(state, policy);
  } catch (error) {
    if (state.circuit === "half-open") {
      state.circuit = "open";
      state.probeInFlight = false;
    }
    throw error;
  }

  state.counters.requests += 1;
  state.lastAttemptAt = new Date(policy.now()).toISOString();
  const startedAt = policy.now();
  let lastError = null;

  try {
    for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
      const elapsed = policy.now() - startedAt;
      const remainingMs = policy.deadlineMs - elapsed;
      if (remainingMs <= 0) {
        lastError = serviceError(SERVICE_ERROR_CODES.TIMEOUT, {
          dependency: policy.dependency,
          operation: policy.operation,
          retryable: true,
          statusCode: 504
        });
        break;
      }

      const controller = new AbortController();
      const removeAbortForwarder = forwardAbort(init.signal, controller);
      let timedOut = false;
      const attemptBudgetMs = Math.max(1, Math.min(policy.attemptTimeoutMs, remainingMs));
      const timeout = setTimeout(() => {
        timedOut = true;
        controller.abort(new DOMException("The operation timed out", "TimeoutError"));
      }, attemptBudgetMs);
      timeout.unref?.();
      state.counters.attempts += 1;

      try {
        const response = await policy.fetchImpl(policy.url, {
          ...init,
          method: policy.method,
          redirect: init.redirect || "error",
          signal: controller.signal
        });
        const retryAfterMs = parseRetryAfterMs(response, policy.now());
        const retryableResponse = policy.retryableStatuses.has(response.status);
        const canRetry = retryableResponse && attempt < policy.maxAttempts;

        if (canRetry) {
          const delayMs = retryAfterMs ?? fullJitterDelayMs(attempt, policy.baseDelayMs, policy.maxDelayMs);
          if (delayMs < policy.deadlineMs - (policy.now() - startedAt)) {
            // Keep the final response readable when Retry-After exceeds the
            // remaining operation budget and another attempt cannot be made.
            await response.body?.cancel?.().catch(() => null);
            state.counters.retries += 1;
            emit(policy, "dependency.request_retry", {
              attempt,
              resend_count: attempt,
              status_code: response.status,
              delay_ms: delayMs
            });
            await wait(delayMs, init.signal);
            continue;
          }
        }

        const bufferedResponse = policy.bufferResponse
          ? await cloneWithBoundedBody(response, {
              maxBytes: policy.maxResponseBytes,
              abort: () => controller.abort(),
              label: `${policy.dependency} response`
            })
          : response;

        if (retryableResponse) {
          const error = responseFailure(response.status, policy, retryAfterMs);
          if (policy.throwOnHttpError) throw error;
          state.counters.failures += 1;
          markCircuitFailure(state, policy, error);
        } else if (policy.throwOnHttpError && !response.ok) {
          const error = responseFailure(response.status, policy, retryAfterMs);
          state.lastFailureAt = new Date(policy.now()).toISOString();
          state.lastFailureCode = error.code;
          state.lastUpstreamStatus = response.status;
          throw error;
        } else {
          markSuccess(state, policy);
        }

        return bufferedResponse;
      } catch (cause) {
        const error = classifyServiceFailure(cause, {
          dependency: policy.dependency,
          operation: policy.operation,
          callerAborted: Boolean(init.signal?.aborted),
          timedOut
        });
        lastError = error;
        const canRetry = error.retryable && policy.replaySafe && attempt < policy.maxAttempts && !init.signal?.aborted;
        if (canRetry) {
          const delayMs = fullJitterDelayMs(attempt, policy.baseDelayMs, policy.maxDelayMs);
          if (delayMs < policy.deadlineMs - (policy.now() - startedAt)) {
            state.counters.retries += 1;
            emit(policy, "dependency.request_retry", {
              attempt,
              resend_count: attempt,
              error_type: error.code,
              delay_ms: delayMs
            });
            await wait(delayMs, init.signal);
            continue;
          }
        }
        break;
      } finally {
        clearTimeout(timeout);
        removeAbortForwarder();
      }
    }

    const failure = lastError || serviceError(SERVICE_ERROR_CODES.UNAVAILABLE, {
      dependency: policy.dependency,
      operation: policy.operation,
      retryable: true,
      statusCode: 502
    });
    state.counters.failures += 1;
    markCircuitFailure(state, policy, failure);
    throw failure;
  } finally {
    state.inflight = Math.max(0, state.inflight - 1);
    if (state.circuit === "half-open") state.probeInFlight = false;
  }
}

const getServiceResilienceSnapshot = () => ({
  checked_at: new Date().toISOString(),
  boundaries: [...registry.values()]
    .map((state) => ({
      dependency: state.dependency,
      endpoint: state.endpoint,
      circuit: state.circuit,
      inflight: state.inflight,
      max_concurrent: state.maxConcurrent,
      consecutive_failures: state.consecutiveFailures,
      opened_at: state.openedAt,
      next_probe_at: state.nextProbeAt,
      last_attempt_at: state.lastAttemptAt,
      last_success_at: state.lastSuccessAt,
      last_failure_at: state.lastFailureAt,
      last_failure_code: state.lastFailureCode,
      last_upstream_status: state.lastUpstreamStatus,
      counters: { ...state.counters }
    }))
    .sort((left, right) => left.dependency.localeCompare(right.dependency) || left.endpoint.localeCompare(right.endpoint))
});

const resetServiceResilienceState = () => registry.clear();

module.exports = {
  DEFAULT_FAILURE_THRESHOLD,
  DEFAULT_MAX_CONCURRENT,
  DEFAULT_MAX_RESPONSE_BYTES,
  DEFAULT_RESET_TIMEOUT_MS,
  IDEMPOTENT_METHODS,
  RETRYABLE_STATUSES,
  ServiceBoundaryError,
  getServiceResilienceSnapshot,
  resilientHttpRequest,
  resetServiceResilienceState,
  _internals: {
    boundaryKey,
    endpointOrigin,
    fullJitterDelayMs,
    isReplayableBody,
    normalizePolicy,
    parseRetryAfterMs
  }
};
