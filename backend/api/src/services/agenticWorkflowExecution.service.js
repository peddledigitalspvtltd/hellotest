const { createHash, randomUUID } = require("node:crypto");
const db = require("../db");
const assistant = require("./agenticAssistant.service");
const permissions = require("./permission.service");
const flags = require("./featureFlag.service");
const execution = require("./knowledgeExecution.service");

// This executor deliberately supports a small, real capability set. Canvas
// definitions outside this contract remain previewable, but cannot execute.
const MODE = "review";
const MAX_DURATION_MS = 180_000;
const MAX_INPUT_BYTES = 16_384;
const MAX_PARALLEL_RUNS = 2;
const SUPPORTED_KINDS = new Set(["trigger", "agent", "llmAgent", "aggregator", "output"]);
const active = new Map();
const starting = new Map();
const diagnostics = { onFailure: () => {} };
const error = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode, publicMessage: message });
const text = (value) => typeof value === "string" ? value.trim() : "";
const object = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const array = (value) => Array.isArray(value) ? value : [];
const parse = (value, fallback) => { try { return typeof value === "string" ? JSON.parse(value) : value ?? fallback; } catch { return fallback; } };
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const kindOf = (node) => node.data?.kind || node.type || "agent";
const nodeName = (node) => text(node.data?.label) || node.id;
const hydrate = (run) => run && ({ ...run, execution_mode: parse(run.workflow_snapshot, {}).execution_mode || "preview", workflow_snapshot: parse(run.workflow_snapshot, {}), input_payload: parse(run.input_payload, {}), output_payload: parse(run.output_payload, {}), node_results: parse(run.node_results, []) });

const store = {
  get: async (id) => hydrate(await db.prepare("SELECT * FROM agentic_workflow_runs WHERE id = ?").get(id)),
  insert: async (run) => db.prepare(`INSERT INTO agentic_workflow_runs
    (id, workflow_id, project_id, app_type_id, workflow_name, status, trigger_kind, input_payload, output_payload, workflow_snapshot, node_results, created_by, started_at)
    VALUES (?, ?, ?, ?, ?, 'running', 'manual', ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT (id) DO NOTHING RETURNING id`).get(run.id, run.workflow_id, run.project_id, run.app_type_id, run.workflow_name, run.input_payload, run.output_payload, run.workflow_snapshot, run.node_results, run.created_by),
  save: async (id, status, nodes, output) => db.prepare(`UPDATE agentic_workflow_runs
    SET status = ?, node_results = ?, output_payload = ?, updated_at = CURRENT_TIMESTAMP,
      completed_at = CASE WHEN ? = 'running' THEN NULL ELSE CURRENT_TIMESTAMP END
    WHERE id = ? AND status = 'running' RETURNING id`).get(status, nodes, output, status, id)
};

