import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require = createRequire(new URL('../../../platform/frontend/package.json', import.meta.url));
const ts = require('typescript');
const catalog = require('@hellotest/platform/shared/aiExecutionDefaults.json');
const tasks = JSON.parse(readFileSync(new URL('../../shared/workflowNativeTasks.json',import.meta.url),'utf8'));
const exports = {};
new Function('exports','require',ts.transpileModule(readFileSync(new URL('../../frontend/workflows/NodeAiConfiguration.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText)(exports,name=>{
  if(name==='@hellotest/platform/shared/aiExecutionDefaults.json')return {default:catalog};
  if(name==='../../shared/workflowNativeTasks.json')return {default:tasks};
  if(name.endsWith('.css'))return {};
  return require(name);
});

test('node defaults show the pinned agent model preferences and immutable definition bounds',()=>{
  const limits={max_model_calls:2,max_output_tokens:2048,timeout_ms:60000};
  const data={kind:'agent',agentId:'agent-saved',agentSnapshot:{definition:{ai_configuration:{temperature:0.7,context:{mode:'none',token_budget:1000,max_items:3,required:false,focus:''}},limits}}};
  const defaults=exports.nodeAiDefaults(data);
  assert.equal(defaults.temperature,0.7);assert.equal(defaults.context.mode,'none');
  assert.equal(defaults.max_output_tokens,2048);assert.equal(defaults.agent_execution.max_model_calls,2);
  assert.equal(defaults.agent_execution.timeout_ms,60000);assert.deepEqual(defaults.definition_limits,limits);
  const html=require('react-dom/server').renderToStaticMarkup(exports.NodeAiSettings({agent:true,defaults,
    value:{max_output_tokens:12000,agent_execution:{max_model_calls:8,max_revision_rounds:1,max_followups:2,timeout_ms:150000}},onChange:()=>{},onReviewCriteriaChange:()=>{}}));
  assert.match(html,/saved agent version limits this node to 2 model calls/);
  assert.match(html,/aria-label="Node maximum output tokens"[^>]*max="2048"[^>]*value="2048"/);
  assert.match(html,/aria-label="Node total model calls"[^>]*max="2"[^>]*value="2"/);
});

test('native case generation exposes its own application contract without a response-field schema example',()=>{
  const defaults=exports.nodeAiDefaults({kind:'artifactTask',artifactTask:'test-case-generation'});
  assert.ok(defaults.native_contract);
  const html=require('react-dom/server').renderToStaticMarkup(exports.NodeAiSettings({defaults,onChange:()=>{},onReviewCriteriaChange:()=>{}}));
  assert.match(html,/Required application contract/);assert.match(html,/cannot replace its native response contract/);
  assert.doesNotMatch(html,/required.*response.*placeholder/);
  assert.match(html,/placeholder="\{&quot;type&quot;:&quot;object&quot;\}"/);
});
