const test = require("node:test");
const assert = require("node:assert/strict");
const runtime = require("../../../agentic/backend/services/agenticWorkflowExecution.service");
const assistant = require("../../../agentic/backend/services/agenticAssistant.service");
const permissions = require("../services/permission.service");
const flags = require("../services/featureFlag.service");
const { ROUTE_PERMISSIONS } = require("../src/security/permissions.catalog");

const user = { id: "reviewer", role: "member" };
const node = (id, kind, extra = {}) => ({ id, type: "agenticStep", data: { label: id, kind, ...extra } });
const workflow = () => ({ id: "workflow-a", project_id: "project-a", app_type_id: "app-a", name: "Release readiness review", status: "draft", trigger_kind: "manual",
  nodes: [node("request", "trigger"), node("story", "agent", { agentId: "story-architect", prompt: "Review missing acceptance boundaries", knowledgeScope: "requirements,test-runs,knowledge" }), node("finish", "output")],
  edges: [{ id: "a", source: "request", target: "story" }, { id: "b", source: "story", target: "finish" }], settings: {} });
const response = (status = "ready_for_review", id = "review-a") => ({ transaction: { id }, result: { response: "Coverage has a gap [K-stories-real]", citation_ids: ["K-stories-real"], readiness: { status, evidence_count: 1, task_evidence_count: 1, limitations: [] } }, provenance: { generation_mode: "llm", requires_human_review: true } });

function setup(t, review = async () => response()) {
  t.mock.method(require("../../../agentic/backend/agents/agentRegistry.service"), "resolveModel", async () => ({ id: "model", model: "test-model" }));
  const rows = new Map();
  const requests = [];
  t.mock.method(permissions, "hasPermission", async (_user, _permission, project) => project === "project-a");
  t.mock.method(flags, "areEnabled", async () => true);
  t.mock.method(runtime._internals.store, "get", async id => structuredClone(rows.get(id) || null));
  t.mock.method(runtime._internals.store, "mergePublication", async () => null);
  t.mock.method(runtime._internals.store, "insert", async row => {
    if (rows.has(row.id)) return null;
    rows.set(row.id, structuredClone(row)); return { id: row.id };
  });
  t.mock.method(runtime._internals.store, "save", async (id, status, nodes, output, expectedNodes = null) => {
    const row = rows.get(id);
    if (!row || row.status !== "running") return null;
    if (expectedNodes && JSON.stringify(expectedNodes) !== JSON.stringify(row.node_results)) return null;
    rows.set(id, structuredClone({ ...row, status, node_results: nodes, output_payload: output, completed_at: status === "running" ? null : new Date().toISOString() }));
    return { id };
  });
  t.mock.method(assistant, "respond", async input => { requests.push(input); return review(input); });
  t.after(async () => {
    const tasks = [...runtime._internals.active.values()];
    tasks.forEach(task => task.controller.abort());
    await Promise.allSettled(tasks.map(task => task.promise));
  });
  return { rows, requests };
}

async function finished(id) {
  await runtime._internals.active.get(id)?.promise;
  return runtime._internals.store.get(id);
}

test("readiness accepts implemented data nodes and rejects unconfigured or unknown operations", () => {
  assert.equal(runtime.readiness(workflow()).ready, true);
  for (const kind of ["condition", "transform", "repositoryTool", "knowledgeTool", "log"]) {
    const graph = workflow(); graph.nodes[1].data.kind = kind;
    assert.equal(runtime.readiness(graph).ready, true, kind);
  }
  for (const kind of ["loop", "apiTool", "mcpTool", "webAgent", "invented"]) {
    const graph = workflow(); graph.nodes[1].data.kind = kind;
    assert.equal(runtime.readiness(graph).ready, false, kind);
  }
  for (const update of [{ agentId: "invented" }, { prompt: "" }, { inputExpression: "{{secret}}" }, { onError: "continue" }, { toolName: "HTTP Request" }, { mergeMode: "firstAvailable" }, { timeoutMs: "500000" }, { retryCount: "10" }, { requiresApproval: true }, { toolPolicy: "approval-required" }, { outputSchema: "{}" }, { maxContextChars: "2000" }, { redactSecrets: "false" }, { parallel: true }, { credentialId: "external" }]) {
    const graph = workflow(); Object.assign(graph.nodes[1].data, update);
    assert.equal(runtime.readiness(graph).ready, false, JSON.stringify(update));
  }
});

test("readiness rejects orphaned branches, non-manual triggers and circular graphs", () => {
  const graph = workflow(); graph.nodes.push(node("orphan", "agent", { agentId: "quality-evaluator", prompt: "Review" }));
  assert.equal(runtime.readiness(graph).ready, false);
  graph.nodes.pop(); graph.trigger_kind = "schedule";
  assert.equal(runtime.readiness(graph).ready, false);
  graph.trigger_kind = "manual"; graph.edges.push({ source: "finish", target: "story" });
  assert.ok(runtime.readiness(graph).blockers.some(item => /cycle/.test(item.message)));
});

test("real review execution persists the snapshot, invokes the registered specialist and collects actual evidence", async t => {
  const { requests } = setup(t);
  const graph = workflow(); graph.nodes[1].data.sampleOutput = "Fabricated sample";
  const run = await runtime.start(graph, { request_id: "request-one", input_payload: { release: "Checkout" } }, user);
  graph.nodes[1].data.prompt = "Later mutation must not change the snapshot";
  const saved = await finished(run.id);
  assert.equal(saved.execution_mode, "review"); assert.equal(saved.status, "completed");
  assert.equal(requests.length, 1); assert.equal(requests[0].agent_id, "story-architect");
  assert.deepEqual(requests[0].context_scopes, ["stories", "runs", "knowledge"]);
  assert.equal(requests[0].project_id, "project-a"); assert.equal(requests[0].app_type_id, "app-a");
  assert.match(requests[0].prompt, /Checkout/); assert.doesNotMatch(requests[0].prompt, /Later mutation|Fabricated sample/);
  assert.equal(saved.node_results[1].output.session_id, "review-a");
  assert.deepEqual(saved.node_results[2].output.reviews[0].citation_ids, ["K-stories-real"]);
  assert.ok(saved.node_results.every(item => item.status === "completed" && item.attempts === 1));
  assert.equal(saved.output_payload.runtime_contract.project_changes_applied, false);
});

test("workflow execution replaces client agent snapshots with the published version and retains connected inputs", async t => {
  const { requests } = setup(t);
  const contract = require("../../../agentic/backend/agents/agentDefinition");
  const registered = { id: "agent-11111111-1111-4111-8111-111111111111", version: 2, definition: contract.normalize({ name: "Release review", objective: "Review supplied evidence", required_inputs: ["release_id"] }), definition_hash: "published-hash" };
  t.mock.method(require("../../../agentic/backend/agents/agentRegistry.service"), "resolve", async (id, version, project) => { assert.equal(id, registered.id); assert.equal(version, 2); assert.equal(project, "project-a"); return structuredClone(registered); });
  const graph = workflow();
  Object.assign(graph.nodes[1].data, { agentId: registered.id, agentVersion: 2, agentSnapshot: { version: 999, definition: { objective: "Forged contract" } } });
  await assert.rejects(runtime.start(graph, {}, user), { code: "AGENT_INPUT_REQUIRED" });
  const started = await runtime.start(graph, { input_payload: { release_id: "r1" } }, user);
  registered.definition.objective = "Changed after run started";
  const saved = await finished(started.id);
  assert.equal(saved.status, "completed");
  assert.equal(saved.workflow_snapshot.nodes[1].data.agentSnapshot.definition.objective, "Review supplied evidence");
  assert.equal(requests[0].workflow_policy.agent_definition.version, 2);
  assert.equal(requests[0].workflow_policy.connected_input.request.release_id, "r1");
});

