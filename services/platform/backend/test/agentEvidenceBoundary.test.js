const assert = require("node:assert/strict");
const test = require("node:test");
const assistant = require("../../../agentic/backend/services/agenticAssistant.service");
const context = require("../../../ai/backend/services/aiContextOrchestrator.service");
const knowledge = require("../../../knowledge/backend/services/aiKnowledge.service");
const rag = require("../../../knowledge/backend/services/knowledgeRag.service");
const selection = require("../../../integration/backend/services/aiLlmSelection.service");
const transactions = require("../services/workspaceTransaction.service");
const permissions = require("../services/permission.service");
const flags = require("../services/featureFlag.service");
const projects = require("../services/project.service");
const db = require("../src/db");
const resilience = require("../src/utils/resilientHttpClient");

const user = { id: "agent-user", role: "member" };
const input = { project_id: "project-a", user, agent_id: "story-architect", mode: "agent", prompt: "Review missing story acceptance criteria", context_scopes: ["stories", "knowledge"] };
const storyHit = () => context._internals.makeLiveHit({ projectId: "project-a", scope: "stories", title: "Story coverage", content: JSON.stringify({ evidence_type: "authoritative_live_story_snapshot", total_records: 5, uncovered_records: 2, thin_coverage_records: 1 }) });

function setupAssistant(t, { model = { name: "Fixture model", model: "test-model", base_url: "https://model.example.test/v1", api_key: "test-only-credential" } } = {}) {
  const events = [];
  const records = [];
  resilience.resetServiceResilienceState();
  const configuration=require('../services/aiConfiguration.service');
  t.mock.method(configuration,'resolve',async id=>({config:configuration.catalog.find(item=>item.id===id).defaults}));
  const retrieval=require('../../../knowledge/backend/services/knowledgeRetrieval.service');
  t.mock.method(retrieval,'retrieveSearch',async()=>{const packet=await context.buildLiveProjectEvidence();return {results:packet.hits,retrieval:{context_transport:'mcp',live_context_counts:packet.counts}};});
  t.mock.method(retrieval,'authorizeFreshEvidence',async({hits})=>({allowed:hits,denied_ids:[]}));
  t.mock.method(projects, "getProject", async id => ({ id }));
  t.mock.method(globalThis, "fetch", async (_url, request) => {
    const evidence = JSON.parse(JSON.parse(request.body).messages.at(-1).content).citation_contract;
    const citation = evidence.find(item => item.id.includes("stories"));
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ response: citation ? `Story coverage needs review [${citation.id}]` : "Task evidence is missing; supply current story evidence.", citation_ids: citation ? [citation.id] : [], findings: citation ? [{ title: "Story coverage", detail: "Review missing boundaries.", citation_ids: [citation.id] }] : [], deliverables: [], evidence_gaps: citation ? [] : ["Task-specific evidence is unavailable."] }) } }] }), { headers: { "content-type": "application/json" } });
  });
  t.mock.method(permissions, "hasPermission", async () => true);
  t.mock.method(flags, "areEnabled", async () => true);
  t.mock.method(flags, "getDisabledPermissionCodes", async () => []);
  t.mock.method(knowledge, "buildKnowledgeContextPackage", async () => ({ knowledge: [], retrieval: {} }));
  t.mock.method(rag, "search", async () => ({ results: [], retrieval: {} }));
  t.mock.method(context, "buildLiveProjectEvidence", async () => ({ hits: [storyHit()], counts: { stories: 5 } }));
  t.mock.method(selection, "resolveLlmIntegrationForUsage", async () => model);
  t.mock.method(rag, "assertLlmIntegrationProjectScope", () => {});
  t.mock.method(transactions, "createTransaction", async (record) => { records.push(record); return { ...record, id: "transaction-a" }; });
  t.mock.method(transactions, "appendTransactionEvent", async (_id, event) => { events.push(event); return event; });
  t.mock.method(transactions, "updateTransaction", async (_id, record) => { records.push(record); return { ...record, id: "transaction-a" }; });
  t.mock.method(transactions, "listTransactionEvents", async () => events);
  return { events, records };
}


