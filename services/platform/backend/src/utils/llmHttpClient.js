const DEFAULT_TIMEOUT_MS = Math.min(150_000, Math.max(5_000, Number.parseInt(process.env.LLM_REQUEST_TIMEOUT_MS || "90000", 10) || 90_000));
const DEFAULT_MAX_ATTEMPTS = Math.max(1, Math.min(4, Number.parseInt(process.env.LLM_MAX_ATTEMPTS || "3", 10) || 3));
const { cloneWithBoundedBody } = require("./boundedResponse");
const { isContextSizeRejection, buildContextFallbackBody } = require("./llmContextFallback");
const { resilientHttpRequest } = require("./resilientHttpClient");
const traces = require("./llmTraceCapture");
const { prepareChatRequest, compatibleChatRequest, validateChatResponse } = require("./llmRequestPolicy");

const bufferResponseWithinDeadline = (response, controller, maxBytes) => cloneWithBoundedBody(response, {
  maxBytes,
  abort: () => controller.abort(),
  label: "LLM provider response"
});

exports.fetchLlmWithRetry = async (url, init = {}, options = {}) => {
  // Older feature callers append this suffix even when the integration stores
  // the complete endpoint. Normalize only that duplicate, preserving the host.
  if (typeof url === "string") url = url.replace(/(\/chat\/completions)(?:\/chat\/completions)+\/?$/i, "$1");
  const managed = await require("./aiFeatureRuntime").apply(init, options);
  init = managed.init; options = managed.options;
  if (managed.url) url = managed.url;
  const timeoutMs = Math.max(1_000, Number(options.timeoutMs || DEFAULT_TIMEOUT_MS));
  const maxAttempts = Math.max(1, Math.min(4, Number(options.maxAttempts || DEFAULT_MAX_ATTEMPTS)));
  const operation = String(options.operation || "llm.request");
  const startedAt = Date.now();
  options.timeoutMs = timeoutMs;
  let prepared;
  try {
    init = await require("@hellotest/mcp/backend/gateway").enrichChatRequest(init, options);
    prepared = prepareChatRequest(init, { ...options, operation });
    init = prepared.init;
  } catch (error) {
    const preflight = await traces.begin({ url, init, options: { ...options, operation } });
    await traces.finish(preflight, { error });
    throw error;
  }
  let lastTrace = null, lastResponse = null, attempts = 1;
  const request = async (init, remainingMs = timeoutMs) => {
    if (lastTrace) await traces.finish(lastTrace, { response: lastResponse, attempts });
    lastTrace = await traces.begin({ url, init, options: { ...options, operation }, correctionOf: lastTrace?.id });
    attempts = 1;
    lastResponse = null;
    remainingMs = Math.min(remainingMs, timeoutMs - (Date.now() - startedAt));
    if (remainingMs <= 0) throw Object.assign(new Error("The model request deadline elapsed before dispatch."), { code: "DEADLINE_EXCEEDED", statusCode: 504 });
    lastResponse = await resilientHttpRequest(url, init, {
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
    onEvent: (event) => { attempts = Math.max(attempts, Number(event.attempt || 0) + 1); console.warn(JSON.stringify(event)); }
    });
    if (lastTrace) lastTrace.received = Date.now();
    return lastResponse;
  };
  let failure = null;
  try {
  let response = await request(init);
  let contextReduced = false;
  // At most two compatibility/size corrections, under the original deadline.
  // Never replay successful, throttled, network-failed, or truncated generation.
  for (let correction = 0; correction < 2 && !response.ok; correction++) {
    if (![400, 413, 422].includes(response.status)) break;
    const detail = await response.clone().text();
    let next = options.compatibility === false ? null : compatibleChatRequest(init, response.status, detail);
    if (!next && !contextReduced && options.contextFallback !== false && isContextSizeRejection(response.status, detail)) {
      const body = buildContextFallbackBody(init.body, options.contextFallbackContent);
      if (body) {
        next = { ...init, body };
        contextReduced = true;
        console.warn(JSON.stringify({ event: "llm.context_fallback", operation, status_code: response.status }));
        options.onContextFallback?.({ operation });
      }
    }
    const remainingMs = timeoutMs - (Date.now() - startedAt);
    if (!next || remainingMs < 1000 || init.signal?.aborted) break;
    init = next;
    response = await request(init, remainingMs);
  }
  await require("./aiFeatureRuntime").validateResponse(response, managed.profile);
  const valid = options.validateResponse === false ? false : await validateChatResponse(response, prepared.payload);
  if (valid && options.integration) {
    // Preferences must not turn a successful generation into a failed request.
    try { await require("@hellotest/integration/backend/services/aiLlmSelection.service").recordSuccessfulLlmIntegration(options.integration); } catch { /* best effort */ }
  }
  return response;
  } catch (error) { failure = error; throw error; }
  finally { await traces.finish(lastTrace, { response: lastResponse, error: failure, invalid: Boolean(failure && lastResponse?.ok), attempts }); }
};

exports._internals = {
  bufferResponseWithinDeadline
};