test("AI nodes reject deterministic reviews and leave downstream nodes unexecuted", async t => {
  setup(t, async () => ({ ...response(), provenance: { generation_mode: "deterministic" } }));
  const run = await runtime.start(workflow(), {}, user);
  const saved = await finished(run.id);
  assert.equal(saved.status, "failed");
  assert.equal(saved.node_results[1].error_details.code, "AGENT_OUTPUT_INVALID");
  assert.equal(saved.node_results[2].status, "skipped");
});

test("simultaneous idempotent starts produce one persisted run and one specialist call", async t => {
  const { rows, requests } = setup(t);
  const input = { request_id: "request-same", input_payload: { scope: "Checkout" } };
  const [one, two] = await Promise.all([runtime.start(workflow(), input, user), runtime.start(workflow(), input, user)]);
  await finished(one.id);
  assert.equal(one.id, two.id); assert.equal(rows.size, 1); assert.equal(requests.length, 1);
  await assert.rejects(runtime.start(workflow(), { ...input, input_payload: { scope: "Billing" } }, user), { statusCode: 409 });
});

test("unsupported definitions and oversized input never create a run", async t => {
  const { rows, requests } = setup(t);
  const graph = workflow(); graph.nodes[1].data.kind = "apiTool";
  await assert.rejects(runtime.start(graph, {}, user), { statusCode: 422 });
  await assert.rejects(runtime.start(workflow(), { input_payload: { giant: "x".repeat(17000) } }, user), { statusCode: 400 });
  assert.equal(rows.size, 0); assert.equal(requests.length, 0);
});

test("permission denial and disabled agent capability prevent execution", async t => {
  const { rows } = setup(t);
  await assert.rejects(runtime.start({ ...workflow(), project_id: "other" }, {}, user), { statusCode: 403 });
  t.mock.method(flags, "areEnabled", async () => false);
  await assert.rejects(runtime.start(workflow(), {}, user), { statusCode: 403 });
  assert.equal(rows.size, 0);
});

test("cancellation remains available after the capability is disabled", async t => {
  let began; const started = new Promise(resolve => { began = resolve; });
  setup(t, async () => { began(); return new Promise(() => {}); });
  const run = await runtime.start(workflow(), {}, user); await started;
  t.mock.method(flags, "areEnabled", async () => false);
  const cancelled = await runtime.cancel(await runtime._internals.store.get(run.id), user);
  assert.equal(cancelled.status, "cancelled");
  await finished(run.id);
});

test("evidence-free results stop downstream agents instead of reporting successful execution", async t => {
  const { requests } = setup(t, async () => response("insufficient_evidence"));
  const graph = workflow(); graph.nodes.splice(2, 0, node("second", "agent", { agentId: "quality-evaluator", prompt: "Evaluate coverage" }));
  graph.edges = [{ source: "request", target: "story" }, { source: "story", target: "second" }, { source: "second", target: "finish" }];
  const run = await runtime.start(graph, {}, user); const saved = await finished(run.id);
  assert.equal(saved.status, "needs_review"); assert.equal(requests.length, 1);
  assert.equal(saved.node_results[2].status, "skipped"); assert.equal(saved.node_results[3].status, "skipped");
  assert.equal(saved.node_results[1].output.session_id, "review-a");
});

test("limited evidence completes the packet with an explicit needs-review outcome", async t => {
  setup(t, async () => response("limited_evidence"));
  const run = await runtime.start(workflow(), {}, user); const saved = await finished(run.id);
  assert.equal(saved.status, "needs_review"); assert.equal(saved.node_results[2].status, "completed");
  assert.match(saved.output_payload.summary, /evidence limitations/);
});

test("cancel aborts a running specialist and prevents late completion from overwriting cancellation", async t => {
  let began; const started = new Promise(resolve => { began = resolve; }); let signal;
  const { rows } = setup(t, async input => { signal = input.signal; began(); return new Promise(() => {}); });
  const run = await runtime.start(workflow(), {}, user); await started;
  const cancelled = await runtime.cancel(await runtime._internals.store.get(run.id), user);
  assert.equal(cancelled.status, "cancelled");
  await finished(run.id);
  assert.equal(signal.aborted, true); assert.equal(rows.get(run.id).status, "cancelled");
  assert.equal(rows.get(run.id).node_results[2].status, "skipped");
});

test("a cancellation persisted by another worker is observed and cannot be overwritten", async t => {
  let began; const started = new Promise(resolve => { began = resolve; });
  const { rows } = setup(t, async () => { began(); return new Promise(() => {}); });
  const run = await runtime.start(workflow(), {}, user); await started;
  rows.get(run.id).status = "cancelled";
  await finished(run.id);
  assert.equal(rows.get(run.id).status, "cancelled");
});

test("cancelling a stale snapshot preserves progress saved while stopping and records terminal events", async t => {
  let began; const started = new Promise(resolve => { began = resolve; });
  const { rows } = setup(t, async () => { began(); return new Promise(() => {}); });
  const stale = await runtime.start(workflow(), {}, user); await started;
  const save = runtime._internals.store.save;
  let raced = false;
  t.mock.method(runtime._internals.store, 'save', async (id, status, nodes, output, expectedNodes) => {
    if (status === 'cancelled' && !raced) {
      raced = true;
      rows.get(id).node_results[0].output.request.progress = 'saved by another worker';
    }
    return save(id, status, nodes, output, expectedNodes);
  });
  const cancelled = await runtime.cancel(stale, user);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.node_results[0].output.request.progress, 'saved by another worker');
  assert.equal(cancelled.node_results[1].logs.at(-1).code, 'WORKFLOW_CANCELLED');
  assert.match(cancelled.node_results[2].skip_reason, /before this step started/);
  await finished(stale.id);
});

test("safe transient step retries are counted and permission errors never retry", async t => {
  let count = 0;
  const { requests } = setup(t, async () => { if (++count === 1) throw Object.assign(new Error("Unavailable"), { statusCode: 503 }); return response(); });
  const graph = workflow(); graph.nodes[1].data.retryCount = "2";
  const run = await runtime.start(graph, {}, user); const saved = await finished(run.id);
  assert.equal(requests.length, 2); assert.equal(saved.node_results[1].attempts, 2); assert.equal(saved.status, "completed");
  t.mock.method(assistant, "respond", async () => { throw Object.assign(new Error("Provider key hidden"), { statusCode: 403 }); });
  const failed = await runtime.start(graph, {}, user); const failure = await finished(failed.id);
  assert.equal(failure.status, "failed"); assert.equal(failure.node_results[1].attempts, 1);
  assert.doesNotMatch(JSON.stringify(failure), /Provider key hidden/);
});

test("AI retries share a single model-call budget for the node", async t => {
  const budgets = [];
  setup(t, async request => {
    const budget = request.workflow_policy.model_budget;
    budgets.push(budget);
    budget.used++;
    throw Object.assign(new Error("Unavailable"), { statusCode: 503 });
  });
  const graph = workflow(); graph.nodes[1].data.retryCount = 2; graph.nodes[1].data.retryDelayMs = 0;
  const run = await runtime.start(graph, {}, user), saved = await finished(run.id);
  assert.equal(saved.status, "failed");
  assert.equal(saved.node_results[1].attempts, 2);
  assert.equal(budgets.length, 2);
  assert.equal(budgets[0], budgets[1]);
  assert.equal(budgets[0].used, 2);
});

