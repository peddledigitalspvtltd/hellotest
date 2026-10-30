const { inferAutomationStepType, normalizeTestStepType, normalizeRichText, parseJsonValue } = require('./testStepAutomation');

const AUTOMATION_CASE_TYPES = Object.freeze(['web', 'api', 'android', 'ios', 'unified']);
const ALLOWED_STEP_TYPES = Object.freeze({
  web: ['web', 'api'], api: ['api'], android: ['android', 'api'], ios: ['ios', 'api'],
  unified: ['web', 'api', 'android', 'ios']
});
const typeError = (message, code = 'AUTOMATION_CASE_TYPE_INVALID') => Object.assign(new Error(message), { statusCode: 422, code, nonRetryable: true });

function normalizeAutomationCaseType(value, { required = false } = {}) {
  if (value == null || value === '') {
    if (required) throw typeError('Select an automation case type: Web, API, Android, iOS or Unified.', 'AUTOMATION_CASE_TYPE_REQUIRED');
    return null;
  }
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!AUTOMATION_CASE_TYPES.includes(normalized)) throw typeError('Automation case type must be Web, API, Android, iOS or Unified.');
  return normalized;
}

function storedAutomationCaseType(testCase = {}) {
  const options = parseJsonValue(testCase.test_data_options, {}) || {};
  return normalizeAutomationCaseType(testCase.automation_case_type ?? options.automation_case_type);
}

// Old records have no platform choice. Their actual saved runtimes take
// precedence over application metadata until the user explicitly saves one.
function resolveAutomationCaseType(testCase = {}, { steps = [], appTypeKind } = {}) {
  const explicit = storedAutomationCaseType(testCase);
  if (explicit) return explicit;
  const application = normalizeAutomationCaseType(appTypeKind || testCase.app_type_kind || testCase.app_type?.type);
  const types = new Set(steps.map(step => inferAutomationStepType(step, { appTypeKind: application })));
  if (types.size === 1) return [...types][0];
  if (types.size && [...types].every(type => ['web', 'api'].includes(type))) return 'web';
  if (types.size && [...types].every(type => ['android', 'api'].includes(type))) return 'android';
  if (types.size && [...types].every(type => ['ios', 'api'].includes(type))) return 'ios';
  return types.size ? 'unified' : application || 'web';
}

function stepHasBrowserIntent(step) {
  const text = String(step.action || '').replace(/<[^>]+>/g, ' ');
  return /\b(?:browser|page|DOM|web(?:site|page)|getByRole|getByLabel|locator\s*\()\b/i.test(text)
    || /^(?:(?:Given|When|Then|And|But)\s+)?(?:(?:I|we)\s+)?(?:click|hover|scroll|navigate|browse|visit|open|fill|type|enter|select)\b/i.test(text.trim());
}

function automationStepType(step, automationCaseType) {
  const selected = normalizeAutomationCaseType(automationCaseType, { required: true });
  const saved = normalizeTestStepType(step.step_type);
  if (step.step_type != null && step.step_type !== '' && step.step_type !== 'manual' && !saved) throw Object.assign(typeError('The automation step uses an unsupported runtime. Select Web, API, Android or iOS.', 'AUTOMATION_STEP_TYPE_INVALID'), { step_id: step.id || null, step_type: step.step_type });
  const inferred = inferAutomationStepType(step);
  // API/native cases may contain the historical unimplemented Web default.
  // Interpret only that default; saved code and observable browser intent
  // must never be silently rewritten into HTTP requests or device actions.
  if (selected !== 'web' && selected !== 'unified' && (!saved || saved === 'web')
    && !normalizeRichText(step.automation_code) && !stepHasBrowserIntent(step)) {
    return inferred === 'api' ? 'api' : selected;
  }
  return inferred;
}

function resolveAutomationCaseSteps(testCase, steps = [], options = {}) {
  const type = resolveAutomationCaseType(testCase, { ...options, steps });
  const allowed = ALLOWED_STEP_TYPES[type];
  const resolved = steps.map(step => {
    const runtime = automationStepType(step, type);
    if (!allowed.includes(runtime)) {
      throw Object.assign(typeError(`Step ${step.step_order || steps.indexOf(step) + 1} uses ${runtime}, which is incompatible with an ${type} automation case. Change the step runtime or select Unified.`, 'AUTOMATION_CASE_TYPE_MISMATCH'), {
        step_id: step.id || null, step_type: runtime, automation_case_type: type,
        generation_provider_requests: 0, browser_actions: 0
      });
    }
    return { ...step, step_type: runtime };
  });
  return { automation_case_type: type, steps: resolved, allowed_step_types: allowed };
}

module.exports = { AUTOMATION_CASE_TYPES, ALLOWED_STEP_TYPES, normalizeAutomationCaseType, storedAutomationCaseType, resolveAutomationCaseType, automationStepType, resolveAutomationCaseSteps };
