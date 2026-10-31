const DEFAULT_TIMEOUT_MS = Math.min(150_000, Math.max(5_000, Number.parseInt(process.env.LLM_REQUEST_TIMEOUT_MS || "90000", 10) || 90_000));
const DEFAULT_MAX_ATTEMPTS = Math.max(1, Math.min(4, Number.parseInt(process.env.LLM_MAX_ATTEMPTS || "3", 10) || 3));
const { cloneWithBoundedBody } = require("./boundedResponse");
const { isContextSizeRejection, buildContextFallbackBody } = require("./llmContextFallback");
const { resilientHttpRequest } = require("./resilientHttpClient");
const traces = require("./llmTraceCapture");
const { prepareChatRequest, compatibleChatRequest, validateChatResponse, assertInputBudget } = require("./llmRequestPolicy");

const bufferResponseWithinDeadline = (response, controller, maxBytes) => cloneWithBoundedBody(response, {
  maxBytes,
  abort: () => controller.abort(),
  label: "LLM provider response"
});

exports.fetchLlmWithRetry = async (url, init = {}, options = {}) => {
  const startedAt=Date.now();
  // Older feature callers append this suffix even when the integration stores
  // the complete endpoint. Normalize only that duplicate, preserving the host.
  if (typeof url === "string") url = url.replace(/(\/chat\/completions)(?:\/chat\/completions)+\/?$/i, "$1");
  let managed;
  try{managed=await require("./aiFeatureRuntime").apply(init,options);}catch(error){
    const preflight=await traces.begin({url,init,options:{...options,traceStage:'configuration_preflight'}});
    await traces.finish(preflight,{error});throw error;
  }
  init = managed.init; options = managed.options;
  if (managed.url) url = managed.url;
  const timeoutMs = Math.max(1_000, Number(options.timeoutMs || DEFAULT_TIMEOUT_MS));
  const maxAttempts = Math.max(1, Math.min(4, Number(options.maxAttempts || DEFAULT_MAX_ATTEMPTS)));
  const operation = String(options.operation || "llm.request");
  options.timeoutMs = timeoutMs;
  let prepared;
  try {
    init = await require("@hellotest/mcp/backend/gateway").enrichChatRequest(init, options);
    prepared = prepareChatRequest(init, { ...options, operation, providerUrl:url });
    init = prepared.init;
    init = await require('../../services/aiAttachmentAccess.service').prepareImages(init, options);
  } catch (error) {
    const preflight = await traces.begin({ url, init, options: { ...options, operation,traceStage:'context_preflight' } });
    await traces.finish(preflight, { error });
    throw error;
  }
  let lastTrace = null, lastResponse = null, attempts = 1, correctionFailure = null, receivedGeneration=false;
  const request = async (init, remainingMs = timeoutMs) => {
    let payload;try{payload=JSON.parse(init.body);}catch{}if(Array.isArray(payload?.messages))assertInputBudget(payload,options);
    if (lastTrace) await traces.finish(lastTrace, { response: lastResponse, attempts, error:correctionFailure, invalid:Boolean(correctionFailure) });
    correctionFailure = null;
    lastTrace = await traces.begin({ url, init, options: { ...options, operation,traceStage:'provider_preflight' }, correctionOf: lastTrace?.id });
    attempts = 1;
    lastResponse = null;
    remainingMs = Math.min(remainingMs, timeoutMs - (Date.now() - startedAt));
    if (remainingMs <= 0) throw Object.assign(new Error("The model request deadline elapsed before dispatch."), { code: "DEADLINE_EXCEEDED", statusCode: 504 });
    let dispatchError;
    try{lastResponse = await resilientHttpRequest(url, init, {
    fetchImpl:async(...args)=>{
      if(typeof options.beforeDispatch==='function'){
        let payload;try{payload=JSON.parse(args[1].body);}catch{}
        try{await options.beforeDispatch({url:args[0],init:args[1],payload});}catch(error){dispatchError=error;error.nonRetryable=true;error.statusCode||=422;throw error;}
      }
      traces.dispatch(lastTrace,attempts);return globalThis.fetch(...args);
    },
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
    });}catch(error){throw dispatchError||error;}
    if(lastResponse?.ok)receivedGeneration=true;
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
    if (require('./aiReferenceImages').isVisionRejection(response.status, detail) && prepared.payload?.messages?.some(message => Array.isArray(message.content) && message.content.some(part => part?.type === 'image_url'))) {
      throw Object.assign(new Error('The selected model rejected reference images. Select a vision-capable integration or remove the images; no text-only generation was substituted.'), { code: 'AI_VISION_UNSUPPORTED', statusCode: 422 });
    }
    let next = options.compatibility === false ? null : compatibleChatRequest(init, response.status, detail);
    if (!next && !contextReduced && options.contextFallback !== false && isContextSizeRejection(response.status, detail)) {
      const body = buildContextFallbackBody(init.body, options.contextFallbackContent, options.contextFallbackInstructions);
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
  const nativeContract = !managed.profile?.deferred_output_schema && require('./aiGenerationContracts').nativeArtifactContract(managed.profile?.id);
  if (nativeContract && response.ok) {
    const validateArtifact = async candidate => {
      const value = await candidate.clone().json();
      if (['length','content_filter'].includes(value.choices?.[0]?.finish_reason) || value.choices?.[0]?.message?.refusal || value.choices?.[0]?.message?.tool_calls?.length) return;
      let parsed;
      try { parsed = JSON.parse(require('./llmResponse').getCompletionContent(value).trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'')); } catch { parsed = null; }
      require('./aiGenerationContracts').validateNativeArtifactOutput(managed.profile.id, parsed, {testCaseTypes:options.nativeArtifactTestCaseTypes});
    };
    try { await validateArtifact(response); }
    catch (error) {
      const remainingMs = timeoutMs - (Date.now() - startedAt);
      if (error?.code !== 'AI_NATIVE_CONTRACT_INVALID' || error.empty_artifact_collection || remainingMs < 1000 || init.signal?.aborted) throw error;
      const body = JSON.parse(init.body);
      const correction = managed.profile?.config?.instruction_blocks?.['application.artifactCorrection'];
      if (typeof correction !== 'string' || !correction.trim()) throw Object.assign(new Error('The AI configuration is missing the artifact correction instruction.'), { statusCode:503, code:'AI_INSTRUCTION_MISSING' });
      const candidate=require('./llmResponse').getCompletionContent(await response.clone().json());
      body.messages=require('./aiPromptEnvelope').repairMessages(body.messages,{candidate,issues:{validation_errors:error.validation_errors},instruction:correction});
      // This is read-only authoring, never a replay of a browser/tool action.
      correctionFailure = error;
      response = await request({ ...init, body:JSON.stringify(body) }, remainingMs);
      if (response.ok) await validateArtifact(response);
    }
  }
  await require("./aiFeatureRuntime").validateResponse(response, managed.profile);
  const valid = options.validateResponse === false ? false : await validateChatResponse(response, prepared.payload,options);
  if (valid && options.integration) {
    // Preferences must not turn a successful generation into a failed request.
    try { await require("@hellotest/integration/backend/services/aiLlmSelection.service").recordSuccessfulLlmIntegration(options.integration); } catch { /* best effort */ }
  }
  return response;
  } catch (error) {
    // A later failed correction or bookkeeping step cannot make the original
    // paid completion replay-safe for an outer job/capacity retry.
    if(receivedGeneration){error.retryable=false;error.nonRetryable=true;error.generation_received=true;}
    failure = error; throw error;
  }
  finally { await traces.finish(lastTrace, { response: lastResponse, error: failure, invalid: Boolean(failure && lastResponse?.ok), attempts }); }
};

exports._internals = {
  bufferResponseWithinDeadline
};
