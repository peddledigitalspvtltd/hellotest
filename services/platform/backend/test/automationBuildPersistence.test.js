const { dependencyName } = require("./helpers/sourceFile");
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { buildAutomationCaseBlueprint } = require("../src/utils/automationCaseBlueprint");
const { normalizeScheduledAt } = require("../src/utils/automationSchedule");
const automationUtils = require("../src/utils/testStepAutomation");

const source = {
  id: "manual", app_type_id: "app", title: "Customer checkout", description: "Business flow", automated: "no",
  requirement_ids: ["story-1", "story-2"], suite_ids: ["suite-1"], module_ids: ["module-1"], test_data_set_ids: ["data"],
  labels: ["smoke"], parameter_values: { "t.email": "buyer@example.test" }, authoring_mode: "gherkin",
  gherkin_document: "Feature: Checkout\nScenario: Buy\n  # Shared Step Group [login-source]: Login\n  When sign in\n  # End Shared Step Group [login-source]"
};
const sourceSteps = [
  { id: "setup", action: "An account exists", expected_result: "Account is active", group_id: "setup-source", group_name: "Preconditions", group_kind: "local", step_type: "api", api_request: { method: "GET", url: "/accounts" } },
  { id: "login", action: "Sign in with @t.email", expected_result: "Dashboard appears", group_id: "login-source", group_name: "Login", group_kind: "reusable", reusable_group_id: "shared-login", step_type: "web", automation_code: "await page.goto('/login');" }
];

test("manual automation clones retain prose, preconditions, capabilities and scope links", () => {
  const before = JSON.stringify({ source, sourceSteps });
  let sequence = 0;
  const result = buildAutomationCaseBlueprint({ source, steps: sourceSteps, createdBy: "author", createGroupId: () => `clone-${++sequence}` });
  assert.equal(result.automated, "yes");
  assert.equal(result.automation_status, "incomplete");
  assert.deepEqual(result.manual_test_case_ids, ["manual"]);
  assert.deepEqual(result.requirement_ids, source.requirement_ids);
  assert.deepEqual(result.suite_ids, source.suite_ids);
  assert.deepEqual(result.test_data_set_ids, source.test_data_set_ids);
  assert.deepEqual(result.parameter_values, source.parameter_values);
  assert.deepEqual(result.steps.map((step) => [step.action, step.expected_result]), sourceSteps.map((step) => [step.action, step.expected_result]));
  assert.equal(result.steps[0].group_name, "Preconditions");
  assert.deepEqual(result.steps[0].api_request, sourceSteps[0].api_request);
  assert.equal(result.steps[1].automation_code, sourceSteps[1].automation_code);
  assert.equal(result.steps[1].reusable_group_id, "shared-login");
  assert.match(result.gherkin_document, /Shared Step Group \[clone-2\]/);
  assert.doesNotMatch(result.gherkin_document, /login-source/);
  assert.equal(JSON.stringify({ source, sourceSteps }), before);
});

test("automation scheduling normalizes timezone offsets and rejects invalid or past times", () => {
  const now = Date.parse("2026-09-06T00:00:00Z");
  assert.equal(normalizeScheduledAt(undefined, now), null);
  assert.equal(normalizeScheduledAt("2026-09-06T10:30:00+05:30", now), "2026-09-06T05:00:00.000Z");
  for (const value of ["tomorrow", "2026-09-06T10:30", "2026-09-05T00:00:00Z", "2026-09-06T00:00:00Z"]) {
    assert.throws(() => normalizeScheduledAt(value, now), (error) => error.statusCode === 400);
  }
});

