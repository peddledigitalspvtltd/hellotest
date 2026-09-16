const assert = require("node:assert/strict");
const test = require("node:test");
const Fastify = require("fastify");
const db = require("../src/db");
const flags = require("../src/services/featureFlag.service");
const permissionService = require("../src/services/permission.service");
const { ROUTE_PERMISSIONS } = require("../src/security/permissions.catalog");

async function fixture(t, { admin = false, workspaceAllowed = true } = {}) {
  const queries = [];
  const checks = [];
  const own = { id: "member-project", display_id: "PRJ_1", name: "Assigned project" };
  const other = { id: "other-project", display_id: "PRJ_2", name: "Another project" };
  t.mock.method(db, "prepare", sql => ({ all: async (...args) => {
    queries.push({ sql, args });
    assert.match(sql, /SELECT projects\.id, projects\.display_id, projects\.name\s+FROM projects/);
    assert.doesNotMatch(sql, /SELECT\s+(?:projects\.)?\*|COUNT\(|requirements|feedback|test_cases|description|visibility|created_by/);
    assert.match(sql, /WHERE \? = TRUE OR EXISTS\s*\([\s\S]*project_members\.project_id = projects\.id[\s\S]*project_members\.user_id = \?/);
    assert.equal(args[1], "authenticated-user");
    return args[0] ? [own, other] : [own];
  } }));
  t.mock.method(permissionService, "hasPermission", async (user, permission) => {
    checks.push(permission);
    return permission === "workspace.view" ? workspaceAllowed : permission === "project.view";
  });
  // Project management is explicitly disabled; the workspace shell still has
  // its minimal membership-scoped names, never management data or metrics.
  t.mock.method(flags, "areEnabled", async keys => !keys.includes("hellotest.ops.projects"));
  const app = Fastify({ logger: false });
  t.after(() => app.close());
  await app.register(require("../src/plugins/errorHandler"));
  await app.register(require("../src/plugins/accessControl"));
  app.addHook("onRequest", async req => {
    if (req.headers.authorization === "Bearer fixture") req.user = { id: "authenticated-user", role: admin ? "admin" : "member", status: "active" };
  });
  await app.register(require("../src/routes/domainMetadata.routes"));
  app.get("/projects", async () => assert.fail("Disabled management endpoint must not execute"));
  await app.ready();
  return { app, queries, checks, own, other };
}

test("workspace scopes return only the signed-in member's identifiers and names with Projects disabled", async t => {
  const { app, queries, checks, own } = await fixture(t);
  const response = await app.inject({ method: "GET", url: "/metadata/workspace-scopes?user_id=another&role=admin", headers: { authorization: "Bearer fixture" } });
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json(), { projects: [own] });
  assert.deepEqual(queries[0].args, [false, "authenticated-user"]);
  assert.deepEqual(checks, ["workspace.view"]);
  const disabled = await app.inject({ method: "GET", url: "/projects", headers: { authorization: "Bearer fixture" } });
  assert.equal(disabled.statusCode, 403);
  assert.equal(disabled.json().code, "FEATURE_DISABLED");
});

test("verified workspace administrators may select all project scopes", async t => {
  const { app, queries, own, other } = await fixture(t, { admin: true });
  const response = await app.inject({ method: "GET", url: "/metadata/workspace-scopes", headers: { authorization: "Bearer fixture" } });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { projects: [own, other] });
  assert.deepEqual(queries[0].args, [true, "authenticated-user"]);
});

test("anonymous and workspace-denied callers cannot query project scope metadata", async t => {
  const { app, queries } = await fixture(t, { workspaceAllowed: false });
  const anonymous = await app.inject({ method: "GET", url: "/metadata/workspace-scopes" });
  assert.equal(anonymous.statusCode, 401);
  const denied = await app.inject({ method: "GET", url: "/metadata/workspace-scopes", headers: { authorization: "Bearer fixture" } });
  assert.equal(denied.statusCode, 403);
  assert.equal(queries.length, 0);
  assert.equal(ROUTE_PERMISSIONS.get("GET /metadata/workspace-scopes"), "workspace.view");
  assert.equal(ROUTE_PERMISSIONS.get("GET /projects"), "project.view");
});
