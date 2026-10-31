const { aiInstructionBlock } = require('@hellotest/platform/backend/src/utils/aiInstructionBlocks');
const { createHash } = require('crypto');
const selection = require('@hellotest/integration/backend/services/aiLlmSelection.service');
const { fetchLlmWithRetry } = require('@hellotest/platform/backend/src/utils/llmHttpClient');
const { getCompletionContent } = require('@hellotest/platform/backend/src/utils/llmResponse');
const { sanitizeAiText } = require('@hellotest/platform/backend/src/security/aiTextPolicy');
const { requireAiAssessment } = require('@hellotest/platform/backend/src/utils/requireAiAssessment');
const { createLlmProviderError } = require('@hellotest/platform/backend/src/utils/upstreamLlmError');
const { dataBlock, dedupeInstructions, repairMessages } = require('@hellotest/platform/backend/src/utils/aiPromptEnvelope');

const digest=value=>createHash('sha256').update(value).digest('hex');
function evidenceInput(value){
  const input=JSON.stringify(value);
  if(typeof input!=='string'||Buffer.byteLength(input)>48000)throw Object.assign(new Error('Select a smaller evidence scope for this AI review.'),{statusCode:422,code:'AI_INPUT_BUDGET_EXCEEDED'});
  const safe=sanitizeAiText(input).text;
  let data;try{data=JSON.parse(safe);}catch{data={sanitized_evidence:safe};}
  return {safe,content:dataBlock('context',data)};
}
function repairInput(content,error){
  const safe=typeof content==='string'?sanitizeAiText(content).text:'';
  const candidate=typeof content!=='string'?{omitted:true,reason:error.model_candidate_omitted?'invalid_output_exceeds_transport_budget':'invalid_output_unavailable'}
    :Buffer.byteLength(safe)<=16000?safe:{omitted:true,reason:'invalid_output_exceeds_repair_budget',utf8_bytes:Buffer.byteLength(safe),sha256:digest(safe)};
  return {candidate,issues:[{code:error.code || 'AI_RESPONSE_JSON_INVALID',message:sanitizeAiText(String(error.message || 'The response failed local validation.')).text.slice(0,500),
    ...(Array.isArray(error.validation_errors)?{validation_errors:error.validation_errors.slice(0,5)}:{})}]};
}
async function review({ projectId, userId, integrationId, usageKey='ai.quality.portfolio_insights', task, evidence, fallbackEvidence, contract, validate, signal, maxOutputTokens = 3500 }) {
  const integration = await selection.resolveLlmIntegrationForUsage({ projectId, userId, integrationId, usageKey, fallback: 'project-then-global', allowMissing: true });
  requireAiAssessment({ integration });
  const full=evidenceInput(evidence),reduced=fallbackEvidence==null?null:evidenceInput(fallbackEvidence);
  const instruction=dedupeInstructions([aiInstructionBlock(usageKey,'structuredReview.response.1'),String(task),
    aiInstructionBlock(usageKey,'structuredReview.service.prompt.segment.1')+String(contract),
    aiInstructionBlock(usageKey,'structuredReview.service.prompt.segment.2')]).join('\n\n');
  const base = String(integration.base_url || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const deadline = Date.now() + 60000;
  let lastError, correction, calls = 0, contextReduced = false;
  for (; calls < 2; calls++) {
    const remaining = deadline - Date.now();
    if (remaining < 1000) break;
    let content;
    try {
      const selected=contextReduced&&reduced?reduced:full;
      const baseMessages=[{role:'system',content:instruction},
        ...(contextReduced?[{role:'system',content:aiInstructionBlock(usageKey,'structuredReview.contextReduction')}]:[]),
        {role:'user',content:selected.content}];
      const messages=correction?repairMessages(baseMessages,{...correction,instruction:{instruction:aiInstructionBlock(usageKey,'structuredReview.repair')}}):baseMessages;
      const response = await fetchLlmWithRetry(/\/chat\/completions$/.test(base) ? base : `${base}/chat/completions`, { method: 'POST', signal,
        headers: { 'Content-Type': 'application/json', ...(integration.api_key ? { Authorization: `Bearer ${integration.api_key}` } : {}) },
        body: JSON.stringify({ model: integration.model,response_format:{type:'json_object'},messages }) }, { integration, featureKey:usageKey,operation: usageKey, timeoutMs: remaining, maxAttempts: 1, maxOutputTokens, compatibility: false,
          contextFallback:Boolean(reduced)&&!contextReduced,onContextFallback:()=>{contextReduced=true;},contextFallbackContent:reduced?.content,
          contextFallbackInstructions:reduced?aiInstructionBlock(usageKey,'structuredReview.contextReduction'):undefined });
      if (!response.ok) throw createLlmProviderError({ status: response.status, detail: await response.text() });
      const payload = await response.json();
      if (payload.choices?.[0]?.finish_reason === 'length') throw Object.assign(new Error('The model stopped before completing the review. Narrow the scope and retry.'), { code: 'AI_OUTPUT_TRUNCATED', statusCode: 502 });
      content=getCompletionContent(payload);
      const parsed = JSON.parse(content.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, ''));
      const result = validate(parsed);
      return { result, integration: { id: integration.id, name: integration.name, type: 'llm', model: payload.model || integration.model, direct_model_invocation: true },
        generation_mode: 'llm', fallback_used: false, context_reduced: contextReduced, model_execution: { model_calls: calls + 1, max_model_calls: 2, effective_model: payload.model || integration.model, usage: payload.usage || null, usage_scope:'accepted_response',input_hash:digest((contextReduced&&reduced?reduced:full).safe) } };
    } catch (error) {
      lastError = error;
      if (!(error instanceof SyntaxError || ['AI_REVIEW_INVALID','AI_INVALID_JSON','AI_OUTPUT_SCHEMA_VIOLATION','AI_MANAGED_SCHEMA_INVALID'].includes(error.code))) throw error;
      correction=repairInput(content || error.model_candidate,error);
    }
  }
  requireAiAssessment({ integration, failed: true });
  throw lastError;
}
const invalid = () => Object.assign(new Error('The model returned an unsupported review.'), { code: 'AI_REVIEW_INVALID', statusCode: 502 });
module.exports = { review, invalid };
