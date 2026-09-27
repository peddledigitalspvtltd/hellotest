const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { resolveMobileRecorderPlatform, buildMobileRecorderPlan } = require("../../backend/domain/mobileRecorderPlan");
const { persistMobileRecorderPlan } = require("../../backend/services/mobileRecorderPersistence.service");

function recorderFixture({ steps = [], kind = "unified", configuration = null, recordingActions = [] } = {}) {
  const testCase = { id: "case", title: "Native checkout", app_type_id: "app", project_id: "project", app_type_kind: kind };
  const updates = [];
  const creates = [];
  const requests = [];
  const transactions = [];
  let recorderSession;
  const database = { transaction: (callback) => callback, prepare: () => ({ get: async () => testCase, all: async () => steps, run: async () => ({ changes: 1 }) }) };
  const exported = {};
  const module = { exports: exported };
  const source = fs.readFileSync(path.join(__dirname, "../../backend/services/aiAutomationBuilder.service.js"), "utf8");
  new Function("require", "exports", "module", source)((name) => {
    if (name.endsWith("/db")) return database;
    if (name.endsWith("/obsDb")) return { prepare: () => ({ all: async () => [], run: async () => ({ changes: 1 }) }) };
    if (name === "crypto") return require("node:crypto");
    if (name.endsWith("/testStepAutomation")) return require("../../../platform/backend/src/utils/testStepAutomation");
    if (name.endsWith("/mobileRecorderPlan")) return { resolveMobileRecorderPlatform, buildMobileRecorderPlan };
    if (name.endsWith("/mobileRecorderPersistence.service")) return { persistMobileRecorderPlan };
    if (name.endsWith("/mobileFeature")) return require("../../../platform/backend/src/utils/mobileFeature");
    if (name.endsWith("/runtimeSecrets")) return { resolveMobileEngineSecret: () => "test-secret" };
    if (name.endsWith("/optionalEvidenceAccess.service")) return { getOptionalEvidenceAccess: async () => ({ "mobile.manage": true }) };
    if (name.endsWith("/mobileFeature.service")) return { assertMobileFeatureEnabled: async () => true };
    if (name.endsWith("/testConfiguration.service")) return { getTestConfiguration: async () => configuration };
    if (name.endsWith("/integration.service")) return { getActiveIntegrationByTypeForProject: async () => ({ base_url: "http://engine.test", config: {} }) };
    if (name.endsWith("automationCasePreparation.service")) return { prepareAutomationTarget: async ({ targetStepId }) => ({ test_case_id: testCase.id, target_step_id: targetStepId }) };
    if (name.endsWith("/workspaceTransaction.service")) return {
      createTransaction: async (input) => { transactions.push(input); return { id: "transaction" }; },
      getTransaction: async () => transactions[0], updateTransaction: async (id, patch) => Object.assign(transactions[0], patch),
      appendTransactionEvent: async () => undefined
    };
    if (name.endsWith("/llmHttpClient")) return { fetchLlmWithRetry: async (url, init) => {
      const body = init.body ? JSON.parse(init.body) : null;
      requests.push({ url, body });
      if (body) recorderSession = { id: "session", platform: body.platform_name, actions: recordingActions };
      return Response.json(recorderSession);
    } };
    if (name.endsWith("/testStep.service")) return {
      updateTestStep: async (id, update) => { updates.push({ id, ...update }); },
      createTestStep: async (input) => { creates.push(input); return { id: `created-${creates.length}` }; }
    };
    return {};
  }, exported, module);
  return { ...module.exports, testCase, applicationPlatform: kind, steps, updates, creates, requests, transactions };
}

test("mobile recorder resolves targeted iOS and native plans with API setup", () => {
  const f = recorderFixture({ steps: [{ id: "api", step_type: "api" }, { id: "ios", step_type: "ios" }] });
  assert.equal(resolveMobileRecorderPlatform(f), "ios");
  assert.equal(resolveMobileRecorderPlatform({ ...f, targetStepId: "ios" }), "ios");
  assert.throws(() => resolveMobileRecorderPlatform({ ...f, targetStepId: "api" }), /Android or iOS step/);
  assert.throws(() => resolveMobileRecorderPlatform({ ...f, targetStepId: "ios", recordedPlatform: "android" }), /does not match/);
  assert.equal(resolveMobileRecorderPlatform({ ...f, recordedPlatform: "ios" }), "ios");
});

test("mixed native platforms require a target or one configured platform", () => {
  const f = recorderFixture({ steps: [{ id: "android", step_type: "android" }, { id: "ios", step_type: "ios" }] });
  assert.throws(() => resolveMobileRecorderPlatform(f), /includes Android and iOS/);
  assert.equal(resolveMobileRecorderPlatform({ ...f, targetStepId: "ios" }), "ios");
  assert.equal(resolveMobileRecorderPlatform({ ...f, configuration: { targets: [{ mobile_os: "iOS", version: "18" }] } }), "ios");
  assert.throws(() => resolveMobileRecorderPlatform({ ...f, configuration: { mobile_os: "ios", targets: [{ mobile_os: "android" }, { mobile_os: "ios" }] } }), /includes Android and iOS/);
});

