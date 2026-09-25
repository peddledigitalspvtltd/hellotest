const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

const readSource = (relativePath) => readFile(path.join(__dirname, relativePath), "utf8");

test("Object Repository creation derives and validates project ownership from app type scope", async () => {
  const routes = await readSource("../../backend/routes/testCases.routes.js");
  const createRoute = routes.slice(
    routes.indexOf('fastify.post("/test-cases/automation/learning-cache"'),
    routes.indexOf('fastify.delete("/test-cases/automation/learning-cache/:id"')
  );

  assert.match(createRoute, /let resolvedProjectId = req\.body\?\.project_id \|\| null/);
  assert.match(createRoute, /resolvedProjectId !== appType\.project_id/);
  assert.match(createRoute, /resolvedProjectId = appType\.project_id/);
  assert.match(createRoute, /project_id: resolvedProjectId \|\| undefined/);
});
