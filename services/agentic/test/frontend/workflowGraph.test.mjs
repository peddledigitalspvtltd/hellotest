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
const nativeProfiles = {};
new Function('require', 'exports', ts.transpileModule(readFileSync(new URL('../../frontend/workflows/nativeTaskProfiles.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
}).outputText)(() => JSON.parse(readFileSync(new URL('../../shared/workflowNativeTasks.json', import.meta.url), 'utf8')), nativeProfiles);
const dataProfiles = {};
new Function('require', 'exports', ts.transpileModule(readFileSync(new URL('../../frontend/workflows/dataOperationProfiles.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
}).outputText)(() => JSON.parse(readFileSync(new URL('../../shared/workflowDataOperations.json', import.meta.url), 'utf8')), dataProfiles);
const graph = {};
new Function('require', 'exports', ts.transpileModule(readFileSync(new URL('../../frontend/workflows/workflowGraph.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText)(name => name === './specialistProfiles' ? profiles : name === './nativeTaskProfiles' ? nativeProfiles : name === './dataOperationProfiles' ? dataProfiles : name === '@xyflow/react' ? { MarkerType: { ArrowClosed: 'arrowclosed' } } : { isRovoIntegrationId: value => value.startsWith('rovo:') }, graph);

test('Sprint template snapshots the correct editable intent for each native task', () => {
  const templates = {};
  new Function('require', 'exports', ts.transpileModule(readFileSync(new URL('../../frontend/workflows/workflowTemplates.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText)(name => name === './workflowGraph' ? graph : name === './nativeTaskProfiles' ? nativeProfiles : profiles, templates);
  const { draft } = templates.draftFromTemplate(templates.WORKFLOW_TEMPLATES.find(item => item.id === 'sprint-automator'));
  const tasks = draft.nodes.filter(node => node.data.kind === 'artifactTask');
  assert.equal(tasks.length, 4);
  assert.equal(new Set(tasks.map(node => node.data.task)).size, 4);
  for (const {data} of tasks) {
    const profile = nativeProfiles.nativeTaskProfiles[data.artifactTask];
    assert.equal(data.task, profile.task);
    assert.equal(data.instructions, profile.instructions);
    assert.equal(data.guardrails, profile.guardrails);
  }
  assert.equal(draft.settings.library_publication_mode, 'automatic');
  assert.equal(tasks.find(node => node.data.artifactTask === 'automation-engineer').data.readinessPolicy, 'verify-inputs');
  assert.equal(draft.settings.requires_human_review, false);
  const loop = draft.nodes.find(node => node.data.kind === 'loop');
  assert.equal(loop.data.loopAction, 'workflow');
  assert.equal(Number(loop.data.loopBatchSize), 1);
  assert.equal(Number(loop.data.timeoutMs), 3600000);
  assert.ok(draft.edges.some(edge => edge.source === loop.id && edge.sourceHandle === 'loop' && edge.target === 'story-assurance'));
  assert.ok(draft.edges.some(edge => edge.source === 'automation-engineer' && edge.target === loop.id && edge.targetHandle === 'continue'));
  assert.ok(draft.edges.some(edge => edge.source === loop.id && edge.sourceHandle === 'done' && edge.target === 'sprint-output'));
  assert.equal(draft.edges.some(edge => edge.source === 'automation-engineer' && edge.target === 'sprint-output'), false);
});

test('opening legacy native tasks preserves user guidance and intentionally empty fields', () => {
  const native = data => graph.normalizeWorkflowNodeDirectLlm({id:'native',position:{x:0,y:0},data:{kind:'artifactTask',artifactTask:'automation-engineer',...data}}).data;
  assert.equal(native({prompt:'Use the approved data fixture'}).instructions, 'Use the approved data fixture');
  const customized = native({task:'Build invoice automation',instructions:'Keep the existing assertions',guardrails:'',inspectBrowser:false});
  assert.equal(customized.task, 'Build invoice automation');
  assert.equal(customized.instructions, 'Keep the existing assertions');
  assert.equal(customized.guardrails, '');
  assert.equal(customized.inspectBrowser, false);
});

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


test('connected loops permit only body returns and layout ignores return control edges', () => {
  const nodes = [
    {id:'start',position:{x:0,y:0},data:{kind:'trigger'}},
    {id:'loop',position:{x:0,y:0},data:{...graph.buildNodeDefaults('loop',1),kind:'loop'}},
    {id:'body',position:{x:0,y:0},data:{kind:'transform'}},
    {id:'finish',position:{x:0,y:0},data:{kind:'output'}},
    {id:'outside',position:{x:0,y:0},data:{kind:'transform'}},
  ];
  const edges = [{id:'start-loop',source:'start',target:'loop'},{id:'body-edge',source:'loop',sourceHandle:'loop',target:'body'},{id:'done-edge',source:'loop',sourceHandle:'done',target:'finish'}];
  assert.equal(graph.canConnectWorkflow(nodes,edges,'body','loop',null,'continue'),true);
  assert.equal(graph.canConnectWorkflow(nodes,edges,'outside','loop',null,'continue'),false);
  assert.equal(graph.canConnectWorkflow(nodes,edges,'body','loop'),false);
  assert.equal(graph.canConnectWorkflow(nodes,edges,'loop','outside'),false);
  assert.equal(graph.canConnectWorkflow(nodes,edges,'body','outside',null,'continue'),false);
  const withReturn = [...edges,{id:'return',source:'body',target:'loop',targetHandle:'continue'}];
  assert.equal(graph.canConnectWorkflow(nodes,withReturn,'body','loop',null,'continue'),false);
  const positions = Object.fromEntries(graph.layoutWorkflow(nodes,withReturn).map(node=>[node.id,node.position]));
  assert.ok(positions.start.x<positions.loop.x && positions.loop.x<positions.body.x);
  assert.ok(positions.loop.x<positions.finish.x);
  const inserted = graph.insertWorkflowNode(nodes,withReturn,'log',{edgeId:'return'});
  assert.equal(inserted.edges.find(edge=>edge.target===inserted.node.id).source,'body');
  assert.equal(inserted.edges.find(edge=>edge.id==='return').targetHandle,'continue');
  assert.deepEqual(inserted.nodes.find(node=>node.id==='loop').position,nodes[1].position,'return insertion never shifts loop or its ancestors');
  const outer = graph.insertWorkflowNode(nodes,edges,'loop',{edgeId:'done-edge'});
  assert.equal(outer.edges.find(edge=>edge.target==='finish').sourceHandle,'done','inserting a loop keeps downstream nodes on its completion branch');
});

test('data node defaults come from native catalog and Switch labels keep stable edge identities', () => {
  const catalog=JSON.parse(readFileSync(new URL('../../shared/workflowDataOperations.json',import.meta.url),'utf8'));
  for(const [id,profile] of Object.entries(catalog)) {
    const data=dataProfiles.dataOperationDefaults(id);
    assert.equal(data.dataOperation,id); assert.equal(data.dataSourceKey,'input');
    for(const [key,value] of Object.entries(profile.defaults)) assert.deepEqual(data[key],value);
  }
  assert.equal(graph.buildNodeDefaults('dataOperation',1).dataOperation,'editFields');
  const route={id:'passed',label:'Original',conditions:[]};
  const node={id:'switch',position:{x:0,y:0},data:{kind:'dataOperation',dataOperation:'switch',dataRoutes:JSON.stringify([route]),dataFallback:'fallback'}};
  assert.deepEqual(graph.workflowSourceHandles(node),[{id:'passed',label:'Original'},{id:'fallback',label:'fallback'}]);
  const renamed={...node,data:{...node.data,dataRoutes:JSON.stringify([{...route,label:'Renamed'}])}};
  const target={id:'target',data:{kind:'transform'},position:{x:0,y:0}};
  assert.equal(graph.canConnectWorkflow([renamed,target],[],'switch','target','passed'),true);
  assert.equal(graph.canConnectWorkflow([renamed,target],[],'switch','target','Original'),false);
  assert.equal(graph.canConnectWorkflow([renamed,target],[],'switch','target'),false);
  assert.deepEqual(graph.workflowSourceHandles({...node,data:{...node.data,dataRoutes:'invalid',dataFallback:'none'}}),[]);
  assert.equal(graph.canConnectWorkflow([{...node,data:{...node.data,dataRoutes:'invalid',dataFallback:'none'}},target],[],'switch','target'),false);
});

test('stop nodes terminate branches and numbered merge inputs preserve distinct connections', () => {
  const nodes=['source','merge','stop'].map(id=>({id,position:{x:0,y:0},data:{kind:id==='source'?'transform':id==='merge'?'aggregator':'stop'}}));
  assert.equal(graph.canConnectWorkflow(nodes,[],'stop','merge'),false);
  assert.equal(graph.canConnectWorkflow(nodes,[],'source','merge',null,'input-1'),true);
  assert.equal(graph.canConnectWorkflow(nodes,[{source:'source',target:'merge',targetHandle:'input-1'}],'source','merge',null,'input-2'),true);
  assert.equal(graph.canConnectWorkflow(nodes,[],'source','merge',null,'input-3'),false);
  assert.equal(graph.canConnectWorkflow(nodes,[],'source','stop',null,'input-1'),false);
});

test('arrange reserves space for tall switch cards and exported flow preserves branch and merge port indexes', () => {
  const routes=Array.from({length:6},(_,index)=>({id:`route_${index+1}`,label:`Route ${index+1}`}));
  const nodes=[
    {id:'start',position:{x:0,y:0},data:{kind:'trigger',label:'Start'}},
    {id:'loop',position:{x:0,y:0},data:{...graph.buildNodeDefaults('loop',1),label:'Loop'}},
    {id:'switch',position:{x:0,y:0},data:{kind:'dataOperation',dataOperation:'switch',label:'Switch',dataRoutes:JSON.stringify(routes)}},
    {id:'sibling',position:{x:0,y:0},data:{kind:'transform',label:'Sibling'}},
    {id:'merge',position:{x:0,y:0},data:{kind:'aggregator',label:'Merge',mergeMode:'combinePosition',mergeIncludeUnpaired:true}},
  ];
  const edges=[{id:'start-loop',source:'start',target:'loop'}, {id:'loop-switch',source:'loop',sourceHandle:'loop',target:'switch'}, {id:'done-merge',source:'loop',sourceHandle:'done',target:'merge',targetHandle:'input-1'}, {id:'branch',source:'switch',sourceHandle:'route_2',target:'merge',targetHandle:'input-2'}, {id:'sibling',source:'loop',sourceHandle:'loop',target:'sibling'}];
  const positions=Object.fromEntries(graph.layoutWorkflow(nodes,edges).map(node=>[node.id,node.position]));
  assert.ok(positions.sibling.y-positions.switch.y>=56+routes.length*34+76);
  const payload=graph.buildN8nPayload({name:'Branches',status:'draft',settings:{}},nodes,edges);
  assert.equal(payload.connections.Loop.main[0][0].node,'Switch');
  assert.deepEqual(payload.connections.Loop.main[1],[{node:'Merge',type:'main',index:0}]);
  assert.deepEqual(payload.connections.Switch.main[1],[{node:'Merge',type:'main',index:1}]);
  const merge=payload.nodes.find(node=>node.id==='merge');
  assert.equal(merge.parameters.merge.includeUnpaired,true);
  assert.equal(merge.parameters.dataFlow.incoming[1].sourceHandle,'route_2');
  assert.equal(merge.parameters.dataFlow.incoming[1].targetHandle,'input-2');
  assert.equal(payload.nodes.find(node=>node.id==='loop').parameters.loop.batchSize,1);
});


test('list-processing starter has an explicit connected body and valid completion wiring', () => {
  const templates = {};
  new Function('require', 'exports', ts.transpileModule(readFileSync(new URL('../../frontend/workflows/workflowTemplates.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText)(name => name === './workflowGraph' ? graph : name === './nativeTaskProfiles' ? nativeProfiles : profiles, templates);
  const {draft,input}=templates.draftFromTemplate(templates.WORKFLOW_TEMPLATES.find(item=>item.id==='foreach'));
  const loop=draft.nodes.find(node=>node.data.kind==='loop');
  const body=draft.nodes.find(node=>node.id==='shape-batch');
  assert.equal(loop.data.loopAction,'workflow');assert.equal(loop.data.loopBatchSize,1);
  assert.equal(body.data.kind,'dataOperation');assert.equal(body.data.dataSourceKey,'input');
  assert.equal(loop.data.transformMapping,undefined,'connected bodies do not store an unused inline field mapping');
  assert.equal(JSON.parse(input).items.length,2);
  assert.ok(draft.edges.some(edge=>edge.source===loop.id && edge.target===body.id && edge.sourceHandle==='loop'));
  assert.ok(draft.edges.some(edge=>edge.source===body.id && edge.target===loop.id && edge.targetHandle==='continue'));
  assert.ok(draft.edges.some(edge=>edge.source===loop.id && edge.sourceHandle==='done' && draft.nodes.find(node=>node.id===edge.target)?.data.kind==='output'));
  for(const edge of draft.edges) assert.equal(graph.canConnectWorkflow(draft.nodes,draft.edges.filter(item=>item.id!==edge.id),edge.source,edge.target,edge.sourceHandle,edge.targetHandle),true);
});
