// Provider selection, bounded generation and native tool response parsing for automation.
const { aiInstructionBlock } = require("@hellotest/platform/backend/src/utils/aiInstructionBlocks");
const aiLlmSelectionService = require("@hellotest/integration/backend/services/aiLlmSelection.service");
const { fetchLlmWithRetry } = require("@hellotest/platform/backend/src/utils/llmHttpClient");
const { getCompletionContent } = require("@hellotest/platform/backend/src/utils/llmResponse");
const { createLlmProviderError } = require("@hellotest/platform/backend/src/utils/upstreamLlmError");
const { retryLlmCapacity } = require("@hellotest/platform/backend/src/utils/llmCapacityRetry");
const { retryActorJsonOutput } = require("./automationJsonOutputRetry");
const { browserActorRequestPolicy } = require("../browser/automationActorModelPolicy");
const LLM_TIMEOUT_MS = Math.max(10_000, Number(process.env.AUTOMATION_BUILDER_LLM_TIMEOUT_MS || 90_000));

const extractJsonPayload = (content) => {
  const trimmed = String(content || "").trim();

  if (!trimmed) {
    throw Object.assign(new Error("LLM response was empty"),{code:"AI_INVALID_JSON"});
  }

  const withoutFence = trimmed.startsWith("```")
    ? trimmed.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim()
    : trimmed;
  const firstBrace = withoutFence.indexOf("{");
  const lastBrace = withoutFence.lastIndexOf("}");
  const jsonCandidate =
    firstBrace !== -1 && lastBrace !== -1 && lastBrace >= firstBrace
      ? withoutFence.slice(firstBrace, lastBrace + 1)
      : withoutFence;

  try {
    return JSON.parse(jsonCandidate);
  } catch {
    throw Object.assign(new Error("Unable to parse JSON from the LLM response"),{code:"AI_INVALID_JSON"});
  }
};

const fetchWithTimeout = async (url, init = {}, timeoutMs = LLM_TIMEOUT_MS, integration, featureKey, maxAttempts, {beforeDispatch, idempotent = false} = {}) => {
  return fetchLlmWithRetry(url, init, { integration, featureKey, timeoutMs, maxAttempts, beforeDispatch, idempotent, bufferedProposal: idempotent === true, operation: "automation.generate" });
};

const resolveLlmIntegration = async (integrationId, { allowFallback = true, userId, usageKey, projectId } = {}) => {
  const integration = await aiLlmSelectionService.resolveLlmIntegrationForUsage({
    integrationId,
    userId,
    usageKey,
    projectId,
    fallback: "project-then-global",
    allowMissing: allowFallback
  });

  if (!integration) {
    if (allowFallback) {
      return null;
    }

    throw new Error("No active LLM integration is configured");
  }

  if (integration.type !== "llm") {
    throw new Error("Selected integration is not an LLM integration");
  }

  if (!integration.is_active) {
    throw new Error("Selected LLM integration is inactive");
  }

  return integration;
};

