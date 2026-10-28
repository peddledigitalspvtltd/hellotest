const assert = require("node:assert/strict");
const test = require("node:test");
const { EventEmitter } = require("node:events");
const assistant = require("../../../agentic/backend/services/agenticAssistant.service");
const workflows = require("../../../agentic/backend/services/agenticWorkflow.service");
const routes = require("../../../agentic/backend/routes/agenticWorkflows.routes");
const context = require("../../../ai/backend/services/aiContextOrchestrator.service");
const knowledge = require("../../../knowledge/backend/services/aiKnowledge.service");
const rag = require("../../../knowledge/backend/services/knowledgeRag.service");
const selection = require("../../../integration/backend/services/aiLlmSelection.service");
const transactions = require("../services/workspaceTransaction.service");
const permissions = require("../services/permission.service");
const flags = require("../services/featureFlag.service");
const projects = require("../services/project.service");
const appTypes = require("../services/appType.service");
const db = require("../src/db");
const obsDb = require("../src/obsDb");
const resilience = require("../src/utils/resilientHttpClient");
const execution = require("../../../knowledge/backend/services/knowledgeExecution.service");
const { ROUTE_PERMISSIONS } = require("../src/security/permissions.catalog");
const { validateInput } = require("../src/plugins/validator");

const user = { id: "agent-user", role: "member" };
const input = { project_id: "project-a", user, agent_id: "quality-evaluator", mode: "agent", prompt: "Review missing story acceptance criteria", context_scopes: ["stories", "knowledge"] };
const node = (id, kind = "agent", data = {}) => ({ id, data: { label: id, kind, ...data } });
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
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ response: citation ? `Story coverage needs review [${citation.id}]` : "Task evidence is missing; supply current story evidence.", citation_ids: citation ? [citation.id] : [], findings: citation ? [{ title: "Story coverage", detail: "Review missing boundaries.", requires_proposal: false, citation_ids: [citation.id] }] : [], deliverables: [], evidence_gaps: citation ? [] : ["Task-specific evidence is unavailable."] }) } }] }), { headers: { "content-type": "application/json" } });
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

test("a project name is not sufficient evidence for a specialist review", () => {
  const project = context._internals.makeLiveHit({ projectId: "project-a", scope: "project-overview", title: "Project", content: JSON.stringify({ evidence_type: "authoritative_live_project_record", project: { name: "Demo" } }) });
  const workspace = { live_project: [{ ...project, content: project.content }] };
  const route = context.planContext({ prompt: input.prompt, agentId: input.agent_id });
  const result = assistant._internals.buildFallbackResult({ agent: assistant.AGENT_CATALOG[input.agent_id], agentId: input.agent_id, mode: "agent", prompt: input.prompt, context: workspace, contextCounts: { live_project: 1 }, citations: assistant._internals.buildCitations(workspace), contextRoute: route });
  assert.equal(result.readiness.status, "insufficient_evidence");
  assert.equal(result.readiness.task_evidence_count, 0);
  assert.equal(result.grounding_status, "insufficient_context");
  for (const key of ["grounding", "completeness", "traceability", "risk_control", "maturity_score"]) assert.equal(result.evaluation[key], 0);
});

test("missing models and provider failures record a failed review without a fallback answer", async t => {
  const { records } = setupAssistant(t, { model: null });
  await assert.rejects(assistant.respond(input), { code: "AGENT_MODEL_REQUIRED" });
  assert.equal(records.at(-1).status, "failed");
  assert.equal(records.some(record => record.status === "completed"), false);
  t.mock.method(selection, "resolveLlmIntegrationForUsage", async () => ({ name: "Model", model: "test", base_url: "https://model.example.test/v1", api_key: "fixture-only-key" }));
  const calls = t.mock.method(globalThis, "fetch", async () => new Response("provider outage", { status: 503 }));
  await assert.rejects(assistant.respond(input), { code: "AGENT_PROVIDER_ERROR", statusCode: 503 });
  assert.equal(calls.mock.callCount(), 1);
  assert.equal(records.at(-1).metadata.error_code, "AGENT_PROVIDER_ERROR");
  assert.equal(records.some(record => record.status === "completed"), false);
});

