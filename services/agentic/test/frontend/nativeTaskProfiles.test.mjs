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

test('new Automation Engineer nodes explicitly perform steps while saved legacy nodes retain their prior action authority',()=>{
 const created=native.nativeTaskDefaults('automation-engineer');
 assert.equal(created.automationBrowserMode,'perform_steps');assert.equal(created.inspectBrowser,true);
 assert.equal(native.withNativeTaskDefaults({kind:'artifactTask',...created}).automationBrowserMode,'perform_steps');
 for(const [stored,mode]of[[{},'read_only'],[{inspectBrowser:true},'read_only'],[{inspectBrowser:false},'offline']]){
  const legacy={kind:'artifactTask',artifactTask:'automation-engineer',...stored},original=structuredClone(legacy);
  const hydrated=native.withNativeTaskDefaults(legacy);
  assert.equal(hydrated.automationBrowserMode,mode);
  assert.deepEqual(legacy,original,'Hydration does not modify the stored definition.');
  assert.equal(native.withNativeTaskDefaults(JSON.parse(JSON.stringify(hydrated))).automationBrowserMode,mode,'Saving and reopening must not silently grant interactive actions.');
 }
});

test('saved explicit browser modes survive hydration and guidance reset independently of the legacy inspection flag',()=>{
 for(const mode of ['perform_steps','read_only','offline']){
  const saved={kind:'artifactTask',artifactTask:'automation-engineer',automationBrowserMode:mode,inspectBrowser:mode==='offline',
   instructions:'Custom generation intent',automationCredentialId:'managed-credential',automationStartUrl:'https://application.example/'};
  const hydrated=native.withNativeTaskDefaults(saved);
  assert.equal(hydrated.automationBrowserMode,mode);
  const reset={...hydrated,...native.nativeTaskResetPatch('automation-engineer')};
  assert.equal(reset.automationBrowserMode,mode);assert.equal(reset.inspectBrowser,saved.inspectBrowser);
  assert.equal(reset.automationCredentialId,'managed-credential');assert.equal(reset.automationStartUrl,saved.automationStartUrl);
 }
});

test('other native tasks never inherit Automation Engineer browser action settings',()=>{
 for(const artifactTask of ['story-assurance','test-case-generation','test-case-assurance']){
  const defaults=native.nativeTaskDefaults(artifactTask),hydrated=native.withNativeTaskDefaults({kind:'artifactTask',artifactTask});
  assert.equal(Object.hasOwn(defaults,'automationBrowserMode'),false);
  assert.equal(Object.hasOwn(hydrated,'automationBrowserMode'),false);
 }
});

test('new assurance profiles preserve explicit decisions while saved guidance and accepted definitions remain unchanged',()=>{
 const defaults=native.nativeTaskDefaults('test-case-assurance');
 assert.match(defaults.instructions,/including @r and @t/);
 assert.match(defaults.instructions,/Preserve fixed expected values/);
 assert.match(defaults.guardrails,/optional environmental risks advisory/);
 assert.match(defaults.guardrails,/UI topology and expansion requirements supported only by the generated case/);
 assert.match(defaults.guardrails,/Do not require the case to embed Playwright code, browser fixture declarations, fixed sleeps or capture tooling/);
 assert.match(defaults.guardrails,/Preserve explicit infrastructure constraints and genuine unresolved custom capability or external fixture dependencies/);
 assert.match(native.nativeTaskDefaults('test-case-generation').guardrails,/without inventing same-tab\/new-tab rules/);
 const saved={kind:'artifactTask',artifactTask:'test-case-assurance',instructions:'Our accepted review instructions.',guardrails:'Reviewed guardrails.',
  llmIntegrationId:'saved-model',readinessPolicy:'require-ready',timeoutMs:'45000'};
 const original=structuredClone(saved),hydrated=native.withNativeTaskDefaults(Object.freeze(saved));
 assert.deepEqual(saved,original);
 assert.equal(hydrated.instructions,saved.instructions);assert.equal(hydrated.guardrails,saved.guardrails);
 assert.equal(hydrated.llmIntegrationId,saved.llmIntegrationId);assert.equal(hydrated.timeoutMs,saved.timeoutMs);
});