test('selected evidence boundary reaches knowledge, live retrieval, model payloads and saved provenance', async t => {
  const {records} = setupAssistant(t);
  const scope = {story_id:'story-1',release_id:'release-1',sprint_id:'sprint-1'};
  const indexed=[]; const live=[]; const payloads=[]; const messages=[];
  t.mock.method(knowledge,'buildKnowledgeContextPackage',async(_project,options)=>{indexed.push(options);return {knowledge:[],retrieval:{}};});
  t.mock.method(require('../../../knowledge/backend/services/knowledgeRetrieval.service'),'retrieveSearch',async request=>{
    live.push(request);return {results:[storyHit()],retrieval:{live_context_counts:{stories:1}}};
  });
  t.mock.method(globalThis,'fetch',async(_url,request)=>{
    const sent=JSON.parse(request.body).messages;messages.push(sent);
    const payload=JSON.parse(sent.at(-1).content);payloads.push(payload);
    const id=payload.citation_contract[0].id;
    return Response.json({choices:[{message:{content:JSON.stringify({response:`Review selected boundary [${id}]`,citation_ids:[id],findings:[],deliverables:[],recommendations:[],evidence_gaps:[]})}}]});
  });
  const first=await assistant.respond({...input,agent_id:'quality-evaluator',history:[{role:'assistant',content:'Unrelated prior sprint claim that must not cross the new boundary.'}],inputs:{...scope,build:'ignored-scope-field',environment_id:'ignored-scope-field'}});
  assert.deepEqual(indexed[0].evidence_scope,scope);
  assert.deepEqual(live[0].filters.evidence_scope,scope);
  assert.deepEqual(payloads[0].evidence_scope,scope);
  assert.equal(messages[0].some(message=>message.content.includes('Unrelated prior sprint claim')),false);
  assert.deepEqual(first.result.evidence_scope,scope);
  assert.deepEqual(records[0].metadata.evidence_scope,scope);
  const second=await assistant.respond({...input,agent_id:'quality-evaluator',inputs:{...scope,sprint_id:'sprint-2'}});
  assert.notEqual(first.provenance.input_fingerprint,second.provenance.input_fingerprint);
});

test('successors receive only assigned findings and fresh evidence, and preserve the scope boundary', async t => {
  setupAssistant(t);
  t.mock.method(require('../services/dropdownCatalog.service'),'getField',async()=>({options:[{value:'functional',active:true}]}));
  const scope={story_id:'story-1',sprint_id:'sprint-1'};
  const retrievals=[],payloads=[];
  t.mock.method(require('../../../knowledge/backend/services/knowledgeRetrieval.service'),'retrieveSearch',async request=>{
    retrievals.push(request);
    const id=`K-fresh-${retrievals.length}`;
    return {results:[{chunk_id:id,title:'Current selected Story',source_kind:'live_project',content:JSON.stringify({evidence_type:'authoritative_live_story_snapshot',records:[{id:'story-1',title:'Checkout',revision:1}]}),citation:{id,source_kind:'live_project'}}],retrieval:{}};
  });
  t.mock.method(globalThis,'fetch',async(_url,request)=>{
    const payload=JSON.parse(JSON.parse(request.body).messages.at(-1).content);payloads.push(payload);
    const citation=payload.citation_contract[0].id;
    const findings=payloads.length===1 ? [
      {id:'story-gap',title:'Missing acceptance boundary',detail:'Story needs the documented retry boundary.',artifact_kind:'story',requires_proposal:true,citation_ids:[citation]},
      {id:'analysis-only',title:'Review owner',detail:'A person must review the output.',requires_proposal:false,citation_ids:[citation]}
    ] : [{id:'story-gap',title:'Missing acceptance boundary',detail:'The current Story still needs the documented retry boundary.',artifact_kind:'story',requires_proposal:true,citation_ids:[citation]}];
    const artifacts=payloads.length===1 ? [] : [{kind:'story',title:'Checkout retry',description:'Preserve the approved retry behavior.',priority:'P2',acceptance_criteria:['A repeated checkout retains one order.'],addressed_finding_ids:['story-gap'],citation_ids:[citation]}];
    return Response.json({choices:[{message:{content:JSON.stringify({response:`Selected Story review [${citation}]`,citation_ids:[citation],findings,artifacts,recommendations:[],deliverables:[],evidence_gaps:[]})}}]});
  });
  const review=await assistant.respond({...input,agent_id:'quality-evaluator',inputs:scope});
  assert.equal(payloads.length,2);
  assert.equal(retrievals.length,2);
  assert.deepEqual(payloads[1].previous_specialist_review.findings.map(f=>f.id),['story-gap']);
  assert.equal(payloads[1].previous_specialist_review.provenance,'untrusted_prior_model_review');
  assert.deepEqual(payloads[1].citation_contract.map(c=>c.id),['K-fresh-2']);
  assert.deepEqual(retrievals[1].filters.evidence_scope,scope);
  assert.deepEqual(payloads[1].evidence_scope,scope);
  assert.deepEqual(review.result.agent_chain[1].addressed_finding_ids,['story-gap']);
  assert.equal(review.result.agent_chain[1].verification.status,'passed');
  assert.equal(review.result.artifacts.length,1);
});

test('pinned case context fails closed when additional evidence identifiers do not intersect',async t=>{
  let params;
  t.mock.method(db,'prepare',sql=>({get:async(...values)=>{assert.match(sql,/scope_sprint/);params=values;return null;}}));
  await assert.rejects(assistant._internals.assertPinnedCaseScope({projectId:'p',appTypeId:'a',evidenceScope:{test_case_id:'case-1',sprint_id:'other-sprint'}}),{code:'AGENT_EVIDENCE_SCOPE_MISMATCH'});
  assert.ok(params.includes('other-sprint'));
});

