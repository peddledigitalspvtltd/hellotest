import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../../platform/frontend/package.json', import.meta.url));
const ts = require('typescript');
function load(path) {
  const exports = {};
  new Function('exports', ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText)(exports);
  return exports;
}
const history = load('../../frontend/workflows/workflowHistory.ts');
const validation = load('../../frontend/agents/agentDefinitionValidation.ts');
const node = (id, x = 0) => ({ id, position: { x, y: 0 }, data: { kind: 'agent', prompt: 'Review evidence' } });
const graph = (nodes = [], edges = []) => history.snapshotWorkflowGraph(nodes, edges);

test('undo restores deleted steps and their connections; redo and branched edits preserve graph integrity', () => {
  const source = graph([node('first'), node('second')], [{ id: 'link', source: 'first', target: 'second' }]);
  let state = history.createWorkflowHistory(source);
  state = history.recordWorkflowGraph(state, graph([node('first')], []));
  state = history.undoWorkflowGraph(state);
  assert.deepEqual(state.present, source);
  state = history.redoWorkflowGraph(state);
  assert.equal(state.present.nodes.length, 1);
  state = history.undoWorkflowGraph(state);
  state = history.recordWorkflowGraph(state, graph([node('first'), node('second', 300)], source.edges));
  assert.equal(state.future.length, 0, 'editing after undo discards the obsolete redo branch');
  assert.equal(state.present.edges[0].target, 'second');
  assert.equal(history.redoWorkflowGraph(state), state);
});

test('selection and measurements cannot consume undo steps or corrupt stored snapshots', () => {
  const first = graph([node('step')]);
  const uiChange = graph([{ ...node('step'), selected: true, dragging: true, measured: { width: 236, height: 94 } }]);
  assert.deepEqual(uiChange, first);
  const original = [node('step')];
  const snapshot = graph(original);
  original[0].data.prompt = 'Changed';
  assert.equal(snapshot.nodes[0].data.prompt, 'Review evidence');
  assert.equal(history.recordWorkflowGraph(history.createWorkflowHistory(first), uiChange).past.length, 0);
});

test('history stays bounded across long editing sessions and retains the most recent moves', () => {
  let state = history.createWorkflowHistory(graph([node('step')]));
  for (let index = 1; index <= 60; index++) state = history.recordWorkflowGraph(state, graph([node('step', index)]));
  assert.equal(state.past.length, 40);
  state = history.undoWorkflowGraph(state);
  assert.equal(state.present.nodes[0].position.x, 59);
  state = history.redoWorkflowGraph(state);
  assert.equal(state.present.nodes[0].position.x, 60);
});

test('workflow input refuses arrays, scalars, malformed JSON and preserves structured input', () => {
  for (const input of ['[]', 'null', '42', '"task"', '{"request":']) assert.ok(history.validateWorkflowInput(input).error, input);
  const valid = history.validateWorkflowInput('{"source":{"repository_url":"https://github.com/owner/repo"},"request":"Review"}');
  assert.equal(valid.error, ''); assert.equal(valid.value.source.repository_url, 'https://github.com/owner/repo');
});

const definition = () => ({ name: 'Release reviewer', objective: 'Review release evidence.', instructions: '', required_inputs: ['release_id'], skills: [], allowed_tools: ['project_evidence'], guardrails: '', acceptance: { require_evidence: true, no_evidence_gaps: false, minimum_findings: 0 }, limits: { timeout_ms: 70000, max_model_calls: 2, max_output_tokens: 4000 } });
test('agent builder flags invalid limits, input identifiers and evidence rules before a network save', () => {
  assert.deepEqual(validation.validateAgentDefinition(definition()), []);
  for (const required_inputs of [['constructor'], ['release-id'], ['1release']]) assert.equal(validation.validateAgentDefinition({ ...definition(), required_inputs })[0].tab, 'skills');
  for (const max_output_tokens of [0, 8001, 12.5, NaN]) assert.equal(validation.validateAgentDefinition({ ...definition(), limits: { ...definition().limits, max_output_tokens } })[0].tab, 'completion');
  assert.equal(validation.validateAgentDefinition({ ...definition(), allowed_tools: [], required_inputs: [] })[0].tab, 'skills');
  assert.equal(validation.validateAgentDefinition({ ...definition(), objective: 'x'.repeat(2000), instructions: 'x'.repeat(3000) })[0].tab, 'skills');
});