function readiness(workflow) {
  const blockers = [];
  const warnings = [];
  const add = (node, message) => blockers.push({ node_id: node?.id || null, node_name: node ? nodeName(node) : null, message });
  let ordered = [];
  try { ordered = require("../utils/agenticWorkflowGraph").validateWorkflowGraph(workflow.nodes, workflow.edges, { requireNodes: true }); }
  catch (failure) { add(null, failure.publicMessage || failure.message); }
  const nodes = array(workflow.nodes);
  const edges = array(workflow.edges);
  const settings = object(workflow.settings);
  if (settings.requiresApproval || settings.approvalRequired || settings.human_approval_required) add(null, "Approval gates are preview-only. Remove the execution approval gate; results will still require human review before any artifact change.");
  if (settings.execution_mode && !["review", "sequential", "preview"].includes(settings.execution_mode)) add(null, "Only sequential review execution is supported. Parallel or custom execution modes are preview-only.");
  const specialists = nodes.filter(node => ["agent", "llmAgent"].includes(kindOf(node)));
  if (["paused", "archived"].includes(workflow.status)) add(null, "Move this workflow to Draft or Active before executing a review.");
  if (workflow.trigger_kind && workflow.trigger_kind !== "manual") add(null, "Review execution supports manual starts. Change the trigger to Manual; schedules and webhooks are preview-only.");
  if (nodes.length > 8) add(null, "A review workflow supports at most 8 steps.");
  if (!specialists.length || specialists.length > 4) add(null, "Include between 1 and 4 registered specialist steps.");
  const triggers = nodes.filter(node => kindOf(node) === "trigger");
  if (triggers.length !== 1) add(null, "Include exactly one request trigger.");
  if (!nodes.some(node => kindOf(node) === "output")) add(null, "Add an Output step for the review packet.");
  for (const node of nodes) {
    const data = object(node.data);
    const kind = kindOf(node);
    const incoming = edges.filter(edge => edge.target === node.id);
    const outgoing = edges.filter(edge => edge.source === node.id);
    if (!SUPPORTED_KINDS.has(kind)) add(node, `${kind} steps are preview-only. Use a registered specialist for evidence review.`);
    if (data.requiresApproval || data.approvalRequired || data.toolPolicy === "approval-required") add(node, "Approval gates are preview-only. Remove this gate before executing a read-only review.");
    if (data.parallel === true || Number(data.concurrency) > 1 || Number(data.maxConcurrency) > 1) add(node, "Configured parallel concurrency is preview-only. Review branches run in dependency order.");
    if (text(data.credentialId)) add(node, "Node credentials bind external tools and are preview-only. Remove the credential binding for a specialist evidence review.");
    if (text(data.outputSchema)) add(node, "Custom output schemas are preview-only. Clear the schema to use the specialist's validated evidence-review contract.");
    if (["topK", "maxContextChars", "maxOutputChars", "maxCompletionTokens"].some(key => data[key] != null && String(data[key]).trim())) add(node, "Custom model limits are preview-only. Clear model tuning to use the specialist's bounded retrieval and validated output.");
    if (data.redactSecrets === false || data.redactSecrets === "false") add(node, "Secret redaction is required for executed reviews.");
    if (data.logLevel && !["standard", "audit"].includes(data.logLevel)) add(node, "Use Standard or Audit logging. Debug payload logging is preview-only.");
    if (kind === "trigger" && incoming.length) add(node, "The request trigger cannot have incoming connections.");
    if (kind !== "trigger" && !incoming.length) add(node, "Connect this step to the request trigger or an earlier step.");
    if (kind === "output" && outgoing.length) add(node, "Output steps must finish a branch.");
    if (kind !== "output" && !outgoing.length) add(node, "Connect this branch to an Output step.");
    if (["agent", "llmAgent"].includes(kind)) {
      if (!assistant.AGENT_CATALOG[data.agentId]) add(node, "Choose a registered workspace specialist in the step inspector.");
      const prompt = text(data.prompt) || text(data.intent);
      if (!prompt) add(node, "Describe the task this specialist should review.");
      if (prompt.length + text(data.instructions).length > 4_000) add(node, "Keep the task and instructions within 4,000 characters.");
    }
    if (text(data.inputExpression) || data.inputMode === "manualReferences") add(node, "Expression inputs are preview-only. Clear the expression and use connected step outputs.");
    if (text(data.loopSourceKey) || Number(data.loopMaxIterations) > 0) add(node, "Loop policies are preview-only; remove this step's loop configuration.");
    if (text(data.apiUrl) || text(data.toolName) || text(data.testOpsAction)) add(node, "External tools and write actions are preview-only. Remove the tool binding to execute an evidence review.");
    if (data.onError && data.onError !== "stop") add(node, "Review execution stops on failure. Set the error policy to Stop workflow.");
    if (data.mergeMode && data.mergeMode !== "waitAllAppend") add(node, "Review execution collects every connected result. Choose Wait for all, append items.");
    if (data.timeoutMs != null && (!Number.isFinite(Number(data.timeoutMs)) || Number(data.timeoutMs) < 1_000 || Number(data.timeoutMs) > 70_000)) add(node, "Choose a step timeout between 1,000 and 70,000 milliseconds.");
    if (data.retryCount != null && (!Number.isInteger(Number(data.retryCount)) || Number(data.retryCount) < 0 || Number(data.retryCount) > 2)) add(node, "Review steps support zero, one or two retries within their timeout.");
    if (data.retryDelayMs != null && (!Number.isFinite(Number(data.retryDelayMs)) || Number(data.retryDelayMs) < 0 || Number(data.retryDelayMs) > 10_000)) add(node, "Choose a retry delay between 0 and 10,000 milliseconds.");
  }
  if (nodes.some(node => node.data?.sampleOutput != null)) warnings.push("Execution uses actual connected results. Declared sample outputs are used only in previews.");
  warnings.push("Results remain review briefs. No test cases, runs, bugs, repository files or external systems are changed.");
  warnings.push("Connected branches execute in dependency order on this worker. Output labels do not evaluate expressions; each specialist retrieves fresh evidence with its own bounded context policy.");
  return { ready: blockers.length === 0, execution_mode: MODE, blockers, warnings,
    limits: { max_steps: 8, max_specialists: 4, timeout_ms: MAX_DURATION_MS, input_limit_bytes: MAX_INPUT_BYTES },
    steps: ordered.map(node => ({ node_id: node.id, name: nodeName(node), kind: kindOf(node), specialist_id: node.data?.agentId || null })) };
}