test("revoked permission stops subsequent steps and preserves the first review", async t => {
  let allowed = true;
  setup(t, async () => { allowed = false; return response(); });
  t.mock.method(permissions, "hasPermission", async () => allowed);
  const run = await runtime.start(workflow(), {}, user); const saved = await finished(run.id);
  assert.equal(saved.status, "failed"); assert.equal(saved.node_results[1].status, "completed");
  assert.equal(saved.node_results[2].status, "skipped");
  assert.match(saved.output_payload.summary, /Access changed/);
});

test("expired running records recover honestly as interrupted without replay", async t => {
  const { rows, requests } = setup(t);
  const stale = { id: "old-run", execution_mode: "review", status: "running", project_id: "project-a", workflow_snapshot: { runtime_contract: { deadline_at: new Date(Date.now() - 1000).toISOString() } }, node_results: [{ node_id: "first", status: "completed", output: { session_id: "prior" } }, { node_id: "last", status: "running" }], output_payload: {} };
  rows.set(stale.id, stale);
  const recovered = await runtime.reconcile(stale);
  assert.equal(recovered.status, "interrupted"); assert.equal(recovered.node_results[0].output.session_id, "prior");
  assert.equal(recovered.node_results[1].status, "interrupted"); assert.equal(requests.length, 0);
});

test("upstream review proposals retain their untrusted boundary", async t => {
  const { requests } = setup(t);
  const graph = workflow(); graph.nodes.splice(2, 0, node("evaluate", "agent", { agentId: "quality-evaluator", prompt: "Check the review" }));
  graph.edges = [{ source: "request", target: "story" }, { source: "story", target: "evaluate" }, { source: "evaluate", target: "finish" }];
  const run = await runtime.start(graph, {}, user); await finished(run.id);
  assert.equal(requests.length, 2); assert.match(requests[1].prompt, /untrusted analysis, not source evidence/);
  assert.match(requests[1].prompt, /independently verify/);
  const saved = await runtime._internals.store.get(run.id);
  assert.deepEqual(saved.node_results.at(-1).output.reviews.map(review => review.node_id), ["story", "evaluate"], "Final packets preserve all connected ancestor reviews");
});

test("execution routes have exact project permission mappings", () => {
  assert.equal(ROUTE_PERMISSIONS.get("GET /agentic-workflows/:id/readiness"), "agentic_workflow.view");
  assert.equal(ROUTE_PERMISSIONS.get("POST /agentic-workflows/:id/executions"), "agentic_workflow.run");
  assert.equal(ROUTE_PERMISSIONS.get("POST /agentic-workflow-runs/:id/cancel"), "agentic_workflow.run");
});

test("step execution runs only its ancestors and records the actual bounded input", async t => {
  const { requests } = setup(t);
  const graph = workflow();
  graph.nodes.splice(2, 0, node("later", "agent", { agentId: "quality-evaluator", prompt: "Later task" }));
  graph.edges = [{ source: "request", target: "story" }, { source: "story", target: "later" }, { source: "later", target: "finish" }];
  const report = runtime.readiness(graph, "story");
  assert.equal(report.ready, true);
  assert.deepEqual(report.steps.map(step => step.node_id), ["request", "story"]);
  const run = await runtime.start(graph, { target_node_id: "story", request_id: "step-request", input_payload: { release: "Checkout" } }, user);
  const saved = await finished(run.id);
  assert.equal(requests.length, 1);
  assert.equal(saved.workflow_snapshot.nodes.length, 4, "Full definition remains available for inspection");
  assert.equal(saved.workflow_snapshot.runtime_contract.target_node_id, "story");
  assert.equal(saved.node_results[1].input.prompt, requests[0].prompt);
  assert.deepEqual(saved.node_results[1].input.request, { release: "Checkout" });
  await assert.rejects(runtime.start(graph, { target_node_id: "later", request_id: "step-request", input_payload: { release: "Checkout" } }, user), { statusCode: 409 });
});

test("step readiness rejects unknown targets and cannot bypass a cycle", () => {
  assert.equal(runtime.readiness(workflow(), "missing").ready, false);
  const graph = workflow(); graph.edges.push({ source: "story", target: "request" });
  assert.equal(runtime.readiness(graph, "story").ready, false);
  assert.equal(runtime.readiness(workflow(), "request").ready, true, "The trigger can be tested without running a model");
});

test("source templates reuse repository analysis and preserve a link to its reviewable findings", async t => {
  const { requests } = setup(t);
  const sourceAgents = require("../../../agentic/backend/agents/repositoryAgents.service");
  const jobs = [];
  t.mock.method(sourceAgents, "createRun", async (input, actor, options) => { jobs.push({ input, actor, options }); return { id: "source-job" }; });
  t.mock.method(sourceAgents, "getRun", async () => ({ id: "source-job", status: "completed", summary: "Found 12 API test drafts", result: { llm_review: { ...response().result, session_id: "source-model", provenance: response().provenance } }, source: { repository_url: "https://github.com/example/project" }, stages: [] }));
  const graph = workflow(); graph.nodes[1].data = { label: "API source analysis", kind: "repositoryAgent", repositoryAgentType: "api_tests", llmIntegrationId: "source-model-connection", timeoutMs: "180000" };
  const source = { type: "github", repository_url: "https://github.com/example/project", ref: "main" };
  assert.equal(runtime.readiness(graph).ready, true);
  const run = await runtime.start(graph, { input_payload: { source } }, user);
  const saved = await finished(run.id);
  assert.equal(saved.status, "completed"); assert.equal(requests.length, 0);
  assert.equal(jobs.length, 1); assert.equal(jobs[0].input.project_id, "project-a");
  assert.equal(jobs[0].input.llm_integration_id, "source-model-connection");
  assert.equal(saved.node_results[1].output.session_id, "source-model");
  assert.equal(saved.node_results[2].output.data.response, response().result.response);
  assert.deepEqual(jobs[0].input.source, source); assert.match(jobs[0].options.requestKey, /^workflow-/);
  assert.equal(saved.node_results[1].output.repository_run_id, "source-job");
  assert.equal(saved.node_results[1].output.requires_human_review, true);
});

test("source nodes reject missing source input without inventing successful results", async t => {
  setup(t); const sourceAgents = require("../../../agentic/backend/agents/repositoryAgents.service");
  const create = t.mock.method(sourceAgents, "createRun", async () => { throw Error("Should not be called"); });
  const graph = workflow(); graph.nodes[1].data = { kind: "repositoryAgent", repositoryAgentType: "api_tests" };
  await assert.rejects(runtime.start(graph, {}, user), { statusCode: 400 });
  assert.equal(create.mock.callCount(), 0);
});

test("saving an unchanged definition after a lost response preserves execution idempotency", async t => {
  const { requests } = setup(t);
  const graph = workflow(); graph.updated_at = "2026-09-20T01:00:00Z";
  const input = { request_id: "transport-retry", input_payload: { task: "Checkout" } };
  const first = await runtime.start(graph, input, user); await finished(first.id);
  graph.updated_at = "2026-09-20T01:00:10Z";
  const retried = await runtime.start(graph, input, user);
  assert.equal(retried.id, first.id); assert.equal(requests.length, 1);
  graph.nodes[1].data.prompt = "A different task";
  await assert.rejects(runtime.start(graph, input, user), { statusCode: 409 });
});

