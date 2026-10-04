// Product AI actions must never report a successful local fallback as a model assessment.
// Deterministic metrics and manual authoring remain available through their ordinary paths.
function requireAiAssessment({ integration, failed = false, accepted = true } = {}) {
  if (!integration || integration.is_active === false || !String(integration.model || '').trim()) {
    const message = 'Configure an active LLM with a model in Integrations, then retry this AI action.';
    throw Object.assign(new Error(message), { statusCode: 422, code: 'AI_MODEL_REQUIRED', publicMessage: message });
  }
  if (failed || !accepted) {
    const message = 'The model did not complete a valid evidence-backed assessment. Your saved work is unchanged. Retry or select another configured LLM.';
    throw Object.assign(new Error(message), { statusCode: 502, code: 'AI_ASSESSMENT_FAILED', publicMessage: message });
  }
  return integration;
}
module.exports = { requireAiAssessment };