const loadBuilderTestFunctions = (records) => {
  const file = path.join(__dirname, "../../../automation/backend/services/aiAutomationBuilder.service.js");
  const dbStub = { transaction: callback => callback, prepare: () => ({ get: async () => null, all: async () => Array.from(records.values()), run: async () => ({ changes: 1 }) }) };
  const sandbox = { module: { exports: {} }, exports: {}, process, URL, Buffer, setTimeout, clearTimeout, console, require: (id) => {
    if (dependencyName(id) === "db" || dependencyName(id) === "obsDb") return dbStub;
    if (id === "crypto") return require("crypto");
    if (dependencyName(id) === "testStepAutomation") return automationUtils;
    if (dependencyName(id) === "testStep.service") return { updateTestStep: async (id, update, options) => { assert.equal(options.syncSharedGroup, false); return Object.assign(records.get(id), update); } };
    return {};
  } };
  vm.runInNewContext(`${fs.readFileSync(file, "utf8")}\nmodule.exports = { normalizeLlmBuild: (payload, ...args) => normalizeLlmBuild(JSON.parse(JSON.stringify(payload)), ...args), applyBuild };`, sandbox, { filename: file });
  return sandbox.module.exports;
};

test("complete AI mappings preserve API/native capabilities and never overwrite step prose", async () => {
  const mixedSteps = [
    ...sourceSteps,
    { id: "native", action: "Tap sign in", expected_result: "Welcome appears", step_type: "android", automation_code: "await driver.back();" }
  ];
  const records = new Map(mixedSteps.map((step) => [step.id, { ...step }]));
  const { normalizeLlmBuild, applyBuild } = loadBuilderTestFunctions(records);
  const build = normalizeLlmBuild({ steps: mixedSteps.map(step => ({ step_id: step.id, step_type: step.step_type, automation_code: step.automation_code, api_request: step.api_request })) }, mixedSteps, [], "https://example.test");
  await applyBuild({ build });
  assert.equal(records.get("setup").api_request.url, "/accounts");
  assert.equal(records.get("setup").step_type, "api");
  assert.equal(records.get("native").automation_code, "await driver.back();");
  for (const step of mixedSteps) {
    assert.equal(records.get(step.id).action, step.action);
    assert.equal(records.get(step.id).expected_result, step.expected_result);
    assert.equal(records.get(step.id).group_id, step.group_id);
  }
});

const loadService = (relativeFile, overrides) => {
  const file = path.join(__dirname, relativeFile);
  const exported = {};
  const sandbox = { module: { exports: exported }, exports: exported, process, URL, Buffer, setTimeout: () => 0, clearTimeout: () => {}, console,
    require: (id) => overrides[Object.keys(overrides).find(key => key.split('/').pop() === id.split('/').pop())] || (id === "crypto" ? require("crypto") : dependencyName(id) === "automationSchedule" ? { normalizeScheduledAt } : dependencyName(id) === "automationCaseBlueprint" ? { buildAutomationCaseBlueprint } : {}) };
  vm.runInNewContext(fs.readFileSync(file, "utf8"), sandbox, { filename: file });
  return sandbox.module.exports;
};

test("both automation queues persist the future due time at their scheduling boundary", async () => {
  const future = "2099-01-02T03:04:05.000Z";
  const writes = [];
  const transactions = [];
  const database = { transaction: callback => callback, prepare: (sql) => ({ get: async () => ({ ...source, project_id: "project" }), run: async (...values) => { writes.push({ sql, values }); return { changes: 1 }; }, all: async () => [] }) };
  const workspace = {
    createTransaction: async (input) => { transactions.push(input); return { id: "transaction" }; },
    getTransaction: async () => ({ id: "transaction", title: "Automation build" }),
    appendTransactionEvent: async () => {}, createTransactionNotification: async () => {}
  };
  const overrides = { "./aiAutomationFeaturePolicy": require('../../../automation/backend/services/aiAutomationFeaturePolicy'), "@hellotest/platform/backend/src/db": database, "@hellotest/platform/backend/src/obsDb": database, "@hellotest/platform/backend/services/workspaceTransaction.service": workspace };
  const batch = loadService("../../../testing/backend/services/batchProcess.service.js", overrides);
  const generator = loadService("../../../automation/backend/services/automationGenerator.service.js", overrides);
  const batchResult = await batch.queueAutomationBuild({ app_type_id: "app", test_case_ids: ["manual"], scheduled_at: future, created_by: "author" });
  const generatorResult = await generator.queueGeneratorJob({ test_case_id: "manual", scheduled_at: future, created_by: "author", ai_feature: 'ai.automation.review' });
  assert.equal(batchResult.scheduled_at, future);
  assert.equal(generatorResult.scheduled_at, future);
  assert.equal(writes.find((write) => write.sql.includes("INSERT INTO batch_process_jobs")).values[4], future);
  assert.equal(writes.find((write) => write.sql.includes("INSERT INTO automation_generator_jobs")).values[5].scheduled_at, future);
  assert.equal(writes.find((write) => write.sql.includes("INSERT INTO automation_generator_jobs")).values[5].ai_feature, 'ai.automation.review');
  assert.equal(transactions.every((transaction) => transaction.metadata.scheduled_at === future), true);
});

