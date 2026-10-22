import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { createLiveViewPeerReader } from "../dist/lib/liveViewPeers.js";

const secret = "live-peer-test-secret-with-over-32-characters";
const environment = { TESTENGINE_LIVE_PEER_HOST: "web-workers", TESTENGINE_LIVE_PEER_PORT: "4301", TESTENGINE_SHARED_SECRET: secret };

test("live view discovers the exact case on another replica and reuses its owner", async () => {
  const calls = [];
  const reader = createLiveViewPeerReader({ environment,
    resolve: async hostname => { assert.equal(hostname, "web-workers");return [{ address: "10.1.0.2" }, { address: "10.1.0.3" }]; },
    request: async options => {
      const url = new URL(options.url);calls.push(url.hostname);
      assert.equal(url.searchParams.get("run_id"), "selected-case");assert.equal(url.searchParams.get("local_only"), "1");
      assert.equal(options.init.headers["x-hellotest-testengine-secret"], secret);
      assert.equal(options.maxResponseBytes, 8 * 1024 * 1024);assert.equal(options.timeoutMs, 1500);
      return url.hostname === "10.1.0.3" ? Buffer.from("case-image") : Buffer.alloc(0);
    }
  });
  assert.equal((await reader("playwright", "selected-case")).toString(), "case-image");
  calls.length = 0;
  assert.equal((await reader("playwright", "selected-case")).toString(), "case-image");
  assert.deepEqual(calls, ["10.1.0.3"]);
});

test("peer live view is opt-in and never follows user targets or falls back to an unrelated browser", async () => {
  let calls = 0;
  const request = async () => { calls++;return Buffer.alloc(0); };
  const resolve = async () => [{ address: "10.1.0.2" }];
  assert.equal(await createLiveViewPeerReader({ environment: {}, resolve, request })("playwright", "case"), null);
  assert.equal(await createLiveViewPeerReader({ environment: { ...environment, TESTENGINE_LIVE_PEER_HOST: "http://untrusted/path" }, resolve, request })("playwright", "case"), null);
  assert.equal(await createLiveViewPeerReader({ environment, resolve, request })("playwright", undefined), null);
  assert.equal(calls, 0);
  assert.equal(await createLiveViewPeerReader({ environment, resolve, request })("playwright", "missing-case"), null);
  assert.equal(calls, 1);
});

test("peer screenshots use bounded authenticated HTTP and refuse redirects", async t => {
  const app = Fastify();let requests = 0;
  app.get("/api/v1/live-session/screenshot", async (request, reply) => {
    requests++;
    assert.equal(request.headers["x-hellotest-testengine-secret"], secret);
    assert.equal(request.query.local_only, "1");
    if (request.query.run_id === "redirect-case") return reply.redirect("http://untrusted.test/leak");
    return reply.type("image/jpeg").send(Buffer.from("fixture-jpeg"));
  });
  const base = await app.listen({ host: "127.0.0.1", port: 0 });
  t.after(() => app.close());
  const reader = createLiveViewPeerReader({ environment: { ...environment, TESTENGINE_LIVE_PEER_PORT: new URL(base).port }, resolve: async () => [{ address: "127.0.0.1" }] });
  assert.equal((await reader("playwright", "case")).toString(), "fixture-jpeg");
  assert.equal(await reader("playwright", "redirect-case"), null);
  assert.equal(requests, 2);
});