test('a successor cannot claim that an unrelated finding was resolved', async t => {
  setupAssistant(t);
  const payloads=[];
  t.mock.method(globalThis,'fetch',async(_url,request)=>{
    const payload=JSON.parse(JSON.parse(request.body).messages.at(-1).content);payloads.push(payload);
    const id=payload.citation_contract[0].id;
    const findings=[{id:'assigned-story-gap',title:'Missing story acceptance',detail:'Clarify the documented retry boundary.',artifact_kind:'story',requires_proposal:true,citation_ids:[id]}];
    const artifact={kind:'story',title:'Checkout',description:'Checkout retry boundary.',priority:'P2',acceptance_criteria:['One order remains.'],citation_ids:[id],addressed_finding_ids:['unassigned-finding']};
    return Response.json({choices:[{message:{content:JSON.stringify({response:`Selected boundary [${id}]`,citation_ids:[id],findings,artifacts:payloads.length===1?[]:[artifact],evidence_gaps:[]})}}]});
  });
  const review=await assistant.respond({...input,agent_id:'quality-evaluator',inputs:{story_id:'story-1'}});
  assert.equal(review.result.artifacts.length,0);
  assert.equal(review.result.agent_chain[1].status,'needs_input');
  assert.equal(review.result.agent_chain[0].status,'needs_input');
  assert.equal(review.result.primary_review.findings[0].id,'assigned-story-gap');
  assert.equal(review.result.verification.status,'needs_input');
  assert.ok(review.result.evidence_gaps.some(gap=>gap.includes('follow-up specialist')));
});

test('scope identifiers and prior workflow claims cannot substitute for missing scoped records',()=>{
  const readiness=assistant._internals.buildEvidenceReadiness({
    context:{workflow_input:[{id:'supplied',content:'A previous specialist claimed this sprint was ready.'}]},
    contextRoute:{evidence_scope:{sprint_id:'unavailable-sprint'},priority_scopes:[]}
  });
  assert.equal(readiness.status,'insufficient_evidence');
  assert.equal(readiness.task_evidence_count,0);
  assert.ok(readiness.limitations.some(gap=>gap.includes('No authorized record evidence matched')));
});

test('automation successor authoring uses concrete view permissions and returns a scoped Plan',async t=>{
  setupAssistant(t);
  t.mock.method(permissions,'hasPermission',async(_user,code)=>{assert.equal(typeof code,'string','Every handoff must check a concrete permission.');return true;});
  t.mock.method(require('../services/dropdownCatalog.service'),'getField',async()=>({options:[{value:'functional'}]}));
  const requests=[];
  t.mock.method(require('../../../knowledge/backend/services/knowledgeRetrieval.service'),'retrieveSearch',async()=>({results:[{
    chunk_id:'K-selected-case',source_kind:'live_project',title:'Selected case',content:JSON.stringify({evidence_type:'authoritative_live_test_case_snapshot',records:[{id:'case-1',title:'Checkout'}]}),citation:{id:'K-selected-case',source_kind:'live_project'}
  }],retrieval:{}}));
  t.mock.method(globalThis,'fetch',async(_url,request)=>{
    const payload=JSON.parse(JSON.parse(request.body).messages.at(-1).content);requests.push(payload);
    const finding={id:'automation-gap',title:'Missing automation plan',detail:'Prepare the approved checkout case as an Automation Plan.',artifact_kind:'automation',requires_proposal:true,citation_ids:['K-selected-case']};
    const proposal={kind:'automation',title:'Checkout automation',description:'Observe the selected checkout case.',priority:'P2',test_case_type:'functional',parameter_values:{},start_url:'https://checkout.example.test/',manual_test_case_ids:['case-1'],steps:[{step_type:'web',action:'Open checkout.',expected_result:'Checkout is displayed.'}],citation_ids:['K-selected-case'],addressed_finding_ids:['automation-gap']};
    return Response.json({choices:[{message:{content:JSON.stringify({response:'Prepare the selected case [K-selected-case].',citation_ids:['K-selected-case'],findings:[finding],artifacts:requests.length===1?[]:[proposal],evidence_gaps:[]})}}]});
  });
  const review=await assistant.respond({...input,agent_id:'quality-evaluator',context_scopes:['test-cases','automation'],inputs:{test_case_id:'case-1'}});
  assert.equal(requests.length,2);
  assert.equal(review.result.agent_chain[1].agent_id,'automation-engineer');
  assert.equal(review.result.agent_chain[1].status,'completed');
  assert.equal(review.result.artifacts[0].kind,'automation');
  assert.deepEqual(review.result.artifacts[0].manual_test_case_ids,['case-1']);
});
