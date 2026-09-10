const assert = require("node:assert/strict");
const test = require("node:test");
const Minio = require("minio");
const analytics = require("../src/services/qualityAnalytics.service");
const dashboards = require("../src/services/qualityDashboard.service");
const versions = require("../src/services/testCaseVersion.service");
const attachments = require("../src/services/attachment.service");
const executions = require("../src/services/execution.service");
const featureFlags = require("../src/services/featureFlag.service");
const richTextAi = require("../src/services/richTextAi.service");
const aiTestDataGeneration = require("../src/services/aiTestDataGeneration.service");
const { ROUTE_PERMISSIONS } = require("../src/security/permissions.catalog");

const context = (overrides = {}) => ({
  requirements: [
    { id: "r1", priority: 1, test_case_ids: ["t1"] },
    { id: "r2", priority: 3, test_case_ids: ["t2"] }
  ],
  testCases: [
    { id: "t1", automated: "yes", module_ids: ["m1"] },
    { id: "t2", automation_status: "ready", module_ids: [] }
  ],
  results: [
    { id: "x1", test_case_id: "t1", status: "passed" },
    { id: "x2", test_case_id: "t2", status: "passed" }
  ],
  plannedCaseIds: new Set(["t1", "t2"]),
  issues: [],
  executions: [{ id: "e1", status: "completed", started_at: "2026-07-20T00:00:00Z", ended_at: "2026-07-20T01:00:00Z" }],
  suites: [{ id: "s1" }],
  modules: [{ id: "m1", name: "Core" }],
  ...overrides
});

test("release readiness treats zero defects as full containment and uses latest planned case scope", () => {
  const metrics = analytics.calculateMetrics(context());
  assert.equal(metrics.requirementCoverage, 100);
  assert.equal(metrics.executionCompletion, 100);
  assert.equal(metrics.passRate, 100);
  assert.equal(metrics.releaseConfidence, 100);
  assert.equal(metrics.evidenceConfidence, 100);
});

test("hard evidence caps keep open critical defects and blocked results visible", () => {
  const metrics = analytics.calculateMetrics(context({
    issues: [{ id: "bug-1", status: "open", severity: "critical" }],
    results: [
      { id: "x1", test_case_id: "t1", status: "passed" },
      { id: "x2", test_case_id: "t2", status: "blocked" }
    ]
  }));
  assert.equal(metrics.criticalDefects, 1);
  assert.equal(metrics.blockedResults, 1);
  assert.ok(metrics.releaseConfidence <= 39);
});

test("QA dashboard designer provides review-only widgets with explicit design provenance", async (t) => {
  const preview = dashboards.designPreview({ projectId: "project-1", stakeholder: "quality", release: "2026.07" });
  assert.equal(preview.preview_only, true);
  assert.equal(preview.requires_human_review, true);
  assert.equal(preview.dashboard.gadgets.length, 8);
  assert.equal(preview.dashboard.gadgets.every((item) => item.release === "2026.07"), true);
  assert.equal(preview.provenance.capability, "quality-dashboard-design-preview");
  assert.equal(preview.provenance.design_method, "stakeholder_template");
  assert.match(preview.provenance.design_basis, /predefined stakeholder template/);
  assert.match(preview.provenance.confidence_basis, /no design accuracy score/);
  assert.equal(typeof preview.confidence, "number", "Retains the existing wire contract for older clients");

  const selection = require("../src/services/aiLlmSelection.service");
  let integration = null;
  t.mock.method(selection, "resolveLlmIntegrationForUsage", async () => integration);
  const fallback = await dashboards.designPreviewWithAi({ projectId: "project-1" });
  assert.equal(fallback.fallback_used, true);
  assert.equal(fallback.provenance.design_method, "stakeholder_template");

  integration = { id: "model-fixture", name: "Fixture provider", type: "llm", model: "fixture-model" };
  t.mock.method(global, "fetch", async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ name: "Review dashboard", gadgets: [{ title: "Cases", metric: "testCases", type: "metric" }] }) } }] }), { status: 200 }));
  const generated = await dashboards.designPreviewWithAi({ projectId: "project-1" });
  assert.equal(generated.generation_mode, "llm");
  assert.equal(generated.provenance.design_method, "model_draft");
  assert.match(generated.provenance.design_basis, /normalized to supported widgets/);
  assert.match(generated.provenance.confidence_basis, /no design accuracy score/);
  assert.equal(generated.requires_human_review, true);
});

