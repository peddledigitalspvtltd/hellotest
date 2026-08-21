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

test("portfolio analytics uses complete accessible-project evidence and preserves compact impact contracts", async () => {
  const [service, routes, permissions, settingsRoutes, settingsService] = await Promise.all([
    readSource("../src/services/portfolioAnalytics.service.js"),
    readSource("../src/routes/projects.routes.js"),
    readSource("../src/security/permissions.catalog.js"),
    readSource("../src/routes/settings.routes.js"),
    readSource("../src/services/settings.service.js")
  ]);

  assert.match(service, /projectService\.getProjectCatalog\(userId\)/);
  assert.match(service, /project\.has_access !== false/);
  assert.match(service, /FROM requirements WHERE requirements\.project_id IN/);
  assert.match(service, /FROM test_cases JOIN app_types/);
  assert.match(service, /mimeType\.startsWith\("image\/"\) \|\| mimeType\.startsWith\("video\/"\)/);
  assert.match(service, /entity_comments/);
  assert.match(service, /latestFailedResults/);
  assert.match(service, /failure_impacts/);
  assert.match(service, /bug_impacts/);
  assert.match(routes, /fastify\.get\("\/projects\/portfolio-analytics"/);
  assert.match(routes, /renderedSnapshotPdf\(req\.body \|\| \{\}, \{ pageMode: "continuous" \}\)/);
  assert.match(permissions, /\["GET", "\/projects\/portfolio-analytics", "project\.view"\]/);
  assert.match(permissions, /\["POST", "\/projects\/portfolio-attention-report\.pdf", "run\.report\.export"\]/);
  assert.match(settingsRoutes, /"ai_metric_formula_values"/);
  assert.match(settingsService, /WORKSPACE_METRIC_FORMULA_VALUES_KEY/);
  assert.match(settingsService, /metricFormulaRow/);
});
