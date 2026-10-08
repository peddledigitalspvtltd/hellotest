const { aiInstructionBlock } = require('@hellotest/platform/backend/src/utils/aiInstructionBlocks');
const { createHash } = require('crypto');
const selection = require('@hellotest/integration/backend/services/aiLlmSelection.service');
const { fetchLlmWithRetry } = require('@hellotest/platform/backend/src/utils/llmHttpClient');
const { getCompletionContent } = require('@hellotest/platform/backend/src/utils/llmResponse');
const { sanitizeAiText } = require('@hellotest/platform/backend/src/security/aiTextPolicy');
const { requireAiAssessment } = require('@hellotest/platform/backend/src/utils/requireAiAssessment');
const { createLlmProviderError } = require('@hellotest/platform/backend/src/utils/upstreamLlmError');

async function review({ projectId, userId, integrationId, usageKey, task, evidence, contract, validate, signal }) {
  const integration = await selection.resolveLlmIntegrationForUsage({ projectId, userId, integrationId, usageKey, fallback: 'project-then-global', allowMissing: true });
  requireAiAssessment({ integration });
  const input = JSON.stringify(evidence);
  if (Buffer.byteLength(input) > 48000) throw Object.assign(new Error('Select a smaller evidence scope for this AI review.'), { statusCode: 422, code: 'AI_INPUT_BUDGET_EXCEEDED' });
  const safe = sanitizeAiText(input).text;
  const prompt = ["",String(task),aiInstructionBlock("ai.quality.portfolio_insights", "structuredReview.service.prompt.segment.1"),String(contract),aiInstructionBlock("ai.quality.portfolio_insights", "structuredReview.service.prompt.segment.2"),String(safe),""].join('');
  const base = String(integration.base_url || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const deadline = Date.now() + 60000;
  let lastError, calls = 0;
  for (; calls < 2; calls++) {
    const remaining = deadline - Date.now();
    if (remaining < 1000) break;
    try {
      const response = await fetchLlmWithRetry(/\/chat\/completions$/.test(base) ? base : `${base}/chat/completions`, { method: 'POST', signal,
        headers: { 'Content-Type': 'application/json', ...(integration.api_key ? { Authorization: `Bearer ${integration.api_key}` } : {}) },
        body: JSON.stringify({ model: integration.model,  response_format: { type: 'json_object' }, messages: [
          { role: 'system', content: aiInstructionBlock("ai.quality.portfolio_insights", "structuredReview.response.1") },
          { role: 'user', content: prompt + (calls ? '\nThe previous response failed the contract. Correct its shape and use only the exact supplied evidence references.' : '') }
        ] }) }, { integration, operation: usageKey, timeoutMs: remaining, maxAttempts: 1, maxOutputTokens: 3500, compatibility: false, contextFallback: false });
      if (!response.ok) throw createLlmProviderError({ status: response.status, detail: await response.text() });
      const payload = await response.json();
      if (payload.choices?.[0]?.finish_reason === 'length') throw Object.assign(new Error('The model stopped before completing the review. Narrow the scope and retry.'), { code: 'AI_OUTPUT_TRUNCATED', statusCode: 502 });
      const parsed = JSON.parse(getCompletionContent(payload).trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, ''));
      const result = validate(parsed);
      return { result, integration: { id: integration.id, name: integration.name, type: 'llm', model: payload.model || integration.model, direct_model_invocation: true },
        generation_mode: 'llm', fallback_used: false, model_execution: { model_calls: calls + 1, max_model_calls: 2, effective_model: payload.model || integration.model, usage: payload.usage || null, input_hash: createHash('sha256').update(safe).digest('hex') } };
    } catch (error) {
      lastError = error;
      if (!(error instanceof SyntaxError || error.code === 'AI_REVIEW_INVALID')) throw error;
    }
  }
  requireAiAssessment({ integration, failed: true });
  throw lastError;
}
const invalid = () => Object.assign(new Error('The model returned an unsupported review.'), { code: 'AI_REVIEW_INVALID', statusCode: 502 });
module.exports = { review, invalid };
