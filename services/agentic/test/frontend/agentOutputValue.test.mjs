import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../../platform/frontend/package.json', import.meta.url));
const ts = require('typescript');
function load(path, modules = {}) { const exports = {}; new Function('exports', 'require', ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(exports, name => modules[name] || (() => { throw Error(`Unexpected import ${name}`); })()); return exports; }
const { agentOutputText, agentOutputRows } = load('../../frontend/lib/agentOutputValue.ts');
const { validateAgentDefinition } = load('../../frontend/agents/agentDefinitionValidation.ts');
const definition = patch => ({ name: 'Reviewer', objective: 'Review evidence', required_inputs: [], skills: [], instructions: '', guardrails: '', allowed_tools: ['project_evidence'], acceptance: {require_evidence:true, minimum_findings:0}, limits:{timeout_ms:70000,max_model_calls:2,max_output_tokens:4000},...patch });
test('nested evidence is readable without object coercion or fabricated missing values', () => {
  assert.equal(agentOutputText({ test_case: { title: 'Sign in', priority: 'P2' }, evidence: [{ passed: false }, null], score: NaN }), 'Test case: Title: Sign in\nPriority: P2\nEvidence: Passed: No\nNot supplied\nScore: Not measured');
  assert.equal(agentOutputText(undefined), 'Not supplied');
  assert.equal(agentOutputText([]), 'No items');
  assert.equal(agentOutputText({}), 'No fields');
  const circular = {}; circular.self = circular;
  assert.match(agentOutputText(circular), /Nested data/);
  assert.doesNotMatch(agentOutputText(circular), /\[object Object\]/);
  const nested = Array.from({length:100},()=>Array.from({length:100},()=>({evidence:'Observed'})));
  assert.ok(agentOutputText(nested).length < 15000, 'large nested tool results use one shared display budget');
});
test('record tables retain heterogeneous fields and bound visual work without changing raw data', () => {
  const rows = Array.from({length:120}, (_,index) => ({id:index, ...(index === 1 ? {evidence:{url:'https://example.test/'}} : {})}));
  const result = agentOutputRows(rows);
  assert.equal(result.rows.length, 100); assert.deepEqual(result.columns, ['id','evidence']); assert.equal(rows.length,120);
  assert.equal(agentOutputRows([{title:'One'},'Two']),null);
});
test('custom agent authoring completion requires concrete drafts while legacy reviews remain valid', () => {
  assert.deepEqual(validateAgentDefinition(definition({})), []);
  for (const kind of ['story','test_case','defect','run','automation']) {
    assert.deepEqual(validateAgentDefinition(definition({output_contract:{kind,minimum_artifacts:1}})), []);
    assert.ok(validateAgentDefinition(definition({output_contract:{kind,minimum_artifacts:0}})).some(issue=>issue.tab==='completion'));
  }
  assert.ok(validateAgentDefinition(definition({output_contract:{kind:'review',minimum_artifacts:1}})).length);
  assert.ok(validateAgentDefinition(definition({output_contract:{kind:'unknown',minimum_artifacts:1}})).length);
});
