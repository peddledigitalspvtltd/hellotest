import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../../platform/frontend/package.json', import.meta.url));
const ts = require('typescript');
const input = {};
new Function('exports', ts.transpileModule(readFileSync(new URL('../../frontend/workflows/sprintAutomatorInput.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText)(input);

test('reopening Sprint configuration retains selected scope while excluding arbitrary credentials and foreign scope', () => {
  const saved = input.sprintInputDefaults({ sprint_id: 'saved-sprint', integration_id: 'model', max_cases_per_story: 2,
    authoring_mode: 'gherkin', automation_start_url: '', generation_instructions: 'Use the declared API contract.',
    api_key: 'secret', authorization: 'Bearer secret', project_id: 'foreign', source: { secret: 'secret' } });
  const restored = JSON.parse(input.restoredSprintInput({ sprint_input_defaults: saved }));
  assert.equal(restored.sprint_id, 'saved-sprint');
  assert.equal(restored.authoring_mode, 'gherkin');
  assert.equal(restored.max_cases_per_story, 2);
  assert.doesNotMatch(JSON.stringify(saved), /secret|foreign|authorization|api_key/);
  assert.deepEqual(restored, saved);
});

test('malformed saved configuration falls back to complete editable template inputs', () => {
  assert.deepEqual(JSON.parse(input.restoredSprintInput({ sprint_input_defaults: [] })), input.SPRINT_INPUT_DEFAULTS);
  const restored = JSON.parse(input.restoredSprintInput({ sprint_input_defaults: { sprint_id: {}, max_cases_per_story: '100' } }));
  assert.equal(restored.sprint_id, ''); assert.equal(restored.max_cases_per_story, 5);
});
