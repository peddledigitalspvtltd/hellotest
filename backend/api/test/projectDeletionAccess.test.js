const assert = require("node:assert/strict");
const test = require("node:test");
const Fastify = require("fastify");
const db = require("../src/db");
const permissions = require("../src/services/permission.service");
const flags = require("../src/services/featureFlag.service");

async function fixture(t, { active = true, allowed = true, enabled = true, admin = false } = {}) {
  const lookups = [];
  const grants = [];
  t.mock.method(db, "prepare", sql => ({ get: async projectId => {
    assert.match(sql, /SELECT EXISTS[\s\S]*FROM project_deletion_jobs[\s\S]*status IN \('queued', 'running', 'cleanup'\)/);
    lookups.push(projectId);
    return { active };
  } }));
  t.mock.method(permissions, "hasPermission", async (user, code, projectId) => {
    grants.push({ user, code, projectId });
    return allowed;
  });
  t.mock.method(flags, "areEnabled", async () => enabled);
  const app = Fastify({ logger: false });
  t.after(() => app.close());
  await app.register(require("../src/plugins/errorHandler"));
  await app.register(require("../src/plugins/accessControl"));
  app.addHook("onRequest", async req => {
    req.user = { id: "actor", role: admin ? "admin" : "member" };
  });
  let reached = 0;
  app.post("/test-cases", async () => { reached++; return { saved: true }; });
  app.get("/test-cases", async () => { reached++; return []; });
  app.put("/projects/:id", async req => {
    await app.requirePermission("project.update", { projectId: req.params.id })(req);
    reached++;
    return { saved: true };
  });
  app.delete("/projects/:id", async req => {
    await app.requirePermission("project.delete", { projectId: req.params.id })(req);
    reached++;
    return { accepted: true };
  });
  await app.ready();
  return { app, lookups, grants, reached: () => reached };
}

test("a deleting project rejects member and administrator mutations after permission checks", async t => {
  for (const admin of [false, true]) await t.test(admin ? "administrator" : "member", async context => {
    const { app, lookups, grants, reached } = await fixture(context, { admin });
    const response = await app.inject({ method: "POST", url: "/test-cases", payload: { project_id: "deleting" } });
    assert.equal(response.statusCode, 409, response.body);
    assert.equal(response.json().code, "PROJECT_DELETING");
    assert.deepEqual(lookups, ["deleting"]);
    assert.equal(grants[0].projectId, "deleting");
    assert.equal(reached(), 0);
  });
});

test("deletion admission checks retain permission and feature denials before revealing state", async t => {
  for (const options of [{ allowed: false }, { enabled: false }]) await t.test(JSON.stringify(options), async context => {
    const { app, lookups, reached } = await fixture(context, options);
    const response = await app.inject({ method: "POST", url: "/test-cases", payload: { project_id: "deleting" } });
    assert.equal(response.statusCode, 403);
    assert.deepEqual(lookups, []);
    assert.equal(reached(), 0);
  });
});

test("read-only access avoids deletion queries and explicit deletion retries remain authorized", async t => {
  const { app, lookups, grants, reached } = await fixture(t);
  for (const method of ["GET", "HEAD"]) {
    assert.equal((await app.inject({ method, url: "/test-cases?project_id=deleting" })).statusCode, 200);
  }
  const deleted = await app.inject({ method: "DELETE", url: "/projects/deleting" });
  assert.equal(deleted.statusCode, 200, deleted.body);
  assert.deepEqual(lookups, []);
  assert.equal(grants.filter(row => row.code === "project.delete").length, 1, "Only the explicit scoped guard runs");
  assert.equal(grants.at(-1).projectId, "deleting");
  assert.equal(reached(), 3);
});

test("ordinary project mutation is guarded while projects without active deletion remain writable", async t => {
  for (const active of [true, false]) await t.test(String(active), async context => {
    const { app, lookups, reached } = await fixture(context, { active });
    const response = await app.inject({ method: "PUT", url: "/projects/project", payload: { name: "Edited" } });
    assert.equal(response.statusCode, active ? 409 : 200, response.body);
    assert.deepEqual(lookups, ["project"]);
    assert.equal(reached(), active ? 0 : 1);
  });
});