test("dashboard gadget count and visualization inputs are normalized", () => {
  assert.throws(() => dashboards.normalizeGadgets(Array.from({ length: 13 }, () => ({}))), /0 and 12/);
  const [gadget] = dashboards.normalizeGadgets([{ title: "Pass rate", type: "unknown", metric: "passRate" }]);
  assert.equal(gadget.type, "metric");
  assert.equal(gadget.metric, "passRate");
  assert.throws(() => dashboards.normalizeGadgets([{ data_source: "hellotest", metric: "averageAgeDays" }]), { code: "DASHBOARD_METRIC_UNSUPPORTED", statusCode: 400 });
  const [bounded] = dashboards.normalizeGadgets([{ data_source: "hellotest", metric: "testCases", group_by: "unsafe", accent: "pink" }]);
  assert.equal(bounded.metric, "testCases");
  assert.equal(bounded.group_by, "status");
  assert.equal(bounded.accent, "blue");
});

test("test case version summaries identify field and step changes", () => {
  const reason = versions.summarizeChanges(
    { title: "Checkout", status: "draft", steps: [{ action: "Open" }] },
    { title: "Checkout", status: "ready", steps: [{ action: "Open" }, { action: "Pay" }] }
  );
  assert.match(reason, /status/);
  assert.match(reason, /steps \(1 → 2\)/);
  assert.equal(versions.normalizeRevision("7"), 7);
  assert.throws(() => versions.normalizeRevision("latest"), /positive integer/);
});

test("attachment filenames are safe and evidence routes require scoped permissions", () => {
  assert.equal(attachments.safeFileName("../bad\u0000/name?.pdf"), "name-.pdf");
  assert.equal(typeof Minio.Client, "function");
  assert.equal(ROUTE_PERMISSIONS.get("POST /attachments"), "attachment.create");
  assert.equal(ROUTE_PERMISSIONS.get("POST /executions/:id/ai-failure-clusters"), "run.ai");
  assert.equal(ROUTE_PERMISSIONS.get("POST /analytics/query-batch"), "dashboard.view");
  assert.equal(ROUTE_PERMISSIONS.get("POST /ai/rich-text-rephrase"), "content.ai");
  assert.equal(ROUTE_PERMISSIONS.get("POST /requirements/ai-create-preview"), "requirement.ai");
});

test("rich-text AI output is reduced to the supported authoring HTML contract", () => {
  assert.equal(
    richTextAi.sanitizeAllowedHtml('<p class="x" onclick="bad()">Safe <strong>fact</strong><script>alert(1)</script><img src=x onerror=bad()></p>'),
    "<p>Safe <strong>fact</strong></p>"
  );
  assert.equal(richTextAi.sanitizeAllowedHtml("First line\n\nSecond line"), "<p>First line</p><p>Second line</p>");
  assert.equal(richTextAi.sanitizeAllowedHtml("<blockquote><em>Review</em></blockquote>"), "<blockquote><em>Review</em></blockquote>");
  assert.equal(
    richTextAi.ensureBulletListHtml("<p>Project scope</p><p>Release goals</p>"),
    "<ul><li>Project scope</li><li>Release goals</li></ul>"
  );
  assert.equal(
    richTextAi.ensureBulletListHtml("<ol><li>First outcome</li><li>Second outcome</li></ol>"),
    "<ul><li>First outcome</li><li>Second outcome</li></ul>"
  );
});

test("AI test-data generation keeps deterministic fallback and LLM values synthetic", () => {
  const emails = aiTestDataGeneration._internals.deterministicValues({ prompt: "customer emails", fieldContext: "checkout", count: 4 });
  assert.equal(emails.length, 4);
  assert.ok(emails.every((value) => value.endsWith("@example.test")));
  assert.equal(aiTestDataGeneration._internals.isSafeSyntheticValue("synthetic.user@example.test"), true);
  assert.equal(aiTestDataGeneration._internals.isSafeSyntheticValue("real.person@company.example"), false);
  assert.equal(aiTestDataGeneration._internals.isSafeSyntheticValue("api_key=live-secret-value"), false);
  assert.equal(aiTestDataGeneration._internals.isSafeSyntheticValue("+1-202-555-0118"), true);
  assert.equal(aiTestDataGeneration._internals.isSafeSyntheticValue("+1-212-867-5309"), false);
});

test("execution assignments inherit from run through suite and module to case", () => {
  const snapshot = { suite_id: "suite-1", module_id: "module-1", test_case_id: "case-1" };
  const base = {
    assigned_to_ids: ["run-owner"],
    suite_assignments: { "suite-1": ["suite-owner"] },
    module_assignments: { "module-1": ["module-owner"] },
    case_assignments: { "case-1": ["case-owner"] }
  };

  assert.deepEqual(executions.resolveScopeAssignment(snapshot, base), {
    assignedToIds: ["case-owner"], source: "case"
  });
  assert.deepEqual(executions.resolveScopeAssignment(snapshot, { ...base, case_assignments: {} }), {
    assignedToIds: ["module-owner"], source: "module"
  });
  assert.deepEqual(executions.resolveScopeAssignment(snapshot, { ...base, case_assignments: {}, module_assignments: {} }), {
    assignedToIds: ["suite-owner"], source: "suite"
  });
  assert.deepEqual(executions.resolveScopeAssignment(snapshot, { ...base, case_assignments: {}, module_assignments: {}, suite_assignments: {} }), {
    assignedToIds: ["run-owner"], source: "run"
  });
});

