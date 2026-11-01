const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const memory = require('../../backend/contextGraph');
const traces = require('@hellotest/platform/backend/src/utils/llmTraceContext');
const actor = { user: { id: 'reader' }, projectId: 'project', clientId: 'host' };
const fail = (message, statusCode, code) => Object.assign(new Error(message), { statusCode, code, publicMessage: message });
const graph = () => ({ contract_type: 'ContextGraph', project_id: 'project',
  nodes: [{ id: 'task', kind: 'task', title: 'Recorded task' }, { id: 'source', kind: 'source', title: 'Authorized source' }],
  edges: [{ id: 'selected', source: 'task', target: 'source', type: 'RETRIEVED_EVIDENCE' }],
  timeline: [{ id: 'selected-event', type: 'CONTEXT_SELECTED', status: 'recorded' }] });
function fixture({ denied = false, foreignApp = false, value = graph(), bounded = value => value } = {}) {
  const calls = [];
  const service = { list: async input => { calls.push(input); return { project_id: 'project', items: [{ trace_id: 'trace-1' }], next_cursor: null }; },
    explore: async input => { calls.push(input); return value; } };
  return { calls, boundary: memory.createContextGraph({ permit: async (_actor, permission) => {
    assert.equal(permission, 'knowledge.view'); if (denied) throw fail('Denied', 403, 'DENIED');
  }, fail, db: { prepare: () => ({ get: async () => ({ project_id: foreignApp ? 'foreign' : 'project' }) }) }, bounded, service: () => service }) };
}

test('context memory schemas expose bounded owner-private reads without model identity or event writes', () => {
  assert.equal(memory.listSchema.parse({}).limit, 12);
  for (const input of [{ project_id: 'foreign' }, { user_id: 'admin' }, { limit: 21 }, { from: 'yesterday' }, { approved: true }]) assert.equal(memory.listSchema.safeParse(input).success, false);
  for (const input of [{ trace_id: 'trace', user_id: 'admin' }, { trace_id: 'trace', record_event: { status: 'approved' } }, { trace_id: '' }]) assert.equal(memory.exploreSchema.safeParse(input).success, false);
});
test('context graph reads forward verified actor, project and exact time/application filters', async () => {
  const f = fixture(), args = memory.listSchema.parse({ app_type_id: 'app', feature_id: 'ai.bug.draft', from: '2026-10-01T00:00:00Z', limit: 4 });
  await f.boundary.list(actor, args);
  assert.equal(f.calls[0].projectId, actor.projectId); assert.equal(f.calls[0].user, actor.user);
  assert.equal(f.calls[0].appTypeId, 'app'); assert.equal(f.calls[0].featureId, args.feature_id); assert.equal(f.calls[0].from, args.from);
  assert.equal(f.calls[0].limit, 4); assert.ok(f.calls[0].signal instanceof AbortSignal);
  const result = await f.boundary.explore(actor, memory.exploreSchema.parse({ trace_id: 'trace-1' }));
  assert.equal(f.calls[1].traceId, 'trace-1'); assert.equal(result.edges[0].source, 'task');
});
test('revoked knowledge access and foreign applications stop before context history is queried', async () => {
  for (const options of [{ denied: true }, { foreignApp: true }]) {
    const f = fixture(options);
    await assert.rejects(f.boundary.explore(actor, memory.exploreSchema.parse({ trace_id: 'trace', app_type_id: 'app' })), error => error.statusCode === 403);
    assert.equal(f.calls.length, 0);
  }
});
test('context graph rejects foreign endpoints, dangling links and identities removed by delivery packing', async () => {
  for (const value of [{ ...graph(), project_id: 'foreign' }, { ...graph(), nodes: [{ id: 'task', project_id: 'foreign' }] },
    { ...graph(), edges: [{ source: 'task', target: 'unavailable' }] }, { ...graph(), timeline: [{ project_id: 'foreign' }] },
    { ...graph(), nodes: [{ id: 'same' }, { id: 'same' }] }]) {
    await assert.rejects(fixture({ value }).boundary.explore(actor, { trace_id: 'trace' }), { code: 'MCP_CONTEXT_GRAPH_CONTRACT' });
  }
  await assert.rejects(fixture({ bounded: value => ({ ...value, nodes: value.nodes.slice(0, 1) }) }).boundary.explore(actor, { trace_id: 'trace' }), { code: 'MCP_CONTEXT_GRAPH_BUDGET' });
  await assert.rejects(fixture({ bounded: value => ({ ...value, nodes: value.nodes.map(node => ({...node,id:'redacted'})),edges:value.edges.map(edge=>({...edge,source:'redacted',target:'redacted'})) }) }).boundary.explore(actor, { trace_id: 'trace' }), { code: 'MCP_CONTEXT_GRAPH_BUDGET' });
});

test('canonical numeric graph identities survive actual MCP text redaction without bypassing prose policy',async()=>{
 const {bounded}=require('../../backend/backplane');
 const task='41111111-1111-4111-8111-111111111111',source='55555555-5555-4555-8555-555555555555',edge='42424242-4242-4242-8242-424242424242';
 const value={...graph(),nodes:[{id:task,kind:'task',title:'Call 4111111111111111'},{id:source,kind:'text',knowledge_node_id:source}],edges:[{id:edge,source:task,target:source,type:'RETRIEVED_EVIDENCE'}],timeline:[{id:edge,node_id:task,type:'CONTEXT_SELECTED'}]};
 const result=await fixture({value,bounded}).boundary.explore(actor,{trace_id:'trace'});
 assert.equal(result.nodes[0].id,task);assert.equal(result.nodes[1].knowledge_node_id,source);assert.equal(result.edges[0].target,source);assert.equal(result.timeline[0].node_id,task);
 assert.ok(!result.nodes[0].title.includes('4111111111111111'));
});

