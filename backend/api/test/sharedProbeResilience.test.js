const assert = require("node:assert/strict");
const test = require("node:test");
const Fastify = require("fastify");
const obsDb = require("../src/obsDb");
const observability = require("../src/plugins/observability");
const { createRuntimeHealthService } = require("../src/services/runtimeHealth.service");
const errorHandler = require("../src/plugins/errorHandler");

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test("overlapping Prometheus scrapes share one database query and completed values are not cached", async t => {
  const gate = deferred();
  let queries = 0;
  t.mock.method(obsDb.pool, "query", async () => { queries += 1; await gate.promise; return { rows: [{ total: queries }] }; });
  const app = Fastify({ logger: false });
  t.after(() => app.close());
  await app.register(observability);
  await app.ready();
  const pending = Array.from({ length: 40 }, () => app.inject("/metrics"));
  await new Promise(setImmediate);
  assert.equal(queries, 1);
  gate.resolve();
  const responses = await Promise.all(pending);
  assert.ok(responses.every(response => response.statusCode === 200 && response.body.includes("hellotest_runs_total 1\n")));
  const next = await app.inject("/metrics");
  assert.equal(queries, 2);
  assert.match(next.body, /hellotest_runs_total 2\n/);
});

test("concurrent required and full health requests share database probes without hiding a later outage", async () => {
  const gate = deferred();
  let mainReads = 0;
  let executionReads = 0;
  let fail = false;
  const service = createRuntimeHealthService({
    config: { storageProvider: "disabled", postgres: {}, obsPostgres: {}, objectStorage: {}, knowledge: {}, enableObservability: false },
    db: { query: async () => { mainReads += 1; await gate.promise; if (fail) throw new Error("database down"); return { rows: [{}] }; } },
    obsDb: { query: async () => { executionReads += 1; await gate.promise; return { rows: [{}] }; } },
    cache: { ensureRedis: async () => false },
    objectStorage: { isEnabled: () => false },
    probeTimeoutMs: 2_000
  });
  const pending = Array.from({ length: 50 }, (_, index) => service.runChecks({ includeOptional: index % 2 === 0 }));
  await new Promise(setImmediate);
  assert.equal(mainReads, 1);
  assert.equal(executionReads, 1);
  gate.resolve();
  const snapshots = await Promise.all(pending);
  assert.ok(snapshots.every(snapshot => snapshot.checks.find(check => check.key === "database").status === "ready"));
  assert.equal(snapshots[0].checks.length, 6);
  assert.equal(snapshots[1].checks.length, 2);
  fail = true;
  assert.equal((await service.runChecks({ includeOptional: false })).status, "blocked");
  assert.equal(mainReads, 2);
});

test("database statement and pool timeouts return controlled retry contracts without private details", async t => {
  const app = Fastify({ logger: false });
  t.after(() => app.close());
  await app.register(errorHandler);
  app.get("/statement", async () => { throw Object.assign(new Error("canceling secret query due to statement timeout"), { code: "57014" }); });
  app.get("/pool", async () => { throw new Error("timeout exceeded when trying to connect"); });
  for (const [url, code] of [["/statement", "DATABASE_TIMEOUT"], ["/pool", "DATABASE_UNAVAILABLE"]]) {
    const response = await app.inject(url);
    assert.equal(response.statusCode, 503);
    assert.equal(response.json().code, code);
    assert.equal(response.json().retryable, true);
    assert.equal(response.headers["retry-after"], "1");
    assert.doesNotMatch(response.body, /secret query|timeout exceeded when trying/);
  }
});
