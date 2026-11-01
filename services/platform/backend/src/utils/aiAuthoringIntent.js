const { splitGenerationContext } = require('./aiGenerationContext');
const { storyAiSnapshot, testCaseAiSnapshot } = require('./aiArtifactContext');
const { getCompletionContent } = require('./llmResponse');
const { parseAiJson } = require('./aiJsonResponse');
const { createLlmProviderError } = require('./upstreamLlmError');

const FEATURE = 'ai.authoring.request_validation';
const decisions = ['accept', 'out_of_scope', 'story_mismatch', 'needs_context'];
const validationSchema = {
  type: 'object', additionalProperties: false,
  required: ['decision', 'explanation', 'suggestions'],
  properties: {
    decision: { enum: decisions },
    explanation: { type: 'string', maxLength: 1000 },
    suggestions: { type: 'array', maxItems: 3, items: { type: 'string', maxLength: 300 } }
  }
};

// This checks authoring relevance only. The calling routes retain project,
// record and attachment authorization; a model verdict never grants access.
async function validateAuthoringIntent({ featureKey, integration, additionalContext, requirements = [], currentCase, images = [], externalLinks = [], fetchCompletion }) {
  const request = splitGenerationContext(additionalContext);
  const stories = requirements.filter(Boolean).map(story => storyAiSnapshot(story));
  const existing = currentCase ? testCaseAiSnapshot(currentCase) : null;
  const hasCase = existing && Boolean(existing.title || existing.description || existing.gherkin_document || existing.steps?.length);
  const hasEvidence = stories.length || hasCase || images.length || externalLinks.length || request.reviewed_context.length || request.selected_template.length;
  if (!request.user_request && !hasEvidence) {
    throw Object.assign(new Error('Describe the behavior to test, select a Story, provide an existing Test Case, or attach supporting evidence before generating Test Cases.'), { statusCode: 422, code: 'AI_AUTHORING_CONTEXT_REQUIRED' });
  }
  // Empty guidance with a Story/current case is an ordinary feature request.
  if (!request.user_request) return;

  const base = String(integration.base_url || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const response = await fetchCompletion(/\/chat\/completions$/i.test(base) ? base : `${base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(integration.api_key ? { Authorization: `Bearer ${integration.api_key}` } : {}) },
    body: JSON.stringify({ model: integration.model, response_format: { type: 'json_object' }, messages: [
      { role: 'user', content: JSON.stringify({ application_contract: { output_schema: validationSchema }, feature: featureKey,
        user_request: request.user_request, stories, current_case: existing,
        evidence_available: Boolean(hasEvidence),
        // Evidence cannot supply instructions that approve its own relevance.
        reviewed_context: request.reviewed_context, selected_template: request.selected_template,
        reference_images: images.map(image => ({ name: image.name })), external_references: externalLinks.map(url => ({ url, content_retrieved: false })) }) }
    ] })
  }, { integration, operation: 'authoring.validate-request', featureKey: FEATURE, contextFallback: false, maxOutputTokens: 700 });
  if (!response.ok) throw createLlmProviderError({ status: response.status, headers: response.headers, detail: await response.text() });
  let verdict;
  try { verdict = parseAiJson(getCompletionContent(await response.json())); } catch { /* handled by the closed contract below */ }
  if (!verdict || Object.keys(verdict).some(key => !['decision', 'explanation', 'suggestions'].includes(key)) || !decisions.includes(verdict.decision) || typeof verdict.explanation !== 'string' || verdict.explanation.length > 1000
    || !Array.isArray(verdict.suggestions) || verdict.suggestions.length > 3 || verdict.suggestions.some(value => typeof value !== 'string' || value.length > 300)
    || (verdict.decision === 'story_mismatch' && !stories.length)) {
    throw Object.assign(new Error('AI could not validate the authoring request. Retry your request; no Test Cases were generated.'), { statusCode: 502, code: 'AI_AUTHORING_VALIDATION_FAILED' });
  }
  if (verdict.decision === 'accept') return;
  const guidance = verdict.suggestions.filter(Boolean).join(' ');
  const message = verdict.decision === 'story_mismatch'
    ? `Your instructions do not match the selected Story${stories.length > 1 ? ' scope' : ` “${String(stories[0].title || 'Untitled').slice(0, 160)}”`}. Select a matching Story, remove the selection, or adjust the instructions.`
    : verdict.decision === 'needs_context'
      ? 'Add the behavior, expected outcome, or supporting evidence you want the Test Cases to cover.'
      : 'This AI feature creates or improves Test Cases. Describe the testing task you want to complete.';
  throw Object.assign(new Error([message, verdict.explanation, guidance].filter(Boolean).join(' ')), {
    statusCode: 422, code: verdict.decision === 'story_mismatch' ? 'AI_AUTHORING_STORY_MISMATCH' : verdict.decision === 'needs_context' ? 'AI_AUTHORING_CONTEXT_REQUIRED' : 'AI_AUTHORING_TASK_MISMATCH'
  });
}

module.exports = { validateAuthoringIntent, validationSchema, FEATURE };