const packet = () => ({ contract_type: 'ContextPacket', project_id: 'project', context_packet_id: 'packet-1',
  trace_id: 'retrieval-trace', request_id: 'request-1', applied_filters: { app_type_id: 'app' },
  query: { text: 'The original authorized user question.' }, evidence: [{ evidence_id: 'evidence-1', source_id: 'source-1', document_id: 'document-v2', content: '[Redacted] delivered excerpt', integrity: { version_hash: 'a'.repeat(64) } }], retrieval: { termination_reason: 'CONTEXT_SUFFICIENT' } });
test('recording binds delivered evidence to verified identity and trusted feature/session metadata', async () => {
  const calls = [], input = packet();
  const result = await traces.run({ feature: 'ai.test_case.design', session_id: 'owned-session', task_id: 'task-1' }, () => memory.rememberContext(actor, input, {
    service: () => ({ recordContext: async value => { calls.push(value); return { trace_id: 'context-trace', recorded_at: '2026-11-01T00:00:00Z' }; } })
  }));
  assert.equal(calls.length, 1); assert.equal(calls[0].projectId, actor.projectId); assert.equal(calls[0].user, actor.user);
  assert.equal(calls[0].featureId, 'ai.test_case.design'); assert.equal(calls[0].sessionId, 'owned-session'); assert.equal(calls[0].taskRef, 'task-1');
  assert.equal(calls[0].packet, input); assert.equal(calls[0].packet.evidence[0].content, '[Redacted] delivered excerpt');
  assert.deepEqual(result.retrieval.context_graph, { status: 'recorded', trace_id: 'context-trace', recorded_at: '2026-11-01T00:00:00Z' });
  assert.equal(input.retrieval.context_graph, undefined, 'The original evidence packet is immutable.');
});
test('optional memory failure remains an explicit gap and never retries or discards a valid context packet', async () => {
  const input = packet(); let calls = 0;
  const result = await memory.rememberContext(actor, input, { service: () => ({ recordContext: async () => { calls++; throw Error('Unavailable ledger'); } }) });
  assert.equal(calls, 1); assert.deepEqual(result.evidence, input.evidence);
  assert.deepEqual(result.retrieval.context_graph, { status: 'unavailable', code: 'CONTEXT_GRAPH_RECORD_UNAVAILABLE' });
  const unsupported = { project_id: 'project', evidence: [] };
  assert.equal(await memory.rememberContext(actor, unsupported, { service: () => assert.fail('Legacy non-packet data must not create false traces') }), unsupported);
});
test('cancelled context capture cannot become a recorded or successful memory result', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(memory.rememberContext(actor, packet(), { signal: controller.signal, service: () => assert.fail('Cancelled capture must not write') }));
});
test('observed outcome writes use exact native receipt IDs and cannot invalidate already persisted feature work', async () => {
  const input = packet(); input.retrieval.context_graph = { status: 'recorded', trace_id: 'context-trace' };
  let calls = 0;
  const event = { id: 'assistant-message:message-1', type: 'OUTCOME_RECORDED', status: 'answered', reference_id: 'message-1', rationale: 'Saved after native answer validation.' };
  const result = await memory.rememberDecision({ projectId: 'project', user: actor.user, packet: input, event,
    service: () => ({ recordDecision: async value => { calls++; assert.equal(value.contextTraceId, 'context-trace'); assert.equal(value.event, event); assert.equal(value.user, actor.user); throw Error('Ledger unavailable'); } }) });
  assert.equal(calls, 1); assert.equal(result.status, 'unavailable');
  assert.deepEqual(await memory.rememberDecision({ projectId: 'project', user: actor.user, packet: packet(), event }), { status: 'not_recorded' });
});

test('real SDK advertises and calls context graph tools without granting history access through arguments', async t => {
  const f = fixture(), filename = require.resolve('../../backend/mcpServer'), local = createRequire(filename), module = { exports: {} };
  const mocks = { './contextGraph': { ...memory, createContextGraph: () => f.boundary }, './backplane': { bounded: value => value, auditFailure: () => {} },
    './projections': { entities: { projects: {} } }, './auth': { permit: async () => {}, fail }, './gateway': { installTransport: () => {} },
    '@hellotest/platform/backend/src/db': { prepare: () => ({ run: async () => {} }) } };
  new Function('require', 'module', 'exports', fs.readFileSync(filename, 'utf8'))(name => mocks[name] || local(name), module, module.exports);
  t.after(() => module.exports.handler.close());
  const tools = await module.exports.inspectLocal(actor);
  assert.ok(tools.some(tool => tool.name === 'hellotest_context_graph_list'));
  assert.ok(tools.some(tool => tool.name === 'hellotest_context_graph_explore'));
  const result = await module.exports.callLocal(actor, 'hellotest_context_graph_explore', { trace_id: 'trace-1' });
  assert.equal(result.project_id, 'project'); assert.equal(result.contract_type, 'ContextGraph');
  await assert.rejects(module.exports.invoke(actor, 'hellotest_context_graph_list', { user_id: 'another-user' }), { code: 'MCP_INVALID_ARGUMENT' });
});