test("partial source analysis completes as needs-review and parent cancellation stops its child job", async t => {
  setup(t);
  const sourceAgents = require("../../../agentic/backend/agents/repositoryAgents.service");
  const graph = workflow(); graph.nodes[1].data = { kind: "repositoryAgent", repositoryAgentType: "api_tests" };
  const input = { input_payload: { source: { type: "github", repository_url: "https://github.com/example/project" } } };
  t.mock.method(sourceAgents, "createRun", async () => ({ id: "child-job" }));
  t.mock.method(sourceAgents, "getRun", async () => ({ status: "partial", summary: { files_scanned: 3 }, result: { llm_review: { ...response().result, session_id: "source-model", provenance: response().provenance } }, stages: [], warnings: [] }));
  const partial = await runtime.start(graph, input, user); const saved = await finished(partial.id);
  assert.equal(saved.status, "needs_review"); assert.equal(typeof saved.node_results[1].output.response, "string");
  let started; const waiting = new Promise(resolve => { started = resolve; });
  t.mock.method(sourceAgents, "getRun", async () => { started(); return { status: "running" }; });
  const cancelChild = t.mock.method(sourceAgents, "cancelRun", async () => ({ status: "cancelled" }));
  const running = await runtime.start(graph, input, user); await waiting;
  await runtime.cancel(await runtime._internals.store.get(running.id), user); await finished(running.id);
  // The bounded callback unwinds and cancels its own source analysis.
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(cancelChild.mock.callCount(), 1);
  assert.equal(cancelChild.mock.calls[0].arguments[0], "child-job");
});

test('condition selects a branch, skips the other and preserves mapped output', async t => {
  setup(t);
  const graph = workflow();
  graph.nodes = [node('request','trigger'), node('check','condition',{conditionPath:'input.approved',conditionOperator:'equals',conditionValue:'true'}),
    node('yes','transform',{transformMapping:'{"answer":"approved"}'}), node('no','transform',{transformMapping:'{"answer":"rejected"}'}), node('finish','output')];
  graph.edges = [{source:'request',target:'check'},{source:'check',target:'yes',sourceHandle:'true'},{source:'check',target:'no',sourceHandle:'false'}, {source:'yes',target:'finish'},{source:'no',target:'finish'}];
  const run = await runtime.start(graph,{request_id:'conditional-run',input_payload:{approved:false}},user);
  const done = await finished(run.id);
  assert.equal(done.status,'completed');
  assert.equal(done.node_results.find(n=>n.node_id==='yes').status,'skipped');
  assert.equal(done.node_results.find(n=>n.node_id==='no').output.data.answer,'rejected');
  assert.deepEqual(done.node_results.at(-1).output.sources.map(n=>n.node_id),['no']);
});

test('For each maps every item and rejects oversized iterations without silently truncating', async t => {
  setup(t);
  const graph = workflow();
  graph.nodes[1] = node('story','loop',{loopSourceKey:'input.items',loopAction:'transform',loopMaxIterations:'2',transformMapping:'{"title":"$item.title","project":"$request.project"}'});
  const run = await runtime.start(graph,{request_id:'iteration-good',input_payload:{project:'checkout',items:[{title:'One'},{title:'Two'}]}},user);
  const done = await finished(run.id);
  assert.equal(done.status,'completed');
  assert.deepEqual(done.node_results[1].output.data,[{title:'One',project:'checkout'},{title:'Two',project:'checkout'}]);
  assert.equal(done.node_results[1].progress.percent,100);
  const tooMany = await runtime.start(graph,{request_id:'iteration-limit',input_payload:{items:[1,2,3]}},user);
  const failed = await finished(tooMany.id);
  assert.equal(failed.status,'failed');
  assert.match(failed.output_payload.summary,/received 3 items/);
});

test('custom AI and iterative AI pass connected input to the bounded review adapter', async t => {
  const {requests} = setup(t);
  const graph = workflow(); graph.nodes[1] = node('story','customAI',{prompt:'Compare release risks',instructions:'Give a direct answer'});
  const run = await runtime.start(graph,{request_id:'custom-ai-call',input_payload:{release:'2.3'}},user);
  assert.equal((await finished(run.id)).status,'completed');
  assert.equal(requests[0].agent_id,'quality-evaluator');
  assert.match(requests[0].prompt,/Compare release risks/);
  assert.match(requests[0].prompt,/2\.3/);
  graph.nodes[1] = node('story','loop',{loopSourceKey:'input.items',loopAction:'customAI',loopMaxIterations:'2',prompt:'Review the current item'});
  const loopRun = await runtime.start(graph,{request_id:'custom-ai-loop',input_payload:{items:[{id:'A'},{id:'B'}]}},user);
  assert.equal((await finished(loopRun.id)).node_results[1].output.processed,2);
  assert.deepEqual(requests[1].workflow_policy.connected_input.input,{id:"A"});
  assert.deepEqual(requests[2].workflow_policy.connected_input.input,{id:"B"});
});

test('explicit error routing preserves failures and skips success paths', async t => {
  setup(t);
  const graph = workflow();
  graph.nodes = [node('request','trigger'),node('bad','loop',{loopSourceKey:'input.absent',loopAction:'transform',loopMaxIterations:'2',onError:'errorOutput'}),node('recover','errorHandler'),node('success','transform',{transformMapping:'{"success":true}'}),node('finish','output')];
  graph.edges = [{source:'request',target:'bad'},{source:'bad',target:'recover'},{source:'bad',target:'success'},{source:'recover',target:'finish'},{source:'success',target:'finish'}];
  const run = await runtime.start(graph,{request_id:'error-routing',input_payload:{}},user);
  const done = await finished(run.id);
  assert.equal(done.status,'needs_review');
  assert.equal(done.node_results.find(n=>n.node_id==='success').status,'skipped');
  assert.equal(done.node_results.find(n=>n.node_id==='recover').output.recovered,true);
  assert.match(done.node_results.find(n=>n.node_id==='recover').output.data[0].error,/array/);
});


test('oversized mapped output is rejected before persistence and supports explicit error routing', async t => {
  setup(t);
  const graph = workflow();
  graph.nodes = [node('request','trigger'), node('expand','transform',{transformMapping:JSON.stringify(Object.fromEntries(Array.from({length:20},(_,i)=>[String(i),'$input.text']))),onError:'errorOutput'}), node('recover','errorHandler'), node('finish','output')];
  graph.edges = [{source:'request',target:'expand'},{source:'expand',target:'recover'},{source:'recover',target:'finish'}];
  const run = await runtime.start(graph,{input_payload:{text:'x'.repeat(10000)}},user);
  const done = await finished(run.id);
  assert.equal(done.status,'needs_review');
  const expanded = done.node_results.find(n=>n.node_id==='expand');
  assert.equal(expanded.status,'failed');
  assert.equal(expanded.output, undefined);
  assert.match(expanded.error,/128 KB/);
  assert.equal(done.node_results.find(n=>n.node_id==='recover').output.recovered,true);
  assert.ok(Buffer.byteLength(JSON.stringify(done.node_results))<128*1024);
});