async function requireRunAccess(user, projectId, { allowDisabled = false } = {}) {
  if (!user?.id || !await permissions.hasPermission(user, "agentic_workflow.run", projectId)) throw error("Permission required: agentic_workflow.run", 403);
  if (!allowDisabled && !await flags.areEnabled(flags.getFeatureKeysForPermission("agentic_workflow.run"), { user })) throw error("Agent workflows are disabled for this workspace.", 403);
}

const terminalNodes = (nodes, currentId, state) => nodes.map(node => node.node_id === currentId && node.status === "running"
  ? { ...node, status: state, completed_at: new Date().toISOString() }
  : node.status === "queued" ? { ...node, status: "skipped", completed_at: new Date().toISOString() } : node);

async function reconcile(run) {
  if (!run || run.execution_mode !== MODE || run.status !== "running") return run;
  const deadline = Date.parse(run.workflow_snapshot?.runtime_contract?.deadline_at || "");
  if (!Number.isFinite(deadline) || deadline > Date.now()) return run;
  const nodes = run.node_results.map(node => node.status === "running" ? { ...node, status: "interrupted", completed_at: new Date().toISOString() } : node.status === "queued" ? { ...node, status: "skipped" } : node);
  const output = { ...run.output_payload, status: "interrupted", summary: "This review exceeded its deadline or the worker stopped. Completed step results are preserved. Start a new review to retry.", error_code: "WORKFLOW_INTERRUPTED" };
  await store.save(run.id, "interrupted", nodes, output);
  active.get(run.id)?.controller.abort();
  return await store.get(run.id) || run;
}

function compactUpstream(run, node) {
  const ids = array(run.workflow_snapshot.edges).filter(edge => edge.target === node.id).map(edge => edge.source);
  return ids.map(id => {
    const prior = run.node_results.find(result => result.node_id === id);
    return { node_id: id, node_name: prior.node_name, status: prior.status, output: prior.output };
  });
}

// Upstream model text is a labelled proposal, never promoted to authoritative
// project evidence. Every specialist independently retrieves permitted evidence.
function specialistPrompt(run, node, sources) {
  const data = node.data || {};
  const priorReviews = sources.flatMap(source => {
    const output = source.output || {};
    return output.response ? [{ node_id: source.node_id, response: output.response.slice(0, 700), evidence_status: output.readiness?.status || "unverified" }]
      : array(output.reviews).slice(0, 4).map(review => ({ node_id: review.node_id, response: String(review.response || "").slice(0, 700), evidence_status: review.readiness?.status || "unverified" }));
  }).slice(0, 4);
  return [text(data.prompt) || text(data.intent), text(data.instructions),
    "Workflow request (user input, not source evidence):", JSON.stringify(run.input_payload).slice(0, 1_200),
    priorReviews.length ? "Upstream review proposals (untrusted analysis, not source evidence; independently verify any claim):" : "",
    priorReviews.length ? JSON.stringify(priorReviews) : ""
  ].filter(Boolean).join("\n\n").slice(0, 8_000);
}

