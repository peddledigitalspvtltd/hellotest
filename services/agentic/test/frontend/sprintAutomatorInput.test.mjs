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
const nodes = [
  {id:'source',data:{kind:'apiTool',apiResource:'sprintStories'}},
  {id:'generation',data:{kind:'artifactTask',artifactTask:'test-case-generation'}},
  {id:'automation',data:{kind:'artifactTask',artifactTask:'automation-engineer'}},
];

test('new Sprint input persists only scope, excluding task settings and arbitrary credentials', () => {
  const saved = input.sprintInputDefaults({ sprint_id: 'saved-sprint', integration_id: 'model', max_cases_per_story: 2,
    authoring_mode: 'gherkin', api_key: 'secret', authorization: 'Bearer secret', project_id: 'foreign' });
  assert.deepEqual(saved, {sprint_id:'saved-sprint'});
  assert.deepEqual(JSON.parse(input.restoredSprintInput({sprint_input_defaults:saved})),saved);
  assert.deepEqual(JSON.parse(input.restoredSprintInput({sprint_input_defaults:[]})),input.SPRINT_INPUT_DEFAULTS);
});

test('legacy settings move into owning nodes without dropping customized settings or other trigger data', () => {
  const legacy={sprint_id:'sprint-a',integration_id:'model-a',max_cases_per_story:7,authoring_mode:'gherkin',automation_start_url:'https://app.example',generation_instructions:'Custom coverage.'};
  const restored=JSON.parse(input.restoredSprintInput({sprint_input_defaults:{...legacy,api_key:'secret'}}));
  assert.deepEqual(restored,legacy);
  const migrated=input.migrateSprintConfiguration(nodes,{...restored,request:'Keep this custom trigger field.'});
  assert.deepEqual(migrated.input,{sprint_id:'sprint-a',request:'Keep this custom trigger field.'});
  assert.deepEqual(migrated.nodes[1].data,{kind:'artifactTask',artifactTask:'test-case-generation',llmIntegrationId:'model-a',maxCasesPerStory:7,authoringMode:'gherkin',generationInstructions:'Custom coverage.'});
  assert.equal(migrated.nodes[2].data.automationStartUrl,'https://app.example');
  assert.equal(nodes[1].data.llmIntegrationId,undefined,'input graph is not mutated');
  const customized=structuredClone(nodes);
  customized[1].data={...customized[1].data,llmIntegrationId:'node-model',maxCasesPerStory:2,authoringMode:'structured',generationInstructions:''};
  customized[2].data.automationStartUrl='';
  const again=input.migrateSprintConfiguration(customized,legacy);
  assert.deepEqual(again.nodes[1].data,customized[1].data,'explicit empty strings and customized nodes win over legacy trigger defaults');
  assert.equal(again.nodes[2].data.automationStartUrl,'');
  customized[1].data.llmIntegrationId='';
  assert.equal(input.migrateSprintConfiguration(customized,legacy).nodes[1].data.llmIntegrationId,'model-a','Legacy empty model inherited the trigger model');
  assert.equal(input.migrateSprintConfiguration(customized,{sprint_id:'a'}).nodes[1].data.llmIntegrationId,'','After migration an empty node model uses the project default');
});

test('scope-only templates get per-node defaults and unrelated workflow inputs are untouched',()=>{
  const migrated=input.migrateSprintConfiguration(nodes,{sprint_id:'a'});
  assert.equal(migrated.nodes[1].data.maxCasesPerStory,5);
  assert.equal(migrated.nodes[1].data.authoringMode,'structured');
  assert.equal(migrated.nodes[1].data.generationInstructions,'');
  assert.deepEqual(input.migrateSprintConfiguration([],{integration_id:'custom'}),{nodes:[],input:{integration_id:'custom'}});
});
