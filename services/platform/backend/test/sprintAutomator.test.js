const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const runtime = require('../../../agentic/backend/services/agenticWorkflowExecution.service');
const tasks = require('../../../agentic/backend/workflows/artifactTasks');
const operations = require('../../../agentic/backend/workflows/nodeOperations');
const connections = require('../../../agentic/backend/workflows/connections');
const permissions = require('../services/permission.service');
const flags = require('../services/featureFlag.service');
const stories = require('../../../manual/backend/services/requirement.service');
const design = require('../../../manual/backend/services/requirementDesign.service');
const assurance = require('../../../ai/backend/services/artifactAssurance.service');
const automation = require('../../../automation/backend/services/aiAutomationBuilder.service');
const user = { id: 'user-a', role: 'member' };
const story = id => ({ id, project_id: 'project-a', iteration_id: 'sprint-a', title: `${id} customer reads an invoice`, description: 'As a customer I can read an existing invoice so that I can confirm the saved amount. The response returns the saved invoice.', acceptance_criteria: ['Given an existing invoice, when the customer reads it, then return its saved amount.'], test_case_ids: [], labels: [], external_references: [] });
const node = (id, kind, data = {}) => ({ id, type: 'agenticStep', data: { label: id, kind, ...data } });
const graph = () => {
  const nodes = [node('request', 'trigger'), node('stories', 'apiTool', { connectionId: 'stories-api', apiResource: 'sprintStories', apiMethod: 'GET', timeoutMs: 70000 }), node('each', 'loop', { loopAction: 'storyPackets', loopSourceKey: 'input.items', loopMaxIterations: 100 }), ...['story-assurance','test-case-generation','test-case-assurance','automation-engineer'].map(task => node(task, 'artifactTask', { artifactTask: task, timeoutMs: 1800000 })), node('finish', 'output')];
  return { id: 'sprint-workflow', project_id: 'project-a', app_type_id: 'app-a', name: 'Sprint Automator', trigger_kind: 'manual', status: 'draft', settings: { maxDurationMs: 3600000 }, nodes, edges: nodes.slice(1).map((item, index) => ({ source: nodes[index].id, target: item.id })) };
};
async function setup(t, handler) {
  const requests = [];
  const server = http.createServer((req,res) => { requests.push({ url: req.url, authorization: req.headers.authorization }); handler(req, res); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const previous = process.env.AGENTIC_HTTP_CONNECTIONS;
  process.env.AGENTIC_HTTP_CONNECTIONS = JSON.stringify([{ id: 'stories-api', url: `http://127.0.0.1:${server.address().port}/api`, projectIds: ['project-a'], methods: ['GET'], allowPrivateNetwork: true, secretEnv: 'AGENTIC_SECRET_SPRINT_TEST' }]);
  const previousSecret = process.env.AGENTIC_SECRET_SPRINT_TEST;
  process.env.AGENTIC_SECRET_SPRINT_TEST = 'sprint-private-key-never-model-context';
  t.after(() => { if (previous == null) delete process.env.AGENTIC_HTTP_CONNECTIONS; else process.env.AGENTIC_HTTP_CONNECTIONS = previous; if (previousSecret == null) delete process.env.AGENTIC_SECRET_SPRINT_TEST; else process.env.AGENTIC_SECRET_SPRINT_TEST = previousSecret; });
  t.mock.method(require('../../../agentic/backend/workflows/connectionSettings'), 'all', async () => []);
  t.mock.method(permissions, 'hasPermission', async (_user, _permission, projectId) => projectId === 'project-a');
  t.mock.method(flags, 'areEnabled', async () => true);
  t.mock.method(require('../../../agentic/backend/agents/agentRegistry.service'), 'resolveModel', async () => ({ id: 'model-a' }));
  t.mock.method(require('../public/applicationAccess'), 'getAppType', async () => ({ id: 'app-a', project_id: 'project-a', kind: 'web' }));
  t.mock.method(stories, 'getRequirement', async id => story(id));
  const rows = new Map();
  t.mock.method(runtime._internals.store, 'get', async id => structuredClone(rows.get(id) || null));
  t.mock.method(runtime._internals.store, 'insert', async row => { rows.set(row.id, structuredClone(row)); return { id: row.id }; });
  t.mock.method(runtime._internals.store, 'save', async (id,status,nodes,output) => { const old = rows.get(id); if (!old || old.status !== 'running') return null; rows.set(id, structuredClone({ ...old, status, node_results: nodes, output_payload: output })); return { id }; });
  t.after(async () => { const active = [...runtime._internals.active.values()]; active.forEach(item => item.controller.abort()); await Promise.allSettled(active.map(item => item.promise)); });
  return { requests, rows };
}
const page = (res, items, next = null, total = 2) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ items, total, next_cursor: next, is_last: !next })); };