const requestChatCompletion = async ({ integration, prompt, content, featureKey, signal, timeoutMs = LLM_TIMEOUT_MS, maxAttempts, onCapacityWait, onJsonRetry, activeGoal, browserActor = false, browserReview = false, nativeTools, beforeDispatch, upstreamPhase }) => {
  // Only these host-selected phases return buffered proposals/source. They do
  // not execute MCP or accept a browser action until one response is validated.
  const bufferedUpstream = maxAttempts !== 1 && ['upstream_browser_actor','upstream_source','upstream_instruction_mapping','upstream_api_source'].includes(upstreamPhase);
  const bufferedAttempts = Math.min(3, Math.max(1, Number(maxAttempts || Number.parseInt(process.env.LLM_MAX_ATTEMPTS || '3', 10) || 3)));
  return retryActorJsonOutput(({timeoutMs: requestTimeoutMs}) => retryLlmCapacity(async ({timeoutMs: remainingMs}) => {
  const accessCheckStarted=Date.now();
  await beforeDispatch?.();
  signal?.throwIfAborted();
  remainingMs-=Date.now()-accessCheckStarted;
  if(remainingMs<=0)throw Object.assign(new Error('The model request deadline elapsed before dispatch.'),{code:'DEADLINE_EXCEEDED',statusCode:504});
  const tools=browserActor===true&&nativeTools!==undefined?nativeTools:null;
  if(tools!==null&&(!Array.isArray(tools)||tools.length<1||tools.length>100||tools.some(tool=>!tool||typeof tool.name!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(tool.name)||!tool.inputSchema||typeof tool.inputSchema!=='object'||Array.isArray(tool.inputSchema))))throw Object.assign(new Error('Supply the discovered native Playwright tool catalog.'),{code:'AUTOMATION_UPSTREAM_TOOL_INVALID',statusCode:422,nonRetryable:true});
  const baseUrl = (integration.base_url || "https://api.openai.com/v1").replace(/\/$/, "");
  const response = await fetchWithTimeout(`${baseUrl}/chat/completions`, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${integration.api_key}`
    },
    body: JSON.stringify({
      model: integration.model,

      ...(tools?{tools:tools.map(tool=>({type:'function',function:{name:tool.name,description:tool.description,parameters:tool.inputSchema}})),tool_choice:'auto'}:{response_format:{type:'json_object'}}),
      // Reserve one bounded typed decision. Reasoning-capable official GPT-5
      // needs headroom for both reasoning and visible JSON; managed limits can
      // still impose a lower cap. Only the separately trusted browser-review
      // phase shares that reasoning policy; other generation stays unchanged.
      ...browserActorRequestPolicy(integration,browserActor,browserReview),
      messages: [
        ...(tools?[{role:'system',content:'HelloTest host contract for configured private inputs: keys present in the current section private_parameter_tokens dictionary are available configured bindings. Their plaintext values are intentionally omitted from public parameters and model context. Use the exact scoped reference (for example @r.password) or its supplied opaque native key in browser_type.text, browser_fill_form field.value, or browser_verify_value.value. The host securely resolves the binding at native MCP dispatch; a reviewed blank binding remains an intentional empty value. Do not ask for plaintext, classify a supplied private token as unavailable because its value is hidden, or use JavaScript evaluation, extraction, hidden APIs or credential discovery to obtain it. Use only private bindings explicitly available for the current authored section.'}]:[]),
        ...(activeGoal && typeof activeGoal.action === 'string' && typeof activeGoal.expected_result === 'string'
          && activeGoal.action.length + activeGoal.expected_result.length <= 2000 ? [
            {role:'system',content:aiInstructionBlock(featureKey || 'ai.automation.keyword_generation', 'automationBrowserAgent.activeGoal')},
            {role:'user',content:JSON.stringify({host_selected_current_manual_section:{action:activeGoal.action,expected_result:activeGoal.expected_result}})}
          ] : []),
        {
          role: "user",
          content: content || prompt
        }
      ]
    })
  }, remainingMs, integration, featureKey, bufferedUpstream ? bufferedAttempts : maxAttempts, {beforeDispatch, idempotent: bufferedUpstream});

  if (!response.ok) {
    const raw = await response.text();
    throw createLlmProviderError({ status: response.status, detail: raw, headers: response.headers });
  }

  const payload = await response.json();
  const toolCalls=payload?.choices?.[0]?.message?.tool_calls;
  if(tools&&Array.isArray(toolCalls)&&toolCalls.length){
    const names=new Set(tools.map(tool=>tool.name));
    return {tool_calls:toolCalls.map(call=>{
      if(call?.type!=='function'||!names.has(call.function?.name))throw Object.assign(new Error('The model returned a tool outside the discovered native catalog.'),{code:'AI_UNEXPECTED_TOOL_CALL',statusCode:422,nonRetryable:true});
      let args;try{args=JSON.parse(call.function.arguments);if(!args||typeof args!=='object'||Array.isArray(args))throw new Error('object required');}
      catch{throw Object.assign(new Error('The model returned invalid native tool arguments.'),{code:'AI_INVALID_TOOL_ARGUMENTS',statusCode:422,nonRetryable:true});}
      return {name:call.function.name,arguments:args};
    })};
  }
  const messageContent = getCompletionContent(payload);

  if (!messageContent) {
    throw Object.assign(new Error("LLM response did not include generated content"),{code:'AI_INVALID_JSON',statusCode:422,generation_received:true});
  }

  return messageContent;
}, { timeoutMs: requestTimeoutMs, signal, maxAttempts: bufferedUpstream || maxAttempts === 1 ? 1 : 3, onWait: onCapacityWait }), { browserActor: browserActor === true && maxAttempts !== 1 && nativeTools === undefined && !bufferedUpstream, timeoutMs, signal, onRetry: onJsonRetry });
};

module.exports = { LLM_TIMEOUT_MS, extractJsonPayload, resolveLlmIntegration, requestChatCompletion };
