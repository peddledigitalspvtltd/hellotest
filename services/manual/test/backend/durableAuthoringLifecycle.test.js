const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
process.env.NODE_ENV = "test";

function fixture({ grooming, cases, allowed = true } = {}) {
  const rows = new Map(), calls = [], mutations = [];
  const db = { transaction: callback => () => callback(), prepare(sql) {
    const owned = (id, owner) => { const row = rows.get(id); return row?.status === "running" && row.lease_owner === owner ? row : null; };
    if (sql.includes("INSERT INTO")) return { get: async (id, project_id, input_payload, result_payload, created_by, job_kind) => {
      const row = { id, project_id, input_payload, result_payload, created_by, job_kind, status: "queued", attempts: 0 };
      rows.set(id, row); return { ...row };
    } };
    if (sql.includes("SELECT *")) return { get: async (id, project) => rows.get(id)?.project_id === project ? { ...rows.get(id) } : null };
    if (sql.includes("SET result_payload")) return { run: async (result, id, owner) => {
      const row = owned(id, owner); if (!row) return { changes: 0 };
      row.result_payload = structuredClone(result); mutations.push(structuredClone(result)); return { changes: 1 };
    } };
    if (sql.includes("SET status = 'cancelled'")) return { get: async (result, id, project) => {
      const row = rows.get(id); if (row?.project_id !== project || !["running", "queued"].includes(row.status)) return null;
      Object.assign(row, { result_payload: result, status: "cancelled", lease_owner: null }); return { ...row };
    } };
    if (sql.includes("SET status = 'completed'")) return { get: async (result, id, owner) => {
      const row = owned(id, owner); if (!row) return null;
      Object.assign(row, { status: "completed", result_payload: result, lease_owner: null }); return { ...row };
    } };
    if (sql.includes("SET status = 'failed'")) return { get: async (result, message, error_code, failure_payload, id, owner) => {
      const row = owned(id, owner); if (!row) return null;
      Object.assign(row, { status: "failed", result_payload: result, last_error: message, error_code, failure_payload, lease_owner: null }); return { ...row };
    } };
    throw new Error(`Unexpected SQL ${sql}`);
  } };
  const filename = path.resolve(__dirname, "../../backend/services/requirementGenerationJobs.service.js");
  const native = createRequire(filename), module = { exports: {} };
  const requireFixture = id => {
    if (id.endsWith("/src/db")) return db;
    if (id === "./requirement.service") return { getRequirement: async () => ({ id: "story", project_id: "project" }) };
    if (id.endsWith("/public/projectAccess")) return { getProject: async () => ({ id: "project" }) };
    if (id.endsWith("/public/applicationAccess")) return { getAppType: async () => ({ id: "app", project_id: "project" }) };
    if (id.endsWith("optionalEvidenceAccess.service")) return { getOptionalEvidenceAccess: async () => ({ "requirement.ai": allowed }) };
    if (id === "./requirementWorkspace.service") return { previewGrooming: async input => { calls.push(input); return grooming(input); } };
    if (id === "./requirementDesign.service") return { previewRequirementsTestCases: async input => { calls.push(input); return cases(input, calls.length); } };
    return native(id);
  };
  new Function("require", "module", "exports", fs.readFileSync(filename, "utf8"))(requireFixture, module, module.exports);
  const service = module.exports;
  const enqueue = async (kind = "grooming", extra = {}) => {
    const queued = await service.createGenerationJob({ kind, input: { project_id: "project", requirement_id: "story", app_type_id: "app", ...extra }, userId: "author", schedule() {} });
    const row = rows.get(queued.id); Object.assign(row, { status: "running", lease_owner: "worker", attempts: 1 }); return row;
  };
  const run = row => service.__storyGenerationJobInternals.runClaimedGenerationJob({ job: { ...row }, workerId: "worker", leaseSeconds: 60 });
  return { service, rows, calls, mutations, enqueue, run };
}

test("a short brief is rejected before a durable row or model request is created", async () => {
  const f = fixture();
  await assert.rejects(f.service.createGenerationJob({ input: { project_id: "project", additional_context: "signup" }, userId: "author" }), { code: "AI_STORY_BRIEF_TOO_SHORT" });
  assert.equal(f.rows.size, 0); assert.equal(f.calls.length, 0);
});

test("grooming returns a review and reports only actual completed stages", async () => {
  const f = fixture({ grooming: async ({ onProgress, durable, signal }) => {
    assert.equal(durable, true); assert.equal(signal.aborted, false);
    for (const stage of ["context", "guardrails", "specialist", "outcome", "evaluation"]) await onProgress(stage, stage);
    return { grooming: { purpose: "A real provider review fixture" }, processing: require("../../../ai/backend/services/generationLifecycle").processing({ status: "completed", stage: "review", profile: "grooming" }) };
  } });
  const row = await f.enqueue(); await f.run(row);
  const result = await f.service.getGenerationJob(row.id, "project");
  assert.equal(result.status, "completed"); assert.ok(result.grooming);
  assert.deepEqual(f.mutations.map(item => item.processing.active_stage_id), ["intake", "context", "guardrails", "specialist", "outcome", "evaluation"]);
  assert.equal(result.processing.schema_version, 1); assert.equal(result.processing.active_stage_id, "review");
});

