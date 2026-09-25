const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

const readSource = (relativePath) => readFile(path.join(__dirname, relativePath), "utf8");

test("environment and configuration list services reject an unscoped query before persistence access", async () => {
  const environmentService = require("../../../testing/backend/services/testEnvironment.service");
  const configurationService = require("../../../testing/backend/services/testConfiguration.service");

  await assert.rejects(
    environmentService.getTestEnvironments({}),
    (error) => error?.statusCode === 400 && /project_id or app_type_id is required/.test(error.message)
  );
  await assert.rejects(
    configurationService.getTestConfigurations({}),
    (error) => error?.statusCode === 400 && /project_id or app_type_id is required/.test(error.message)
  );
});

test("engine run authorization uses the persisted run project for membership and permission", async () => {
  const { ensureRunReadAccess } = require("../../../automation/backend/routes/engine.routes")._internals;
  const calls = [];
  const req = { params: { runId: "engine-run-1" }, user: { id: "user-1" } };
  const fastify = {
    requirePermission(permissionCode, { projectId }) {
      return async (request) => calls.push(["permission", permissionCode, projectId, request.user.id]);
    }
  };

  const scope = await ensureRunReadAccess(fastify, req, {
    engineService: {
      async getRunScope(runId) {
        calls.push(["scope", runId]);
        return { engine_run_id: runId, project_id: "project-2" };
      }
    },
    projectService: {
      async getProject(projectId, userId) {
        calls.push(["membership", projectId, userId]);
        return { id: projectId };
      }
    }
  });

  assert.equal(scope.project_id, "project-2");
  assert.deepEqual(calls, [
    ["scope", "engine-run-1"],
    ["membership", "project-2", "user-1"],
    ["permission", "run.view", "project-2", "user-1"]
  ]);
});

test("signed-in Test Engine readers are authorized against the run's own project", async () => {
  const [routes, service, permissions] = await Promise.all([
    readSource("../../../automation/backend/routes/engine.routes.js"),
    readSource("../../../automation/backend/services/engine.service.js"),
    readSource("../src/security/permissions.catalog.js")
  ]);

  assert.match(service, /exports\.getRunScope = async \(runId\)/);
  assert.match(service, /SELECT engine_run_id, project_id, execution_id, test_case_id[\s\S]*WHERE engine_run_id = \?/);
  assert.match(routes, /const scope = await engineService\.getRunScope\(req\.params\.runId\)/);
  assert.match(routes, /projects\.getProject\(scope\.project_id, req\.user\.id\)/);
  assert.match(routes, /requirePermission\("run\.view", \{ projectId: scope\.project_id \}\)/);
  assert.equal((routes.match(/const scope = await ensureRunReadAccess\(fastify, req\)/g) || []).length, 4);
  assert.equal((service.match(/WHERE engine_run_id = \? AND project_id = \?/g) || []).length, 4);

  for (const suffix of ["status", "results", "logs", "artifacts"]) {
    assert.match(
      permissions,
      new RegExp(`\\["GET", "\\/api\\/runs\\/:runId\\/${suffix}", "run\\.view"\\]`)
    );
  }
});

test("Test Environment access always resolves and authorizes one project", async () => {
  const [routes, service] = await Promise.all([
    readSource("../../../testing/backend/routes/testEnvironments.routes.js"),
    readSource("../../../testing/backend/services/testEnvironment.service.js")
  ]);

  assert.match(routes, /project_id or app_type_id is required when listing Test Environments/);
  assert.match(routes, /const scopedProjectId = await resolveListProjectId\(\{ project_id, app_type_id \}\)/);
  assert.match(routes, /requirePermission\("environment\.view", \{ projectId: scopedProjectId \}\)/);
  assert.match(routes, /requirePermission\("environment\.view", \{ projectId: environment\.project_id \}\)/);
  assert.ok(
    (routes.match(/requirePermission\("environment\.manage", \{ projectId: environment\.project_id \}\)/g) || []).length >= 2,
    "updates and deletes must authorize against the persisted environment project"
  );
  assert.match(routes, /requirePermission\("environment\.manage", \{ projectId: req\.body\.project_id \}\)/);
  assert.match(routes, /appType\.project_id !== project_id/);
  assert.match(service, /if \(!project_id && !app_type_id\)/);
});

test("Test Configuration access always resolves and authorizes one project", async () => {
  const [routes, service] = await Promise.all([
    readSource("../../../testing/backend/routes/testConfigurations.routes.js"),
    readSource("../../../testing/backend/services/testConfiguration.service.js")
  ]);

  assert.match(routes, /project_id or app_type_id is required when listing Test Configurations/);
  assert.match(routes, /const scopedProjectId = await resolveListProjectId\(\{ project_id, app_type_id \}\)/);
  assert.match(routes, /requirePermission\("configuration\.view", \{ projectId: scopedProjectId \}\)/);
  assert.match(routes, /requirePermission\("configuration\.view", \{ projectId: configuration\.project_id \}\)/);
  assert.ok(
    (routes.match(/requirePermission\("configuration\.manage", \{ projectId: configuration\.project_id \}\)/g) || []).length >= 2,
    "updates and deletes must authorize against the persisted configuration project"
  );
  assert.match(routes, /requirePermission\("configuration\.manage", \{ projectId: req\.body\.project_id \}\)/);
  assert.match(routes, /appType\.project_id !== project_id/);
  assert.match(service, /if \(!project_id && !app_type_id\)/);
});

test("OpenAPI documents the project-scoped resource contracts", async () => {
  const openapi = await readSource("../../../../openapi.yaml");

  for (const routePath of [
    "/api/runs/{runId}/status",
    "/api/runs/{runId}/results",
    "/api/runs/{runId}/logs",
    "/api/runs/{runId}/artifacts",
    "/test-environments",
    "/test-environments/{id}",
    "/test-configurations"
  ]) {
    assert.match(openapi, new RegExp(`^  ${routePath.replace(/[{}]/g, "\\$&")}:$`, "m"));
  }

  assert.match(openapi, /At least one of project_id or app_type_id is required\./g);
  assert.match(openapi, /RunIdPathParam:/);
  assert.match(openapi, /TestEngineRunStatus:/);
  assert.match(openapi, /TestEnvironment:/);
});