const collectReviews = (sources) => sources.flatMap(source => {
  const out = source.output || {};
  return out.response ? [{ node_id: source.node_id, session_id: out.session_id, response: out.response, readiness: out.readiness, citation_ids: out.citation_ids }]
    : array(out.reviews);
}).filter((review, index, all) => all.findIndex(other => other.node_id === review.node_id) === index).slice(0, 4);

async function executeNode(run, node, user, signal, onAttempt) {
  const sources = compactUpstream(run, node);
  const kind = kindOf(node);
  if (kind === "trigger") return { request: run.input_payload };
  if (kind === "aggregator" || kind === "output") {
    const ancestors = new Set();
    const visit = id => {
      for (const edge of run.workflow_snapshot.edges.filter(item => item.target === id)) {
        if (!ancestors.has(edge.source)) { ancestors.add(edge.source); visit(edge.source); }
      }
    };
    visit(node.id);
    return { reviews: collectReviews(run.node_results.filter(item => ancestors.has(item.node_id))), requires_human_review: true };
  }
  const data = object(node.data);
  const deadline = Date.now() + (Number(data.timeoutMs) || 70_000);
  const retries = Number(data.retryCount) || 0;
  const scopeAliases = { requirements: "stories", "test-runs": "runs", "object-repository": "automation" };
  const scopes = text(data.knowledgeScope).split(",").map(scope => scopeAliases[scope.trim()] || scope.trim()).filter(Boolean);
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    await requireRunAccess(user, run.project_id);
    if (signal.aborted) throw execution.abortError();
    await onAttempt(attempt + 1);
    try {
      const review = await execution.bounded((nodeSignal) => assistant.respond({ user, project_id: run.project_id, app_type_id: run.app_type_id,
        mode: "agent", agent_id: data.agentId, prompt: specialistPrompt(run, node, sources), context_scopes: scopes,
        integration_id: text(data.llmIntegrationId) || undefined,
        smart_context: { query: text(data.knowledgeQuery) || text(data.prompt), source_ids: array(data.knowledgeSourceIds), source_kinds: array(data.knowledgeSourceKinds) },
        signal: nodeSignal
      }), { timeoutMs: deadline - Date.now(), signal });
      return { session_id: review.transaction.id, specialist_id: data.agentId, ...review.result, provenance: review.provenance };
    } catch (failure) {
      lastError = failure;
      if (signal.aborted || !([408, 429].includes(failure.statusCode) || failure.statusCode >= 500) || attempt >= retries || Date.now() >= deadline) throw failure;
      await execution.bounded(() => new Promise(resolve => setTimeout(resolve, Math.min(Number(data.retryDelayMs ?? 500) * (attempt + 1), deadline - Date.now()))), { timeoutMs: deadline - Date.now(), signal });
    }
  }
  throw lastError;
}