test("repeated identical invalid model output stops repair and never becomes success", async t => {
  const { records } = setupAssistant(t);
  const calls = t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ response: "Unverified result [invented]", citation_ids: ["invented"] }) } }] }), { headers: { "content-type": "application/json" } }));
  await assert.rejects(assistant.respond(input), { code: "AGENT_OUTPUT_INVALID" });
  assert.equal(calls.mock.callCount(), 2);
  assert.equal(records.at(-1).status, "failed");
  assert.equal(records.some(record => record.status === "completed"), false);
});

test("a published agent enforces its input contract, skills and one-call budget", async t => {
  setupAssistant(t);
  const contract = require("../../../agentic/backend/agents/agentDefinition");
  const definition = contract.normalize({ name: "Release gate", objective: "Review the supplied release.", instructions: "Identify unsupported boundaries.", required_inputs: ["release_id"], skills: [{ id: "boundaries", name: "Boundaries", instructions: "Assess retry boundaries." }], allowed_tools: [], context_scopes: [], limits: { max_model_calls: 1 }, acceptance: { minimum_findings: 1 } });
  t.mock.method(require("../../../agentic/backend/agents/agentRegistry.service"), "resolve", async () => ({ id: "agent-fixture", version: 3, definition, definition_hash: contract.definitionHash(definition) }));
  const requests = [];
  t.mock.method(globalThis, "fetch", async (_url, request) => {
    requests.push(JSON.parse(request.body));
    return new Response(JSON.stringify({ model: "effective-test-model", usage: { prompt_tokens: 70, completion_tokens: 15, total_tokens: 85 }, choices: [{ message: { content: JSON.stringify({ response: "Release was supplied [K-workflow-input]", citation_ids: ["K-workflow-input"], findings: [], evidence_gaps: [] }) } }] }), { headers: { "content-type": "application/json", "x-request-id": "provider-observation" } });
  });
  await assert.rejects(assistant.respond({ ...input, agent_id: "agent-fixture" }), { code: "AGENT_INPUT_REQUIRED" });
  assert.equal(requests.length, 0);
  const review = await assistant.respond({ ...input, agent_id: "agent-fixture", agent_version: 3, inputs: { release_id: "r1" } });
  assert.match(JSON.stringify(requests[0].messages), /Assess retry boundaries/);
  assert.equal(review.result.verification.status, "needs_input");
  assert.equal(review.result.readiness.status, "insufficient_evidence");
  assert.equal(review.result.model_execution.agent_version, 3);
  assert.equal(review.result.model_execution.model_calls, 1);
  assert.equal(review.result.model_execution.effective_model, "effective-test-model");
  assert.equal(review.result.model_execution.provider_request_id, "provider-observation");
  assert.equal(review.result.model_execution.usage.total_tokens, 85);
  const invalid = t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ choices: [{ message: { content: "{invalid-json" } }] }), { headers: { "content-type": "application/json" } }));
  await assert.rejects(assistant.respond({ ...input, agent_id: "agent-fixture", inputs: { release_id: "r1" } }), { code: "AGENT_OUTPUT_INVALID" });
  assert.equal(invalid.mock.callCount(), 1);
});

test("custom AI calls the selected model on supplied workflow input with retrieval disabled", async t => {
  resilience.resetServiceResilienceState();
  setupAssistant(t, { model: {name:'Configured model', model:'test-model', base_url:'https://model.example.test/v1', api_key:'test-only-credential'} });
  t.mock.method(knowledge,'buildKnowledgeContextPackage',async()=>assert.fail('Disabled knowledge tool must not run'));
  t.mock.method(context,'buildLiveProjectEvidence',async()=>assert.fail('Disabled project evidence tool must not run'));
  const requests=[];
  t.mock.method(globalThis,'fetch',async(_url, request)=>{
    requests.push(JSON.parse(request.body));
    return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({response:'There are two checkout items [K-workflow-input]',citation_ids:['K-workflow-input'],recommendations:[],findings:[],deliverables:[]})}}]}),{headers:{'content-type':'application/json'}});
  });
  const result=await assistant.respond({...input,prompt:'Count the connected checkout items.',context_scopes:[],workflow_policy:{custom_task:true,allowed_tools:[],connected_input:{items:['one','two']}}});
  assert.equal(requests.length,1);
  assert.equal(result.provenance.generation_mode,'llm');
  assert.match(result.result.response,/two checkout items/);
  assert.deepEqual(result.citations.map(citation=>citation.id),['K-workflow-input']);
  assert.match(JSON.stringify(requests[0]),/unverified/);
  assert.deepEqual(result.provenance.context_route.effective_scopes,[]);
});

