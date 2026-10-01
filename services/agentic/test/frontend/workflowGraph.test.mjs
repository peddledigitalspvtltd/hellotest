import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../../platform/frontend/package.json', import.meta.url));
const ts = require('typescript');
const profiles = {};
new Function('require', 'exports', ts.transpileModule(readFileSync(new URL('../../frontend/workflows/specialistProfiles.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
}).outputText)(() => JSON.parse(readFileSync(new URL('../../shared/workflowSpecialists.json', import.meta.url), 'utf8')), profiles);
const graph = {};
new Function('require', 'exports', ts.transpileModule(readFileSync(new URL('../../frontend/workflows/workflowGraph.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText)(name => name === './specialistProfiles' ? profiles : name === '@xyflow/react' ? { MarkerType: { ArrowClosed: 'arrowclosed' } } : { isRovoIntegrationId: value => value.startsWith('rovo:') }, graph);

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

test('blank workflows start with one trigger and node insertion preserves the downstream graph', () => {
  const first = graph.insertWorkflowNode([], [], 'customAI');
  assert.equal(first.node.data.kind, 'trigger');
  assert.throws(() => graph.insertWorkflowNode(first.nodes, [], 'trigger'), /already/);
  const second = graph.insertWorkflowNode(first.nodes, [], 'customAI', { sourceId: first.node.id });
  const third = graph.insertWorkflowNode(second.nodes, second.edges, 'output', { sourceId: second.node.id });
  const inserted = graph.insertWorkflowNode(third.nodes, third.edges, 'transform', { edgeId: third.edges[1].id });
  assert.ok(inserted.edges.some(edge => edge.source === second.node.id && edge.target === inserted.node.id));
  assert.ok(inserted.edges.some(edge => edge.source === inserted.node.id && edge.target === third.node.id));
  assert.ok(inserted.nodes.find(node => node.id === third.node.id).position.x > third.node.position.x);
});

test('inserting in a false branch preserves true routing and error recovery', () => {
  const nodes = ['trigger', 'check', 'yes', 'no', 'recover'].map(id => ({ id, position: {x:0,y:0}, data: {kind: id === 'check' ? 'condition' : id === 'recover' ? 'errorHandler' : 'transform'} }));
  const edges = [{id:'true', source:'check',target:'yes',sourceHandle:'true'}, {id:'false',source:'check',target:'no',sourceHandle:'false'}, {id:'error',source:'no',target:'recover'}];
  const inserted = graph.insertWorkflowNode(nodes, edges, 'log', {edgeId:'false'});
  assert.deepEqual(inserted.edges.find(edge => edge.id === 'true'),edges[0]);
  assert.equal(inserted.edges.find(edge => edge.target === inserted.node.id).sourceHandle,'false');
  assert.equal(inserted.edges.find(edge => edge.target === 'no').sourceHandle,null);
  assert.deepEqual(inserted.edges.find(edge => edge.id === 'error'),edges[2]);
  const recovery = graph.insertWorkflowNode(nodes, edges, 'errorHandler', {sourceId:'yes'});
  assert.equal(recovery.nodes.find(node => node.id === 'yes').data.onError,'errorOutput');
  assert.throws(() => graph.insertWorkflowNode(nodes, edges, 'log', {sourceId:'check'}), /branch/);
});

test('repeated nodes receive unique output labels without renaming saved nodes', () => {
  for (const kind of ['aggregator', 'errorHandler', 'log']) {
    let draft = graph.insertWorkflowNode([], [], 'trigger');
    draft = graph.insertWorkflowNode(draft.nodes, draft.edges, kind);
    const original = draft.node.data.outputKey;
    const second = graph.insertWorkflowNode(draft.nodes, draft.edges, kind);
    assert.notEqual(second.node.data.outputKey, original);
    assert.equal(second.nodes.find(node => node.id === draft.node.id).data.outputKey, original);
    const third = graph.insertWorkflowNode(second.nodes, second.edges, kind);
    assert.equal(new Set(third.nodes.map(node => node.data.outputKey)).size, third.nodes.length);
  }
});

test('connections reject cycles, duplicate edges, incoming triggers and outgoing outputs', () => {
  const nodes = ['trigger','transform','output'].map(id=>({id,position:{x:0,y:0},data:{kind:id}}));
  const edges = [{source:'trigger',target:'transform'}];
  assert.equal(graph.canConnectWorkflow(nodes,edges,'transform','output'),true);
  for (const [from,to] of [['output','transform'],['transform','trigger'],['transform','transform'],['trigger','transform']]) assert.equal(graph.canConnectWorkflow(nodes,edges,from,to),false);
  const plain = nodes.map(node=>({...node,data:{kind:'transform'}}));
  assert.equal(graph.canConnectWorkflow(plain,edges,'transform','trigger'),false);
});

test('every specialist profile supplies independent editable skills, tools and context', () => {
  for (const id of Object.keys(profiles.specialistProfiles)) {
    const one = profiles.specialistDefaults(id), two = profiles.specialistDefaults(id);
    assert.ok(one.skills.length && one.prompt && one.knowledgeScope);
    assert.deepEqual(one.allowedTools,['project_evidence','knowledge_search']);
    one.skills[0].instructions='Changed'; one.allowedTools.pop();
    assert.notEqual(two.skills[0].instructions,'Changed'); assert.equal(two.allowedTools.length,2);
  }
});