async function perform(run, user, controller) {
  let currentNode = null;
  let checking = false;
  const checkState = async () => {
    if (checking || controller.signal.aborted) return;
    checking = true;
    try { if ((await store.get(run.id))?.status !== "running") controller.abort(); }
    catch { controller.abort(); }
    finally { checking = false; }
  };
  const heartbeat = setInterval(() => void checkState(), 1_000);
  heartbeat.unref?.();
  const persist = async () => {
    if (controller.signal.aborted) throw execution.abortError();
    if (!await store.save(run.id, "running", run.node_results, run.output_payload)) { controller.abort(); throw execution.abortError(); }
  };
  try {
    await execution.bounded(async signal => {
      for (const step of run.workflow_snapshot.execution_order) {
        const node = run.workflow_snapshot.nodes.find(item => item.id === step);
        await requireRunAccess(user, run.project_id);
        if (signal.aborted) throw execution.abortError();
        currentNode = node.id;
        const result = run.node_results.find(item => item.node_id === node.id);
        result.status = "running";
        result.started_at = new Date().toISOString();
        result.input = { source_node_ids: compactUpstream(run, node).map(source => source.node_id), input_mode: "connected_results" };
        result.logs.push({ at: result.started_at, level: "info", message: "Started the registered review step." });
        await persist();
        result.output = await executeNode(run, node, user, signal, async attempts => { result.attempts = attempts; await persist(); });
        if (signal.aborted) throw execution.abortError();
        result.status = "completed";
        result.completed_at = new Date().toISOString();
        result.attempts = Math.max(result.attempts, 1);
        result.logs.push({ at: result.completed_at, level: "info", message: result.output.session_id ? "Specialist review saved with its evidence and provenance." : "Connected results collected." });
        run.output_payload.completed_steps += 1;
        await persist();
        if (result.output.readiness?.status === "insufficient_evidence") {
          if (signal.aborted) throw execution.abortError();
          run.node_results = terminalNodes(run.node_results, currentNode, "completed");
          await store.save(run.id, "needs_review", run.node_results, { ...run.output_payload, status: "needs_review", summary: `${nodeName(node)} could not find sufficient permitted evidence. Review its evidence gaps before starting another workflow.`, review_session_ids: run.node_results.map(item => item.output?.session_id).filter(Boolean) });
          return;
        }
      }
      const reviews = run.node_results.filter(item => item.output?.session_id).map(item => ({ node_id: item.node_id, session_id: item.output.session_id, readiness: item.output.readiness }));
      const limited = reviews.some(review => review.readiness?.status !== "ready_for_review");
      if (signal.aborted) throw execution.abortError();
      await store.save(run.id, limited ? "needs_review" : "completed", run.node_results, { ...run.output_payload, status: limited ? "needs_review" : "completed",
        summary: limited ? "Review workflow finished with evidence limitations. Inspect each specialist review before acting." : "Review workflow completed. Evidence and proposed next actions are ready for human review.",
        reviews, review_session_ids: reviews.map(review => review.session_id),
        results: run.node_results.filter(item => item.node_type === "output").map(item => ({ node_id: item.node_id, output: item.output })) });
    }, { timeoutMs: Math.max(1, Date.parse(run.workflow_snapshot.runtime_contract.deadline_at) - Date.now()), signal: controller.signal });
  } catch (failure) {
    diagnostics.onFailure(failure);
    const timedOut = failure.code === "DEADLINE_EXCEEDED";
    const state = timedOut ? "interrupted" : controller.signal.aborted || failure.name === "AbortError" ? "cancelled" : "failed";
    const message = timedOut ? "The review reached its deadline. Completed results are preserved."
      : state === "cancelled" ? "Review execution stopped. Completed results are preserved."
        : failure.statusCode === 403 ? "Access changed while this review was running. Further steps were stopped."
          : "A specialist step could not finish. Open its completed reviews and start a new workflow when the issue is resolved.";
    run.node_results = terminalNodes(run.node_results, currentNode, state);
    const failedStep = run.node_results.find(node => node.node_id === currentNode && node.status === state);
    if (failedStep) failedStep.logs.push({ at: new Date().toISOString(), level: "error", message });
    await store.save(run.id, state, run.node_results, { ...run.output_payload, status: state, summary: message, error_code: timedOut ? "WORKFLOW_DEADLINE" : state === "cancelled" ? "WORKFLOW_CANCELLED" : "WORKFLOW_STEP_FAILED" });
  } finally { clearInterval(heartbeat); }
}