test("specialist retrieval starts indexed and current evidence concurrently", async t => {
  setupAssistant(t);
  let releaseKnowledge;
  const indexed = new Promise((resolve) => { releaseKnowledge = resolve; });
  t.mock.method(knowledge, "buildKnowledgeContextPackage", () => indexed);
  t.mock.method(context, "buildLiveProjectEvidence", async () => { releaseKnowledge({ knowledge: [], retrieval: {} }); return { hits: [storyHit()], counts: { stories: 5 } }; });
  const result = await assistant.respond(input);
  assert.equal(result.provenance.generation_mode, "llm");
  assert.equal(result.result.readiness.status, "ready_for_review");
  assert.ok(result.result.findings.some((finding) => finding.title.includes("coverage")));
});

test("failed knowledge retrieval preserves available current project evidence", async t => {
  setupAssistant(t);
  t.mock.method(knowledge, "buildKnowledgeContextPackage", async () => { throw new Error("private provider details"); });
  const result = await assistant.respond(input);
  assert.ok(result.citations.length);
  assert.equal(result.provenance.degraded, true);
  assert.match(result.result.evidence_gaps.join(" "), /Knowledge retrieval was unavailable/);
  assert.doesNotMatch(JSON.stringify(result), /private provider details/);
});

test("disabled knowledge capability prevents specialist retrieval even when its permission is granted", async t => {
  setupAssistant(t);
  t.mock.method(flags, "areEnabled", async () => false);
  t.mock.method(knowledge, "buildKnowledgeContextPackage", async () => assert.fail("Disabled knowledge must not be retrieved"));
  t.mock.method(rag, "search", async () => assert.fail("Disabled knowledge must not be retrieved"));
  const result = await assistant.respond(input);
  assert.ok(result.citations.length, "Permitted live project evidence still remains available");
});

test("indexed source permissions exclude disabled product capabilities", async t => {
  t.mock.method(permissions, "hasPermission", async () => true);
  t.mock.method(flags, "areEnabled", async keys => !keys.includes("hellotest.manual.requirements"));
  const allowed = await rag.resolveAllowedSourcePermissions(user, "project-a");
  assert.equal(allowed.includes("requirement.view"), false);
  assert.ok(allowed.includes("testcase.view"));
});

test("failed live reads never become an authoritative zero", async t => {
  setupAssistant(t);
  t.mock.method(context, "buildLiveProjectEvidence", async () => { throw new Error("database unavailable"); });
  const result = await assistant.respond(input);
  assert.equal(result.result.readiness.status, "insufficient_evidence");
  assert.equal(result.result.evaluation.grounding, 0);
  assert.match(result.result.evidence_gaps.join(" "), /current counts and states could not be confirmed/);
});

test("revoked run permission prevents any specialist transaction or model call", async t => {
  const { records } = setupAssistant(t);
  t.mock.method(permissions, "hasPermission", async () => false);
  await assert.rejects(assistant.respond(input), { statusCode: 403 });
  assert.equal(records.length, 0);
});

test("unknown specialist IDs fail instead of silently invoking the orchestrator", async t => {
  const { records } = setupAssistant(t);
  await assert.rejects(assistant.respond({ ...input, agent_id: "invented" }), { statusCode: 400 });
  assert.equal(records.length, 0);
});

test("cancelled specialist requests stop retrieval and never publish a completed response", async t => {
  const { events, records } = setupAssistant(t);
  let started;
  const ready = new Promise((resolve) => { started = resolve; });
  t.mock.method(context, "buildLiveProjectEvidence", async () => { started(); return new Promise(() => {}); });
  const controller = new AbortController();
  const pending = assistant.respond({ ...input, signal: controller.signal });
  await ready;
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(events.some((event) => event.status === "failed" && event.metadata.cancelled));
  assert.equal(records.filter((record) => record.status === "completed").length, 0);
});

test("citation validation rejects uncited findings and invented citations in summaries", () => {
  const fallback = { response: "fallback", recommendations: [], assumptions: [], suggested_handoffs: [], evaluation: {} };
  const candidate = { response: "Observed coverage [K-real]", citation_ids: ["K-real"] };
  assert.equal(assistant._internals.normalizeResult({ ...candidate, findings: [{ title: "Claim", detail: "Unsupported", citation_ids: [] }] }, fallback, [{ id: "K-real" }]), fallback);
  assert.equal(assistant._internals.normalizeResult({ ...candidate, executive_summary: "Invented claim [K-fake]" }, fallback, [{ id: "K-real" }]), fallback);
});