test('evidence nodes use the project retrieval contract and preserve results through log and aggregator nodes', async t => {
  setup(t);
  const retrieval = require('../../../knowledge/backend/services/knowledgeRetrieval.service');
  const calls=[];
  t.mock.method(retrieval,'retrieve',async input=>{calls.push(input);return {context_packet_id:'packet-1',evidence:[{evidence_id:'e1',content:'Release ready'}],limitations:[]};});
  for (const [kind,sourceKinds] of [['knowledgeTool',undefined],['repositoryTool',['knowledge_item','file','text']],['testOpsTool',['execution']]]) {
    const graph=workflow();
    graph.nodes=[node('request','trigger'),node('evidence',kind,{knowledgeQuery:'Release progress',testOpsAction:kind==='testOpsTool'?'read-runs':undefined}),node('log','log'),node('merge','aggregator'),node('finish','output')];
    graph.edges=[{source:'request',target:'evidence'},{source:'evidence',target:'log'},{source:'log',target:'merge'},{source:'merge',target:'finish'}];
    const run=await runtime.start(graph,{},user);
    const done=await finished(run.id);
    assert.equal(done.status,'completed');
    assert.equal(calls.at(-1).projectId,'project-a');
    assert.equal(calls.at(-1).appTypeId,'app-a');
    assert.deepEqual(calls.at(-1).filters.source_kinds,sourceKinds);
    assert.equal(done.node_results.find(n=>n.node_id==='evidence').output.context_packet_id,'packet-1');
    assert.equal(done.node_results.find(n=>n.node_id==='log').output.data[0].content,'Release ready');
    assert.equal(done.node_results.find(n=>n.node_id==='merge').output.data[0].evidence_id,'e1');
  }
  t.mock.method(permissions,'hasPermission',async (_user,permission)=>permission!=='knowledge.view');
  const graph=workflow(); graph.nodes[1]=node('story','knowledgeTool');
  const denied=await runtime.start(graph,{},user);
  const done=await finished(denied.id);
  assert.equal(done.status,'failed');
  assert.equal(calls.length,3,'revoked knowledge access never reaches retrieval');
});

test('a matched field in ordinary HTTP or transform data never selects condition branches', async t => {
  setup(t);
  const graph = workflow();
  graph.nodes = [node('request','trigger'), node('value','transform',{transformMapping:'{"matched":false,"title":"Still runs"}'}),node('log','log'),node('finish','output')];
  graph.edges = [{source:'request',target:'value'},{source:'value',target:'log'},{source:'log',target:'finish'}];
  const done = await finished((await runtime.start(graph,{},user)).id);
  assert.equal(done.status,'completed');
  assert.deepEqual(done.node_results.at(-1).output.data,{matched:false,title:'Still runs'});
  assert.deepEqual(done.node_results[2].input.input,done.node_results[1].output.data);
});

test('AI execution sends selected skills, guardrails, tool restrictions and additional context', async t => {
  const {requests} = setup(t);
  const graph = workflow();
  Object.assign(graph.nodes[1].data,{kind:'customAI',skills:[{id:'skill-1',name:'Boundary review',instructions:'Check zero, one and maximum quantities.'}],guardrails:'Do not assume an inventory policy.',contextInstructions:'Inventory is reviewed daily.',allowedTools:[],knowledgeScope:''});
  const done = await finished((await runtime.start(graph,{input_payload:{quantity:2}},user)).id);
  assert.equal(done.status,'completed');
  assert.match(requests[0].prompt,/Check zero, one and maximum/);
  assert.match(requests[0].prompt,/Do not assume an inventory policy/);
  assert.match(requests[0].prompt,/Inventory is reviewed daily/);
  assert.deepEqual(requests[0].workflow_policy.allowed_tools,[]);
  assert.deepEqual(requests[0].context_scopes,[]);
  assert.equal(requests[0].workflow_policy.custom_task,true);
  assert.equal(requests[0].workflow_policy.connected_input.input.quantity,2);
});

test('merge appends branch data and subsequent mapping references both immediate data and source labels', async t => {
  setup(t);
  const graph = workflow();
  graph.nodes=[node('request','trigger'),node('one','transform',{transformMapping:'{"title":"One"}'}),node('two','transform',{transformMapping:'{"title":"Two"}'}),node('merge','aggregator',{outputKey:'combined'}),node('map','transform',{transformMapping:'{"first":"$input.0.title","all":"$nodes.combined.data"}'}),node('finish','output')];
  graph.edges=[{source:'request',target:'one'},{source:'request',target:'two'},{source:'one',target:'merge'},{source:'two',target:'merge'},{source:'merge',target:'map'},{source:'map',target:'finish'}];
  const done=await finished((await runtime.start(graph,{},user)).id);
  assert.equal(done.status,'completed');
  assert.deepEqual(done.node_results.at(-1).output.data,{first:'One',all:[{title:'One'},{title:'Two'}]});
});

test('an unconnected condition branch does not report a completed output',async t=>{
  setup(t);
  const graph=workflow();
  graph.nodes=[node('request','trigger'),node('check','condition',{conditionPath:'input.approved',conditionValue:'true'}),node('finish','output')];
  graph.edges=[{source:'request',target:'check'},{source:'check',target:'finish',sourceHandle:'true'}];
  const done=await finished((await runtime.start(graph,{input_payload:{approved:false}},user)).id);
  assert.equal(done.status,'needs_review');assert.deepEqual(done.output_payload.results,[]);
  assert.match(done.output_payload.summary,/did not reach/);
});

test('readiness rejects ambiguous output references, duplicate wires and ignored retry settings',()=>{
  const graph=workflow();
  graph.nodes[0].data.outputKey='shared';graph.nodes[1].data.outputKey='shared';
  assert.match(runtime.readiness(graph).blockers.map(item=>item.message).join(' '),/unique output label/);
  delete graph.nodes[1].data.outputKey;
  graph.edges.push({...graph.edges[0],id:'duplicate'});
  assert.match(runtime.readiness(graph).blockers.map(item=>item.message).join(' '),/duplicate connections/);
  graph.edges.pop();graph.nodes[1]=node('story','transform',{retryCount:1});
  assert.match(runtime.readiness(graph).blockers.map(item=>item.message).join(' '),/Set retries to zero/);
});

test('invalid workflow inputs are rejected instead of being silently replaced',async t=>{
  const {rows}=setup(t);
  for(const input_payload of [null,[],false,'{"task":"hello"}',12]) await assert.rejects(runtime.start(workflow(),{input_payload},user),/JSON object/);
  assert.equal(rows.size,0);
});

test('HTTP retries produce diagnostic events, honor a zero delay and log actual messages',async t=>{
  setup(t);const connections=require('../../../agentic/backend/workflows/connections');let calls=0;
  t.mock.method(connections,'callHttp',async()=>{if(++calls===1)throw Object.assign(new Error('transient'),{statusCode:500,publicMessage:'Service busy'});return {data:{status:'ready'}};});
  const graph=workflow();graph.nodes=[node('request','trigger'),node('http','apiTool',{apiUrl:'https://example.test',apiMethod:'GET',retryCount:2,retryDelayMs:0}),node('log','log',{logMessage:'Current state: {{ $input.status }}',logLevel:'audit'}),node('finish','output')];
  graph.edges=[{source:'request',target:'http'},{source:'http',target:'log'},{source:'log',target:'finish'}];
  const done=await finished((await runtime.start(graph,{},user)).id);
  assert.equal(done.status,'completed');const http=done.node_results[1];
  assert.equal(http.attempts,2);assert.equal(http.logs.find(item=>item.event==='retry_scheduled').retry_delay_ms,0);
  assert.equal(http.logs.find(item=>item.event==='retry_scheduled').status_code,500);
  assert.ok(Number.isFinite(http.duration_ms));
  const log=done.node_results[2];assert.equal(log.logs.find(item=>item.event==='user_log').message,'Current state: ready');
  assert.ok(log.logs.find(item=>item.event==='node_completed').output_size_bytes>0);
});

