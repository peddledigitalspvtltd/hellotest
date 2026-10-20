const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const Fastify = require("fastify");

const source = fs.readFileSync(require.resolve("../../backend/routes/testSteps.routes"), "utf8");
const evidenceSource = fs.readFileSync(require.resolve("../../../platform/backend/services/optionalEvidenceAccess.service"), "utf8");
const steps = [
  { id: "web", test_case_id: "case-a", step_order: 1, action: "Submit the order", expected_result: "Receipt appears", step_type: "web", automation_code: 'await web.fill("#password", "private-value");', api_request: null, group_id: "checkout", group_name: "Checkout", group_kind: "reusable", reusable_group_id: "shared-checkout" },
  { id: "api", test_case_id: "case-a", step_order: 2, action: "Read the order", expected_result: "Order is returned", step_type: "api", automation_code: "// @hellotest-options optional", api_request: { method: "GET", url: "/orders", headers: [{ key: "Authorization", value: "private-token" }] } },
  { id: "other-project", test_case_id: "case-b", step_order: 1, action: "Other project behavior", expected_result: "Visible outcome", step_type: "web", automation_code: 'await web.click("#private-target");', api_request: null }
];

async function fixture(t, { automationFeatureEnabled = true } = {}) {
  const calls = { reads: [], permissions: [], optional: [] };
  const evidenceModule = { exports: {} };
  vm.runInNewContext(evidenceSource, { module: evidenceModule, require: name => {
    if (name === "./permission.service") return { hasPermission: async (user, code, projectId) => code === "automation.code.view" && (user.role === "admin" || user.id === "engineer" && projectId === "project-a") };
    if (name === "./featureFlag.service") return { getDisabledPermissionCodes: async () => automationFeatureEnabled ? [] : ["automation.code.view"] };
    throw new Error(`Unexpected evidence dependency: ${name}`);
  } });
  const module = { exports: {} };
  vm.runInNewContext(source, { module, require: name => {
    if (name === 'node:crypto') return require('node:crypto');
    if (name === '@hellotest/automation/backend/lib/automationObjectSourceContext') return require('../../../automation/backend/lib/automationObjectSourceContext');
    if (name === "../services/testStep.service") return {
      getTestSteps: async ({ test_case_id }) => { calls.reads.push(test_case_id || "all"); return steps.filter(step => !test_case_id || step.test_case_id === test_case_id); },
      getTestCaseAutomationStartUrl:async()=> 'https://app.test/start',
      getTestStep: async id => {
        const step = steps.find(item => item.id === id);
        if (!step) throw Object.assign(new Error("Test Step not found"), { statusCode: 404 });
        return step;
      }
    };
    if (name.endsWith("entityScope.service")) return { resolveEntityScope: async ({ entityType, entityId }) => {
      assert.equal(entityType, "test_case");
      if (!["case-a", "case-b"].includes(entityId)) throw Object.assign(new Error("Case not found"), { statusCode: 404 });
      return { entityType, entityId, projectId: entityId === "case-a" ? "project-a" : "project-b" };
    } };
    if (name.endsWith("optionalEvidenceAccess.service")) return { getOptionalEvidenceAccess: async (user, projectId, permissionCodes) => {
      calls.optional.push({ user: user.id, projectId, permissionCodes: Array.from(permissionCodes) });
      return evidenceModule.exports.getOptionalEvidenceAccess(user, projectId, permissionCodes);
    } };
    if (name.endsWith("/catalog")) return { TEST_STEP_GROUP_KIND_VALUES: ["local", "reusable"], TEST_STEP_TYPE_VALUES: ["web", "api", "android", "ios"] };
    if (name.endsWith("/mobileFeature")) return { containsMobileStepPayload: () => false };
    if (name.includes("sharedStepGroup.service") || name.includes("mobileFeature.service")) return {};
    throw new Error(`Unexpected dependency: ${name}`);
  } });
  const app = Fastify();
  t.after(() => app.close());
  app.decorate("authenticate", async req => {
    const id = req.headers.authorization;
    if (!id) throw Object.assign(new Error("Authentication required"), { statusCode: 401 });
    req.user = { id, role: id === "admin" ? "admin" : "member" };
  });
  app.decorate("requirePermission", (permission, { projectId }) => async req => {
    calls.permissions.push({ permission, projectId, user: req.user.id });
    if (req.user.id === "denied") throw Object.assign(new Error("Permission required: testcase.view"), { statusCode: 403 });
  });
  await app.register(module.exports);
  return { app, calls };
}