test("manual build preparation creates a separate linked case and copies module membership", async () => {
  const created = [];
  const moduleWrites = [];
  const database = { prepare: (sql) => ({
    get: async () => null,
    all: async () => sourceSteps,
    run: async (...args) => { moduleWrites.push({ sql, args }); return { changes: 1 }; }
  }) };
  const service = loadService("../../../automation/backend/services/automationCasePreparation.service.js", {
    "@hellotest/platform/backend/src/db": database,
    "@hellotest/testing/backend/services/testCase.service": { getTestCase: async () => source, createTestCase: async (input) => { created.push(input); return { id: "automation-output" }; } }
  });
  const result = await service.prepareAutomationTarget({ testCaseId: "manual", createdBy: "author" });
  assert.equal(result.test_case_id, "automation-output");
  assert.equal(result.source_test_case_id, "manual");
  assert.equal(created[0].manual_test_case_ids[0], "manual");
  assert.equal(created[0].ai_generation_source, undefined, "manual recorder preparation is not an AI generation");
  assert.equal(source.automated, "no");
  assert.deepEqual(moduleWrites[0].args, ["automation-output", "manual"]);
});

test("AI build preparation assigns the creator to new clone review without reopening an existing target", async () => {
  const created = [];
  let existing = null;
  const service = loadService("../../../automation/backend/services/automationCasePreparation.service.js", {
    "@hellotest/platform/backend/src/db": { prepare: () => ({ get: async () => existing, all: async () => sourceSteps, run: async () => ({ changes: 1 }) }) },
    "@hellotest/testing/backend/services/testCase.service": { getTestCase: async () => source, createTestCase: async input => { created.push(input); return { id: "new-ai-target" }; } }
  });
  await service.prepareAutomationTarget({ testCaseId: "manual", createdBy: "generator", aiGenerated: true });
  assert.equal(created[0].reviewer_id, "generator");
  assert.equal(created[0].review_status, "pending");
  assert.equal(created[0].ai_generation_source, "interactive");
  assert.equal(created[0].ai_generation_review_status, "pending");
  existing = { id: "accepted-target", review_status: "accepted", ai_generation_review_status: "accepted" };
  const result = await service.prepareAutomationTarget({ testCaseId: "manual", createdBy: "generator", aiGenerated: true });
  assert.equal(result.test_case_id, "accepted-target");
  assert.equal(created.length, 1);
  assert.equal(existing.review_status, "accepted");
});

test("recording never falls back to an unrelated linked step at the same position", async () => {
  const moduleWrites = [];
  const database = { prepare: sql => ({ get: async () => ({ id: "automation-output" }), all: async id => id === "manual" ? sourceSteps : sourceSteps.map((step, index) => ({ ...step, id: `target-${index}`, action: "A different step" })), run: async (...args) => moduleWrites.push(args) }) };
  const service = loadService("../../../automation/backend/services/automationCasePreparation.service.js", { "@hellotest/platform/backend/src/db": database, "@hellotest/testing/backend/services/testCase.service": { getTestCase: async () => source } });
  await assert.rejects(service.prepareAutomationTarget({ testCaseId: "manual", targetStepId: "login" }), { statusCode: 409 });
  assert.equal(moduleWrites.length, 0);
});