test('Sprint Automator follows real authenticated HTTP cursor pages and feeds each native stage its exact per-Story output', async t => {
  const { requests, rows } = await setup(t, (req,res) => { const url = new URL(req.url, 'http://local'); page(res, [story(url.searchParams.has('cursor') ? 'story-b' : 'story-a')], url.searchParams.has('cursor') ? null : 'next-page'); });
  const reviews = [], generations = [], builds = [];
  t.mock.method(assurance, 'reviewArtifact', async input => { reviews.push(input); return { assurance_review: { summary: `Review ${input.savedArtifact.id}`, dimensions: [], insights: [], limitations: [], automation_readiness: {status:'ready',summary:'The reviewed API fixture supplies the automation inputs.',evidence_refs:[`draft:test-case:${input.savedArtifact.id}`],missing_context:[]} }, verification: { status: 'passed' }, generation_mode: 'hybrid' }; });
  t.mock.method(design, 'previewRequirementsTestCases', async input => { generations.push(input); return { generated: 1, cases: [{ client_id: 'draft-1', title: `Read ${input.requirements[0].id}`, description: 'Read the saved invoice', priority: 2, test_case_type: 'Functional', authoring_mode: 'structured', requirement_ids: [input.requirements[0].id], parameter_values: {}, steps: [{ action: 'GET /invoices/one', expected_result: 'Response status equals 200 and amount equals the saved invoice', step_type: 'manual' }] }] }; });
  t.mock.method(automation, 'previewAutomationDraft', async input => { builds.push(input); return { steps: input.draft.steps.map(step => ({ ...step, step_type: 'api', api_request: { method: 'GET', url: 'https://invoices.example/invoices/one', assertions: [{ type: 'status_code', expected: 200 }] } })), validation: { status: 'passed' }, verification_status: 'unverified', generation_mode: 'llm' }; });
  const run = await runtime.start(graph(), { request_id: 'sprint-first-run', input_payload: { sprint_id: 'sprint-a', integration_id: 'selected-model', max_cases_per_story: 2 } }, user);
  await runtime._internals.active.get(run.id)?.promise;
  const saved = rows.get(run.id);
  assert.equal(saved.status, 'completed');
  assert.equal(requests.length, 2);
  assert.ok(requests.every(request => request.authorization === 'Bearer sprint-private-key-never-model-context'));
  const first = new URL(requests[0].url, 'http://local');
  assert.equal(first.pathname, '/api/requirements'); assert.equal(first.searchParams.get('sprint_id'), 'sprint-a'); assert.equal(first.searchParams.get('project_id'), 'project-a');
  assert.equal(generations.length, 2); assert.deepEqual(generations.map(item => item.requirements[0].id), ['story-a','story-b']);
  assert.ok(generations.every(item => item.integration_id === 'selected-model' && item.max_cases === 2));
  assert.match(generations[0].additional_context, /Review story-a/); assert.doesNotMatch(generations[0].additional_context, /Review story-b/);
  assert.equal(reviews.filter(item => item.artifactType === 'story').length, 2); assert.equal(reviews.filter(item => item.artifactType === 'test-case').length, 2);
  assert.deepEqual(builds.map(input => input.draft.requirement_ids[0]), ['story-a','story-b']);
  assert.ok(builds.every(input => input.user_id === user.id && input.project_id === 'project-a'));
  const output = saved.node_results.find(item => item.node_id === 'automation-engineer').output;
  assert.equal(output.data.length, 2); assert.equal(output.data[0].automation[0].steps[0].step_type, 'api');
  assert.equal(output.data[0].automation[0].verification_status, 'unverified');
  assert.equal(output.data[0].story_assurance.comparison.score_delta, 0);
  const baseline = await tasks._internals.metrics();
  assert.deepEqual(output.data[0].story_assurance.baseline, tasks._internals.storyBaseline(baseline, story('story-a')));
  assert.doesNotMatch(JSON.stringify({ saved, generations, reviews, builds }), /sprint-private-key-never-model-context/);
  assert.equal(saved.output_payload.runtime_contract.max_duration_ms, 3600000);
});

test('Stories pagination never silently truncates oversized Sprints or follows repeated cursors', async t => {
  await setup(t, (_req,res) => page(res, [story('story-a')], 'same-cursor', 2));
  await assert.rejects(connections.callHttp({ projectId: 'project-a', data: { connectionId: 'stories-api', apiPagination: 'cursor', apiMethod: 'GET' }, signal: new AbortController().signal }), /duplicate record|stopped advancing/);
});

