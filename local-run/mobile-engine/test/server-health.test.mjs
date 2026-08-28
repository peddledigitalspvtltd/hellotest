import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { app, lifecycleState } from "../src/server.js";

const listen = (server) => new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    server.off("error", reject);
    resolve(server.address());
  });
});

const close = (server) => new Promise((resolve, reject) => {
  server.close((error) => error ? reject(error) : resolve());
});

test("registered health routes preserve compatibility and gate readiness on Appium", async () => {
  let providerReady = true;
  let statusRequestCount = 0;
  const provider = createServer((request, response) => {
    statusRequestCount += 1;
    assert.equal(request.url, "/wd/hub/status");
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ value: { ready: providerReady } }));
  });
  const address = await listen(provider);
  const previous = {
    MOBILE_PROVIDER: process.env.MOBILE_PROVIDER,
    APPIUM_SERVER_URL: process.env.APPIUM_SERVER_URL,
    MOBILE_READINESS_TIMEOUT_MS: process.env.MOBILE_READINESS_TIMEOUT_MS,
    MOBILE_REQUIRE_PROVIDER_READY: process.env.MOBILE_REQUIRE_PROVIDER_READY
  };

  process.env.MOBILE_PROVIDER = "local-appium";
  process.env.APPIUM_SERVER_URL = `http://127.0.0.1:${address.port}/wd/hub`;
  process.env.MOBILE_READINESS_TIMEOUT_MS = "500";
  process.env.MOBILE_REQUIRE_PROVIDER_READY = "true";

  try {
    const compatible = await app.inject({ method: "GET", url: "/health" });
    assert.equal(compatible.statusCode, 200);
    assert.deepEqual(compatible.json(), {
      ok: true,
      service: "hellotest-mobile-engine",
      runner: "webdriverio+appium"
    });

    const live = await app.inject({ method: "GET", url: "/health/live" });
    assert.equal(live.statusCode, 200);
    assert.equal(live.json().status, "live");

    const ready = await app.inject({ method: "GET", url: "/health/ready" });
    assert.equal(ready.statusCode, 200);
    assert.equal(ready.json().checks.provider.status, "ready");

    providerReady = false;
    const unavailable = await app.inject({ method: "GET", url: "/health/ready" });
    assert.equal(unavailable.statusCode, 503);
    assert.equal(unavailable.json().checks.provider.reason, "provider_reported_not_ready");

    process.env.MOBILE_REQUIRE_PROVIDER_READY = "false";
    const degraded = await app.inject({ method: "GET", url: "/health/ready" });
    assert.equal(degraded.statusCode, 200);
    assert.equal(degraded.json().status, "degraded");
    assert.equal(degraded.json().checks.provider.required, false);
    assert.equal(degraded.json().checks.provider.status, "not_ready");

    const requestsBeforeDrain = statusRequestCount;
    lifecycleState.shuttingDown = true;
    const draining = await app.inject({ method: "GET", url: "/health/ready" });
    assert.equal(draining.statusCode, 503);
    assert.equal(draining.json().checks.lifecycle.status, "stopping");
    assert.equal(statusRequestCount, requestsBeforeDrain);
  } finally {
    lifecycleState.shuttingDown = false;
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await app.close();
    await close(provider);
  }
});