async function routesFixture(t, { projectExists = true, allowed = true, statusMissing = false } = {}) {
  const deletion = require("../src/services/projectDeletion.service");
  const project = require("../src/services/project.service");
  const grants = [], requests = [];
  const job = { id: "job", project_id: "project", project_name: "Project", status: projectExists ? "queued" : "completed" };
  t.mock.method(project, "deleteProject", () => assert.fail("The request must never execute synchronous project deletion"));
  t.mock.method(permissions, "hasPermission", async (user, code, projectId) => { grants.push({ code, projectId }); return allowed; });
  t.mock.method(flags, "areEnabled", async () => true);
  t.mock.method(db, "prepare", () => assert.fail("Deletion routes must not require live aggregate memberships before durable authorization"));
  t.mock.method(deletion, "enqueue", async (projectId, user, { authorize }) => {
    requests.push({ operation: "enqueue", projectId, user });
    if (projectExists) await authorize();
    return { accepted: true, job };
  });
  t.mock.method(deletion, "getStatus", async (projectId, user) => {
    requests.push({ operation: "status", projectId, user });
    if (statusMissing) throw Object.assign(new Error("Project deletion was not found"), { statusCode: 404 });
    return job;
  });
  const app = Fastify({ logger: false });
  t.after(() => app.close());
  await app.register(require("../src/plugins/errorHandler"));
  await app.register(require("../src/plugins/accessControl"));
  app.addHook("onRequest", async req => {
    if (req.headers.authorization === "Bearer fixture") req.user = { id: "requester", role: "member" };
    if (req.headers["x-fixture-api-key"]) req.apiKey = { scope: req.headers["x-fixture-api-key"] };
  });
  await app.register(require("../src/routes/projects.routes"));
  await app.ready();
  return { app, job, requests, grants };
}

test("DELETE accepts durable work with 202, polling location and exactly one live scoped permission check", async t => {
  const { app, job, requests, grants } = await routesFixture(t);
  const response = await app.inject({ method: "DELETE", url: "/projects/project", headers: { authorization: "Bearer fixture" } });
  assert.equal(response.statusCode, 202, response.body);
  assert.deepEqual(response.json(), { accepted: true, job });
  assert.equal(response.headers.location, "/projects/project/deletion");
  assert.equal(response.headers["cache-control"], "no-store");
  assert.deepEqual(grants, [{ code: "project.delete", projectId: "project" }]);
  assert.deepEqual(requests, [{ operation: "enqueue", projectId: "project", user: { id: "requester", role: "member" } }]);
});

test("completed deletion can be polled and cleanup retried after the requester's final membership is gone", async t => {
  const { app, job, grants } = await routesFixture(t, { projectExists: false, allowed: false });
  for (const method of ["GET", "HEAD"]) {
    const response = await app.inject({ method, url: "/projects/project/deletion", headers: { authorization: "Bearer fixture" } });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.headers["cache-control"], "no-store");
    if (method === "GET") assert.deepEqual(response.json(), job);
  }
  const retried = await app.inject({ method: "DELETE", url: "/projects/project", headers: { authorization: "Bearer fixture" } });
  assert.equal(retried.statusCode, 202, retried.body);
  assert.deepEqual(grants, [], "The service owns durable requester authorization for a deleted project");
});

test("async deletion retains authentication, live grant, API-key and hidden-status denials", async t => {
  await t.test("authentication and API key", async context => {
    const { app, requests } = await routesFixture(context);
    for (const [method, url] of [["DELETE", "/projects/project"], ["GET", "/projects/project/deletion"]]) {
      assert.equal((await app.inject({ method, url })).statusCode, 401);
    }
    const response = await app.inject({ method: "DELETE", url: "/projects/project", headers: { authorization: "Bearer fixture", "x-fixture-api-key": "read" } });
    assert.equal(response.statusCode, 403);
    assert.deepEqual(requests, []);
  });
  await t.test("live grant", async context => {
    const { app } = await routesFixture(context, { allowed: false });
    const response = await app.inject({ method: "DELETE", url: "/projects/project", headers: { authorization: "Bearer fixture" } });
    assert.equal(response.statusCode, 403);
  });
  await t.test("private status", async context => {
    const { app } = await routesFixture(context, { statusMissing: true });
    const response = await app.inject({ method: "GET", url: "/projects/project/deletion", headers: { authorization: "Bearer fixture" } });
    assert.equal(response.statusCode, 404);
  });
});
