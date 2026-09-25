import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../../platform/frontend/package.json', import.meta.url));
const ts = require('typescript');
const graph = {};
new Function('require', 'exports', ts.transpileModule(readFileSync(new URL('../../frontend/workflows/workflowGraph.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText)(name => name === '@xyflow/react' ? { MarkerType: { ArrowClosed: 'arrowclosed' } } : { isRovoIntegrationId: value => value.startsWith('rovo:') }, graph);

test('opening an intentionally empty or disconnected saved definition never invents default nodes or edges', () => {
  const draft = graph.createWorkflowDraft({ id: 'empty', name: 'Empty workflow', nodes: [], edges: [], settings: {}, status: 'draft', trigger_kind: 'manual' });
  assert.deepEqual(draft.nodes, []); assert.deepEqual(draft.edges, []);
  const disconnected = graph.createWorkflowDraft({ ...draft, nodes: [{ id: 'one', position: {x:0,y:0}, data: {kind:'trigger'} }] });
  assert.equal(disconnected.nodes.length, 1); assert.deepEqual(disconnected.edges, []);
});

test('arrange follows dependencies and keeps parallel branches in separate rows', () => {
  const nodes = ['output','right','trigger','left'].map(id => ({ id, position:{x:0,y:0},data:{kind:'agent'} }));
  const edges = [{source:'trigger',target:'left'},{source:'trigger',target:'right'},{source:'left',target:'output'},{source:'right',target:'output'}];
  const arranged = Object.fromEntries(graph.layoutWorkflow(nodes,edges).map(node=>[node.id,node.position]));
  assert.ok(arranged.trigger.x < arranged.left.x && arranged.left.x < arranged.output.x);
  assert.equal(arranged.left.x,arranged.right.x); assert.notEqual(arranged.left.y,arranged.right.y);
  assert.equal(nodes[0].position.x,0,'layout does not mutate the saved snapshot');
});

test('saved output becomes stale after input, connections, settings or task changes, but not a canvas move', () => {
  const draft = graph.createWorkflowDraft();
  const run = { workflow_snapshot: structuredClone(draft), input_payload:{scope:'Checkout'} };
  const matches = (nodes=draft.nodes,edges=draft.edges,input='{"scope":"Checkout"}',definition=draft) => graph.runMatchesDraft(run,definition,nodes,edges,input);
  assert.equal(matches(),true);
  assert.equal(matches(draft.nodes.map(node=>({...node,position:{x:0,y:0}}))),true);
  assert.equal(matches(draft.nodes,draft.edges,'{ "scope": "Billing" }'),false);
  assert.equal(matches(draft.nodes,draft.edges,'invalid JSON'),false);
  assert.equal(matches(draft.nodes,draft.edges.slice(1)),false);
  assert.equal(matches(draft.nodes.map(node=>({...node,data:{...node.data,prompt:'Changed'}}))),false);
  assert.equal(matches(draft.nodes,draft.edges,'{"scope":"Checkout"}',{...draft,settings:{requiresApproval:true}}),false);
});
