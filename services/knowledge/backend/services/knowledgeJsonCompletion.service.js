const execution = require("./knowledgeExecution.service");
const integrationService = require("@hellotest/integration/backend/services/integration.service");
const aiLlmSelectionService = require("@hellotest/integration/backend/services/aiLlmSelection.service");
const { fetchLlmWithRetry } = require("@hellotest/platform/backend/src/utils/llmHttpClient");
const { getCompletionContent: completionContent } = require("@hellotest/platform/backend/src/utils/llmResponse");
const { validateModelEndpoint, readRetryAfterMs } = require("@hellotest/platform/backend/src/utils/knowledgeModelRetry");
const { modelHttpError } = require("@hellotest/platform/backend/src/utils/knowledgeAssistantErrors");
const { normalizeText } = require("@hellotest/platform/backend/src/security/aiTextPolicy");
const { validateChatResponse } = require('@hellotest/platform/backend/src/utils/llmRequestPolicy');
const resolveChatCompletionsUrl = baseUrl => {
  const normalized = normalizeText(baseUrl, 2000) || "https://api.openai.com/v1";
  return /\/chat\/completions\/?$/i.test(normalized) ? normalized.replace(/\/+$/, "") : `${normalized.replace(/\/+$/, "")}/chat/completions`;
};
const extractJson = value => {
  const text = String(value || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = text.indexOf("{");
  const parsed = JSON.parse(start < 0 ? text : text.slice(start, text.lastIndexOf("}") + 1));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("A JSON object completion is required.");
  return parsed;
};
const isJsonModeCompatibilityRejection = (status, text) => [400, 422].includes(Number(status))
  && /(?:response[_\s-]?format|json[_\s-]?object|json mode)/i.test(text)
  && /(?:unsupported|not supported|unknown|unrecognized|invalid|extra inputs?|not permitted)/i.test(text);

// Only explicit pre-generation parameter rejections are learned. Keep provider
// capabilities separate from result data, credentials and project evidence.
const compatibility = new Map();
const COMPATIBILITY_TTL_MS = 10 * 60 * 1000;
const COMPATIBILITY_LIMIT = 100;
const compatibilityKey = (integration, endpoint) => JSON.stringify([integration.id || null, endpoint, integration.model || null]);
const rememberCompatibility = (key, settings) => {
  compatibility.delete(key);
  compatibility.set(key, { settings: { ...settings }, expiresAt: Date.now() + COMPATIBILITY_TTL_MS });
  while (compatibility.size > COMPATIBILITY_LIMIT) compatibility.delete(compatibility.keys().next().value);
};

const openAiJsonCompletion = async ({ integration, messages, operation, signal, timeoutMs = 45_000, maxOutputTokens = 4096, outputSchema, outputSchemaName = 'hellotest_knowledge_answer', recordUsage = () => {}, reserveCompatibilityAttempt = () => {}, reservePreparedRequest = () => {} }) => {
  const endpoint = resolveChatCompletionsUrl(integration.base_url);
  validateModelEndpoint(endpoint);
  const headers = { "Content-Type": "application/json" };
  const apiKey = String(integration.api_key || "").trim();
  if (integrationService.isUsableApiCredential(apiKey)) headers.Authorization = `Bearer ${apiKey}`;
  const key = compatibilityKey(integration, endpoint);
  const cached = compatibility.get(key);
  if (cached && cached.expiresAt <= Date.now()) compatibility.delete(key);
  let { useJsonMode = true, structuredOutput = true, outputTokenField = 'max_tokens', includeTemperature = true } = cached?.expiresAt > Date.now() ? cached.settings : {};
  const deadlineAt = Date.now() + timeoutMs;
  const request = (attempt) => {
    const remainingMs = Math.max(0, deadlineAt - Date.now());
    if (!remainingMs) throw Object.assign(new Error('The model request deadline was reached.'), { code: 'MODEL_TIMEOUT' });
    if (attempt > 0) reserveCompatibilityAttempt();
    let dispatches = 0;
    return fetchLlmWithRetry(endpoint, {
    method: "POST",
    signal,
    headers,
    body: JSON.stringify({
      model: integration.model,
      [outputTokenField]: maxOutputTokens,
      ...(useJsonMode ? { response_format: { type: "json_object" } } : {}),
      messages
    })
  }, {
    integration,
    sampling: includeTemperature,
    compatibility: false,
    outputSchema,
    outputSchemaName,
    structuredOutput,
    beforeDispatch: async prepared => {
      // Native context-size corrections also dispatch again inside this HTTP
      // boundary. They share the same admission/cost rules as adapter retries.
      if (dispatches > 0) reserveCompatibilityAttempt();
      await reservePreparedRequest(prepared);
      dispatches++;
    },
    // This gateway records usage and exposes its established MODEL_* errors.
    validateResponse: false,
    maxOutputTokens,
    operation: useJsonMode ? operation : `${operation}.json-mode-compatibility`,
    timeoutMs: remainingMs,
    maxAttempts: 1,
    bufferResponse: true,
    maxResponseBytes: 1024 * 1024
    });
  };

  let response;
  let responseText = "";
  for (let compatibilityAttempt = 0; compatibilityAttempt < 4; compatibilityAttempt += 1) {
    execution.assertActive();
    response = await request(compatibilityAttempt);
    if (response.ok) break;
    responseText = typeof response.text === "function" ? await response.text() : "";
    if (![400, 422].includes(response.status)) break;
    // Negotiate only explicit parameter rejections. Transient failures belong
    // to the gateway's shared retry budget; compatibility keeps the output bound.
    if (structuredOutput && /json_schema|structured.?outputs?/i.test(responseText) && /unsupported|not supported|does not support|unknown|unrecognized/i.test(responseText)) structuredOutput = false;
    else if (useJsonMode && isJsonModeCompatibilityRejection(response.status, responseText)) useJsonMode = false;
    else if (outputTokenField === "max_tokens" && /max_tokens/i.test(responseText) && /max_completion_tokens/i.test(responseText)) outputTokenField = "max_completion_tokens";
    else if (includeTemperature && /temperature/i.test(responseText) && /unsupported|not support|only.{0,30}default/i.test(responseText)) includeTemperature = false;
    else break;
    rememberCompatibility(key, { useJsonMode, structuredOutput, outputTokenField, includeTemperature });
  }
  if (!response.ok) throw modelHttpError(Number(response.status), responseText, readRetryAfterMs(response));
  const schemaResponse = outputSchema ? response.clone() : null;
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw Object.assign(new Error("The answer provider returned an invalid payload."), { code: "MODEL_INVALID_RESPONSE" });
  }
  execution.assertActive();
  recordUsage({ integration, operation, usage: payload.usage });
  if (schemaResponse) {
    try { await validateChatResponse(schemaResponse, { messages }, { outputSchema }); }
    catch (error) {
      if (['AI_OUTPUT_SCHEMA_VIOLATION', 'AI_INVALID_JSON', 'AI_INVALID_RESPONSE', 'AI_EMPTY_RESPONSE'].includes(error.code)) {
        throw Object.assign(new Error('The answer provider did not satisfy the declared JSON output contract.', { cause: error }), { code: 'MODEL_INVALID_RESPONSE', validation_errors: error.validation_errors });
      }
      if (error.code === 'AI_OUTPUT_TRUNCATED') throw Object.assign(new Error('The answer provider reached its output limit.', { cause: error }), { code: 'MODEL_OUTPUT_TRUNCATED' });
      throw error;
    }
  }
  if (payload.choices?.[0]?.finish_reason === "length") throw Object.assign(new Error("The answer provider reached its output limit."), { code: "MODEL_OUTPUT_TRUNCATED" });
  const content = completionContent(payload);
  if (!content) throw Object.assign(new Error("The answer provider returned no answer."), { code: "MODEL_EMPTY_RESPONSE" });
  let parsed;
  try { parsed = extractJson(content); }
  catch { throw Object.assign(new Error("The answer provider returned invalid answer JSON."), { code: "MODEL_INVALID_RESPONSE" }); }
  await aiLlmSelectionService.recordSuccessfulLlmIntegration?.(integration);
  return parsed;
};


module.exports = openAiJsonCompletion;

module.exports.resolveChatCompletionsUrl = resolveChatCompletionsUrl;
module.exports.isJsonModeCompatibilityRejection = isJsonModeCompatibilityRejection;
module.exports.resetCompatibilityCache = () => compatibility.clear();