test("native recorder startup sends and persists the effective platform", async () => {
  const f = recorderFixture({ steps: [{ id: "api", step_type: "api" }, { id: "ios", step_type: "ios" }] });
  const result = await f.startRecorderSession({ test_case_id: "case", recorder_mode: "local", recorder_target: "mobile", target_step_id: "ios", created_by: "author" });
  assert.equal(f.requests[0].body.platform_name, "ios");
  assert.equal(f.transactions[0].metadata.platform_name, "ios");
  assert.equal(f.transactions[0].metadata.target_step_id, "ios");
  assert.equal(result.platform_name, "ios");
  assert.match(f.transactions[0].description, /iOS/);
});

test("finishing an iOS recording uses the captured platform even in a unified application", async () => {
  const f = recorderFixture({ steps: [{ id: "api", step_order: 1, step_type: "api" }, { id: "ios", step_order: 2, step_type: "ios" }], recordingActions: [{ type: "tap", locator: "point:100,100" }] });
  await f.startRecorderSession({ test_case_id: "case", recorder_mode: "local", recorder_target: "mobile", target_step_id: "ios", created_by: "author" });
  const result = await f.finishRecorderSession({ test_case_id: "case", recorder_session_id: "session", transaction_id: "transaction", recorder_mode: "local", created_by: "author" });
  assert.equal(result.recorder_session.platform_name, "ios");
  assert.equal(result.step_updates[0].step_type, "ios");
  assert.equal(f.transactions[0].metadata.platform_name, "ios");
  assert.deepEqual(f.updates.map((step) => step.id), ["ios"]);
  assert.match(result.message, /iOS/);
});

test("selected recording actions retain capture order and are never duplicated", async () => {
  const f = recorderFixture({ steps: [{ id: "ios", step_order: 1, step_type: "ios" }], recordingActions: [
    { index: 1, type: "tap", locator: "point:10,10" }, { index: 2, type: "tap", locator: "point:20,20" }, { index: 3, type: "tap", locator: "point:30,30" }
  ] });
  await f.startRecorderSession({ test_case_id: "case", recorder_mode: "local", recorder_target: "mobile", target_step_id: "ios", created_by: "author" });
  const result = await f.finishRecorderSession({ test_case_id: "case", recorder_session_id: "session", transaction_id: "transaction", included_action_indices: [3, 1, 3], created_by: "author" });
  assert.equal(result.recorder_session.action_count, 2);
  const code = result.step_updates[0].automation_code;
  assert.ok(code.indexOf("x: 10") < code.indexOf("x: 30"));
  assert.equal((code.match(/x: 30/g) || []).length, 1);
  assert.doesNotMatch(code, /x: 20/);
});

test("missing action selection and null coordinates fail before step writes", async () => {
  for (const scenario of [
    { actions: [{ index: 1, type: "tap", locator: "point:10,10" }], selection: [2], code: "AUTOMATION_RECORDER_ACTIONS_CHANGED" },
    { actions: [{ index: 1, type: "tap", x: null, y: null }], code: "AUTOMATION_RECORDER_INPUT_INVALID" }
  ]) {
    const f = recorderFixture({ steps: [{ id: "ios", step_order: 1, step_type: "ios" }], recordingActions: scenario.actions });
    await f.startRecorderSession({ test_case_id: "case", recorder_mode: "local", recorder_target: "mobile", target_step_id: "ios", created_by: "author" });
    await assert.rejects(f.finishRecorderSession({ test_case_id: "case", recorder_session_id: "session", transaction_id: "transaction", included_action_indices: scenario.selection, created_by: "author" }), { code: scenario.code });
    assert.equal(f.updates.length, 0);
    assert.equal(f.creates.length, 0);
  }
});

test("whole-plan native recordings preserve API, web and the other native platform", async () => {
  const f = recorderFixture({ steps: [
    { id: "setup", step_order: 1, step_type: "api", api_request: { url: "https://api.test" } },
    { id: "web", step_order: 2, step_type: "web", automation_code: "await page.reload();" },
    { id: "ios", step_order: 3, step_type: "ios", action: "Sign in", expected_result: "Welcome" },
    { id: "android", step_order: 4, step_type: "android", automation_code: "await driver.back();" }
  ] });
  const plan = buildMobileRecorderPlan({ caseId: f.testCase.id, applicationPlatform: f.applicationPlatform, existingSteps: f.steps, platform: "ios", capturedActions: [{ type: "tap", locator: "~Sign in" }, { type: "tap", locator: "~Continue" }] });
  assert.deepEqual(plan.filter((change) => change.operation === "updated").map(({ stepId, input }) => [stepId, input.step_type]), [["ios", "ios"]]);
  assert.equal(plan[1].input.step_type, "ios");
  assert.equal(plan[1].input.step_order, 5);
  assert.match(plan[0].input.automation_code, /ios\.tap/);
  assert.equal(f.steps[0].api_request.url, "https://api.test");
});
