const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

const readSource = (relativePath) => readFile(path.join(__dirname, relativePath), "utf8");

test("workspace user routes expose authenticated CRUD with plain-password setup", async () => {
  const [routes, service] = await Promise.all([
    readSource("../src/routes/users.js"),
    readSource("../src/services/user.service.js")
  ]);

  assert.match(routes, /fastify\.post\("\/users", \{ preHandler: \[fastify\.authenticate\] \}/);
  assert.match(routes, /password: \{ required: true, type: "string", minLength: 6, maxLength: 128 \}/);
  assert.match(routes, /fastify\.delete\("\/users\/:id", \{ preHandler: \[fastify\.authenticate\] \}/);
  assert.match(service, /password \? hashPassword\(password\) : password_hash/);
  assert.match(service, /default_role_id/);
});

test("Sprint persistence and API support complete CRUD with an empty Story selection", async () => {
  const [routes, service, schema, bootstrap] = await Promise.all([
    readSource("../src/routes/requirementIterations.routes.js"),
    readSource("../src/services/requirementIteration.service.js"),
    readSource("../../db/schema.sql"),
    readSource("../src/db/bootstrap.js")
  ]);

  for (const route of [
    'fastify.get("/requirement-iterations"',
    'fastify.post("/requirement-iterations"',
    'fastify.get("/requirement-iterations/:id"',
    'fastify.put("/requirement-iterations/:id"',
    'fastify.delete("/requirement-iterations/:id"'
  ]) assert.match(routes, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  assert.match(service, /requirement_ids = \[\]/);
  assert.match(service, /assignment: requirementIds\.length \? \{/);
  assert.match(service, /: null/);
  assert.match(service, /sprint,\s*assignment:/);
  assert.match(schema, /start_date TIMESTAMPTZ/);
  assert.match(schema, /external_references JSONB NOT NULL DEFAULT '\[\]'::jsonb/);
  assert.match(bootstrap, /data_type = 'date'/);
});

test("Bug creation requires a project so saved Bugs remain visible in project lists", async () => {
  const [routes, service, schema, bootstrap, seed] = await Promise.all([
    readSource("../src/routes/issues.routes.js"),
    readSource("../src/services/issues.service.js"),
    readSource("../../db/schema.sql"),
    readSource("../src/db/bootstrap.js"),
    readSource("../../db/seed.sql")
  ]);

  assert.match(routes, /project_id: \{ required: true, type: "string" \}/);
  assert.match(service, /if \(!project_id \|\| !user_id \|\| !title \|\| !message\)/);
  assert.match(service, /const project = await db\.prepare\("SELECT id FROM projects WHERE id = \?"\)\.get\(project_id\)/);
  assert.match(service, /displayIdService\.createDisplayId\("issue"\)/);
  assert.match(service, /feedback\.display_id/);
  assert.doesNotMatch(service, /project_id \|\| null/);
  assert.match(schema, /CREATE TABLE feedback \([\s\S]*?display_id TEXT UNIQUE,[\s\S]*?project_id TEXT NOT NULL,/);
  assert.match(bootstrap, /SET display_id = 'BUG-' \|\| \(existing\.max_sequence \+ missing\.sequence\)/);
  assert.match(bootstrap, /UPDATE feedback[\s\S]*?WHERE feedback\.project_id IS NULL[\s\S]*?COUNT\(DISTINCT project_members\.project_id\)[\s\S]*?= 1/);
  assert.match(seed, /INSERT INTO feedback \(id, project_id, user_id, title, message, status\)/);
});
