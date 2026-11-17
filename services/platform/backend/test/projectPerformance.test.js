const assert = require("node:assert/strict");
const test = require("node:test");
const Fastify = require("fastify");
const db = require("../src/db");
const projects = require("../services/project.service");
const settings = require("../services/settings.service");
const analytics = require("../../../dashboard/backend/services/portfolioAnalytics.service");

test("summary project lists skip metric scans and retain membership and catalog redaction", async t => {
  const queries = [];
  t.mock.method(db, "prepare", sql => ({ all: async (...params) => {
    queries.push({ sql, params });
    return [{ id: "project", has_access: true }];
  } }));
  await projects.getProjects("actor", { projection: "summary" });
  await projects.getProjectCatalog("actor", { projection: "summary" });
  for (const { sql, params } of queries) {
    assert.doesNotMatch(sql, /COUNT\(|FROM requirements|FROM feedback|FROM test_cases|FROM test_case_modules/);
    assert.match(sql, /project_members pm WHERE pm\.project_id = p\.id AND pm\.user_id = \?/);
    assert.ok(params.every(value => value === "actor"));
  }
  assert.match(queries[1].sql, /CASE WHEN catalog\.has_access THEN LEFT\(catalog\.description, 1024\) ELSE NULL END/);
  assert.match(queries[1].sql, /CASE WHEN catalog\.has_access THEN catalog\.created_by ELSE NULL END/);
});

test("project summary routes always bind the authenticated user", async t => {
  const calls = [];
  t.mock.method(projects, "getProjects", async (...args) => { calls.push(args); return []; });
  t.mock.method(projects, "getProjectCatalog", async (...args) => { calls.push(args); return []; });
  const app = Fastify();
  app.decorate("authenticate", async req => { req.user = { id: "authenticated-user" }; });
  await app.register(require("../routes/projects.routes"));
  t.after(() => app.close());
  for (const url of ["/projects", "/projects/catalog"]) {
    const response = await app.inject(`${url}?projection=summary&user_id=foreign-user`);
    assert.equal(response.statusCode, 200, response.body);
  }
  assert.deepEqual(calls, [
    ["authenticated-user", { projection: "summary" }],
    ["authenticated-user", { projection: "summary" }]
  ]);
});

test("project creation rejects a missing application scope before calling the service", async t => {
  let createCalls = 0;
  t.mock.method(projects, "createProject", async input => {
    createCalls++;
    return { id: "created-project", ...input };
  });
  const app = Fastify();
  app.decorate("authenticate", async req => { req.user = { id: "authenticated-user" }; });
  app.decorate("validate", require("../src/plugins/validator").validateInput);
  await app.register(require("../routes/projects.routes"));
  t.after(() => app.close());

  const missing = await app.inject({ method: "POST", url: "/projects", payload: { name: "Missing app", visibility: "private" } });
  assert.equal(missing.statusCode, 400, missing.body);
  assert.match(missing.json().message, /app_types.*required/i);
  assert.equal(createCalls, 0);

  const empty = await app.inject({ method: "POST", url: "/projects", payload: { name: "Empty apps", visibility: "private", app_types: [] } });
  assert.equal(empty.statusCode, 400, empty.body);
  assert.match(empty.json().message, /app_types.*at least 1/i);
  assert.equal(createCalls, 0);
});

test("portfolio analytics leaves database capacity available and excludes locked projects", async t => {
  let active = 0;
  let maximum = 0;
  const parameters = [];
  t.mock.method(projects, "getProjectCatalog", async (actor, options) => {
    assert.equal(actor, "actor");
    assert.equal(options.projection, "summary");
    return [{ id: "accessible", name: "Accessible", has_access: true }, { id: "locked", name: "Locked", has_access: false }];
  });
  t.mock.method(settings, "getWorkspacePreferences", async () => ({}));
  t.mock.method(db, "prepare", () => ({ all: async (...args) => {
    parameters.push(args);
    maximum = Math.max(maximum, ++active);
    await new Promise(resolve => setImmediate(resolve));
    active--;
    return [];
  } }));
  const result = await analytics.buildPortfolioAnalytics("actor");
  assert.equal(maximum, 3, "a report cannot consume the API's entire database pool");
  assert.ok(parameters.every(args => args.includes("accessible") && !args.includes("locked")));
  assert.equal(result.summary.total_projects, 2);
  assert.equal(result.summary.accessible_projects, 1);
  assert.equal(result.summary.locked_projects, 1);
  assert.deepEqual(result.projects.map(project => project.project_id), ["accessible"]);
});

test("a locked-only catalog does not query any project evidence", async t => {
  t.mock.method(projects, "getProjectCatalog", async () => [{ id: "locked", has_access: false }]);
  t.mock.method(settings, "getWorkspacePreferences", async () => ({}));
  t.mock.method(db, "prepare", () => assert.fail("No evidence queries for inaccessible projects"));
  const result = await analytics.buildPortfolioAnalytics("actor");
  assert.equal(result.summary.locked_projects, 1);
  assert.deepEqual(result.projects, []);
});
