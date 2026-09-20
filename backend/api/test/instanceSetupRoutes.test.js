const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

async function loadRoutes() {
  const calls = [];
  const response = { running: true, job: { id: "setup-receipt", status: "queued" } };
  const service = Object.fromEntries(["start", "retry", "getStatus"].map(method => [method, async input => {
    calls.push({ method, input });
    return response;
  }]));
  const script = fs.readFileSync(path.join(__dirname, "../src/routes/adminPortal.routes.js"), "utf8");
  const sandbox = { module: { exports: {} }, require: name => {
    if (name === "../services/instanceSetup.service") return service;
    if (name === "../domain/catalog") return { INTEGRATION_TYPE_OPTIONS: [] };
    return {};
  } };
  vm.runInNewContext(script, sandbox);
  const registered = [];
  const validations = [];
  const requireAdmin = () => {};
  const fastify = { addHook() {}, requireAdmin, validate: (schema, body) => { validations.push({ schema, body }); } };
  for (const method of ["get", "post", "put", "delete"]) fastify[method] = (route, options, handler) => {
    registered.push({ method, route, options, handler: handler || options });
  };
  await sandbox.module.exports(fastify);
  const resolve = (method, route) => registered.find(entry => entry.method === method && entry.route === route);
  const reply = () => ({ status: 200, headers: {}, code(value) { this.status = value; return this; }, header(key, value) { this.headers[key] = value; return this; } });
  return { calls, response, registered, validations, requireAdmin, resolve, reply };
}

test("instance setup admission, progress and retry remain administrator-only", async () => {
  const { registered, requireAdmin } = await loadRoutes();
  const setup = registered.filter(entry => entry.route.startsWith("/admin-portal/setup/sample-data"));
  assert.equal(setup.length, 4);
  for (const route of setup) assert.equal(route.options.preHandler[0], requireAdmin, route.route);
});

test("setup POST returns an accepted durable receipt and validates requested modules", async () => {
  const fixture = await loadRoutes();
  const reply = fixture.reply();
  const body = { modules: ["stories"] };
  const result = await fixture.resolve("post", "/admin-portal/setup/sample-data").handler({
    body, user: { id: "administrator" }, headers: { "x-forwarded-for": "10.0.0.1, 10.0.0.2" }, ip: "127.0.0.1"
  }, reply);
  assert.equal(result, fixture.response);
  assert.equal(reply.status, 202);
  assert.equal(reply.headers["Cache-Control"], "no-store");
  assert.equal(fixture.validations[0].schema.modules.maxItems, 64);
  assert.equal(fixture.validations[0].body, body);
  assert.deepEqual(JSON.parse(JSON.stringify(fixture.calls)), [{ method: "start", input: { modules: ["stories"], actorId: "administrator", ipAddress: "10.0.0.1" } }]);
});

test("setup status is uncached and forwards the requested receipt ID", async () => {
  const fixture = await loadRoutes();
  const reply = fixture.reply();
  await fixture.resolve("get", "/admin-portal/setup/sample-data/status").handler({ query: { job_id: "setup-receipt" } }, reply);
  assert.equal(reply.headers["Cache-Control"], "no-store");
  assert.equal(fixture.calls[0].method, "getStatus");
  assert.equal(fixture.calls[0].input.jobId, "setup-receipt");
});

test("retry accepts no replacement dataset or caller identity", async () => {
  const fixture = await loadRoutes();
  const route = fixture.resolve("post", "/admin-portal/setup/sample-data/:jobId/retry");
  const request = { params: { jobId: "setup-receipt" }, user: { id: "administrator" }, headers: {}, ip: "127.0.0.1" };
  for (const body of [[], "invalid", { modules: ["test_cases"] }, { actorId: "someone-else" }]) {
    await assert.rejects(route.handler({ ...request, body }, fixture.reply()), { statusCode: 400 });
  }
  assert.equal(fixture.calls.length, 0);
  const reply = fixture.reply();
  await route.handler({ ...request, body: {} }, reply);
  assert.equal(reply.status, 202);
  assert.equal(reply.headers["Cache-Control"], "no-store");
  assert.equal(fixture.calls[0].input.actorId, "administrator");
  assert.equal(fixture.calls[0].input.jobId, "setup-receipt");
});
