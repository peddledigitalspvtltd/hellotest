const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

const readSource = (relativePath) => readFile(path.join(__dirname, relativePath), "utf8");

test("delivery and requirement resolution routes are present in the permission catalog", async () => {
  const permissions = await readSource("../src/security/permissions.catalog.js");

  assert.match(permissions, /\["\/stories", \["requirement\.view"\]\]/);
  assert.match(permissions, /\["POST", "\/requirement-releases\/:id\/release-notes", "requirement_iteration\.view"\]/);
  assert.match(permissions, /\["POST", "\/requirement-releases\/:id\/scope", "requirement_iteration\.update"\]/);
  assert.match(permissions, /\["POST", "\/test-cases\/resolve-requirements", "testcase\.view"\]/);
});

test("ID-based Release and Sprint operations enforce permissions in the target project", async () => {
  const [releaseRoutes, iterationRoutes] = await Promise.all([
    readSource("../src/routes/requirementReleases.routes.js"),
    readSource("../src/routes/requirementIterations.routes.js")
  ]);

  for (const permission of ["requirement_iteration.view", "requirement_iteration.update", "requirement_iteration.delete"]) {
    assert.match(releaseRoutes, new RegExp(`requirePermission\\("${permission.replace(".", "\\.")}", \\{ projectId: release\\.project_id \\}\\)`));
    assert.match(iterationRoutes, new RegExp(`ensureIterationPermission\\(fastify, req, "${permission.replace(".", "\\.")}"\\)`));
  }
  assert.match(iterationRoutes, /const ensureIterationPermission = async \(fastify, req, permissionCode\)/);
});

test("Module requirement resolution requires target-project Story and Test Case visibility", async () => {
  const [caseRoutes, moduleRoutes, accessControl] = await Promise.all([
    readSource("../src/routes/testCases.routes.js"),
    readSource("../src/routes/testCaseModules.routes.js"),
    readSource("../src/plugins/accessControl.js")
  ]);

  const resolver = caseRoutes.slice(
    caseRoutes.indexOf('fastify.post("/test-cases/resolve-requirements"'),
    caseRoutes.indexOf('fastify.get("/test-cases/:id/versions"')
  );
  assert.match(resolver, /requirePermission\("testcase\.view", \{ projectId: appType\.project_id \}\)/);
  assert.match(resolver, /requirePermission\("requirement\.view", \{ projectId: appType\.project_id \}\)/);
  assert.match(moduleRoutes, /const ensureModulePermission = async \(fastify, req, permissionCode, options\)/);
  assert.match(moduleRoutes, /req\.body\.test_case_ids\?\.length \|\| req\.body\.requirement_ids\?\.length/);
  assert.match(moduleRoutes, /requirePermission\("requirement\.view", \{ projectId: appType\.project_id \}\)/);
  assert.match(accessControl, /SELECT project_id FROM app_types WHERE id = \?/);
});

test("reusable Test Data attachment requires data.view while creation remains data.manage", async () => {
  const [caseRoutes, executionRoutes, scheduleRoutes, dataRoutes] = await Promise.all([
    readSource("../src/routes/testCases.routes.js"),
    readSource("../src/routes/executions.routes.js"),
    readSource("../src/routes/executionSchedules.routes.js"),
    readSource("../src/routes/testDataSets.routes.js")
  ]);

  assert.match(caseRoutes, /req\.body\.test_data_set_ids\?\.length/);
  assert.match(caseRoutes, /requirePermission\("data\.view", \{ projectId: dataProjectId \}\)/);
  assert.match(executionRoutes, /const requireSelectedTestDataAccess = async/);
  assert.match(executionRoutes, /dataSet\.project_id !== projectId/);
  assert.match(executionRoutes, /requirePermission\("data\.view", \{ projectId: dataSet\.project_id \}\)/);
  assert.match(scheduleRoutes, /effectiveDataSetId[\s\S]*ensureSelectedTestDataAccess/);
  assert.match(dataRoutes, /requirePermission\("data\.manage", \{ projectId: dataSet\.project_id \}\)/);
});

