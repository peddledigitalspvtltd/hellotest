const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

const readSource = (relativePath) => readFile(path.join(__dirname, relativePath), "utf8");

const schemaSection = (openapi, name, nextName) => {
  const start = openapi.indexOf(`    ${name}:`);
  const end = nextName ? openapi.indexOf(`    ${nextName}:`, start + name.length + 5) : openapi.length;
  assert.notEqual(start, -1, `OpenAPI schema ${name} must exist`);
  assert.notEqual(end, -1, `OpenAPI schema following ${name} must exist`);
  return openapi.slice(start, end);
};

const pathSection = (openapi, pathName, nextPathName) => {
  const start = openapi.indexOf(`  ${pathName}:`);
  const end = nextPathName ? openapi.indexOf(`  ${nextPathName}:`, start + pathName.length + 3) : openapi.indexOf("components:", start);
  assert.notEqual(start, -1, `OpenAPI path ${pathName} must exist`);
  assert.notEqual(end, -1, `OpenAPI path following ${pathName} must exist`);
  return openapi.slice(start, end);
};

test("OpenAPI documents additive Release scope and native Sprint membership", async () => {
  const [openapi, releases, requirements] = await Promise.all([
    readSource("../../../../openapi.yaml"),
    readSource("../../../manual/backend/routes/requirementReleases.routes.js"),
    readSource("../../../manual/backend/routes/requirements.routes.js")
  ]);

  assert.match(releases, /fastify\.post\("\/requirement-releases\/:id\/scope"/);
  assert.match(openapi, /^  \/requirement-releases\/\{id\}\/scope:$/m);
  assert.match(openapi, /AppendRequirementReleaseScopeRequest/);
  assert.match(openapi, /appended_requirement_ids:/);
  assert.match(openapi, /appended_sprint_ids:/);

  assert.match(requirements, /iteration_id:/);
  assert.match(requirements, /\{ project_id, status, priority, sprint_id, unassigned \}/);
  const requirement = schemaSection(openapi, "Requirement", "RequirementDefectLink");
  assert.match(requirement, /iteration_id:/);
  assert.match(openapi, /name: sprint_id[\s\S]*name: unassigned/);
});

test("OpenAPI keeps delivery context aligned across Bugs, Runs, and schedules", async () => {
  const [openapi, issues, executions, schedules] = await Promise.all([
    readSource("../../../../openapi.yaml"),
    readSource("../../../testing/backend/routes/issues.routes.js"),
    readSource("../../../testing/backend/routes/executions.routes.js"),
    readSource("../../../testing/backend/routes/executionSchedules.routes.js")
  ]);

  for (const route of [issues, executions, schedules]) {
    assert.match(route, /release: \{ required: false, type: "string"/);
    assert.match(route, /sprint: \{ required: false, type: "string"/);
    assert.match(route, /build: \{ required: false, type: "string"/);
  }

  for (const [name, nextName] of [
    ["IssueWriteFields", "CreateIssueRequest"],
    ["Execution", "CreateExecutionRequest"],
    ["CreateExecutionRequest", "UpdateExecutionRequest"],
    ["ExecutionSchedule", "CreateExecutionScheduleRequest"],
    ["CreateExecutionScheduleRequest", "UpdateExecutionScheduleRequest"],
    ["UpdateExecutionScheduleRequest", "SmartExecutionImpactCase"]
  ]) {
    const section = schemaSection(openapi, name, nextName);
    assert.match(section, /release:/, `${name} must expose release`);
    assert.match(section, /sprint:/, `${name} must expose sprint`);
    assert.match(section, /build:/, `${name} must expose build`);
  }
});

test("OpenAPI covers Test Case authors, one data set, module Requirements, and row instances", async () => {
  const [openapi, cases, modules, results] = await Promise.all([
    readSource("../../../../openapi.yaml"),
    readSource("../../../testing/backend/routes/testCases.routes.js"),
    readSource("../../../testing/backend/routes/testCaseModules.routes.js"),
    readSource("../../../testing/backend/routes/executionResults.routes.js")
  ]);

  assert.match(cases, /author_id: \{ required: false, type: "string" \}/);
  assert.match(cases, /test_data_set_ids: \{ required: false, type: "array", items: "string", maxItems: 1 \}/);
  const createCase = schemaSection(openapi, "CreateTestCaseRequest", "UpdateTestCaseRequest");
  assert.match(createCase, /required: \[title\]/);
  assert.match(createCase, /test_data_set_ids: \{ type: array, maxItems: 1/);
  assert.match(createCase, /author_id:/);

  assert.match(modules, /requirement_ids: \{ required: false, type: "array", items: "string" \}/);
  assert.match(openapi, /^  \/test-case-modules:$/m);
  const createModule = schemaSection(openapi, "CreateTestCaseModuleRequest", "UpdateTestCaseModuleRequest");
  assert.match(createModule, /requirement_ids:/);
  assert.match(createModule, /test_case_ids:/);

  assert.match(results, /data_set_iteration_index: \{ required: false, type: "number" \}/);
  assert.match(results, /data_set_row_snapshot: \{ required: false, type: "object" \}/);
  const result = schemaSection(openapi, "ExecutionResult", "CreateExecutionResultRequest");
  assert.match(result, /test_data_set_id:/);
  assert.match(result, /data_set_iteration_index:/);
  assert.match(result, /data_set_row_snapshot:/);
});

test("OpenAPI covers persisted settings, API key deletion, feature flags, and session permissions", async () => {
  const [openapi, settings, featureFlags, auth] = await Promise.all([
    readSource("../../../../openapi.yaml"),
    readSource("../routes/settings.routes.js"),
    readSource("../routes/featureFlags.routes.js"),
    readSource("../services/auth.service.js")
  ]);

  for (const routePath of [
    "/settings/localization",
    "/settings/workspace-preferences",
    "/settings/api-keys",
    "/settings/api-keys/{id}/permanent",
    "/feature-flags"
  ]) {
    assert.match(openapi, new RegExp(`^  ${routePath.replace(/[{}]/g, "\\$&")}:$`, "m"));
  }

  assert.match(settings, /fastify\.delete\("\/settings\/api-keys\/:id\/permanent"/);
  assert.match(openapi, /PermanentDeleteApiKeyResponse/);
  assert.match(featureFlags, /fastify\.put\("\/feature-flags"/);
  assert.match(openapi, /UpdateFeatureFlagsRequest/);
  assert.match(openapi, /ApiKeyScopeValue:[\s\S]*enum: \[user, read, design, automation, runs, environment, integrations, admin\]/);

  assert.match(auth, /permissions: permissionProfile\.permissions/);
  assert.match(auth, /workspace_permissions: permissionProfile\.workspacePermissions/);
  assert.match(auth, /project_permissions: permissionProfile\.projectPermissions/);
  const user = schemaSection(openapi, "User", "SessionResponse");
  assert.match(user, /permissions:/);
  assert.match(user, /workspace_permissions:/);
  assert.match(user, /project_permissions:/);
});

test("OpenAPI protects workspace APIs and models service-specific authentication", async () => {
  const openapi = await readSource("../../../../openapi.yaml");

  assert.match(openapi, /^security:\n  - bearerAuth: \[\]\n  - apiKeyAuth: \[\]/m);
  assert.match(openapi, /securitySchemes:[\s\S]*bearerAuth:[\s\S]*scheme: bearer/);
  assert.match(openapi, /apiKeyAuth:[\s\S]*name: X-API-Key/);
  assert.match(openapi, /testEngineSecret:[\s\S]*name: X-HelloTest-TestEngine-Secret/);
  assert.match(openapi, /testEngineCallbackSignature:[\s\S]*name: x-testengine-signature/);

  assert.match(pathSection(openapi, "/auth/login", "/auth/session"), /security: \[\]/);
  assert.match(pathSection(openapi, "/auth/session", "/settings/localization"), /security:\n        - bearerAuth: \[\]/);
  assert.match(pathSection(openapi, "/settings/api-keys", "/settings/api-keys/{id}"), /security:\n        - bearerAuth: \[\]/g);
  assert.match(pathSection(openapi, "/api/testengine/callbacks/runs", "/testengine/internal/jobs/lease"), /testEngineCallbackSignature: \[\]/);
  assert.match(pathSection(openapi, "/testengine/internal/jobs/lease", "/testengine/internal/jobs/{id}"), /testEngineSecret: \[\]/);
});