async function start(workflow, input = {}, user) {
  await requireRunAccess(user, workflow.project_id);
  const report = readiness(workflow);
  if (!report.ready) throw Object.assign(error(report.blockers.map(item => item.message).join(" "), 422), { readiness: report });
  const payload = object(input.input_payload);
  if (Buffer.byteLength(JSON.stringify(payload)) > MAX_INPUT_BYTES) throw error("Review input is limited to 16 KB.");
  const requestKey = text(input.request_id);
  if (requestKey && !/^[a-zA-Z0-9_-]{8,128}$/.test(requestKey)) throw error("Use a request ID of 8–128 letters, digits, underscores or hyphens.");
  const requestFingerprint = hash({ workflow: { ...workflow, run_count: undefined, latest_run_at: undefined, latest_run_status: undefined }, payload });
  const id = requestKey ? `review-${hash([workflow.id, user.id, requestKey]).slice(0, 40)}` : randomUUID();
  const existing = await store.get(id);
  if (existing) {
    if (existing.workflow_snapshot.runtime_contract?.request_fingerprint !== requestFingerprint) throw error("This request ID was already used with a different workflow or input. Start a new review.", 409);
    return reconcile(existing);
  }
  if (active.size >= MAX_PARALLEL_RUNS) throw error("Two review workflows are already running on this worker. Try again after one finishes.", 429);
  const runtime = { mode: "bounded-review-workflow", execution_mode: MODE, simulated: false, arbitrary_code_execution: false, project_changes_applied: false,
    external_write_tools: false, requires_human_review: true, max_duration_ms: MAX_DURATION_MS,
    deadline_at: new Date(Date.now() + MAX_DURATION_MS).toISOString(), request_fingerprint: requestFingerprint,
    recovery: "Interrupted work is preserved; it is never automatically replayed." };
  const run = { id, workflow_id: workflow.id, project_id: workflow.project_id, app_type_id: workflow.app_type_id || null, workflow_name: workflow.name,
    created_by: user.id, execution_mode: MODE, status: "running", trigger_kind: "manual", input_payload: payload,
    workflow_snapshot: { ...structuredClone(workflow), execution_mode: MODE, runtime_contract: runtime, execution_order: report.steps.map(step => step.node_id), snapped_at: new Date().toISOString() },
    node_results: report.steps.map(step => ({ node_id: step.node_id, node_name: step.name, node_type: step.kind, specialist_id: step.specialist_id, status: "queued", execution_mode: MODE, attempts: 0, logs: [] })),
    output_payload: { execution_mode: MODE, status: "running", completed_steps: 0, total_steps: report.steps.length, summary: "Review workflow started.", requires_human_review: true, runtime_contract: runtime } };
  const controller = new AbortController();
  active.set(id, { controller, promise: null });
  try {
    const inserted = await store.insert(run);
    if (!inserted) {
      active.delete(id);
      const concurrent = await store.get(id);
      if (concurrent?.workflow_snapshot.runtime_contract?.request_fingerprint !== requestFingerprint) throw error("This request ID was already used with different workflow input. Start a new review.", 409);
      return concurrent;
    }
    // Persist before returning or scheduling any model calls. The task is bounded;
    // stale rows become interrupted on reads rather than being silently replayed.
    const promise = Promise.resolve().then(() => perform(run, user, controller)).catch(() => {
      // A database outage may prevent the terminal write. The persisted deadline
      // reconciles that record once storage is available again.
    }).finally(() => { if (active.get(id)?.controller === controller) active.delete(id); });
    active.set(id, { controller, promise });
    return await store.get(id);
  } catch (failure) { if (active.get(id)?.controller === controller) active.delete(id); throw failure; }
}

async function cancel(run, user) {
  await requireRunAccess(user, run.project_id, { allowDisabled: true });
  if (run.execution_mode !== MODE) throw error("Workflow previews cannot be cancelled.", 409);
  if (run.status !== "running") return run;
  const nodes = run.node_results.map(node => node.status === "running" ? { ...node, status: "cancelled", completed_at: new Date().toISOString() } : node.status === "queued" ? { ...node, status: "skipped" } : node);
  await store.save(run.id, "cancelled", nodes, { ...run.output_payload, status: "cancelled", summary: "Review execution cancelled. Completed step results are preserved.", cancelled_by: user.id });
  active.get(run.id)?.controller.abort();
  return await store.get(run.id);
}

const startOnce = async (workflow, input = {}, user) => {
  const key = input.request_id ? hash([workflow.id, user?.id, input.request_id]) : randomUUID();
  if (starting.has(key)) {
    await starting.get(key);
    // Revalidate permission and payload fingerprint on the coalesced request.
    return start(workflow, input, user);
  }
  const promise = start(workflow, input, user);
  starting.set(key, promise);
  try { return await promise; } finally { starting.delete(key); }
};

module.exports = { readiness, start: startOnce, cancel, reconcile, _internals: { store, active, diagnostics, perform, requireRunAccess, specialistPrompt, collectReviews, executeNode, MAX_DURATION_MS } };
