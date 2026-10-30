import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';

const require = createRequire(new URL('../../../platform/frontend/package.json', import.meta.url));
const ts = require('typescript');
const profiles = JSON.parse(readFileSync(new URL('../../shared/workflowNativeTasks.json', import.meta.url), 'utf8'));
const native = {};
new Function('require', 'exports', ts.transpileModule(readFileSync(new URL('../../frontend/workflows/nativeTaskProfiles.ts', import.meta.url), 'utf8'), {
  compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true},
}).outputText)(() => profiles, native);
const {generationOptions, pinnedGenerationOptions} = createRequire(import.meta.url)('../../backend/workflows/generationNodeOptions');

test('restoring generator defaults clears saved and legacy coverage guidance without changing execution settings', () => {
  const trigger = {generation_instructions: 'NFR_ONLY', max_cases_per_story: 2, authoring_mode: 'structured'};
  const settings = {maxCasesPerStory: 7, authoringMode: 'gherkin', llmIntegrationId: 'project-model',
    connectionId: 'saved-connection', automationCredentialId: 'protected-credential', timeoutMs: '120000', retryCount: '1'};
  for (const stored of [{generationInstructions: 'NFR_ONLY'}, {}]) {
    const saved = {kind: 'artifactTask', artifactTask: 'test-case-generation', task: 'NFR_ONLY', instructions: 'NFR_ONLY',
      guardrails: 'Custom coverage', prompt: 'NFR_ONLY', ...settings, ...stored};
    const original = structuredClone(saved);
    assert.equal(generationOptions(saved, trigger).instructions, 'NFR_ONLY');
    const reset = {...saved, ...native.nativeTaskResetPatch('test-case-generation')};
    assert.deepEqual(saved, original, 'Preparing the reset does not change the saved definition');
    assert.equal(reset.task, profiles['test-case-generation'].task);
    assert.equal(reset.instructions, profiles['test-case-generation'].instructions);
    assert.equal(reset.guardrails, profiles['test-case-generation'].guardrails);
    assert.equal(reset.prompt, '');
    assert.equal(reset.generationInstructions, '');
    for (const [key, value] of Object.entries(settings)) assert.equal(reset[key], value);
    // Saving, reopening and snapshotting must retain an explicit blank. Deleting
    // this property would resurrect the old trigger's NFR-only instruction.
    const reopened = native.withNativeTaskDefaults(JSON.parse(JSON.stringify(reset)));
    assert.deepEqual(pinnedGenerationOptions({workflow_snapshot: {nodes: [{data: reopened}]}, input_payload: trigger}),
      {maxCases: 7, authoringMode: 'gherkin', instructions: ''});
  }
});

test('guidance reset leaves other task settings alone and hydration preserves custom saved prompts', () => {
  const saved = {kind: 'artifactTask', artifactTask: 'automation-engineer', task: 'Custom task', prompt: 'Custom legacy instructions',
    guardrails: '', inspectBrowser: false, readinessPolicy: 'require-ready', automationData: '{"region":"EU"}'};
  const hydrated = native.withNativeTaskDefaults(saved);
  assert.equal(hydrated.task, saved.task);
  assert.equal(hydrated.instructions, saved.prompt);
  assert.equal(hydrated.guardrails, '');
  const patch = native.nativeTaskResetPatch('automation-engineer');
  assert.deepEqual(Object.keys(patch).sort(), ['guardrails', 'instructions', 'prompt', 'task']);
  const reset = {...saved, ...patch};
  for (const key of ['inspectBrowser', 'readinessPolicy', 'automationData']) assert.equal(reset[key], saved[key]);
});
