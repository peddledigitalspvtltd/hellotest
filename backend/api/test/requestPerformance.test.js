const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");
const db = require("../src/db");
const results = require("../src/services/executionResult.service");
const capacityGuard = require("../src/plugins/capacityGuard");
const observability = require("../src/plugins/observability");

function hookFixture() {
  const hooks = new Map();
  const messages = [];
  const log = Object.fromEntries(["info", "warn", "error"].map(level => [level, fields => messages.push({ level, fields })]));
  const app = {
    decorateRequest() {}, decorate(name, value) { this[name] = value; },
    addHook(name, fn) { hooks.set(name, fn); }, get() {}, log
  };
  const request = { routeOptions: { url: "/items" }, method: "GET", headers: {}, id: "request", log };
  const reply = { raw: new EventEmitter(), statusCode: 200, header() { return this; } };
  return { app, hooks, request, reply, messages };
}

test("a disconnected response releases capacity once, even before the request hook completes", async () => {
  const { app, hooks, request, reply } = hookFixture();
  await capacityGuard(app, { httpConfig: { bodyLimitBytes: 1024, maxInflightRequests: 1, maxInflightLargeRequests: 1 } });
  await hooks.get("onRequest")(request, reply);
  assert.equal(app.capacityGuard.snapshot().active, 1);
  reply.raw.emit("close");
  assert.equal(app.capacityGuard.snapshot().active, 0);
  await hooks.get("onResponse")(request, reply);
  await hooks.get("onTimeout")(request, reply);
  assert.equal(app.capacityGuard.snapshot().active, 0);
});

test("normal response close events are not reported as timeouts or aborted requests", async () => {
  for (const finished of [true, false]) {
    const { app, hooks, request, reply, messages } = hookFixture();
    await observability(app);
    await hooks.get("onRequest")(request, reply);
    reply.raw.writableFinished = finished;
    reply.raw.emit("close");
    reply.raw.emit("close");
    await hooks.get("onResponse")(request, reply);
    assert.equal(messages.filter(item => item.fields.event === "http_request_aborted").length, finished ? 0 : 1);
  }
});

test("history summaries keep scope, ordering and timer/attempt identity without loading evidence blobs", async t => {
  let query;
  let parameters;
  const row = { id: "result", execution_id: "run", test_case_id: "case", data_set_iteration_index: 2,
    status: "paused", duration_ms: "4200", revision: 3, defects: ["bug"], created_at: "2026-09-16T00:00:00Z" };
  t.mock.method(db, "prepare", sql => ({ all: async (...args) => { query = sql; parameters = args; return [row]; } }));
  const summary = await results.getExecutionResults({ project_id: "project", app_type_id: "app", limit: 50, projection: "summary" });
  assert.doesNotMatch(query, /execution_results\.\*|\.logs\b|\.data_set_row_snapshot\b|\.lifecycle_history\b/);
  assert.match(query, /executions\.project_id = \?/);
  assert.match(query, /execution_results\.app_type_id = \?/);
  assert.match(query, /ORDER BY execution_results\.created_at DESC, execution_results\.id DESC/);
  assert.deepEqual(parameters, ["project", "app", 50]);
  assert.equal(summary[0].data_set_iteration_index, 2);
  assert.equal(summary[0].elapsed_duration_ms, 4200);
  assert.deepEqual(summary[0].defects, ["bug"]);
  assert.equal(summary[0].detail_complete, false);
  assert.equal(summary[0].logs, null);
  await results.getExecutionResults({ execution_id: "run", limit: 50 });
  assert.match(query, /execution_results\.\*/);
  assert.deepEqual(parameters, ["run", 50]);
});