test('step deadlines are distinct from workflow deadlines and supply structured recovery input',async t=>{
  setup(t,async()=>new Promise(()=>{}));
  const graph=workflow();graph.nodes[1].data.timeoutMs=1000;
  let done=await finished((await runtime.start(graph,{input_payload:{release:'R1'}},user)).id);
  assert.equal(done.status,'failed');assert.equal(done.output_payload.error_code,'NODE_TIMEOUT');
  assert.equal(done.node_results[1].error_details.code,'NODE_TIMEOUT');
  assert.match(done.node_results[1].error,/step timeout/);
  graph.nodes[1].data.onError='errorOutput';graph.nodes.splice(2,0,node('recover','errorHandler'));
  graph.edges.push({source:'story',target:'recover'},{source:'recover',target:'finish'});
  done=await finished((await runtime.start(graph,{input_payload:{release:'R1'}},user)).id);
  assert.equal(done.status,'needs_review');
  const recovered=done.node_results.find(item=>item.node_id==='recover').output.data[0];
  assert.equal(recovered.error_details.code,'NODE_TIMEOUT');assert.equal(recovered.input.release,'R1');
  assert.equal(done.node_results[1].logs.some(item=>item.event==='error_routed'),true);
});

test('disabled skills never reach the model and each AI loop review remains traceable',async t=>{
  let count=0;const {requests}=setup(t,async()=>response('ready_for_review',`item-review-${++count}`));
  const graph=workflow();graph.nodes[1]=node('story','loop',{loopAction:'customAI',loopSourceKey:'input.items',loopMaxIterations:2,prompt:'Review item',transformMapping:'unused invalid JSON',skills:[{id:'on',name:'First',instructions:'Follow this active instruction'},{id:'off',name:'Second',instructions:'Do not include paused guidance',enabled:false}]});
  const done=await finished((await runtime.start(graph,{input_payload:{items:['a','b']}},user)).id);
  assert.equal(done.status,'completed');assert.equal(done.node_results[1].attempts,2);
  assert.match(requests[0].prompt,/active instruction/);assert.doesNotMatch(requests[0].prompt,/paused guidance/);
  assert.deepEqual(requests.map(request=>request.workflow_policy.connected_input.input),['a','b']);
  assert.deepEqual(requests.map(request=>request.workflow_policy.connected_input.request),[{items:['a','b']},{items:['a','b']}]);
  assert.deepEqual(done.output_payload.review_session_ids,['item-review-1','item-review-2']);
  assert.deepEqual(done.node_results.at(-1).output.reviews.map(item=>item.item_index),[0,1]);
  assert.equal(done.node_results[1].logs.filter(item=>item.event==='attempt_started').length,2);
});

test('all HTTP node variants preserve null, false and empty array output as downstream input',async t=>{
  setup(t);const connections=require('../../../agentic/backend/workflows/connections');let result;
  t.mock.method(connections,'callHttp',async()=>({data:result}));
  for(const kind of ['apiTool','apiAgent','webAgent'])for(const value of [null,false,[]]) {
    result=value;const graph=workflow();graph.nodes[1]=node('story',kind,{apiUrl:'https://example.test',apiMethod:'GET'});
    const done=await finished((await runtime.start(graph,{},user)).id);
    assert.equal(done.status,'completed');assert.deepEqual(done.node_results.at(-1).output.data,value);
  }
});

test('specialist variants use the same bounded review contract and conditions compare object contents',async t=>{
  setup(t);const graph=workflow();graph.nodes[1].data.kind='llmAgent';
  assert.equal((await finished((await runtime.start(graph,{},user)).id)).status,'completed');
  const {condition}=require('../../../agentic/backend/workflows/nodeOperations')._internals;
  assert.equal(condition({conditionPath:'input',conditionValue:'{"b":2,"a":1}'},{input:{a:1,b:2}}),true);
});

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const branchWorkflow = mode => ({ ...workflow(), settings: { processing_mode: mode, max_parallel_nodes: 2 },
  nodes: [node('request', 'trigger'), ...['A', 'B', 'C'].map(id => node(id, 'agent', { agentId: 'quality-evaluator', prompt: `Branch ${id}` })), node('merge', 'aggregator'), node('finish', 'output')],
  edges: [...['A', 'B', 'C'].map(id => ({ source: 'request', target: id })), ...['C', 'A', 'B'].map(id => ({ source: id, target: 'merge' })), { source: 'merge', target: 'finish' }] });

test('parallel DAG processing bounds model concurrency and merges by connection order rather than finish order', async t => {
  const began = Object.fromEntries(['A', 'B', 'C'].map(id => [id, deferred()]));
  const release = Object.fromEntries(['A', 'B', 'C'].map(id => [id, deferred()]));
  let running = 0, peak = 0;
  const { requests } = setup(t, async input => {
    const id = input.prompt.match(/^Branch ([ABC])/)[1];
    running++; peak = Math.max(peak, running); began[id].resolve();
    await release[id].promise; running--;
    return response('ready_for_review', `session-${id}`);
  });
  const run = await runtime.start(branchWorkflow('parallel'), {}, user);
  await Promise.all([began.A.promise, began.B.promise]);
  assert.equal(requests.length, 2);
  assert.equal(peak, 2);
  release.B.resolve(); release.A.resolve();
  await began.C.promise;
  assert.equal(requests.length, 3);
  const partial = await runtime._internals.store.get(run.id);
  assert.equal(partial.node_results.find(row => row.node_id === 'merge').status, 'queued', 'Merge waits for every selected dependency');
  release.C.resolve();
  const done = await finished(run.id);
  assert.equal(done.status, 'completed');
  const merge = done.node_results.find(row => row.node_id === 'merge');
  assert.deepEqual(merge.output.data.map(item => item.session_id), ['session-C', 'session-A', 'session-B']);
  assert.deepEqual(merge.input.source_node_ids, ['C', 'A', 'B']);
  assert.deepEqual(merge.output.source_items.map(item => [item.node_id, item.start_index, item.item_count]), [['C', 0, 1], ['A', 1, 1], ['B', 2, 1]]);
  assert.equal(merge.input.merge_mode, 'waitAllAppend');
  assert.deepEqual(done.output_payload.runtime_contract.processing, { mode: 'parallel', max_parallel_nodes: 2 });
  assert.ok(done.node_results.every(row => row.status === 'completed'));
});

test('sequential DAG processing starts the next independent model only after its predecessor finishes', async t => {
  const began = Object.fromEntries(['A', 'B', 'C'].map(id => [id, deferred()]));
  const release = Object.fromEntries(['A', 'B', 'C'].map(id => [id, deferred()]));
  const { requests } = setup(t, async input => {
    const id = input.prompt.match(/^Branch ([ABC])/)[1]; began[id].resolve();
    await release[id].promise; return response('ready_for_review', `session-${id}`);
  });
  const run = await runtime.start(branchWorkflow('sequential'), {}, user);
  for (const [index, id] of ['A', 'B', 'C'].entries()) {
    await began[id].promise;
    assert.equal(requests.length, index + 1);
    release[id].resolve();
  }
  const done = await finished(run.id);
  assert.equal(done.status, 'completed');
  assert.equal(done.output_payload.runtime_contract.processing.max_parallel_nodes, 1);
});