test("specialist transport failures do not replay a potentially billable generation", async t => {
  resilience.resetServiceResilienceState();
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (_url, request) => {
    assert.ok(request.signal);
    calls += 1;
    return calls === 1 ? new Response("temporary outage", { status: 503 }) : new Response(JSON.stringify({ choices: [{ message: { content: '{"response":"Observed [K-real]","citation_ids":["K-real"]}' } }] }), { headers: { "content-type": "application/json" } });
  });
  await assert.rejects(execution.bounded(() => assistant._internals.requestLlmResult({ integration: { name: "Provider", base_url: "https://llm.example.test/v1", model: "test", api_key: "test-key" }, agent: assistant.AGENT_CATALOG["story-architect"], mode: "agent", prompt: input.prompt, context: {}, citations: [{ id: "K-real" }], history: [], contextRoute: context.planContext({ prompt: input.prompt, agentId: "story-architect" }), knowledgeRetrieval: {} }), { timeoutMs: 3_000 }), /503/);
  assert.equal(calls, 1);
});

test("specialist repairs one malformed model response without losing the evidence contract", async t => {
  resilience.resetServiceResilienceState();
  const model = { name: "Review provider", model: "review-model", base_url: "https://review.example.test/v1", api_key: "valid-credential-for-fixture" };
  setupAssistant(t, { model });
  const requests = [];
  t.mock.method(globalThis, "fetch", async (_url, request) => {
    const body = JSON.parse(request.body);
    requests.push(body);
    const payload = JSON.parse(body.messages.at(-1).content);
    const citation = payload.citation_contract.find((item) => item.id.includes("stories"));
    const content = requests.length === 1 ? "invalid review json" : JSON.stringify({ response: `Two stories need coverage review [${citation.id}]`, citation_ids: [citation.id], findings: [{ title: "Story gaps", detail: "Two uncovered stories need review", requires_proposal: false, citation_ids: [citation.id] }] });
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { headers: { "content-type": "application/json" } });
  });
  const result = await assistant.respond(input);
  assert.ok(requests.length >= 2 && requests.length <= 4);
  assert.equal(requests.length, result.result.model_execution.model_calls);
  const firstPayload = JSON.parse(requests[0].messages.at(-1).content);
  const { revision_feedback, ...repairPayload } = JSON.parse(requests[1].messages.at(-1).content);
  assert.deepEqual(repairPayload, firstPayload);
  assert.equal(revision_feedback.round, 1);
  assert.equal(revision_feedback.issues[0].issue, 'valid_json_object_required');
  assert.match(requests[1].messages[0].content, /preceding attempt did not meet/);
  assert.equal(result.provenance.generation_mode, "llm");
  assert.equal(result.result.evaluation.method, "model_assessment");
  assert.equal(result.result.findings[0].title, "Story gaps");
});

test("missing task evidence produces a model-generated abstention rather than a deterministic success", async t => {
  setupAssistant(t, { model: { name: "Review provider", model: "review-model", base_url: "https://review.example.test/v1", api_key: "valid-credential-for-fixture" } });
  t.mock.method(context, "buildLiveProjectEvidence", async () => ({ hits: [context._internals.makeLiveHit({ projectId: "project-a", scope: "project-overview", title: "Project", content: JSON.stringify({ evidence_type: "authoritative_live_project_record" }) })], counts: {} }));

  const result = await assistant.respond(input);
  assert.equal(result.provenance.generation_mode, "llm");
  assert.equal(result.result.readiness.status, "insufficient_evidence");
});

test("workflow preview follows dependencies instead of visual array order", () => {
  const graph = { id: "workflow", nodes: [node("finish", "output"), node("review", "agent", { sampleOutput: "A declared example" }), node("start", "trigger")], edges: [{ id: "a", source: "start", target: "review" }, { id: "b", source: "review", target: "finish" }] };
  const preview = workflows._internals.buildRunArtifacts(graph, { request: "Review" }, "preview-a");
  assert.deepEqual(preview.nodeResults.map((result) => result.node_id), ["start", "review", "finish"]);
  assert.equal(preview.nodeResults[1].input.sources[0].output_available, true);
  assert.equal(preview.outputPayload.execution_mode, "preview");
  assert.equal(preview.snapshot.runtime_contract.model_called, false);
  assert.equal(preview.snapshot.runtime_contract.tools_executed, false);
  assert.ok(preview.nodeResults.every((result) => result.status === "previewed" && result.attempts === 0));
  assert.equal(preview.nodeResults[2].output.step_1, null);
  assert.doesNotMatch(JSON.stringify(preview), /Tool adapter.*resolved|Completed finish/);
});