for (const [code, retryAfterSeconds] of [["LLM_QUOTA_EXCEEDED", 0], ["DEPENDENCY_NETWORK_ERROR", 0], ["DEPENDENCY_TIMEOUT", 0], ["DEPENDENCY_CIRCUIT_OPEN", 17], ["AI_GROOMING_OUTPUT_INVALID", 0]]) {
  test(`${code} persists its code, stage and retry window without replay`, async () => {
    const stage = code.endsWith("INVALID") ? "outcome" : "specialist";
    const f = fixture({ grooming: async ({ onProgress }) => { await onProgress(stage, "Reviewing"); throw Object.assign(new Error("Safe diagnostic"), { code, publicMessage: "Safe diagnostic", retryAfterSeconds }); } });
    const row = await f.enqueue(); await f.run(row);
    const result = await f.service.getGenerationJob(row.id, "project");
    assert.equal(result.error_code, code); assert.equal(result.failure.code, code);
    assert.equal(result.failure.retry_after_seconds, retryAfterSeconds); assert.equal(result.processing.active_stage_id, stage);
    assert.equal(f.calls.length, 1); assert.equal(result.lease_owner, undefined);
  });
}

test("cancellation immediately aborts the running provider signal and cannot be overwritten by completion", async () => {
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  const f = fixture({ grooming: ({ signal }) => new Promise((resolve, reject) => {
    started(signal); signal.addEventListener("abort", () => reject(Object.assign(new Error("Stopped"), { code: "AI_JOB_CANCELLED" })), { once: true });
  }) });
  const row = await f.enqueue(), running = f.run(row), signal = await ready;
  const cancelled = await f.service.cancelGenerationJob(row.id, "project");
  assert.equal(cancelled.status, "cancelled"); assert.equal(signal.aborted, true);
  await running;
  assert.equal((await f.service.getGenerationJob(row.id, "project")).status, "cancelled");
  await assert.rejects(f.service.cancelGenerationJob(row.id, "other-project"), { statusCode: 404 });
});

test("each case proposal is checkpointed; a later failure retains it for review", async () => {
  const f = fixture({ cases: async ({ onProgress }, count) => {
    await onProgress("specialist", "The configured model is generating this case.");
    if (count === 2) throw Object.assign(new Error("Provider offline"), { code: "DEPENDENCY_NETWORK_ERROR" });
    return { cases: [{ title: "First saved proposal", steps: [] }] };
  } });
  const row = await f.enqueue("case-design", { max_cases: 2 }); await f.run(row);
  const result = await f.service.getGenerationJob(row.id, "project");
  assert.equal(result.status, "failed"); assert.equal(result.cases.length, 1);
  assert.equal(result.cases[0].client_id, "draft-1"); assert.equal(result.failure.code, "DEPENDENCY_NETWORK_ERROR");
});

test("a case service failure persists its confirmed inner phase and safe envelope instead of the outer job phase", async () => {
  const failure = { code: "AI_NATIVE_CONTRACT_INVALID", stage_id: "evaluation", message: "Safe validation diagnostic", retryable: false, retry_after_seconds: 0, retry_at: null };
  const f = fixture({ cases: async () => { throw Object.assign(new Error("PRIVATE_PROVIDER_DETAIL"), { code: failure.code, authoring_failure: failure }); } });
  const row = await f.enqueue("case-design"); await f.run(row);
  const result = await f.service.getGenerationJob(row.id, "project");
  assert.equal(result.processing.active_stage_id, "evaluation");
  assert.equal(result.failure.stage_id, "evaluation");
  assert.equal(result.failure.message, "Safe validation diagnostic");
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_PROVIDER_DETAIL/);
});

test("recovery resumes after a completed case checkpoint while uncertain provider dispatch is never replayed", async () => {
  const f = fixture({ cases: async () => ({ cases: [{ title: "Remaining case", steps: [] }] }) });
  const row = await f.enqueue("case-design", { max_cases: 2 });
  Object.assign(row, { attempts: 2, result_payload: { cases: [{ client_id: "draft-1", title: "Existing case" }], processing: { active_stage_id: "evaluation" } } });
  await f.run(row);
  assert.equal(f.calls.length, 1); assert.equal(row.result_payload.cases.length, 2);
  const uncertain = await f.enqueue("case-design", { max_cases: 2 });
  Object.assign(uncertain, { attempts: 2, result_payload: { cases: [{ client_id: "draft-1", title: "Existing case" }], processing: { active_stage_id: "specialist" } } });
  await f.run(uncertain);
  assert.equal(f.calls.length, 1); assert.equal(uncertain.error_code, "AI_JOB_INTERRUPTED"); assert.equal(uncertain.result_payload.cases.length, 1);
});

test("worker rechecks project AI permission before any provider dispatch", async () => {
  const f = fixture({ allowed: false }); const row = await f.enqueue(); await f.run(row);
  assert.equal(row.error_code, "AI_PERMISSION_REVOKED"); assert.equal(f.calls.length, 0);
});