test('parallel branch failure aborts the other model and preserves distinct terminal node states', async t => {
  const both = deferred(); let calls = 0, aborted = false;
  setup(t, async input => {
    if (++calls === 2) both.resolve();
    if (input.prompt.startsWith('Branch A')) { await both.promise; throw Object.assign(new Error('Provider unavailable'), { statusCode: 503 }); }
    return new Promise((_, reject) => input.signal.addEventListener('abort', () => { aborted = true; reject(Object.assign(new Error('Cancelled'), { name: 'AbortError' })); }, { once: true }));
  });
  const done = await finished((await runtime.start(branchWorkflow('parallel'), {}, user)).id);
  assert.equal(done.status, 'failed');
  assert.equal(aborted, true);
  assert.equal(calls, 2);
  assert.equal(done.node_results.find(row => row.node_id === 'A').status, 'failed');
  assert.equal(done.node_results.find(row => row.node_id === 'B').status, 'interrupted');
  assert.equal(done.node_results.find(row => row.node_id === 'C').status, 'skipped');
});

test('parallel conditional fan-in ignores skipped branches and preserves empty and false values', async t => {
  setup(t);
  const graph = { ...workflow(), settings: { processing_mode: 'parallel' },
    nodes: [node('request','trigger'),node('check','condition',{conditionPath:'input.enabled',conditionValue:'true'}),
      node('yes','transform',{transformMapping:'{"value":true}'}),node('no','transform',{transformMapping:'{"value":false}'}),
      node('empty','transform',{transformMapping:'{"items":[]}'}),node('merge','aggregator'),node('finish','output')],
    edges: [{source:'request',target:'check'},{source:'request',target:'empty'},{source:'check',target:'yes',sourceHandle:'true'},
      {source:'check',target:'no',sourceHandle:'false'},{source:'yes',target:'merge'},{source:'no',target:'merge'},
      {source:'empty',target:'merge'},{source:'merge',target:'finish'}] };
  const done = await finished((await runtime.start(graph,{input_payload:{enabled:false}},user)).id);
  assert.equal(done.status,'completed');
  assert.equal(done.node_results.find(row=>row.node_id==='yes').status,'skipped');
  assert.deepEqual(done.node_results.find(row=>row.node_id==='merge').output.data,[{value:false},{items:[]}]);
});

test('processing settings reject unbounded concurrency and explicitly reject parallel durable execution', t => {
  for (const value of [0,3,2.5,'invalid']) {
    const graph = branchWorkflow('parallel'); graph.settings.max_parallel_nodes = value;
    assert.equal(runtime.readiness(graph).ready,false);
  }
  const control = require('../../../agentic/backend/workflows/temporal/control');
  t.mock.method(control,'enabled',()=>true);
  assert.match(runtime.readiness(branchWorkflow('parallel')).blockers.map(row=>row.message).join(' '),/sequential processing for durable/);
  assert.equal(runtime.readiness(branchWorkflow('sequential')).ready,true);
});

test('native publication follows recorded generation and input-required automation still reaches the output', async t => {
  setup(t);
  const tasks = require('../../../agentic/backend/workflows/artifactTasks');
  const publisher = require('../../../agentic/backend/workflows/acceptDraft');
  const order = [];
  t.mock.method(tasks,'execute',async ({node}) => {
    order.push(node.data.artifactTask);
    return { data: [{ story_id: 'story-a', cases: [{ client_id: 'draft-1' }] }],
      verification: { status: node.data.artifactTask === 'automation-engineer' ? 'needs_input' : 'passed' } };
  });
  t.mock.method(publisher,'publishNodeArtifacts',async ({run,node,signal}) => {
    assert.equal(signal instanceof AbortSignal,true);
    assert.equal(signal.aborted,false);
    const checkpoint = await runtime._internals.store.get(run.id);
    assert.equal(checkpoint.node_results.find(row=>row.node_id===node.id).status,'completed');
    order.push(`publish:${node.data.artifactTask}`);
    return {mode:'automatic',status:'saved',receipts:node.data.artifactTask==='test-case-generation'?[{id:'saved-manual',kind:'manual',saved:true,verification_status:'pending_review'}]:[],requires_review:true,approved:false};
  });
  const nodes = [node('request','trigger'), ...['test-case-generation','test-case-assurance','automation-engineer'].map(task=>node(task,'artifactTask',{artifactTask:task})),node('finish','output')];
  const graph = {...workflow(),nodes,edges:nodes.slice(1).map((item,index)=>({source:nodes[index].id,target:item.id})),
    settings:{template_id:'sprint-automator',library_publication_mode:'automatic'}};
  const done = await finished((await runtime.start(graph,{input_payload:{sprint_id:'sprint-a'}},user)).id);
  assert.equal(done.status,'needs_review');
  assert.deepEqual(order,['test-case-generation','publish:test-case-generation','test-case-assurance','automation-engineer','publish:automation-engineer']);
  assert.equal(done.node_results.at(-1).status,'completed','Missing automation input does not discard the output/publication');
  assert.equal(done.node_results[1].output.library_publication.receipts[0].id,'saved-manual');
  assert.equal(done.node_results[1].output.library_publication.approved,false);
  assert.equal(done.output_payload.project_changes_applied,true);
  assert.equal(done.output_payload.runtime_contract.automatic_library_publication,true);
  assert.equal(Object.hasOwn(done.output_payload.runtime_contract,'project_changes_applied'),false);
  assert.equal(done.output_payload.summary,'Saved 1 manual Test Case pending review. Additional automation inputs are still needed.');
});

test('parallel processing keeps HTTP mutations exclusive and retains their operation receipts', async t => {
  setup(t);
  const journal = require('../../../agentic/backend/workflows/operationJournal');
  const connections = require('../../../agentic/backend/workflows/connections');
  t.mock.method(connections,'resolve',async (_id,_project,url)=>({connection:{id:'approved-write-fixture',kind:'http',methods:['POST']},url:new URL(url)}));
  const began = deferred(), release = deferred(); let calls = 0, running = 0, peak = 0;
  t.mock.method(journal,'invoke',async ({node},dispatch)=>({...(await dispatch()),operation_receipt:{id:`op-${node.id}`,state:'response_received',postcondition_verified:false}}));
  t.mock.method(connections,'callHttp',async ({data})=>{
    running++; peak=Math.max(peak,running); calls++;
    if(data.apiUrl.endsWith('/first')) { began.resolve(); await release.promise; }
    running--; return {data:{url:data.apiUrl}};
  });
  const graph = {...workflow(),settings:{processing_mode:'parallel',max_parallel_nodes:2},
    nodes:[node('request','trigger'),...['first','second'].map(id=>node(id,'apiTool',{apiUrl:`https://example.test/${id}`,apiMethod:'POST'})),node('merge','aggregator'),node('finish','output')],
    edges:[{source:'request',target:'first'},{source:'request',target:'second'},{source:'first',target:'merge'},{source:'second',target:'merge'},{source:'merge',target:'finish'}]};
  const run = await runtime.start(graph,{},user); await began.promise;
  assert.equal(calls,1); release.resolve();
  const done = await finished(run.id);
  assert.equal(done.status,'completed'); assert.equal(peak,1); assert.equal(calls,2);
  for(const id of ['first','second']) assert.deepEqual(done.node_results.find(row=>row.node_id===id).output.operation_receipt,{id:`op-${id}`,state:'response_received',postcondition_verified:false});
});