test("workflow graph rejects cycles, missing steps, duplicate IDs and oversized graphs", () => {
  const validate = workflows._internals.validateWorkflowGraph;
  assert.throws(() => validate([node("a"), node("b")], [{ source: "a", target: "b" }, { source: "b", target: "a" }]), /cycle/);
  assert.throws(() => validate([node("a")], [{ source: "a", target: "missing" }]), /existing workflow steps/);
  assert.throws(() => validate([node("a"), node("a")], []), /unique ID/);
  assert.throws(() => validate(Array.from({ length: 101 }, (_, i) => node(String(i))), []), /100 steps/);
  assert.throws(() => validate([], [], { requireNodes: true }), /at least one/);
  assert.deepEqual(validate([], []), []);
});

test("workflow preview treats prototype-like node IDs as plain identifiers", () => {
  const result = workflows._internals.buildRunArtifacts({ nodes: [node("__proto__", "trigger"), node("constructor")], edges: [{ source: "__proto__", target: "constructor" }] }, {}, "preview-a");
  assert.equal(result.nodeResults[1].input.sources[0].source_node_id, "__proto__");
});

test("fan-in workflow previews bound nested upstream outputs instead of expanding exponentially", () => {
  const nodes = Array.from({ length: 80 }, (_, index) => node(String(index), index ? "aggregator" : "trigger"));
  const edges = nodes.flatMap((current, index) => index > 1 ? [{ source: String(index - 1), target: current.id }, { source: String(index - 2), target: current.id }] : index ? [{ source: "0", target: "1" }] : []);
  const preview = workflows._internals.buildRunArtifacts({ nodes, edges }, { large: "x".repeat(100_000) }, "preview-a");
  assert.equal(preview.nodeResults.length, 80);
  assert.ok(JSON.stringify(preview).length < 2_000_000);
  assert.equal(preview.nodeResults[0].input.payload.truncated, true);
});

test("unscoped workflow lists are limited to projects the actor can view", async t => {
  const calls = [];
  t.mock.method(db, "prepare", (sql) => ({ all: async (...params) => { calls.push({ sql, params }); return []; } }));
  await workflows.listWorkflows({ user });
  await workflows.listWorkflowRuns({ user, limit: 9999 });
  for (const call of calls) {
    assert.match(call.sql, /project_members member/);
    assert.match(call.sql, /permission\.code = \?/);
    assert.ok(call.params.includes(user.id));
    assert.ok(call.params.includes("agentic_workflow.view"));
    assert.ok(call.params.at(-1) <= 200);
  }
});

test("API diagnostics stop reading large responses after a bounded preview", async t => {
  let cancelled = false;
  let chunks = 0;
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    assert.equal(init.redirect, "manual");
    return new Response(new ReadableStream({ pull(controller) { chunks += 1; controller.enqueue(new Uint8Array(32768).fill(65)); }, cancel() { cancelled = true; } }), { headers: { "content-type": "text/plain" } });
  });
  const result = await workflows.testApiAgent({ method: "GET", url: "https://api.example.test/data", responseStyle: "text" });
  assert.equal(result.truncated, true);
  assert.equal(result.preview.length, 96 * 1024);
  assert.ok(chunks <= 5);
  assert.equal(cancelled, true);
});

test("API diagnostics mask query credentials, echoed secrets, and sensitive JSON fields", async t => {
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ token: "a-new-server-token", echoed: "provided-test-secret", ok: true }), { headers: { "content-type": "application/json" } }));
  const result = await workflows.testApiAgent({ url: "https://api.example.test/data", credential: { location: "query", keyName: "key", secret: "provided-test-secret" } });
  assert.doesNotMatch(JSON.stringify(result), /provided-test-secret|a-new-server-token/);
  assert.equal(result.preview.token, "[REDACTED]");
  assert.equal(result.preview.ok, true);
});

