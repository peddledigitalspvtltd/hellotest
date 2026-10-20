const { normalizeTestStepType } = require('./testStepAutomation');

function normalizeAutomationStartUrl(value, { required = false } = {}) {
  const missing = value == null || typeof value === 'string' && !value.trim();
  if (missing) {
    if (required) throw Object.assign(new Error('Enter a Start URL before creating or generating browser automation.'), { statusCode: 400, code: 'AUTOMATION_START_URL_REQUIRED' });
    return null;
  }
  const invalid = () => Object.assign(new Error('Start URL must be a complete HTTP or HTTPS address without credentials or parameter placeholders.'), { statusCode: 400, code: 'AUTOMATION_START_URL_INVALID' });
  if (typeof value !== 'string' || value.length > 2000 || /[\u0000-\u001f\u007f]|\$\{|@[tserc]\./i.test(value)) throw invalid();
  let url;
  try { url = new URL(value.trim()); } catch { throw invalid(); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !url.hostname) throw invalid();
  return url.href;
}

function requiresAutomationStartUrl({ appTypeKind, steps = [] } = {}) {
  if (steps.length) return steps.some(step => normalizeTestStepType(step.step_type, 'web') === 'web');
  return !['api', 'android', 'ios', 'mobile'].includes(String(appTypeKind || '').toLowerCase());
}

module.exports = { normalizeAutomationStartUrl, requiresAutomationStartUrl };
