const assert = require("node:assert/strict");
const test = require("node:test");
const Fastify = require("fastify");
const admin = require("../src/services/adminPortal.service");

test("performance indexing requires administrator access and rejects arbitrary input", async t => {
  const calls = [];
  t.mock.method(admin, "startPerformanceIndexing", async actor => { calls.push(actor); return { running: true, job: { id: "job" }, catalog: [] }; });
  t.mock.method(admin, "getPerformanceIndexing", async () => ({ running: false, job: null, catalog: [] }));
  const app = Fastify(); t.after(() => app.close());
  app.decorate("requireAdmin", async req => {
    if (req.headers.authorization !== "Bearer admin") throw Object.assign(new Error("Admin access required"), { statusCode: 403 });
    req.user = { id: "admin" };
  });
  await app.register(require("../src/routes/adminPortal.routes"));
  const url = "/admin-portal/setup/performance-indexing";
  for (const method of ["GET", "POST"]) {
    assert.equal((await app.inject({ method, url })).statusCode, 403);
  }
  for (const payload of [{ sql: "DROP TABLE users" }, { indexes: ["custom"] }, []]) {
    assert.equal((await app.inject({ method: "POST", url, headers: { authorization: "Bearer admin" }, payload })).statusCode, 400);
  }
  assert.equal(calls.length, 0);
  const started = await app.inject({ method: "POST", url, headers: { authorization: "Bearer admin" } });
  assert.equal(started.statusCode, 202);
  assert.equal(started.headers["cache-control"], "no-store");
  assert.equal(calls[0].actorId, "admin");
  const status = await app.inject({ method: "GET", url, headers: { authorization: "Bearer admin" } });
  assert.equal(status.statusCode, 200);
  assert.equal(status.headers["cache-control"], "no-store");
});
