import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  MobileEngineOperationalError,
  createGracefulShutdown,
  probeProviderReadiness,
  remoteFileToBase64,
  resolveOperationalLimits
} from "../src/operational.js";

test("operational limits reject invalid values and clamp unsafe extremes", () => {
  assert.deepEqual(resolveOperationalLimits({
    MOBILE_READINESS_TIMEOUT_MS: "invalid",
    MOBILE_REMOTE_DOWNLOAD_TIMEOUT_MS: "1",
    MOBILE_REMOTE_DOWNLOAD_MAX_BYTES: "9999999999",
    MOBILE_SHUTDOWN_TIMEOUT_MS: "90000"
  }), {
    readinessTimeoutMs: 2_000,
    remoteDownloadTimeoutMs: 100,
    remoteDownloadMaxBytes: 100 * 1024 * 1024,
    shutdownTimeoutMs: 60_000
  });
});

test("local Appium readiness probes the status endpoint and honors reported readiness", async () => {
  let requestedUrl = null;
  const result = await probeProviderReadiness({
    provider: "LOCAL-APPIUM",
    appiumServerUrl: "http://127.0.0.1:4723/wd/hub?token=secret"
  }, {
    timeoutMs: 500,
    fetchImpl: async (url, options) => {
      requestedUrl = String(url);
      assert.equal(options.signal instanceof AbortSignal, true);
      return new Response(JSON.stringify({ value: { ready: true } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });

  assert.equal(requestedUrl, "http://127.0.0.1:4723/wd/hub/status");
  assert.equal(result.ok, true);
  assert.equal(result.dependency.status, "ready");
  assert.equal(result.dependency.endpoint.includes("secret"), false);
});

test("local Appium readiness fails closed on timeout", { timeout: 1_000 }, async () => {
  const result = await probeProviderReadiness({
    provider: "local-appium",
    appiumServerUrl: "http://127.0.0.1:4723"
  }, {
    timeoutMs: 100,
    fetchImpl: async (_url, { signal }) => new Promise((_, reject) => {
      signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    })
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, "not_ready");
  assert.equal(result.dependency.reason, "timeout");
});

test("local Appium readiness also times out while reading an incomplete status body", { timeout: 1_000 }, async () => {
  const result = await probeProviderReadiness({
    provider: "local-appium",
    appiumServerUrl: "http://127.0.0.1:4723"
  }, {
    timeoutMs: 100,
    fetchImpl: async (_url, { signal }) => ({
      ok: true,
      status: 200,
      json: async () => new Promise((_, reject) => {
        signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      })
    })
  });

  assert.equal(result.ok, false);
  assert.equal(result.dependency.reason, "timeout");
});

test("remote providers validate configuration without making readiness depend on an external vendor", async () => {
  let called = false;
  const result = await probeProviderReadiness({
    provider: "browserstack",
    appiumServerUrl: "https://hub-cloud.browserstack.com/wd/hub?access_key=secret"
  }, {
    fetchImpl: async () => {
      called = true;
      throw new Error("must not be called");
    }
  });

  assert.equal(called, false);
  assert.equal(result.ok, true);
  assert.equal(result.dependency.status, "configured");
  assert.equal(result.dependency.endpoint.includes("secret"), false);
});

test("remote file downloads return base64 only within the byte ceiling", async () => {
  const encoded = await remoteFileToBase64("https://files.example/mobile.txt", {
    maxBytes: 3,
    timeoutMs: 500,
    fetchImpl: async () => new Response("abc", { status: 200 })
  });
  assert.equal(encoded, Buffer.from("abc").toString("base64"));

  await assert.rejects(
    remoteFileToBase64("https://files.example/declared-large.bin", {
      maxBytes: 3,
      timeoutMs: 500,
      fetchImpl: async () => new Response("x", {
        status: 200,
        headers: { "content-length": "4" }
      })
    }),
    (error) => error instanceof MobileEngineOperationalError
      && error.code === "REMOTE_FILE_TOO_LARGE"
      && error.statusCode === 413
  );

  await assert.rejects(
    remoteFileToBase64("https://files.example/streamed-large.bin", {
      maxBytes: 5,
      timeoutMs: 500,
      fetchImpl: async () => new Response("abcdef", { status: 200 })
    }),
    (error) => error.code === "REMOTE_FILE_TOO_LARGE"
  );
});

test("remote file downloads abort after the configured deadline", { timeout: 1_000 }, async () => {
  await assert.rejects(
    remoteFileToBase64("https://files.example/slow.bin", {
      maxBytes: 1024,
      timeoutMs: 100,
      fetchImpl: async (_url, { signal }) => new Promise((_, reject) => {
        signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      })
    }),
    (error) => error.code === "REMOTE_FILE_DOWNLOAD_TIMEOUT" && error.statusCode === 504
  );
});

test("graceful shutdown is idempotent and drains active recorder sessions", async () => {
  let serverCloseCount = 0;
  let sessionCloseCount = 0;
  const state = { shuttingDown: false };
  const sessions = new Map([
    ["session-1", {
      status: "running",
      driver: { deleteSession: async () => { sessionCloseCount += 1; } }
    }]
  ]);
  const shutdown = createGracefulShutdown({
    app: { close: async () => { serverCloseCount += 1; }, log: {} },
    sessions,
    state,
    timeoutMs: 500
  });

  const first = shutdown("SIGTERM");
  const second = shutdown("SIGINT");
  assert.equal(first, second);
  const result = await first;

  assert.equal(state.shuttingDown, true);
  assert.equal(sessions.size, 0);
  assert.equal(serverCloseCount, 1);
  assert.equal(sessionCloseCount, 1);
  assert.deepEqual(result, { reason: "SIGTERM", closed: 1, failed: 0 });
});

test("graceful shutdown has a hard deadline", { timeout: 1_000 }, async () => {
  const shutdown = createGracefulShutdown({
    app: { close: async () => new Promise(() => {}), log: {} },
    sessions: new Map(),
    state: { shuttingDown: false },
    timeoutMs: 100
  });

  await assert.rejects(
    shutdown("SIGTERM"),
    (error) => error.code === "SHUTDOWN_TIMEOUT"
  );
});

test("server and local deployment contracts use split health semantics", async () => {
  const [server, sourceCompose, imageCompose] = await Promise.all([
    readFile(new URL("../src/server.js", import.meta.url), "utf8"),
    readFile(new URL("../../docker-compose.yml", import.meta.url), "utf8"),
    readFile(new URL("../../docker-compose.images.yml", import.meta.url), "utf8")
  ]);

  assert.match(server, /app\.get\("\/health"/);
  assert.match(server, /app\.get\("\/health\/live"/);
  assert.match(server, /app\.get\("\/health\/ready"/);
  assert.match(server, /probeProviderReadiness/);
  assert.match(server, /createGracefulShutdown/);
  assert.equal((sourceCompose.match(/4312\/health\/ready/g) || []).length, 1);
  assert.equal((imageCompose.match(/4312\/health\/ready/g) || []).length, 1);
});
