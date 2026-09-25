const assert = require("node:assert/strict");
const test = require("node:test");
const { resilientHttpRequest, resetServiceResilienceState, getServiceResilienceSnapshot } = require("../src/utils/resilientHttpClient");
const { SERVICE_ERROR_CODES } = require("../src/utils/serviceErrors");

test.beforeEach(resetServiceResilienceState);

test("valid no-body responses are returned without spurious failures or extra requests", async () => {
  for (const status of [204, 205, 304]) {
    let calls = 0;
    const response = await resilientHttpRequest("https://provider.test/resource", {}, {
      fetchImpl: async () => { calls += 1; return new Response(null, { status, headers: { etag: '"revision-1"' } }); }
    });
    assert.equal(response.status, status);
    assert.equal(response.body, null);
    assert.equal(response.headers.get("etag"), '"revision-1"');
    assert.equal(calls, 1);
  }
  const head = await resilientHttpRequest("https://provider.test/resource", { method: "HEAD" }, {
    fetchImpl: async () => new Response(null, { status: 200, headers: { "content-length": "10000000" } })
  });
  assert.equal(head.body, null);
  assert.equal(head.headers.get("content-length"), "10000000");
});

test("an unaffordable Retry-After preserves the response body instead of retrying a canceled stream", async () => {
  let attempts = 0;
  const response = await resilientHttpRequest("https://busy.test/resource", {}, {
    deadlineMs: 100,
    fetchImpl: async () => {
      attempts += 1;
      return new Response('{"reason":"busy"}', { status: 503, headers: { "retry-after": "30" } });
    }
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { reason: "busy" });
  assert.equal(attempts, 1);
  assert.equal(getServiceResilienceSnapshot().boundaries[0].counters.retries, 0);
});

test("recovery permits exactly one concurrent probe even with spare bulkhead capacity", async () => {
  let clock = 0;
  const policy = { dependency: "recovering", failureThreshold: 1, resetTimeoutMs: 1_000, maxAttempts: 1, maxConcurrent: 20, now: () => clock };
  await assert.rejects(resilientHttpRequest("https://recover.test/a", {}, {
    ...policy, fetchImpl: async () => { throw new TypeError("fetch failed"); }
  }), { code: SERVICE_ERROR_CODES.NETWORK });
  clock = 1_001;
  let release;
  let attempts = 0;
  const probe = resilientHttpRequest("https://recover.test/a", {}, {
    ...policy, fetchImpl: () => { attempts += 1; return new Promise(resolve => { release = () => resolve(new Response("recovered")); }); }
  });
  const contenders = await Promise.allSettled(Array.from({ length: 25 }, () => resilientHttpRequest("https://recover.test/a", {}, {
    ...policy, fetchImpl: async () => { attempts += 1; return new Response("unexpected"); }
  })));
  assert.ok(contenders.every(item => item.status === "rejected" && item.reason.code === SERVICE_ERROR_CODES.CIRCUIT_OPEN));
  assert.equal(attempts, 1);
  release();
  assert.equal(await (await probe).text(), "recovered");
  assert.equal(getServiceResilienceSnapshot().boundaries[0].circuit, "closed");
});

test("already cancelled work never calls an upstream transport or occupies capacity", async () => {
  const controller = new AbortController();
  controller.abort();
  let attempts = 0;
  await assert.rejects(resilientHttpRequest("https://cancel.test/a", { signal: controller.signal }, {
    fetchImpl: async () => { attempts += 1; return new Response("ignored cancellation"); }
  }), { code: SERVICE_ERROR_CODES.CANCELLED });
  assert.equal(attempts, 0);
  assert.deepEqual(getServiceResilienceSnapshot().boundaries, []);
});

test("a rejected upstream response counts as one failure, not two", async () => {
  await assert.rejects(resilientHttpRequest("https://provider.test/a", {}, {
    throwOnHttpError: true, fetchImpl: async () => new Response("absent", { status: 404 })
  }), { code: SERVICE_ERROR_CODES.UPSTREAM_REJECTED });
  assert.equal(getServiceResilienceSnapshot().boundaries[0].counters.failures, 1);
});
