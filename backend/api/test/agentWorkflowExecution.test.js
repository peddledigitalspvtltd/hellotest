const test = require("node:test");
const assert = require("node:assert/strict");
const runtime = require("../src/services/agenticWorkflowExecution.service");
const assistant = require("../src/services/agenticAssistant.service");
const permissions = require("../src/services/permission.service");
const flags = require("../src/services/featureFlag.service");
const { ROUTE_PERMISSIONS } = require("../src/security/permissions.catalog");

const user = { id: "reviewer", role: "member" };
const node = (id, kind, extra = {}) => ({ id, type: "agenticStep", data: { label: id, kind, ...extra } });
const workflow = () => ({ id: "workflow-a", project_id: "project-a", app_type_id: "app-a", name: "Release readiness review", status: "draft", trigger_kind: "manual",
  nodes: [node("request", "trigger"), node("story", "agent", { agentId: "story-architect", prompt: "Review missing acceptance boundaries", knowledgeScope: "requirements,test-runs,knowledge" }), node("finish", "output")],
  edges: [{ id: "a", source: "request", target: "story" }, { id: "b", source: "story", target: "finish" }], settings: {} });
const response = (status = "ready_for_review", id = "review-a") => ({ transaction: { id }, result: { response: "Coverage has a gap [K-stories-real]", citation_ids: ["K-stories-real"], readiness: { status, evidence_count: 1, task_evidence_count: 1, limitations: [] } }, provenance: { generation_mode: "deterministic", requires_human_review: true } });

function setup(t, review = async () => response()) {
  const rows = new Map();
  const requests = [];
  t.mock.method(permissions, "hasPermission", async (_user, _permission, project) => project === "project-a");
  t.mock.method(flags, "areEnabled", async () => true);
  t.mock.method(runtime._internals.store, "get", async id => structuredClone(rows.get(id) || null));
  t.mock.method(runtime._internals.store, "insert", async row => {
    if (rows.has(row.id)) return null;
    rows.set(row.id, structuredClone(row)); return { id: row.id };
  });
  t.mock.method(runtime._internals.store, "save", async (id, status, nodes, output) => {
    const row = rows.get(id);
    if (!row || row.status !== "running") return null;
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

test("review readiness distinguishes registered execution from arbitrary canvas nodes", () => {
  assert.equal(runtime.readiness(workflow()).ready, true);
  for (const kind of ["condition", "loop", "transform", "apiTool", "repositoryTool", "webAgent", "testOpsTool"]) {
    const graph = workflow(); graph.nodes[1].data.kind = kind;
    assert.ok(runtime.readiness(graph).blockers.some(item => item.message.includes("preview-only")));
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