test("scope assignment requires iteration update before Release or Module creation", async () => {
  const [releaseRoutes, moduleRoutes] = await Promise.all([
    readSource("../src/routes/requirementReleases.routes.js"),
    readSource("../src/routes/testCaseModules.routes.js")
  ]);

  assert.match(releaseRoutes, /req\.body\.sprint_ids\?\.length \|\| req\.body\.requirement_ids\?\.length/);
  assert.match(releaseRoutes, /requirePermission\("requirement_iteration\.update", \{ projectId: req\.body\.project_id \}\)/);
  assert.match(moduleRoutes, /req\.body\.test_case_ids\?\.length \|\| req\.body\.requirement_ids\?\.length/);
  assert.match(moduleRoutes, /requirePermission\("testcase\.update", \{ projectId: appType\.project_id \}\)/);
});

test("core project lookups and batch transactions use the correct feature boundaries", async () => {
  const [features, adminSpace, permissions] = await Promise.all([
    readSource("../src/services/featureFlag.service.js"),
    readSource("../../../frontend/src/pages/AdminSpacePage.tsx"),
    readSource("../src/security/permissions.catalog.js")
  ]);

  assert.doesNotMatch(features, /"app_type\.view":/);
  assert.match(features, /"app_type\.manage": \["hellotest\.ops\.projects"\]/);
  assert.match(features, /"transaction\.view": \["hellotest\.ops\.background_jobs"\]/);
  assert.match(features, /"transaction\.artifact\.download": \["hellotest\.ops\.background_jobs"\]/);
  assert.match(features, /"transaction\.manage": \["hellotest\.ops\.background_jobs", "hellotest\.automation\.batch_process"\]/);
  assert.doesNotMatch(features, /"project_member\.view":/);
  assert.match(adminSpace, /settings: \["hellotest\.ops\.settings"\]/);
  assert.match(permissions, /\["DELETE", "\/settings\/api-keys\/:id\/permanent", "api_key\.manage"\]/);
});

test("workspace-only permissions cannot be inherited from an unrelated project role", async () => {
  const [backend, frontend] = await Promise.all([
    readSource("../src/services/permission.service.js"),
    readSource("../../../frontend/src/lib/permissions.ts")
  ]);

  for (const code of ["integration.view", "notification.manage", "role.manage", "workspace_preferences.manage"]) {
    assert.match(backend, new RegExp(`"${code.replace(".", "\\.")}"`));
    assert.match(frontend, new RegExp(`"${code.replace(".", "\\.")}"`));
  }
  assert.match(frontend, /const isWorkspaceOnly = WORKSPACE_ONLY_PERMISSIONS\.has\(permission\)/);
  assert.match(frontend, /projectId && session\.user\.project_permissions && !isWorkspaceOnly/);
  assert.match(frontend, /isWorkspaceOnly && Array\.isArray\(session\.user\.workspace_permissions\)/);
});

test("session workspace permissions exclude project-role capabilities", async () => {
  const [auth, permissions] = await Promise.all([
    readSource("../src/services/auth.service.js"),
    readSource("../src/services/permission.service.js")
  ]);

  assert.match(permissions, /WORKSPACE_ONLY_PERMISSION_CODES,/);
  assert.match(auth, /WORKSPACE_ONLY_PERMISSION_CODES\.has\(code\)/);
  assert.match(auth, /permissions: \[\.\.\.new Set\(\[\.\.\.workspacePermissions, \.\.\.projectRows\.map/);
});

test("project administration uses catalogued target-project permissions", async () => {
  const [routes, page] = await Promise.all([
    readSource("../src/routes/projects.routes.js"),
    readSource("../../../frontend/src/pages/ProjectsPage.tsx")
  ]);

  assert.doesNotMatch(routes, /project\.manage/);
  assert.match(routes, /requirePermission\("project\.update", \{ projectId: req\.params\.id \}\)/);
  assert.doesNotMatch(page, /project\.manage/);
  assert.match(page, /hasPermission\(session, "project\.update", selectedProjectId\)/);
  assert.match(page, /hasPermission\(session, "app_type\.manage", selectedProjectId\)/);
});

test("global metric formula preferences require workspace preference administration", async () => {
  const settingsRoutes = await readSource("../src/routes/settings.routes.js");

  assert.match(settingsRoutes, /const WORKSPACE_PREFERENCE_ADMIN_KEYS = new Set\(\[\s*"ai_metric_formula_values"/);
  assert.match(settingsRoutes, /requirePermission\("workspace_preferences\.manage"\)/);
});

test("scheduled Run creation always attributes the authenticated actor", async () => {
  const routes = await readSource("../src/routes/executionSchedules.routes.js");
  assert.match(routes, /createExecutionSchedule\(\{ \.\.\.req\.body, created_by: req\.user\.id \}\)/);
});
