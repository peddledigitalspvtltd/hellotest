const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

const analytics = require("../src/services/portfolioAnalytics.service");
const readSource = (relativePath) => readFile(path.join(__dirname, relativePath), "utf8");

test("portfolio metric formula values are bounded and readiness weights remain a normalized formula", () => {
  const values = analytics.normalizeFormulaValues({
    "metric.project.portfolio_health": { story_weight: 2, automation_weight: 3, pass_weight: 5 },
    "metric.project.risky_classification": { pass_confidence_threshold: 140 },
    "metric.project.execution_evidence": { minimum_coverage_percent: -10 },
    "metric.project.needs_attention": { priority_project_limit: 99 }
  });

  assert.deepEqual(values["metric.project.portfolio_health"], {
    story_weight: 20,
    automation_weight: 30,
    pass_weight: 50
  });
  assert.equal(values["metric.project.risky_classification"].pass_confidence_threshold, 100);
  assert.equal(values["metric.project.execution_evidence"].minimum_coverage_percent, 0);
  assert.equal(values["metric.project.needs_attention"].priority_project_limit, 8);
});

test("project pass confidence combines finalized test outcomes with resolved Bug outcomes", () => {
  assert.deepEqual(analytics.calculatePassConfidence({
    passedCases: 7,
    finalizedCases: 10,
    resolvedBugs: 2,
    totalBugs: 5
  }), {
    total: 15,
    passed: 9,
    percent: 60,
    case_total: 10,
    case_passed: 7,
    bug_total: 5,
    bug_resolved: 2
  });

  assert.equal(analytics.calculatePassConfidence({ passedCases: 4, finalizedCases: 4 }).percent, 100);
  assert.equal(analytics.calculatePassConfidence({ resolvedBugs: 0, totalBugs: 2 }).percent, 0);
});

test("portfolio analytics uses complete accessible-project evidence and preserves compact impact contracts", async () => {
  const [service, routes, permissions, settingsRoutes, settingsService] = await Promise.all([
    readSource("../src/services/portfolioAnalytics.service.js"),
    readSource("../src/routes/projects.routes.js"),
    readSource("../src/security/permissions.catalog.js"),
    readSource("../src/routes/settings.routes.js"),
    readSource("../src/services/settings.service.js")
  ]);

  assert.match(service, /projectService\.getProjectCatalog\(userId, \{ projection: "summary" \}\)/);
  assert.match(service, /project\.has_access !== false/);
  assert.match(service, /FROM requirements WHERE requirements\.project_id IN/);
  assert.match(service, /FROM test_cases JOIN app_types/);
  assert.match(service, /mimeType\.startsWith\("image\/"\) \|\| mimeType\.startsWith\("video\/"\)/);
  assert.match(service, /entity_comments/);
  assert.match(service, /latestFailedResults/);
  assert.match(service, /failure_impacts/);
  assert.match(service, /bug_impacts/);
  assert.match(routes, /fastify\.get\("\/projects\/portfolio-analytics"/);
  assert.match(routes, /renderedSnapshotPdf\(req\.body \|\| \{\}\)/);
  assert.match(permissions, /\["GET", "\/projects\/portfolio-analytics", "project\.view"\]/);
  assert.match(permissions, /\["POST", "\/projects\/portfolio-attention-report\.pdf", "run\.report\.export"\]/);
  assert.match(settingsRoutes, /"ai_metric_formula_values"/);
  assert.match(settingsService, /WORKSPACE_METRIC_FORMULA_VALUES_KEY/);
  assert.match(settingsService, /metricFormulaRow/);
});

test("project workspace exposes editable project details, the requested tabs, and project metrics", async () => {
  const [page, styles] = await Promise.all([
    readSource("../../../frontend/src/pages/ProjectsPage.tsx"),
    readSource("../../../frontend/src/pages/ProjectsPage.css")
  ]);

  assert.match(page, /value: "details", label: "Project details"[\s\S]*value: "members", label: "Members"[\s\S]*value: "applications", label: "Applications"[\s\S]*value: "attachments", label: "Attachments"[\s\S]*value: "traceability", label: "Traceability"/);
  assert.match(page, /section === "attachments"/);
  assert.match(page, /section === "applications"/);
  assert.match(page, /isProjectDetailsDirty[\s\S]*You have unsaved changes\.[\s\S]*Cancel[\s\S]*Save changes/);
  assert.match(page, /selectedProjectBugCount[\s\S]*Total Bugs/);
  assert.match(page, /primeProjectAttentionScroll[\s\S]*maximumScrollTop[\s\S]*captureProjectAttentionSnapshot/);
  assert.match(page, /fragmentSelectors[\s\S]*for \(const fragment of fragments\)[\s\S]*canvasHeight[\s\S]*canvasWidth/);
  assert.match(page, /rendered_snapshot_pages_data_urls: renderedPages/);
  assert.match(styles, /is-exporting-snapshot \.evidence-flip-card-inner[\s\S]*transform: none !important/);
  assert.match(styles, /is-exporting-snapshot \.evidence-flip-card-back[\s\S]*display: none !important/);
  assert.match(page, /formatPassCoverageDetail/);
  assert.doesNotMatch(page, /Edit details/);
  assert.doesNotMatch(page, /label: "App Types"/);
});