test("recording retains exact matches after linked automation steps are reordered", async () => {
  const targets = sourceSteps.map((step, index) => ({ ...step, id: `target-${index}` })).reverse();
  const database = { prepare: () => ({ get: async () => ({ id: "automation-output" }), all: async id => id === "manual" ? sourceSteps : targets, run: async () => ({ changes: 1 }) }) };
  const service = loadService("../../../automation/backend/services/automationCasePreparation.service.js", { "@hellotest/platform/backend/src/db": database, "@hellotest/testing/backend/services/testCase.service": { getTestCase: async () => source } });
  const mapped = await service.prepareAutomationTarget({ testCaseId: "manual", targetStepId: "login" });
  assert.equal(mapped.target_step_id, "target-1");
});

test("recording into an automated case validates that the chosen step belongs to it", async () => {
  const database = { prepare: () => ({ all: async () => sourceSteps }) };
  const service = loadService("../../../automation/backend/services/automationCasePreparation.service.js", { "@hellotest/platform/backend/src/db": database, "@hellotest/testing/backend/services/testCase.service": { getTestCase: async () => ({ ...source, automated: "yes" }) } });
  await assert.rejects(service.prepareAutomationTarget({ testCaseId: "manual", targetStepId: "another-case-step" }), { statusCode: 400 });
  assert.equal((await service.prepareAutomationTarget({ testCaseId: "manual", targetStepId: "login" })).target_step_id, "login");
});

test("automation status endpoint authorizes the transaction project and reports actual saved progress", async () => {
  let transaction = { id: "build", category: "automation_build", project_id: "project", status: "running", metadata: { progress_percent: 45, test_case_id: "automation-output" } };
  const checks = [];
  const register = loadService("../../../testing/backend/routes/testCases.routes.js", {
    "@hellotest/platform/backend/services/workspaceTransaction.service": { getTransaction: async () => transaction },
    "@hellotest/platform/backend/public/projectAccess": { getProject: async (projectId, userId) => { checks.push(["project", projectId, userId]); } }
  });
  const routes = new Map();
  await register({
    get: (route, handler) => routes.set(route, handler), post: () => {}, put: () => {}, delete: () => {},
    authenticate: async () => { checks.push(["authenticate"]); },
    requirePermission: (permission, scope) => async () => { checks.push([permission, scope.projectId]); }
  });
  const handler = routes.get("/test-cases/automation/jobs/:transactionId");
  const response = await handler({ params: { transactionId: "build" }, user: { id: "author" } });
  assert.equal(response.status, "running");
  assert.equal(response.metadata.progress_percent, 45);
  assert.deepEqual(checks, [["authenticate"], ["project", "project", "author"], ["automation.build", "project"]]);
  transaction = { ...transaction, category: "unrelated" };
  await assert.rejects(() => handler({ params: { transactionId: "build" }, user: { id: "author" } }), (error) => error.statusCode === 404);
});

 test("AI mapping rejects omissions, duplicate IDs, runtime changes, placeholders and invalid code", () => {
  const { normalizeLlmBuild } = loadBuilderTestFunctions(new Map());
  const steps = [{ id: "a", step_order: 1, step_type: "web", action: "Save", expected_result: "Saved" }];
  for (const candidates of [[], [{step_id:"unknown",automation_code:"await page.reload();"}], [{step_id:"a",automation_code:"// TODO"}], [{step_id:"a",automation_code:"await page.;"}], [{step_id:"a",step_type:"api",api_request:{url:"/"}}], [{step_id:"a",automation_code:"await page.reload();"},{step_id:"a",automation_code:"await page.reload();"}]]) {
    assert.throws(() => normalizeLlmBuild({ steps: candidates }, steps, [], null));
  }
});

test("a changed case is rejected before AI updates can overwrite concurrent edits", async () => {
  const step = { id: "s", test_case_id: "c", step_order: 1, step_type: "web", action: "Save", expected_result: "Saved", automation_code: "old" };
  const records = new Map([["s", { ...step, action: "User edit" }]]);
  const { applyBuild } = loadBuilderTestFunctions(records);
  await assert.rejects(applyBuild({ build: { updates: [{ step, step_type: "web", automation_code: "new" }] } }), /case changed/);
  assert.equal(records.get("s").automation_code, "old");
});