test("new automation capabilities are disabled by default and run routes use specific permissions", () => {
  const preview = featureFlags.FEATURE_DEFINITIONS.find((item) => item.key === "hellotest.automation.preview");
  const analyticsFlag = featureFlags.FEATURE_DEFINITIONS.find((item) => item.key === "hellotest.automation.analytics");
  assert.equal(preview.default_enabled, false);
  assert.equal(analyticsFlag.default_enabled, false);
  assert.equal(ROUTE_PERMISSIONS.get("POST /executions"), "run.create");
  assert.equal(ROUTE_PERMISSIONS.get("POST /executions/:id/start"), "run.execute");
  assert.equal(ROUTE_PERMISSIONS.get("PUT /executions/:id/:level/:scopeId/assignment"), "run.update");
});

test("feature availability exposes only enforceable API and mobile capability switches", () => {
  const byKey = new Map(featureFlags.FEATURE_DEFINITIONS.map((feature) => [feature.key, feature]));

  for (const removedKey of [
    "hellotest.api.testing",
    "hellotest.api.preview",
    "hellotest.mobile.android",
    "hellotest.mobile.ios",
    "hellotest.mobile.recorder"
  ]) {
    assert.equal(byKey.has(removedKey), false, `${removedKey} must not appear as an inert Admin switch`);
  }

  const preview = byKey.get("hellotest.automation.preview");
  const appium = byKey.get("hellotest.mobile.appium");
  const workspaceSettings = byKey.get("hellotest.ops.settings");
  assert.equal(preview.label, "API request validation previews");
  assert.deepEqual(preview.routes, ["/test-cases", "/shared-steps", "/automation"]);
  assert.equal(appium.label, "Android and Appium");
  assert.match(appium.description, /Android Appium authoring/);
  assert.match(workspaceSettings.description, /Provide personal workspace preferences/);
  assert.deepEqual(featureFlags.getFeatureKeysForPermission("automation.preview"), ["hellotest.automation.preview"]);
  assert.deepEqual(featureFlags.getFeatureKeysForPermission("mobile.manage"), ["hellotest.mobile.appium"]);
});

test("delivery-aware creation stays within existing feature boundaries", () => {
  const byKey = new Map(featureFlags.FEATURE_DEFINITIONS.map((feature) => [feature.key, feature]));
  const deliveryPlanning = byKey.get("hellotest.manual.requirements");
  const testCases = byKey.get("hellotest.manual.test_cases");
  const runs = byKey.get("hellotest.manual.runs");
  const bugs = byKey.get("hellotest.manual.bugs");
  const testData = byKey.get("hellotest.manual.test_data");
  const sharedStepGroups = byKey.get("hellotest.manual.suites");

  assert.equal(deliveryPlanning.label, "Product Management — Stories, Sprints, and Releases");
  assert.deepEqual(deliveryPlanning.routes, ["/requirements", "/stories", "/backlog", "/sprints", "/releases"]);
  assert.match(deliveryPlanning.description, /Release and Sprint choices/);
  assert.match(testCases.description, /selectable ownership/);
  assert.match(testCases.description, /requirement-linked modules/);
  assert.match(runs.description, /scheduled runs/);
  assert.match(runs.description, /linked rows into case instances/);
  assert.match(bugs.description, /Release\/Sprint context/);
  assert.equal(sharedStepGroups.label, "Suites and Shared Step Groups");
  assert.match(testData.description, /one or many rows/);

  for (const permission of ["schedule.view", "schedule.create", "schedule.update", "schedule.run", "schedule.delete"]) {
    assert.deepEqual(featureFlags.getFeatureKeysForPermission(permission), ["hellotest.manual.runs"]);
  }
  assert.deepEqual(featureFlags.getFeatureKeysForPermission("run.view"), ["hellotest.manual.runs"]);
  assert.deepEqual(featureFlags.getFeatureKeysForPermission("settings.view"), ["hellotest.ops.settings"]);
  assert.deepEqual(
    featureFlags.getFeatureKeysForPermission("settings.manage"),
    ["hellotest.ops.settings", "hellotest.ops.admin"]
  );
  assert.deepEqual(
    featureFlags.getFeatureKeysForPermission("workspace_preferences.manage"),
    ["hellotest.ops.settings", "hellotest.ops.admin"]
  );
  assert.deepEqual(
    featureFlags.getFeatureKeysForPermission("localization.manage"),
    ["hellotest.ops.settings", "hellotest.ops.admin"]
  );

  assert.equal(byKey.has("hellotest.manual.delivery_context"), false);
});

test("step-aligned automation moves require governed step management permission", () => {
  assert.equal(ROUTE_PERMISSIONS.get("POST /test-steps/move-automation"), "step.manage");
});
