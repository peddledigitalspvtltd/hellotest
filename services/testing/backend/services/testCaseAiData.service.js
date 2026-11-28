const aiData = require('@hellotest/ai/services/aiTestDataGeneration');
const { normalizeParameterKey } = require('@hellotest/platform/backend/src/utils/stepParameterResolution');

const intentMarker = /\{\{\s*aiData\b/i;
const tokenPattern = /\{\{\s*aiData\s*(?::([^{}]*))?\}\}/gi;
const protectedName = /password|passwd|secret|token|credential|api.?key|authorization|cookie|session|passcode|(?:^|[._ -])pin(?:$|[._ -])|otp|verification.?code|one.?time.?code/i;
const invalid = message => Object.assign(new Error(message), { statusCode: 422, code: 'TEST_DATA_AI_TEMPLATE_INVALID' });

async function resolve(values, { projectId, appTypeId, userId, privateParameterNames = [], authorize }) {
  if (!values || !Object.values(values).some(value => typeof value === 'string' && intentMarker.test(value))) return values;
  if (!projectId) throw invalid('Select a project to generate AI test data.');
  await authorize();
  const hidden = new Set(privateParameterNames.map(name => normalizeParameterKey(name, 't')));
  const entries = Object.entries(values).map(([name, value]) => {
    if (typeof value !== 'string' || !intentMarker.test(value)) return { name, value, tokens: [] };
    if (hidden.has(normalizeParameterKey(name, 't')) || protectedName.test(name)) {
      throw invalid('Use an explicit protected value for a private test parameter.');
    }
    const tokens = [...value.matchAll(tokenPattern)].map(token => ({ token: token[0], start: token.index, intent: token[1]?.trim() || '' }));
    if (!tokens.length || intentMarker.test(value.replace(tokenPattern, '')) || tokens.some(token => token.intent.length < 3 || token.intent.length > 2_000)) {
      throw invalid('Describe the test data after aiData: and close the template with }}.');
    }
    return { name, value, tokens };
  });

  const resolved = [];
  for (const { name, value, tokens } of entries) {
    const templates = new Map();
    let output = '', offset = 0;
    for (const { token, start, intent } of tokens) {
      if (!templates.has(intent)) {
        const preview = await aiData.preview({ projectId, appTypeId, userId, prompt: intent, fieldContext: name, sampleCount: 8 });
        if (preview.generation_mode !== 'llm' || preview.fallback_used || !preview.randomized_template) {
          throw invalid('The configured LLM did not return test data. Try generating again.');
        }
        templates.set(intent, preview.randomized_template);
      }
      output += value.slice(offset, start) + templates.get(intent);
      offset = start + token.length;
    }
    resolved.push([name, tokens.length ? output + value.slice(offset) : value]);
  }
  return Object.fromEntries(resolved);
}

module.exports = { resolve };