test('native tasks reject changed Stories, unassessed cases, cross-project scope and missing trigger Sprint before model calls', async t => {
  await setup(t, (_req,res) => page(res, []));
  const run = { id: 'run', project_id: 'project-a', app_type_id: 'app-a', input_payload: { sprint_id: 'sprint-a' } };
  await assert.rejects(tasks.execute({ run, node: node('generate','artifactTask',{artifactTask:'test-case-generation'}), sources: [], user, signal: new AbortController().signal, onProgress: async()=>{}, context:{input:[{story_id:'story-a',story_revision:tasks.revision(story('story-a'))}]} }), /completed Story assurance/);
  await assert.rejects(tasks.loadStory(run,user,{story_id:'story-a',story_revision:'old'}), { statusCode:409 });
  t.mock.method(stories, 'getRequirement', async id => ({...story(id),project_id:'other'}));
  await assert.rejects(tasks.loadStory(run,user,{story_id:'story-a'}), {statusCode:403});
  assert.throws(() => tasks.checkInput({...run,input_payload:{}}), /sprint_id/);
  assert.throws(() => tasks.checkInput({...run,input_payload:{sprint_id:'sprint-a',project_id:'other'}}), {statusCode:403});
  assert.deepEqual(operations.validate(node('loop','loop',{loopAction:'storyPackets',loopMaxIterations:100})), []);
  assert.ok(operations.validate(node('loop','loop',{loopAction:'customAI',loopMaxIterations:100})).length);
});

test('Gherkin workflow assurance and automation use authored scenarios rather than empty cached steps', async () => {
  const draft = { authoring_mode: 'gherkin', gherkin_document: 'Feature: invoice\n  Scenario: read invoice\n    Given an existing invoice\n    When I GET /invoices/one\n    Then status equals 200\n    And the response amount equals 10\n  Scenario: missing invoice\n    When I GET /invoices/missing\n    Then status equals 404', steps: [] };
  const steps = tasks.authoredSteps(draft);
  assert.equal(steps.length, 2);
  assert.match(steps[0].action, /Given an existing invoice\nWhen I GET/);
  assert.match(steps[0].expected_result, /Then status equals 200\nAnd the response/);
  assert.match(steps[1].expected_result, /404/);
});

test('acceptance uses only saved, assessed outputs and atomically reuses a native Test Case receipt', async t => {
  const { accept } = require('../../../agentic/backend/workflows/acceptDraft');
  const db = require('../src/db');
  const receipts = new Map(), injections = [];
  t.mock.method(permissions, 'hasPermission', async (_user,_code,projectId) => projectId === 'project-a');
  t.mock.method(flags, 'areEnabled', async () => true);
  t.mock.method(require('../public/applicationAccess'), 'getAppType', async () => ({id:'app-a',project_id:'project-a'}));
  t.mock.method(stories, 'getRequirement', async id => story(id));
  t.mock.method(db, 'transaction', task => async () => task());
  t.mock.method(db, 'prepare', sql => ({ get: async (...args) => sql.startsWith('SELECT request_hash') ? receipts.get(args.join(':')) : null, run: async (...args) => { if (sql.startsWith('INSERT INTO workflow_draft_acceptances')) receipts.set([args[0],args[2],args[3],args[4],args[5]].join(':'), {request_hash:args[7],receipt:args[8]}); } }));
  const draft = {client_id:'draft-1',title:'Read invoice',description:'Read an existing invoice',priority:2,test_case_type:'Functional',authoring_mode:'structured',requirement_ids:['story-a'],parameter_values:{},steps:[{action:'GET /invoices/one',expected_result:'Response status equals 200',step_type:'manual'}]};
  const packet = {story_id:'story-a',story_revision:tasks.revision(story('story-a')),cases:[draft],case_assurance:[{case_fingerprint:tasks.fingerprint(draft),verification:{status:'passed'}}],automation:[{case_fingerprint:tasks.fingerprint(draft),validation:{status:'passed'},verification_status:'unverified',steps:[{...draft.steps[0],step_type:'api',api_request:{method:'GET',url:'https://invoices.example/invoices/one'}}]}]};
  const run = {id:'run-a',project_id:'project-a',app_type_id:'app-a',status:'completed',execution_mode:'review',input_payload:{sprint_id:'sprint-a'},node_results:[{node_id:'auto',node_type:'artifactTask',status:'completed',output:{data:[packet]}}]};
  const app = {inject:async input=>{injections.push(input);return{statusCode:201,json:()=>({id:'saved-case'})};}};
  const req = {user,body:{node_id:'auto',story_index:0,case_index:0,kind:'automation',artifact:{title:'Forged user supplied payload'}}};
  const first = await accept(app,req,run), second = await accept(app,req,run);
  assert.equal(first.id,'saved-case');assert.equal(second.reused,true);assert.equal(injections.length,1);
  assert.equal(injections[0].url,'/test-cases');assert.equal(injections[0].payload.title,'Read invoice');assert.equal(injections[0].payload.steps[0].step_type,'api');assert.equal(injections[0].payload.automation_status,'incomplete');
  assert.equal(first.verification_status,'unverified');
  await assert.rejects(accept(app,{...req,apiKey:{id:'api-key'}},run),{statusCode:403});
  await assert.rejects(accept(app,{...req,body:{...req.body,case_index:1}},run),{statusCode:409});
  const stale=structuredClone(run);stale.node_results[0].output.data[0].cases[0].title='Tampered draft';
  await assert.rejects(accept(app,req,stale),{statusCode:409});
});