test("API diagnostic rejects unsupported methods rather than silently sending GET", async () => {
  await assert.rejects(workflows.testApiAgent({ method: "TRACE", url: "https://api.example.test" }), /supported HTTP method/);
  await assert.rejects(workflows.testApiAgent({ url: "https://name:password@api.example.test" }), /credential field/);
});

test("workflow ID routes recheck permission in the actual owning project", async t => {
  const registered = new Map();
  const checked = [];
  const app = {
    ...Object.fromEntries(["get", "post", "put", "delete"].map((method) => [method, (url, handler) => registered.set(`${method} ${url}`, handler)])),
    authenticate: async () => {}, validate: () => {},
    requirePermission: (permission, { projectId }) => async () => { checked.push([permission, projectId]); throw Object.assign(new Error("denied"), { statusCode: 403 }); }
  };
  t.mock.method(projects, "getProject", async () => ({ id: "project-b" }));
  t.mock.method(workflows, "getWorkflow", async () => ({ id: "workflow-b", project_id: "project-b" }));
  t.mock.method(workflows, "getWorkflowRun", async () => ({ id: "run-b", project_id: "project-b" }));
  await routes(app);
  for (const key of ["get /agentic-workflows/:id", "put /agentic-workflows/:id", "delete /agentic-workflows/:id", "post /agentic-workflows/:id/runs", "get /agentic-workflow-runs/:id"]) {
    await assert.rejects(registered.get(key)({ user, params: { id: "foreign" }, body: { project_id: "project-a" } }), { statusCode: 403 });
  }
  assert.ok(checked.every(([, project]) => project === "project-b"));
});

test("assistant route forwards disconnect cancellation and removes listeners", async t => {
  const registered = new Map();
  const app = {
    ...Object.fromEntries(["get", "post", "put", "delete"].map((method) => [method, (url, handler) => registered.set(`${method} ${url}`, handler)])),
    authenticate: async () => {}, validate: () => {}, requirePermission: () => async () => {}
  };
  t.mock.method(projects, "getProject", async () => ({ id: "project-a" }));
  let receivedSignal;
  t.mock.method(assistant, "respond", async ({ signal, workflow_policy }) => { assert.equal(workflow_policy, undefined, "Clients cannot forge the server execution policy"); receivedSignal = signal; signal.addEventListener("abort", () => {}); return { result: "review" }; });
  await routes(app);
  const req = { user, body: { project_id: "project-a", workflow_policy: { agent_definition: { definition: { name: "Forged", acceptance: { require_evidence: false } } } } }, raw: new EventEmitter() };
  const reply = { raw: new EventEmitter() };
  await registered.get("post /agentic-assistant/sessions")(req, reply);
  assert.ok(receivedSignal instanceof AbortSignal);
  assert.equal(req.raw.listenerCount("aborted"), 0);
  assert.equal(reply.raw.listenerCount("close"), 0);
});

test("API tests require explicit project membership and run permission before network I/O", async t => {
  const registered = new Map();
  const checked = [];
  let networkCalls = 0;
  let runAllowed = true;
  const app = {
    ...Object.fromEntries(["get", "post", "put", "delete"].map((method) => [method, (url, handler) => registered.set(`${method} ${url}`, handler)])),
    authenticate: async () => {}, validate: validateInput,
    requirePermission: (permission, { projectId }) => async () => {
      checked.push([permission, projectId]);
      if (!runAllowed || projectId !== "project-a") throw Object.assign(new Error("denied"), { statusCode: 403 });
    }
  };
  t.mock.method(projects, "getProject", async (projectId, actorId) => { checked.push(["membership", projectId, actorId]); return { id: projectId }; });
  t.mock.method(workflows, "testApiAgent", async () => { networkCalls += 1; return { ok: true }; });
  await routes(app);
  const handler = registered.get("post /agentic-workflows/api-agent-test");
  const request = (body) => ({ user, body: { url: "https://api.example.test", ...body }, raw: new EventEmitter() });
  const reply = () => ({ raw: new EventEmitter() });
  for (const body of [{}, { project_id: "" }, { project_id: "  " }, { project_id: 12 }]) await assert.rejects(handler(request(body), reply()), { statusCode: 400 });
  assert.equal(checked.length, 0);
  await assert.rejects(handler(request({ project_id: "project-b" }), reply()), { statusCode: 403 });
  runAllowed = false;
  await assert.rejects(handler(request({ project_id: "project-a" }), reply()), { statusCode: 403 });
  assert.equal(networkCalls, 0);
  runAllowed = true;
  assert.deepEqual(await handler(request({ project_id: "project-a" }), reply()), { ok: true });
  assert.equal(networkCalls, 1);
  assert.ok(checked.some((entry) => entry[0] === "membership" && entry[1] === "project-a" && entry[2] === user.id));
  assert.ok(checked.some((entry) => entry[0] === "agentic_workflow.run" && entry[1] === "project-b"));
});

