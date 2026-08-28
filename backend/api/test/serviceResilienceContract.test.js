const assert = require("node:assert/strict");
const test = require("node:test");
const Fastify = require("fastify");

const errorHandlerPlugin = require("../src/plugins/errorHandler");
const {
  getServiceResilienceSnapshot,
  resilientHttpRequest,
  resetServiceResilienceState
} = require("../src/utils/resilientHttpClient");
const { SERVICE_ERROR_CODES, serviceError } = require("../src/utils/serviceErrors");

test.beforeEach(() => resetServiceResilienceState());

test("the boundary client retries only replay-safe requests and bounds the logical operation", async () => {
  let getAttempts = 0;
  const getResponse = await resilientHttpRequest("https://user:secret@example.test/data?token=private", {}, {
    dependency: "sample-provider",
    operation: "data.read",
    maxAttempts: 3,
    baseDelayMs: 10,
    fetchImpl: async () => {
      getAttempts += 1;
      return getAttempts === 1
        ? new Response("busy", { status: 503 })
        : new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
    }
  });
  assert.equal(getAttempts, 2);
  assert.deepEqual(await getResponse.json(), { ok: true });

  let postAttempts = 0;
  const postResponse = await resilientHttpRequest("https://example.test/create", {
    method: "POST",
    body: JSON.stringify({ name: "one" })
  }, {
    dependency: "sample-writer",
    maxAttempts: 5,
    fetchImpl: async () => {
      postAttempts += 1;
      return new Response("busy", { status: 503 });
    }
  });
  assert.equal(postAttempts, 1, "non-idempotent POST must never be replayed implicitly");
  assert.equal(postResponse.status, 503);

  const snapshot = getServiceResilienceSnapshot();
  assert.equal(snapshot.boundaries.find((entry) => entry.dependency === "sample-provider").endpoint, "https://example.test");
  assert.doesNotMatch(JSON.stringify(snapshot), /secret|private/);
});

test("circuit breaking fails fast and a bulkhead rejects excess work", async () => {
  const networkFailure = async () => { throw new TypeError("fetch failed"); };
  const requestOptions = {
    dependency: "offline-provider",
    maxAttempts: 1,
    failureThreshold: 2,
    resetTimeoutMs: 60_000,
    fetchImpl: networkFailure
  };

  await assert.rejects(resilientHttpRequest("https://offline.test/a", {}, requestOptions), { code: SERVICE_ERROR_CODES.NETWORK });
  await assert.rejects(resilientHttpRequest("https://offline.test/a", {}, requestOptions), { code: SERVICE_ERROR_CODES.NETWORK });
  await assert.rejects(resilientHttpRequest("https://offline.test/a", {}, requestOptions), { code: SERVICE_ERROR_CODES.CIRCUIT_OPEN });
  assert.equal(getServiceResilienceSnapshot().boundaries[0].circuit, "open");

  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const first = resilientHttpRequest("https://slow.test/health", {}, {
    dependency: "slow-provider",
    maxConcurrent: 1,
    maxAttempts: 1,
    fetchImpl: async () => {
      await pending;
      return new Response("ok");
    }
  });
  await assert.rejects(
    resilientHttpRequest("https://slow.test/health", {}, {
      dependency: "slow-provider",
      maxConcurrent: 1,
      maxAttempts: 1,
      fetchImpl: async () => new Response("ok")
    }),
    { code: SERVICE_ERROR_CODES.OVERLOADED }
  );
  release();
  await first;
});

test("the global error boundary publishes stable codes and never leaks 5xx details", async () => {
  const app = Fastify({ logger: false });
  await app.register(errorHandlerPlugin);
  app.get("/internal", async () => {
    throw new Error("database password=super-secret exploded");
  });
  app.get("/dependency", async () => {
    throw serviceError(SERVICE_ERROR_CODES.CIRCUIT_OPEN, {
      dependency: "sample-provider",
      retryable: true,
      statusCode: 503,
      retryAfterSeconds: 7,
      message: "https://user:pass@example.test?token=secret failed"
    });
  });
  app.get("/conflict", async () => {
    const error = new Error("duplicate key value violates unique constraint users_email_key");
    error.code = "23505";
    throw error;
  });

  const internal = await app.inject("/internal");
  assert.equal(internal.statusCode, 500);
  assert.equal(internal.json().code, "INTERNAL_ERROR");
  assert.doesNotMatch(internal.body, /super-secret|password|exploded|stack/i);

  const dependency = await app.inject("/dependency");
  assert.equal(dependency.statusCode, 503);
  assert.equal(dependency.headers["retry-after"], "7");
  assert.equal(dependency.json().code, SERVICE_ERROR_CODES.CIRCUIT_OPEN);
  assert.doesNotMatch(dependency.body, /user|pass|token|secret/);

  const conflict = await app.inject("/conflict");
  assert.equal(conflict.statusCode, 409);
  assert.equal(conflict.json().code, "DATA_CONFLICT");
  assert.doesNotMatch(conflict.body, /users_email_key/);
  await app.close();
});

test("Fastify and database transient failures map to actionable retry contracts", () => {
  const { classifyError } = errorHandlerPlugin._internals;
  assert.deepEqual(classifyError({ code: "FST_ERR_CTP_BODY_TOO_LARGE" }), {
    statusCode: 413,
    code: "PAYLOAD_TOO_LARGE",
    message: "The request payload is too large.",
    retryable: false,
    errorType: "request.validation"
  });
  assert.deepEqual(classifyError({ code: "40P01" }), {
    statusCode: 503,
    code: "DATABASE_UNAVAILABLE",
    message: "The data service is temporarily unavailable.",
    retryAfterSeconds: 1,
    retryable: true,
    errorType: "postgres.transient"
  });
});