test('canonical Gherkin automation preserves Background, JSON DocStrings, tables and each Examples row', async () => {
  const document = `Feature: Create invoices
Background: session fixture
  Given I POST /sessions
    """json
    {"role":"customer"}
    """
Scenario Outline: Create an invoice
  When I POST /invoices
    """json
    {"amount":<amount>,"currency":"USD"}
    """
  Then the response status equals <status>
    | field | value |
    | currency | USD |
Examples:
  | amount | status |
  | 10 | 201 |
  | -1 | 422 |`;
  const compiled = await tasks.automationSteps({authoring_mode:'gherkin',gherkin_document:document,steps:[]});
  assert.equal(compiled.length,4);
  assert.ok(compiled.every(step=>step.gherkin_keyword==='Given'||step.gherkin_keyword==='When'));
  assert.deepEqual(compiled.map(step=>step.gherkin_role),['background','scenario','background','scenario']);
  assert.match(compiled[0].action,/POST \/sessions[\s\S]*"role":"customer"/);
  assert.match(compiled[1].action,/"amount":10/);assert.match(compiled[3].action,/"amount":-1/);
  assert.match(compiled[1].expected_result,/201[\s\S]*\| currency \| USD \|/);
  assert.match(compiled[3].expected_result,/422/);
  assert.doesNotMatch(JSON.stringify(compiled),/<amount>|<status>/);
});

test('incomplete declared Story totals stop pagination before any generation', async t => {
  await setup(t,(_req,res)=>page(res,[story('story-a')],null,2));
  await assert.rejects(connections.callHttp({projectId:'project-a',data:{connectionId:'stories-api',apiPagination:'cursor',apiResource:'sprintStories',apiMethod:'GET'},signal:new AbortController().signal}),/incomplete Sprint page set/);
});

test('persisted JSONB key ordering preserves native draft lineage without erasing action order or timestamps', () => {
  const draft = {title:'Read invoice',parameter_values:{currency:'USD',amount:'10'},steps:[{action:'GET invoice',expected_result:'Status200',api_request:{method:'GET',url:'https://invoices.example/one'}},{action:'Compare amount',expected_result:'Amount10'}]};
  const reordered = {steps:[{api_request:{url:'https://invoices.example/one',method:'GET'},expected_result:'Status200',action:'GET invoice'},{expected_result:'Amount10',action:'Compare amount'}],parameter_values:{amount:'10',currency:'USD'},title:'Read invoice'};
  assert.equal(tasks.fingerprint(draft),tasks.fingerprint(reordered));
  assert.notEqual(tasks.fingerprint(draft),tasks.fingerprint({...draft,steps:[...draft.steps].reverse()}));
  assert.equal(tasks.fingerprint({updated_at:new Date('2026-10-22T10:00:00Z')}),tasks.fingerprint({updated_at:'2026-10-22T10:00:00.000Z'}));
  assert.notEqual(tasks.fingerprint({updated_at:new Date('2026-10-22T10:00:00Z')}),tasks.fingerprint({updated_at:new Date('2026-10-22T10:01:00Z')}));
  const serializable = { omitted:undefined, amount:10, nested:{unknown:undefined,nonfinite:NaN}, ordered:[undefined,Infinity,-0], updated_at:new Date('2026-10-22T10:00:00Z') };
  assert.equal(tasks.fingerprint(serializable),tasks.fingerprint(JSON.parse(JSON.stringify(serializable))));
});