test("saved specialist reviews load independently of recent-history pagination", async t => {
  const calls = [];
  const savedResult = { response: "Saved review [K-story]", recommendations: ["Review acceptance"], evaluation: { grounding: 50 }, readiness: { status: "limited_evidence" } };
  t.mock.method(transactions, "getTransaction", async (id) => ({ id, project_id: "project-b", category: "ai_agent", related_kind: "agentic_assistant_session", status: "completed", metadata: { result: savedResult, citations: [{ id: "K-story" }], guardrails: ["Review required"], provider: "Evidence engine", generation_mode: "deterministic", input_fingerprint: "saved-fingerprint", degraded: true } }));
  t.mock.method(projects, "getProject", async (projectId, actorId) => { calls.push([projectId, actorId]); return {}; });
  t.mock.method(permissions, "hasPermission", async (_user, permission, projectId) => { calls.push([permission, projectId]); return true; });
  t.mock.method(transactions, "listTransactionEvents", async () => [{ phase: "outcome", message: "Review complete" }]);
  const restored = await assistant.getSession("older-review-id", user);
  assert.equal(restored.transaction.id, "older-review-id");
  assert.equal(restored.result.response, savedResult.response);
  assert.deepEqual(restored.result.recommendations, savedResult.recommendations);
  assert.deepEqual(restored.result.assumptions, []);
  assert.deepEqual(restored.result.evidence_gaps, []);
  assert.deepEqual(restored.transaction.metadata.result, restored.result);
  assert.equal(restored.provenance.input_fingerprint, "saved-fingerprint");
  assert.equal(restored.provenance.degraded, true);
  assert.equal(restored.session_state, "completed");
  assert.deepEqual(calls, [["project-b", user.id], ["agentic_workflow.view", "project-b"]]);
  assert.equal(ROUTE_PERMISSIONS.get("GET /agentic-assistant/sessions/:id"), "agentic_workflow.view");
});

test("saved review permissions are checked before exposing events or outcomes", async t => {
  t.mock.method(transactions, "getTransaction", async () => ({ id: "review", project_id: "project-b", category: "ai_agent", related_kind: "agentic_assistant_session", status: "completed", metadata: { result: { response: "private" } } }));
  t.mock.method(projects, "getProject", async () => ({}));
  t.mock.method(permissions, "hasPermission", async () => false);
  t.mock.method(transactions, "listTransactionEvents", async () => assert.fail("Unauthorized requests must not load review events"));
  await assert.rejects(assistant.getSession("review", user), { statusCode: 403 });
});

test("non-review and missing transaction IDs are not exposed as agent sessions", async t => {
  t.mock.method(transactions, "getTransaction", async () => ({ id: "other", project_id: "project-a", category: "bug", related_kind: "bug_creation", status: "completed" }));
  await assert.rejects(assistant.getSession("other", user), { statusCode: 404 });
  t.mock.method(transactions, "getTransaction", async () => { throw new Error("Workspace transaction not found"); });
  await assert.rejects(assistant.getSession("missing", user), { statusCode: 404 });
});

test("in-progress, failed and incomplete saved reviews do not fabricate results", async t => {
  t.mock.method(projects, "getProject", async () => ({}));
  t.mock.method(permissions, "hasPermission", async () => true);
  t.mock.method(transactions, "listTransactionEvents", async () => []);
  for (const [status, expected] of [["queued", "running"], ["running", "running"], ["failed", "failed"], ["completed", "unavailable"]]) {
    t.mock.method(transactions, "getTransaction", async () => ({ id: "review", project_id: "project-a", category: "ai_agent", related_kind: "agentic_assistant_session", status, metadata: {} }));
    const result = await assistant.getSession("review", user);
    assert.equal(result.result, null);
    assert.equal(result.session_state, expected);
    assert.equal(result.provenance.generation_mode, "unknown");
    assert.equal(result.provenance.input_fingerprint, null);
  }
});

