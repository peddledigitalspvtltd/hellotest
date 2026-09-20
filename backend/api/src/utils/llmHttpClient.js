const DEFAULT_TIMEOUT_MS = Math.max(5_000, Number.parseInt(process.env.LLM_REQUEST_TIMEOUT_MS || "45000", 10) || 45_000);
const DEFAULT_MAX_ATTEMPTS = Math.max(1, Math.min(4, Number.parseInt(process.env.LLM_MAX_ATTEMPTS || "3", 10) || 3));
const { cloneWithBoundedBody } = require("./boundedResponse");
const { isContextSizeRejection, buildContextFallbackBody } = require("./llmContextFallback");
const { resilientHttpRequest } = require("./resilientHttpClient");

const bufferResponseWithinDeadline = (response, controller, maxBytes) => cloneWithBoundedBody(response, {
  maxBytes,
  abort: () => controller.abort(),
  label: "LLM provider response"
});

exports.fetchLlmWithRetry = async (url, init = {}, options = {}) => {
  const timeoutMs = Math.max(1_000, Number(options.timeoutMs || DEFAULT_TIMEOUT_MS));
  const maxAttempts = Math.max(1, Math.min(4, Number(options.maxAttempts || DEFAULT_MAX_ATTEMPTS)));
  const operation = String(options.operation || "llm.request");
  const startedAt = Date.now();
  const request = (init, remainingMs = timeoutMs) => resilientHttpRequest(url, init, {
    dependency: "llm-provider",
    operation,
    deadlineMs: remainingMs,
    attemptTimeoutMs: Math.min(remainingMs, Math.max(1_000, Number(options.attemptTimeoutMs || timeoutMs))),
    maxAttempts,
    maxResponseBytes: options.maxResponseBytes,
    bufferResponse: options.bufferResponse !== false,
    maxConcurrent: options.maxConcurrent || 16,
    failureThreshold: options.failureThreshold || 5,
    resetTimeoutMs: options.resetTimeoutMs || 30_000,
    // LLM generation uses POST and can incur duplicate work or billing. It is
    // single-attempt unless a caller explicitly supplies a replay-safe contract.
    idempotent: options.idempotent === true,
    onEvent: (event) => console.warn(JSON.stringify(event))
  });
  const response = await request(init);
  if (response.ok || options.contextFallback === false || ![400, 413, 422].includes(response.status)) return response;
  const detail = await response.clone().text();
  if (!isContextSizeRejection(response.status, detail)) return response;
  const body = buildContextFallbackBody(init.body, options.contextFallbackContent);
  const remainingMs = timeoutMs - (Date.now() - startedAt);
  if (!body || remainingMs < 1000 || init.signal?.aborted) return response;
  // The provider explicitly rejected the original input, so no completion or
  // application write happened. Retry once with less context under one deadline.
  console.warn(JSON.stringify({ event: "llm.context_fallback", operation, status_code: response.status }));
  options.onContextFallback?.({ operation });
  return request({ ...init, body }, remainingMs);
};

exports._internals = {
  bufferResponseWithinDeadline
};