test('durable input-required receipts retain needs-review status while executing the final output', async () => {
  const filename = require.resolve('../../../agentic/backend/workflows/temporal/workflows');
  const called = [], published = [];
  const module = { exports: {} };
  new Function('require','module',require('node:fs').readFileSync(filename,'utf8'))(() => ({
    proxyActivities: () => ({ executeReviewNode: async ({nodeId}) => { called.push(nodeId); return {node_id:nodeId,kind:nodeId==='start'?'trigger':nodeId==='output'?'output':'artifactTask',status:'completed',needs_attention:nodeId==='automation'}; },
      publishReview: async input => { published.push(input); } }),
    CancellationScope: {withTimeout:async(_timeout,task)=>task(),nonCancellable:async task=>task()},isCancellation:()=>false
  }),module);
  const result = await module.exports.reviewWorkflow({runId:'durable-native',deadline:new Date(Date.now()+10000).toISOString(),
    nodes:[{id:'start',kind:'trigger'},{id:'automation',kind:'artifactTask'},{id:'output',kind:'output'}],
    edges:[{source:'start',target:'automation'},{source:'automation',target:'output'}]});
  assert.deepEqual(called,['start','automation','output']);
  assert.equal(result.status,'needs_review');
  assert.equal(published[0].status,'needs_review');
  assert.equal(published[0].receipts.length,3);
});

test('nested merges retain immediate source ranges and the preceding merge provenance in recorded input', async t => {
  setup(t);
  const graph = {...workflow(),settings:{processing_mode:'parallel'},
    nodes:[node('request','trigger'),...['A','B','C'].map(id=>node(id,'transform',{transformMapping:JSON.stringify({id})})),
      node('mergeAB','aggregator'),node('mergeAll','aggregator'),node('finish','output')],
    edges:[...['A','B','C'].map(id=>({source:'request',target:id})),{source:'B',target:'mergeAB'},{source:'A',target:'mergeAB'},
      {source:'C',target:'mergeAll'},{source:'mergeAB',target:'mergeAll'},{source:'mergeAll',target:'finish'}]};
  const done = await finished((await runtime.start(graph,{},user)).id);
  assert.equal(done.status,'completed');
  const result = done.node_results.find(row=>row.node_id==='mergeAll');
  assert.deepEqual(result.output.data,[{id:'C'},{id:'B'},{id:'A'}]);
  assert.deepEqual(result.output.source_items,[{node_id:'C',start_index:0,item_count:1},{node_id:'mergeAB',start_index:1,item_count:2}]);
  assert.deepEqual(result.input.nodes.mergeAB.source_items,[{node_id:'B',start_index:0,item_count:1},{node_id:'A',start_index:1,item_count:1}]);
  assert.deepEqual(result.input.nodes.mergeAB,done.node_results.find(row=>row.node_id==='mergeAB').output);
});

test('publication failure preserves partial receipts and claims project changes only for a saved identity', async t => {
  setup(t);
  const tasks = require('../../../agentic/backend/workflows/artifactTasks');
  const publisher = require('../../../agentic/backend/workflows/acceptDraft');
  t.mock.method(tasks,'execute',async()=>({data:[],verification:{status:'passed'}}));
  let savedReceipt, calls = 0;
  t.mock.method(publisher,'publishNodeArtifacts',async()=>{
    calls++;
    throw Object.assign(new Error('Reconcile the incomplete publication.'),{code:'AGENT_LIBRARY_PUBLICATION_OUTCOME_UNKNOWN',outcome_unknown:true,
      library_publication:{mode:'automatic',status:'partial',receipts:savedReceipt?[{id:'saved-before-failure',saved:true}]:[]}});
  });
  const nodes=[node('request','trigger'),node('generate','artifactTask',{artifactTask:'test-case-generation'}),node('finish','output')];
  const graph={...workflow(),nodes,edges:[{source:'request',target:'generate'},{source:'generate',target:'finish'}],settings:{template_id:'sprint-automator',library_publication_mode:'automatic'}};
  for(const saved of [true,false]) {
    savedReceipt=saved;
    const done=await finished((await runtime.start(graph,{input_payload:{sprint_id:'sprint-a'}},user)).id);
    assert.equal(done.status,'failed');
    assert.equal(done.output_payload.project_changes_applied,saved);
    const result=done.node_results.find(row=>row.node_id==='generate');
    assert.equal(result.output.library_publication.status,'partial');
    assert.equal(result.error_details.outcome_unknown,true);
    assert.equal(done.node_results.at(-1).status,'skipped');
  }
  assert.equal(calls,2,'An uncertain publication is never automatically retried');
});

test('cancellation reaches publication and its committed receipt merges without changing the winning cancellation', async t => {
  const { rows } = setup(t);
  const tasks=require('../../../agentic/backend/workflows/artifactTasks'),publisher=require('../../../agentic/backend/workflows/acceptDraft');
  const began=deferred(); let receivedSignal,merged=0;
  const receipt={id:'committed-before-cancel',kind:'manual',saved:true};
  t.mock.method(tasks,'execute',async()=>({data:[],verification:{status:'passed'}}));
  t.mock.method(publisher,'publishNodeArtifacts',async({signal})=>{
    receivedSignal=signal; began.resolve();
    return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Object.assign(new Error('Publication cancelled.'),{statusCode:499,
      library_publication:{mode:'automatic',status:'partial',receipts:[receipt]}})),{once:true}));
  });
  t.mock.method(runtime._internals.store,'mergePublication',async(id,nodeId,status)=>{
    const saved=rows.get(id);
    assert.equal(saved.status,'cancelled'); assert.equal(status,'partial'); merged++;
    saved.node_results.find(node=>node.node_id===nodeId).output.library_publication={mode:'automatic',status:'partial',receipts:[receipt]};
    saved.output_payload.project_changes_applied=true;
    return structuredClone(saved);
  });
  const nodes=[node('request','trigger'),node('generate','artifactTask',{artifactTask:'test-case-generation'}),node('finish','output')];
  const graph={...workflow(),nodes,edges:[{source:'request',target:'generate'},{source:'generate',target:'finish'}],settings:{template_id:'sprint-automator',library_publication_mode:'automatic'}};
  const run=await runtime.start(graph,{input_payload:{sprint_id:'sprint-a'}},user); await began.promise;
  await runtime.cancel(await runtime._internals.store.get(run.id),user);
  const done=await finished(run.id);
  assert.equal(receivedSignal.aborted,true); assert.equal(merged,1);
  assert.equal(done.status,'cancelled'); assert.equal(done.output_payload.project_changes_applied,true);
  assert.equal(done.node_results.find(node=>node.node_id==='generate').output.library_publication.receipts[0].id,receipt.id);
  assert.equal(done.node_results.at(-1).status,'skipped');
});

test('saved receipt summaries deduplicate cases and distinguish pending review from unverified automation',()=>{
  const manual={id:'manual',kind:'manual',saved:true},automation={id:'automation',kind:'automation',saved:true};
  const nodes=[{output:{library_publication:{receipts:[manual,automation]}}},{output:{library_publication:{receipts:[manual]}}}];
  const summary=runtime._internals.terminalSummary({},'completed',nodes,'Review workflow completed.');
  assert.equal(summary,'Saved 1 manual Test Case pending review. Saved 1 automation Test Case pending review and unverified.');
  const failed=runtime._internals.terminalSummary({},'failed',nodes,'The workflow stopped.');
  assert.equal(runtime._internals.terminalSummary({},'failed',nodes,failed),failed,'Recovery cannot duplicate the saved-case summary');
});