test("legacy review outcomes normalize missing lists and diagnostics without changing stored data", async t => {
  const stored = { response: "Historical review", findings: [null, { title: "Coverage", detail: "Review it" }], assumptions: "not-an-array", evaluation: { grounding: 900 } };
  t.mock.method(projects, "getProject", async () => ({}));
  t.mock.method(permissions, "hasPermission", async () => true);
  t.mock.method(transactions, "listTransactionEvents", async () => []);
  t.mock.method(transactions, "getTransaction", async () => ({ id: "review", project_id: "project-a", category: "ai_agent", related_kind: "agentic_assistant_session", status: "completed", metadata: { result: stored } }));
  const restored = await assistant.getSession("review", user);
  assert.equal(restored.session_state, "completed");
  for (const key of ["recommendations", "assumptions", "evidence_gaps", "suggested_handoffs", "citation_ids"]) assert.deepEqual(restored.result[key], []);
  assert.equal(restored.result.evaluation.grounding, 100);
  assert.equal(restored.result.evaluation.completeness, 0);
  assert.equal(restored.result.findings.length, 1);
  assert.deepEqual(restored.result.findings[0].citation_ids, []);
  assert.equal(stored.assumptions, "not-an-array");
  assert.equal(stored.recommendations, undefined);
});

test("specialist history uses agent view permission with explicit project and app scope", async t => {
  const checks = [];
  const queries = [];
  t.mock.method(projects, "getProject", async (id, actorId) => { checks.push(["membership", id, actorId]); return { id }; });
  t.mock.method(permissions, "hasPermission", async (_user, permission, projectId) => { checks.push([permission, projectId]); return permission === "agentic_workflow.view"; });
  t.mock.method(appTypes, "getAppType", async id => ({ id, project_id: "project-a" }));
  t.mock.method(transactions, "listTransactions", async query => { queries.push(query); return [{ id: "review" }]; });
  assert.deepEqual(await assistant.listSessions({ project_id: "project-a", app_type_id: "app-a" }, user), [{ id: "review", description: null, metadata: {} }]);
  await assistant.listSessions({ project_id: "project-a", limit: 1000 }, user);
  assert.equal(queries[0].limit, 20);
  assert.equal(queries[1].limit, 100);
  assert.equal(queries[0].project_id, "project-a");
  assert.equal(queries[0].app_type_id, "app-a");
  assert.equal(queries[0].category, "ai_agent");
  assert.equal(queries[0].related_kind, "agentic_assistant_session");
  assert.equal(queries[0].include_global, false);
  assert.ok(checks.some(entry => entry[0] === "agentic_workflow.view" && entry[1] === "project-a"));
  assert.ok(!checks.some(entry => entry[0] === "transaction.view"));
  assert.equal(ROUTE_PERMISSIONS.get("GET /agentic-assistant/sessions"), "agentic_workflow.view");
});

test("specialist history denies missing project, revoked permission and foreign app before listing", async t => {
  t.mock.method(projects, "getProject", async () => ({}));
  t.mock.method(permissions, "hasPermission", async () => false);
  t.mock.method(transactions, "listTransactions", async () => assert.fail("Unauthorized history must not be loaded"));
  await assert.rejects(assistant.listSessions({}, user), { statusCode: 400 });
  await assert.rejects(assistant.listSessions({ project_id: "project-a" }, user), { statusCode: 403 });
  t.mock.method(permissions, "hasPermission", async () => true);
  t.mock.method(appTypes, "getAppType", async () => ({ project_id: "project-b" }));
  await assert.rejects(assistant.listSessions({ project_id: "project-a", app_type_id: "foreign" }, user), { statusCode: 400 });
});

test("specialist history excludes unrelated agent transactions in SQL before applying limits", async t => {
  let captured;
  t.mock.method(obsDb, "prepare", sql => ({ all: async (...params) => { captured = { sql, params }; return []; } }));
  await transactions.listTransactions({ project_id: "project-a", app_type_id: "app-a", category: "ai_agent", related_kind: "agentic_assistant_session", limit: 20 });
  assert.match(captured.sql, /workspace_transactions\.category = \?/);
  assert.match(captured.sql, /workspace_transactions\.related_kind = \?/);
  assert.deepEqual(captured.params, ["project-a", "app-a", "ai_agent", "agentic_assistant_session", 20]);
});
