import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const SHARED_SECRET = "server-runtime-test-secret-with-more-than-32-characters";

const waitForServer = async (url, child, output) => {
  const deadline = Date.now() + 10_000;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Test Engine exited before becoming ready: ${output.join("")}`);
    }

    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // The listen socket may not be open yet.
    }

    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error(`Timed out waiting for Test Engine: ${output.join("")}`);
};

test("real server exposes split health, protects run APIs, enforces CORS, and exits cleanly on SIGTERM", async () => {
  const artifactRoot = await mkdtemp(path.join(os.tmpdir(), "hellotest-server-runtime-"));
  const port = 44_000 + (process.pid % 1_000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const output = [];
  const child = spawn(process.execPath, ["dist/server.js"], {
    cwd: path.resolve(import.meta.dirname, ".."),
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: "production",
      ARTIFACT_ROOT: artifactRoot,
      HELLOTEST_API_BASE_URL: "",
      TESTENGINE_QUEUE_REQUIRED: "false",
      TESTENGINE_SHARED_SECRET: SHARED_SECRET,
      OPS_TELEMETRY_ENVIRONMENT: "local",
      OPS_TELEMETRY_STORE_PATH: path.join(artifactRoot, "ops.ndjson"),
      LOG_LEVEL: "error"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.on("data", (chunk) => output.push(String(chunk).slice(0, 2_000)));
  child.stderr.on("data", (chunk) => output.push(String(chunk).slice(0, 2_000)));

  try {
    await waitForServer(`${baseUrl}/health/live`, child, output);

    const live = await fetch(`${baseUrl}/health/live`);
    assert.equal(live.status, 200);
    assert.equal((await live.json()).status, "live");

    const ready = await fetch(`${baseUrl}/health/ready`);
    assert.equal(ready.status, 200);
    const readyPayload = await ready.json();
    assert.equal(readyPayload.status, "ready");
    assert.equal(readyPayload.checks.queue_worker.status, "disabled");

    for (const request of [
      { url: `${baseUrl}/api/v1/runs`, options: {} },
      { url: `${baseUrl}/api/v1/runs/missing`, options: {} },
      { url: `${baseUrl}/api/v1/runs`, options: { method: "POST", headers: { "content-type": "application/json" }, body: "{}" } },
      { url: `${baseUrl}/api/v1/runs/missing/retry`, options: { method: "POST" } }
    ]) {
      assert.equal((await fetch(request.url, request.options)).status, 401);
    }
    assert.equal((await fetch(`${baseUrl}/api/v1/runs`, {
      headers: { "x-hellotest-testengine-secret": SHARED_SECRET }
    })).status, 200);
    assert.equal((await fetch(`${baseUrl}/api/v1/runs`, {
      headers: { origin: "https://attacker.example" }
    })).status, 403);

    child.kill("SIGTERM");
    const [exitCode, signal] = await once(child, "exit");
    assert.equal(exitCode, 0, `Unexpected signal ${signal || "none"}: ${output.join("")}`);
    assert.equal(signal, null);
  } finally {
    if (child.exitCode === null) {
      child.kill("SIGKILL");
      await once(child, "exit").catch(() => undefined);
    }
    await rm(artifactRoot, { recursive: true, force: true });
  }
});
