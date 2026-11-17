const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { createRequire } = require("node:module");
const lifecycle = require("../../backend/services/generationLifecycle");
const context = require("../../../platform/backend/src/utils/llmTraceContext");

function fixture({ providerError, persistError, lostLease = false, missingApp = false } = {}) {
  const row = { id: "job", project_id: "project", app_type_id: "web", created_by: "author", status: "running", lease_owner: "worker", attempts: 1, max_attempts: 1, requirement_ids: ["story"] };
  const snapshots = [], calls = { provider: 0, saved: 0 }, module = { exports: {} };
  const file = require.resolve("../../backend/services/aiTestCaseGeneration.service"), native = createRequire(file);
  const db = { transaction: callback => callback, prepare: sql => ({
    get: async () => sql.includes("FROM app_types") ? missingApp ? null : { id: "web", project_id: "project" }
      : sql.includes("FROM requirements") ? { id: "story", title: "Approve an invoice", project_id: "project" }
      : { ...row },
    all: async () => [],
    run: async (...values) => {
      if (lostLease) return { changes: 0 };
      if (sql.includes("SET processing_payload")) {
        row.processing_payload = values[0]; snapshots.push(values[0]);
      } else if (sql.includes("SET error_code")) {
        [row.error_code, row.failure_payload, row.processing_payload] = values;
      } else if (sql.includes("SET status = ?")) {
        [row.status, row.processed_requirements, row.generated_cases_count, row.error] = values;
        row.lease_owner = null;
      } else if (sql.includes("SET processed_requirements")) {
        [row.processed_requirements, row.generated_cases_count] = values;
      }
      return { changes: 1 };
    }
  }) };
  const preview = lifecycle.withLifecycle("case-design", async ({ onProgress }) => {
    await onProgress("context", "Preparing Story evidence.");
    await onProgress("guardrails", "Checking configuration.");
    await onProgress("specialist", "Generating the proposal."); calls.provider++;
    if (providerError) throw providerError;
    await onProgress("outcome", "Validating the proposal.");
    await onProgress("evaluation", "Checking grounded fields.");
    return { cases: [{ title: "Approve an invoice", steps: [] }] };
  });
  new Function("require", "module", "exports", fs.readFileSync(file, "utf8") + "\nmodule.exports.testRun = runJob; module.exports.testHydrate = hydrateJob;")(id => {
    if (id === "@hellotest/platform/backend/src/db") return db;
    if (id.endsWith("/requirementDesign.service")) return { previewRequirementTestCases: preview };
    if (id.endsWith("/testCase.service")) return { createTestCase: async () => { calls.saved++; if (persistError) throw persistError; return { id: "saved-case" }; } };
    if (id.endsWith("/workspaceTransaction.service")) return { findTransactionByRelated: async () => null };
    if (id.endsWith("/aiAttachmentAccess.service")) return { contextReferenceIds: () => [], retainReferences: async () => {} };
    return native(id);
  }, module, module.exports);
  return { row, snapshots, calls, hydrate: module.exports.testHydrate,
    run: () => context.run({ project_id: "project", generation_job_id: "job", authoring_profile: "case-generation" }, () => module.exports.testRun({ ...row }, "worker")) };
}

test("scheduled Case generation persists confirmed stages under lease and completes only after draft persistence", async () => {
  const f = fixture(), result = await f.run();
  assert.equal(result.status, "completed"); assert.equal(result.generated_cases_count, 1);
  assert.equal(result.processing.active_stage_id, "review");
  assert.equal(result.processing.schema_version, 1);
  assert.deepEqual([...new Set(f.snapshots.map(item => item.active_stage_id))], lifecycle.STAGES.slice(0, -1));
  assert.ok(f.snapshots.every(item => item.profile === "case-generation"));
  assert.deepEqual(f.calls, { provider: 1, saved: 1 });
});

for (const [code, stage] of [["LLM_AUTHENTICATION_FAILED", "specialist"], ["LLM_QUOTA_EXCEEDED", "specialist"], ["AI_NATIVE_CONTRACT_INVALID", "outcome"]]) {
  test(`scheduled ${code} keeps the actual failure stage, recovery fields and safe diagnostic`, async () => {
    const f = fixture({ providerError: Object.assign(new Error("PRIVATE_PROVIDER_DETAIL"), { code, statusCode: code === "LLM_QUOTA_EXCEEDED" ? 429 : 502, publicMessage: "Safe provider diagnostic", retryAfterSeconds: 11 }) });
    const result = await f.run();
    assert.equal(result.status, "failed"); assert.equal(result.error_code, code);
    assert.equal(result.processing.active_stage_id, stage); assert.equal(result.failure.stage_id, stage);
    assert.equal(result.failure.retry_after_seconds, 11);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_PROVIDER_DETAIL/);
    assert.deepEqual(f.calls, { provider: 1, saved: 0 });
  });
}

test("scheduled post-output storage failure is evaluation and never replays generation", async () => {
  const f = fixture({ persistError: Object.assign(new Error("Storage unavailable"), { code: "DEPENDENCY_CIRCUIT_OPEN", statusCode: 503 }) });
  const result = await f.run();
  assert.equal(result.status, "failed"); assert.equal(result.failure.stage_id, "evaluation");
  assert.deepEqual(f.calls, { provider: 1, saved: 1 });
});

test("scheduled missing scope fails during context with no provider dispatch", async () => {
  const f = fixture({ missingApp: true }), result = await f.run();
  assert.equal(result.status, "failed"); assert.equal(result.failure.stage_id, "context");
  assert.equal(f.calls.provider, 0);
});

for (const stage of ["specialist", "outcome", "evaluation"]) test(`recovery after an unfinished ${stage} does not dispatch another paid generation`, async () => {
  const f = fixture();
  Object.assign(f.row, { attempts: 2, processing_payload: lifecycle.processing({ stage, profile: "case-generation" }) });
  const result = await f.run();
  assert.equal(result.status, "failed"); assert.equal(result.failure.code, "AI_JOB_INTERRUPTED");
  assert.equal(result.failure.stage_id, stage); assert.equal(f.calls.provider, 0);
});

test("a persisted known capacity rejection remains eligible for its bounded scheduled retry", async () => {
  const f = fixture();
  Object.assign(f.row, { attempts: 2, max_attempts: 2, processing_payload: lifecycle.processing({ status: "failed", stage: "specialist", profile: "case-generation" }) });
  const result = await f.run();
  assert.equal(result.status, "completed"); assert.equal(f.calls.provider, 1);
});

test("lease loss prevents phase persistence and provider dispatch", async () => {
  const f = fixture({ lostLease: true }); await f.run();
  assert.equal(f.calls.provider, 0); assert.equal(f.snapshots.length, 0);
});

test("legacy jobs without phase receipts disclose missing stages instead of claiming specialist", async () => {
  const f = fixture();
  for (const status of ["running", "failed"]) {
    const result = await f.hydrate({ ...f.row, status });
    assert.equal(result.processing.active_stage_id, undefined);
    assert.equal(result.processing.completed_stage_count, 0);
    assert.equal(result.processing.progress_mode, "indeterminate");
    assert.ok(result.processing.stages.every(item => item.status === "queued"));
    assert.match(result.processing.status_label, /did not record/);
  }
  const queued = await f.hydrate({ ...f.row, status: "queued", processing_payload: lifecycle.processing({ status: "failed", stage: "specialist" }) });
  assert.equal(queued.processing.active_stage_id, "intake");
  assert.equal(queued.processing.completed_stage_count, 0);
});
