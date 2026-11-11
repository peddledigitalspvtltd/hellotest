const assert = require("node:assert/strict");
const test = require("node:test");
const Fastify = require("fastify");
const http = require("node:http");

const errorHandlerPlugin = require("../src/plugins/errorHandler");
const {
  getServiceResilienceSnapshot,
  resilientHttpRequest,
  resetServiceResilienceState
} = require("../src/utils/resilientHttpClient");
const { SERVICE_ERROR_CODES, serviceError, classifyServiceFailure, isNetworkLike, networkFailureCode } = require("../src/utils/serviceErrors");

test.beforeEach(() => resetServiceResilienceState());

test("network classification follows bounded native causes and exports only reviewed transport codes", () => {
  for (const code of ["EAI_AGAIN", "ECONNRESET", "ENOTFOUND", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET"]) {
    const failure = new TypeError("fetch failed", { cause: new AggregateError([Object.assign(new Error("private provider details"), { code })]) });
    assert.equal(networkFailureCode(failure), code);
    assert.equal(isNetworkLike(failure), true);
    assert.equal(classifyServiceFailure(failure).retryable, true);
  }
  assert.equal(isNetworkLike(new TypeError("fetch failed")), true, "Native fetch can omit a platform cause.");
  assert.equal(networkFailureCode(new TypeError("fetch failed")), null, "Do not invent a socket cause from a message.");
  const cyclic = new Error("cycle"); cyclic.cause = cyclic;
  assert.equal(networkFailureCode(cyclic), null);
  assert.equal(networkFailureCode({ errors: Array.from({ length: 100 }, () => ({ code: "private-token-value" })) }), null);
  assert.equal(networkFailureCode({ errors: Array.from({ length: 5 }, () => ({})).concat({ code: "ECONNRESET" }) }), null, "Aggregate traversal is bounded.");
  let deep = { code: "ECONNRESET" };
  for (let depth = 0; depth < 6; depth++) deep = { cause: deep };
  assert.equal(networkFailureCode(deep), null);
});

test("invalid inputs, TLS configuration and programming errors are not transient network failures", async () => {
  const failures = [new TypeError("Cannot read properties of undefined"), new SyntaxError("Bad provider parser"), new ReferenceError("unknown binding"), new RangeError("invalid buffer size")];
  for (const code of ["ERR_INVALID_URL", "ERR_INVALID_ARG_TYPE", "UND_ERR_INVALID_ARG", "CERT_HAS_EXPIRED", "ERR_TLS_CERT_ALTNAME_INVALID"]) {
    failures.push(new TypeError("fetch failed", { cause: Object.assign(new Error("private request configuration"), { code }) }));
  }
  for (const reason of ["bad port", "unknown scheme", "unexpected redirect"]) failures.push(new TypeError("fetch failed", { cause: new Error(reason) }));
  for (const failure of failures) {
    assert.equal(isNetworkLike(failure), false);
    const classified = classifyServiceFailure(failure);
    assert.equal(classified.code, SERVICE_ERROR_CODES.CONFIGURATION);
    assert.equal(classified.retryable, false);
    let attempts = 0;
    await assert.rejects(resilientHttpRequest("https://invalid.test/request", { method: "POST", body: "{}" }, {
      idempotent: true, maxAttempts: 4, fetchImpl: async () => { attempts++; throw failure; }
    }), { code: SERVICE_ERROR_CODES.CONFIGURATION, retryable: false });
    assert.equal(attempts, 1, "A replay-safe generation does not authorize retrying a programming error.");
  }
  const network = Object.assign(new Error("socket reset"), { code: "ECONNRESET" });
  assert.equal(classifyServiceFailure(network, { callerAborted: true }).code, SERVICE_ERROR_CODES.CANCELLED);
  assert.equal(classifyServiceFailure(network, { timedOut: true }).code, SERVICE_ERROR_CODES.TIMEOUT);
  const explicit = serviceError(SERVICE_ERROR_CODES.UPSTREAM_REJECTED, { retryable: false, statusCode: 401 });
  assert.equal(classifyServiceFailure(explicit), explicit, "Existing authorization and boundary decisions remain authoritative.");
});

test("a real native fetch socket reset can recover within the explicit buffered-request retry allowance", async t => {
  let requests = 0;
  const server = http.createServer((request, response) => {
    requests++;
    if (requests === 1) { request.socket.destroy(); return; }
    response.writeHead(200, { "content-type": "application/json" }); response.end('{"proposal":"ready"}');
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const events = [];
  const response = await resilientHttpRequest(`http://127.0.0.1:${server.address().port}/generation`, { method: "POST", body: "{}" }, {
    idempotent: true, maxAttempts: 2, baseDelayMs: 10, deadlineMs: 2000, onEvent: event => events.push(event)
  });
  assert.deepEqual(await response.json(), { proposal: "ready" });
  assert.equal(requests, 2);
  assert.equal(events.filter(event => event.event === "dependency.request_retry").length, 1);
});

test("the boundary client retries only replay-safe requests and bounds the logical operation", { timeout: 5000 }, async (t) => {
  // The mocked transport has no live request socket. Represent that bounded
  // connection while the production retry timer deliberately remains unref'ed.
  const connectionLifetime = setTimeout(() => {}, 5000);
  t.after(() => clearTimeout(connectionLifetime));
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
