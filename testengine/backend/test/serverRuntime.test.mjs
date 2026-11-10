import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { createLiveViewGrant, verifyLiveViewGrant } from '../dist/lib/liveViewGrant.js';
import { createRequire } from 'node:module';
const backendGrant = createRequire(import.meta.url)('../../../services/automation/backend/lib/automationLiveViewGrant.js').createLiveViewGrant;

const SHARED_SECRET = "server-runtime-test-secret-with-more-than-32-characters";
const PAIRED_CALLBACK_SECRET = 'paired-case-specific-callback-key-for-live-fixture';

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
  const child = spawn(process.execPath, ["--input-type=module", "--eval", `
    const {saveRun}=await import('./dist/lib/runStore.js');
    const {liveViewSessions}=await import('./dist/lib/liveViewSessions.js');
    saveRun({id:'paired-case',created_at:new Date().toISOString()}, {callback:{signing_secret:${JSON.stringify(PAIRED_CALLBACK_SECRET)}}});
    liveViewSessions.register({id:'live-case:playwright',provider:'playwright',startedAt:new Date().toISOString(),url:async()=>'https://fixture.test',screenshot:async()=>Buffer.from('fixture-jpeg')});
    await import('./dist/server.js');
  `], {
    cwd: path.resolve(import.meta.dirname, ".."),
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: "production",
      ARTIFACT_ROOT: artifactRoot,
      HELLOTEST_API_BASE_URL: "",
      TESTENGINE_QUEUE_REQUIRED: "false",
      TESTENGINE_LIVE_PEER_HOST: "",
      ENGINE_PUBLIC_URL: "https://runner.example/engines/web",
      PLAYWRIGHT_LIVE_VIEW_URL: "",
      TESTENGINE_SHARED_SECRET: SHARED_SECRET,
      OPS_TELEMETRY_ENVIRONMENT: "local",
      OPS_TELEMETRY_STORE_PATH: path.join(artifactRoot, "ops.ndjson"),
      LOG_LEVEL: "info"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.on("data", (chunk) => output.push(String(chunk).slice(0, 2_000)));
  child.stderr.on("data", (chunk) => output.push(String(chunk).slice(0, 2_000)));

  try {
    await waitForServer(`${baseUrl}/health/live`, child, output);

    const live = await fetch(`${baseUrl}/health/live?session_token=must-not-appear-in-worker-logs`, { headers: { "x-request-id": "engine-correlation-fixture" } });
    assert.equal(live.status, 200);
    assert.equal(live.headers.get("x-request-id"), "engine-correlation-fixture");
    assert.equal((await live.json()).status, "live");

    const ready = await fetch(`${baseUrl}/health/ready`);
    assert.equal(ready.status, 200);
    const readyPayload = await ready.json();
    assert.equal(readyPayload.status, "ready");
    assert.equal(readyPayload.checks.queue_worker.status, "disabled");
    const compatibilityHealth = await (await fetch(`${baseUrl}/health`)).json();
    assert.equal(compatibilityHealth.ready, true);
    assert.equal(compatibilityHealth.capabilities.local_execution, true);
    for (const route of ["/api/v1/live-session", "/api/v1/live-session/screenshot"]) {
      const unscoped = await fetch(`${baseUrl}${route}`);
      assert.equal(unscoped.status, 400);
      assert.equal((await unscoped.json()).code, "LIVE_VIEW_RUN_REQUIRED");
    }
    assert.equal((await fetch(`${baseUrl}/api/v1/live-session/screenshot?run_id=missing-case`)).status, 401);
    assert.equal((await fetch(`${baseUrl}/api/v1/live-session/screenshot?run_id=missing-case&local_only=1`)).status, 401);
    assert.equal((await fetch(`${baseUrl}/api/v1/live-session/screenshot?run_id=missing-case&local_only=1`, { headers: { "x-hellotest-testengine-secret": SHARED_SECRET } })).status, 204);
    const token=backendGrant({engineRunId:'case',provider:'selenium',secret:SHARED_SECRET});
    const viewerInfo = await (await fetch(`${baseUrl}/api/v1/live-session?run_id=case&provider=selenium&format=json&view_token=${token}`)).json();
    const viewerUrl = new URL(viewerInfo.live_view_url);assert.equal(viewerUrl.searchParams.get('view_token'),token);viewerUrl.searchParams.delete('view_token');
    assert.equal(viewerUrl.toString(), "https://runner.example/engines/web/api/v1/live-session?provider=selenium&run_id=case");
    for(const [runId,provider,grant] of [['other','selenium',token],['case','playwright',token],['case','selenium',token+'tampered'],['case','selenium',createLiveViewGrant({engineRunId:'case',provider:'selenium',secret:SHARED_SECRET,now:Date.now()-301000})]]) {
      assert.equal((await fetch(`${baseUrl}/api/v1/live-session?run_id=${runId}&provider=${provider}&view_token=${grant}`)).status,401);
    }
    const webToken=createLiveViewGrant({engineRunId:'case',provider:'playwright',secret:SHARED_SECRET});
    assert.equal((await fetch(`${baseUrl}/api/v1/live-session/screenshot?run_id=case&view_token=${webToken}`)).status,204);
    const viewerHtml = await (await fetch(`${baseUrl}/api/v1/live-session?run_id=case&view_token=${webToken}`)).text();
    const pairedToken=backendGrant({engineRunId:'paired-case',provider:'playwright',secret:PAIRED_CALLBACK_SECRET});
    assert.equal((await fetch(`${baseUrl}/api/v1/live-session/screenshot?run_id=paired-case&view_token=${pairedToken}`)).status,204,'Paired local grants use the accepted case callback key');
    assert.equal((await fetch(`${baseUrl}/api/v1/live-session/screenshot?run_id=case&view_token=${pairedToken}`)).status,401);
    const expiringToken=backendGrant({engineRunId:'live-case',provider:'playwright',secret:SHARED_SECRET,now:Date.now()-295000});
    const frame=await fetch(`${baseUrl}/api/v1/live-session/screenshot?run_id=live-case&view_token=${expiringToken}`);assert.equal(frame.status,200);
    const renewed=frame.headers.get('x-hellotest-live-view-grant');assert.notEqual(renewed,expiringToken);
    assert.equal(verifyLiveViewGrant({token:renewed,engineRunId:'live-case',provider:'playwright',secrets:[SHARED_SECRET]}),SHARED_SECRET);
    const viewerScript = viewerHtml.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/poll\(\);\s*$/, "");
    const frames = [];
    const nodes = new Map();
    await vm.runInNewContext(`${viewerScript}\nrefresh();`, {
      window: { location: { href: "https://runner.example/engines/web/api/v1/live-session?provider=playwright&run_id=case" }, addEventListener() {} }, URL, AbortController,
      document: { getElementById: id => { if (!nodes.has(id)) nodes.set(id, { style: {}, removeAttribute() {} }); return nodes.get(id); } },
      fetch: async (url, options) => { frames.push(new URL(url)); assert.ok(options.signal instanceof AbortSignal); return { ok: true, status: 204 }; }, setTimeout() {}, clearTimeout() {}
    });
    assert.equal(frames[0].pathname, "/engines/web/api/v1/live-session/screenshot");
    assert.equal(frames[0].searchParams.get("run_id"), "case");
    frames.length=0;
    await vm.runInNewContext(`${viewerScript}\n(async()=>{await refresh();await refresh();})();`, {
      window:{location:{href:'https://runner.example/api/v1/live-session?run_id=case'},addEventListener(){}},URL,AbortController,
      document:{getElementById:id=>nodes.get(id)},fetch:async url=>{frames.push(url);return{status:401};},setTimeout(){},clearTimeout(){}
    });
    assert.equal(frames.length,1,'An expired grant stops polling instead of retrying authorization forever');
    assert.match(nodes.get('empty').textContent,/Reopen Live Run View from this Test Case execution/);

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
    assert.ok(output.join("").includes("engine-correlation-fixture"));
    assert.ok(!output.join("").includes("must-not-appear-in-worker-logs"));
  } finally {
    if (child.exitCode === null) {
      child.kill("SIGKILL");
      await once(child, "exit").catch(() => undefined);
    }
    await rm(artifactRoot, { recursive: true, force: true });
  }
});
