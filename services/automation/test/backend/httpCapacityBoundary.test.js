const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const test = require("node:test");
const Fastify = require("fastify");

const capacityGuard = require("../../../platform/backend/src/plugins/capacityGuard");
const { httpConfig } = require("../../../platform/backend/src/runtime/httpConfig");
const testEngineCallbacksRoutes = require("../../backend/routes/testEngineCallbacks.routes");

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

test("HTTP defaults bound ordinary JSON while retaining an explicit large-payload lane", () => {
  assert.equal(httpConfig.bodyLimitBytes, 4 * 1024 * 1024);
  assert.equal(httpConfig.largeBodyLimitBytes, 48 * 1024 * 1024);
  assert.ok(httpConfig.maxInflightLargeRequests < httpConfig.maxInflightRequests);
  assert.ok(httpConfig.maxRequestsPerSocket > 0);
});

test("invalid HTTP capacity configuration fails during startup", () => {
  const cwd = path.join(__dirname, "../../../platform/backend");
  const result = spawnSync(process.execPath, ["-e", "require('./src/runtime/httpConfig')"], {
    cwd,
    env: { ...process.env, HTTP_MAX_INFLIGHT_REQUESTS: "unbounded" },
    encoding: "utf8"
  });

  assert.notEqual(result.status, 0);
  assert.match(`${result.stderr}${result.stdout}`, /HTTP_MAX_INFLIGHT_REQUESTS/);
});

test("capacity guard sheds excess work but leaves health probes available", async (t) => {
  const app = Fastify({ logger: false });
  t.after(() => app.close());
  await app.register(capacityGuard, {
    httpConfig: {
      ...httpConfig,
      bodyLimitBytes: 1_024,
      maxInflightRequests: 1,
      maxInflightLargeRequests: 1
    }
  });

  const started = deferred();
  const release = deferred();
  app.get("/slow", async () => {
    started.resolve();
    await release.promise;
    return { ok: true };
  });
  app.get("/health", async () => ({ ok: true }));
  await app.ready();

  const first = app.inject({ method: "GET", url: "/slow" });
  await started.promise;

  const overloaded = await app.inject({ method: "GET", url: "/slow" });
  assert.equal(overloaded.statusCode, 503);
  assert.equal(overloaded.headers["retry-after"], "1");
  assert.equal(overloaded.json().code, "API_CAPACITY_EXCEEDED");

  const health = await app.inject({ method: "GET", url: "/health" });
  assert.equal(health.statusCode, 200);

  release.resolve();
  assert.equal((await first).statusCode, 200);
  assert.equal(app.capacityGuard.snapshot().active, 0);
  assert.equal(app.capacityGuard.snapshot().rejected, 1);
});

test("large-payload work has an independent concurrency bulkhead", async (t) => {
  const app = Fastify({ logger: false, bodyLimit: 8_192 });
  t.after(() => app.close());
  await app.register(capacityGuard, {
    httpConfig: {
      ...httpConfig,
      bodyLimitBytes: 1_024,
      maxInflightRequests: 3,
      maxInflightLargeRequests: 1
    }
  });

  const started = deferred();
  const release = deferred();
  app.post("/large", { bodyLimit: 8_192 }, async () => {
    started.resolve();
    await release.promise;
    return { ok: true };
  });
  await app.ready();

  const first = app.inject({ method: "POST", url: "/large", payload: { value: "first" } });
  await started.promise;
  const overloaded = await app.inject({ method: "POST", url: "/large", payload: { value: "second" } });
  assert.equal(overloaded.statusCode, 503);

  release.resolve();
  assert.equal((await first).statusCode, 200);
  assert.equal(app.capacityGuard.snapshot().activeLarge, 0);
  assert.equal(app.capacityGuard.snapshot().rejectedLarge, 1);
});

test("raw Test Engine callback capture enforces its bound before buffering the body", async () => {
  const oversizedLength = httpConfig.largeBodyLimitBytes + 1;
  await assert.rejects(
    () => testEngineCallbacksRoutes.captureRawCallbackBody({
      headers: { "content-length": String(oversizedLength) }
    }, null, []),
    (error) => error.statusCode === 413 && error.code === "FST_ERR_CTP_BODY_TOO_LARGE"
  );
});
