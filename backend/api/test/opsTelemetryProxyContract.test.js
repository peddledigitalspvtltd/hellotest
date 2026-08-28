const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

const readSource = (relativePath) => fs.readFile(path.join(__dirname, relativePath), "utf8");

test("OPS telemetry browser reads stay project-scoped and provider credentials remain server-side", async () => {
  const [routes, service, permissions, frontend] = await Promise.all([
    readSource("../src/routes/opsTelemetry.routes.js"),
    readSource("../src/services/opsTelemetry.service.js"),
    readSource("../src/security/permissions.catalog.js"),
    readSource("../../../frontend/src/pages/TestOpsPage.tsx")
  ]);

  assert.match(routes, /fastify\.get\("\/ops-telemetry\/snapshot"/);
  assert.match(routes, /project_id is required/);
  assert.match(routes, /getProject\(project_id, req\.user\.id\)/);
  assert.match(permissions, /\["GET", "\/ops-telemetry\/snapshot", "ops\.view"\]/);
  assert.match(service, /buildOpsHeaders\(integration\)/);
  assert.match(service, /OPS_READ_MAX_BYTES/);
  assert.match(service, /OPS_READ_MAX_EVENTS/);
  assert.doesNotMatch(frontend, /src=\{opsBoardUrl\}/);
  assert.match(frontend, /api\.opsTelemetry\.snapshot/);
  assert.match(frontend, /Redacted payload/);
});

test("OpenAPI documents the server-authenticated OPS snapshot", async () => {
  const openapi = await readSource("../../../openapi.yaml");
  assert.match(openapi, /\/ops-telemetry\/snapshot:/);
  assert.match(openapi, /OpsTelemetrySnapshot/);
  assert.match(openapi, /browser clients never receive provider secrets/);
});