test("case readers receive complete behavior and group metadata without executable source", async t => {
  const { app, calls } = await fixture(t);
  const response = await app.inject({ url: "/test-steps?test_case_id=case-a", headers: { authorization: "reader" } });
  assert.equal(response.statusCode, 200);
  const visible = response.json();
  assert.equal(visible.length, 2);
  for (const [index, step] of visible.entries()) {
    assert.equal(step.action, steps[index].action);
    assert.equal(step.expected_result, steps[index].expected_result);
    assert.equal(step.step_order, index + 1);
    assert.equal(step.automation_code, "");
    assert.equal(step.api_request, null);
    assert.equal(step.automation_source_sha256, null);
    assert.equal(step.automation_context_sha256, null);
    assert.equal(step.automation_source_hidden, true);
  }
  assert.equal(visible[0].reusable_group_id, "shared-checkout");
  assert.equal(visible[0].group_name, "Checkout");
  assert.doesNotMatch(response.body, /private-value|private-token/);
  assert.deepEqual(calls.permissions, [{ permission: "testcase.view", projectId: "project-a", user: "reader" }]);
  assert.deepEqual(calls.optional, [{ user: "reader", projectId: "project-a", permissionCodes: ["automation.code.view"] }]);
  assert.match(steps[0].automation_code, /private-value/, "read projection never changes durable source");
});

test("single-step reads enforce the same feature-aware source projection", async t => {
  const { app } = await fixture(t);
  const disabled = await fixture(t, { automationFeatureEnabled: false });
  for (const [server, user] of [[app, "reader"], [disabled.app, "engineer"], [disabled.app, "admin"]]) {
    const response = await server.inject({ url: "/test-steps/api", headers: { authorization: user } });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().automation_source_hidden, true);
    assert.equal(response.json().action, "Read the order");
    assert.equal(response.json().api_request, null);
    assert.doesNotMatch(response.body, /private-token/);
  }
});

test("engineers receive source only for the entity's authorized project", async t => {
  const { app, calls } = await fixture(t);
  for (const url of ["/test-steps?test_case_id=case-a", "/test-steps/api"]) {
    const response = await app.inject({ url, headers: { authorization: "engineer" } });
    assert.equal(response.statusCode, 200);
    const records = Array.isArray(response.json()) ? response.json() : [response.json()];
    assert.equal(records.some(step => step.api_request?.headers?.[0]?.value === "private-token"), true);
    assert.equal(records.some(step => step.automation_source_hidden), false);
    for (const record of records) assert.equal(record.automation_source_sha256,require('node:crypto').createHash('sha256').update(record.automation_code,'utf8').digest('hex'));
    const contexts=require('../../../automation/backend/lib/automationObjectSourceContext').automationObjectSourceContexts({caseStartUrl:'https://app.test/start',steps:steps.filter(step=>step.test_case_id==='case-a')});
    for(const record of records)assert.equal(record.automation_context_sha256,contexts.get(record.id)||null);
  }
  const response = await app.inject({ url: "/test-steps/other-project?project_id=project-a", headers: { authorization: "engineer" } });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().automation_source_hidden, true);
  assert.equal(calls.optional.at(-1).projectId, "project-b", "query parameters cannot confer source access in another project");
});

test("authentication and case access remain mandatory and unscoped reads remain administrator-only", async t => {
  const { app, calls } = await fixture(t);
  assert.equal((await app.inject({ url: "/test-steps?test_case_id=case-a" })).statusCode, 401);
  assert.equal((await app.inject({ url: "/test-steps?test_case_id=case-a", headers: { authorization: "denied" } })).statusCode, 403);
  assert.equal((await app.inject({ url: "/test-steps/api", headers: { authorization: "denied" } })).statusCode, 403);
  assert.equal(calls.reads.length, 0);
  assert.equal(calls.optional.length, 0);
  assert.equal((await app.inject({ url: "/test-steps", headers: { authorization: "engineer" } })).statusCode, 400);
  const admin = await app.inject({ url: "/test-steps", headers: { authorization: "admin" } });
  assert.equal(admin.statusCode, 200);
  assert.equal(admin.json().length, steps.length);
  assert.match(admin.body, /private-value/);
  assert.match(admin.body, /private-token/);
});
