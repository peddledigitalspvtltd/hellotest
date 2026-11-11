import { retryRunCallbacks } from "./lib/callbackDelivery.js";
import { registerAutomationVerification } from "./lib/automationVerification.js";
import { registerAutomationMcp } from "./lib/automationMcp.js";
import { registerAutomationPlaywrightMcp, PLAYWRIGHT_MCP_RUNTIME, PLAYWRIGHT_MCP_ENDPOINT } from "./lib/automationPlaywrightMcp.js";
import { registerTestEngineReadiness } from "./lib/testEngineReadiness.js";
import { registerQualityAgentRoutes } from "./lib/qualityAgents/routes.js";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { buildAcceptedRun, buildCapabilities } from "./lib/pipeline.js";
import { queueRunExecution, saveAcceptedRun } from "./lib/executor.js";
import { createOpsTelemetry } from "./lib/opsTelemetry.js";
import { startQueueWorker, type QueueWorkerController } from "./lib/queueWorker.js";
import { getRun, getRunEnvelope, listRuns, saveRun } from "./lib/runStore.js";
import { registerRecorderRoutes } from "./lib/recorder.js";
import {
  createCorsHook,
  createPrivilegedRunGuard,
  resolveCorsPolicy,
  resolveTestEngineSharedSecret
} from "./lib/testEngineSecurity.js";
import { captureLiveSessionScreenshot, getLiveSessionStatus } from "./lib/webEngine.js";
import { createLiveViewPeerReader } from "./lib/liveViewPeers.js";
import { createLiveViewGrant, verifyLiveViewGrant } from './lib/liveViewGrant.js';
import type { EngineRunEnvelope } from "./contracts/hellotest.js";

const port = Number.parseInt(process.env.PORT || "4301", 10);
const normalizeText = (value: unknown) => {
  const normalized = String(value || "").trim();
  return normalized || "";
};
const buildSeleniumLiveViewUrl = () => {
  const configured = normalizeText(process.env.SELENIUM_LIVE_VIEW_URL || process.env.SELENIUM_VNC_URL);

  if (configured) {
    return configured;
  }

  const publicBase = normalizeText(process.env.ENGINE_PUBLIC_URL);

  if (!publicBase) {
    return null;
  }

  try {
    const parsed = new URL(publicBase);
    parsed.port = normalizeText(process.env.SELENIUM_VNC_PORT) || "7900";
    parsed.pathname = "/";
    parsed.search = "?autoconnect=1&resize=scale";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
};
const buildPlaywrightLiveViewUrl = () => {
  const configured = normalizeText(process.env.PLAYWRIGHT_LIVE_VIEW_URL);

  if (configured) {
    return configured;
  }

  const publicBase = normalizeText(process.env.ENGINE_PUBLIC_URL);

  if (!publicBase) {
    return null;
  }

  try {
    const parsed = new URL(publicBase);
    if (!parsed.pathname.endsWith("/api/v1/live-session")) parsed.pathname = `${parsed.pathname.replace(/\/+$/, "")}/api/v1/live-session`;
    parsed.search = "?provider=playwright";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
};
const app = Fastify({
  genReqId: (request) => {
    const supplied = request.headers["x-request-id"];
    return typeof supplied === "string" && /^[A-Za-z0-9._-]{1,128}$/.test(supplied) ? supplied : randomUUID();
  },
  logger: {
    level: process.env.LOG_LEVEL || "info",
    serializers: {
      req: (request) => ({
        method: request.method,
        // Recorder/live-view query strings contain scoped bearer credentials.
        url: String(request.url || "").split("?", 1)[0],
        hostname: request.headers?.host,
        remoteAddress: request.socket?.remoteAddress,
        remotePort: request.socket?.remotePort
      })
    }
  }
});
const sharedSecretConfig = resolveTestEngineSharedSecret();
const privilegedRunGuard = createPrivilegedRunGuard(sharedSecretConfig);
const readPeerLiveScreenshot = createLiveViewPeerReader();
const authorizeLiveView = async (request: FastifyRequest, reply: FastifyReply, runId: string, provider: 'playwright' | 'selenium', token: unknown) => {
  const secret = verifyLiveViewGrant({ token, engineRunId: runId, provider,
    secrets: [sharedSecretConfig.secret, getRunEnvelope(runId)?.callback?.signing_secret] });
  if (secret) return { secret, token: token as string };
  await privilegedRunGuard(request, reply);
  if (reply.sent || !sharedSecretConfig.secret) return null;
  return { secret: sharedSecretConfig.secret, token: createLiveViewGrant({ engineRunId: runId, provider, secret: sharedSecretConfig.secret }) };
};
const corsPolicy = resolveCorsPolicy();
const activeDirectExecutions = new Set<Promise<void>>();
let queueWorker: QueueWorkerController | null = null;
let shuttingDown = false;

app.addHook("onRequest", async (request, reply) => { reply.header("x-request-id", request.id); });
app.addHook("onRequest", createCorsHook(corsPolicy));

app.options("/*", async (_request, reply) => {
  reply.code(204).send();
});

let opsTelemetry: Awaited<ReturnType<typeof createOpsTelemetry>> | null = null;
const getOpsTelemetry = () => {
  if (!opsTelemetry) {
    throw new Error("OPS telemetry is not initialized yet");
  }

  return opsTelemetry;
};

const buildLiveHealth = () => ({
  ok: true,
  status: "live",
  service: process.env.ENGINE_NAME || "HelloTest Test Engine",
  runner: process.env.TESTENGINE_WORKER_CLASS || "hybrid",
  ui: "hellotest",
  execution_scope: process.env.TESTENGINE_WORKER_CLASS || "api+web+android+ios"
});

app.get("/health/live", async () => buildLiveHealth());

registerTestEngineReadiness(app, {
  sharedSecret: sharedSecretConfig,
  isShuttingDown: () => shuttingDown,
  isTelemetryInitialized: () => Boolean(opsTelemetry),
  isRuntimeInitialized: () => app.hasDecorator("playwrightMcpRuntime") && app.hasRoute({ method: "POST", url: PLAYWRIGHT_MCP_ENDPOINT }),
  getQueueHealth: () => queueWorker?.getHealthSnapshot() || null,
  serviceName: () => process.env.ENGINE_NAME || "HelloTest Test Engine"
});

// Compatibility endpoint for older operators. Deployment probes use the explicit live/ready endpoints.
app.get("/health", async () => ({
  ...buildLiveHealth(),
  ready: !shuttingDown && sharedSecretConfig.ready && Boolean(opsTelemetry) && Boolean(queueWorker?.getHealthSnapshot().ready),
  capabilities: { repository_inspection: true, local_execution: true, parameter_expressions_v1: true, playwright_mcp_runtime: PLAYWRIGHT_MCP_RUNTIME },
  supported_web_engines: ["playwright", "selenium"],
  queue_worker: queueWorker?.getHealthSnapshot() || null,
  ops_telemetry: getOpsTelemetry().getHealthSnapshot()
}));

app.get("/api/v1/capabilities", async () => buildCapabilities());

app.get("/api/v1/live-session/screenshot", async (request, reply) => {
  const query = request.query as { provider?: string; run_id?: string; local_only?: string; view_token?: string };
  if (query.local_only === "1") {
    await privilegedRunGuard(request, reply);
    if (reply.sent) return;
  }
  if (typeof query.run_id !== "string" || !query.run_id.trim() || query.run_id.length > 255) {
    return reply.code(400).send({ code: "LIVE_VIEW_RUN_REQUIRED", message: "Open Live view from a test case execution to select its browser session." });
  }
  const provider = query.provider === "selenium" ? "selenium" : "playwright";
  const grant = await authorizeLiveView(request, reply, query.run_id, provider, query.view_token);
  if (!grant) return;
  const screenshot = await captureLiveSessionScreenshot(provider, query.run_id)
    || (query.local_only === "1" ? null : await readPeerLiveScreenshot(provider, query.run_id));

  if (!screenshot) {
    reply.code(204);
    return "";
  }

  reply.header("Content-Type", provider === "selenium" ? "image/png" : "image/jpeg").header("Cache-Control", "no-store")
    .header('x-hellotest-live-view-grant', createLiveViewGrant({ engineRunId: query.run_id, provider, secret: grant.secret }));
  return screenshot;
});

app.get("/api/v1/live-session", async (request, reply) => {
  const query = request.query as { provider?: string; format?: string; run_id?: string; view_token?: string };
  if (typeof query.run_id !== "string" || !query.run_id.trim() || query.run_id.length > 255) {
    return reply.code(400).send({ code: "LIVE_VIEW_RUN_REQUIRED", message: "Open Live view from a test case execution to select its browser session." });
  }
  const provider = query.provider === "selenium" ? "selenium" : "playwright";
  const grant = await authorizeLiveView(request, reply, query.run_id, provider, query.view_token);
  if (!grant) return;

  if (query.format !== "json") {
    const status = getLiveSessionStatus(provider, query.run_id);
    reply.header("Content-Type", "text/html; charset=utf-8").header("Cache-Control", "no-store").header("Referrer-Policy", "no-referrer");
    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>HelloTest Test Case Live View</title>
  <style>
    body { margin: 0; font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #0e1726; color: #f8fafc; }
    .bar { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 10px 14px; background: #121f33; border-bottom: 1px solid rgba(255,255,255,.12); }
    .bar strong { font-size: 14px; }
    .bar span { color: #adc0d6; font-size: 12px; }
    .stage { height: calc(100vh - 45px); display: grid; place-items: center; overflow: hidden; }
    img { max-width: 100%; max-height: 100%; object-fit: contain; }
    .empty { text-align: center; color: #adc0d6; padding: 32px; }
  </style>
</head>
<body>
  <div class="bar"><strong>HelloTest ${provider === "selenium" ? "Selenium" : "Playwright"} test case live view</strong><span id="state">${status.available ? "Connected" : "Waiting for this test case"}</span></div>
  <div class="stage"><img id="shot" alt="Live browser for the selected test case" /><div class="empty" id="empty">Waiting for this test case's browser session. The view closes when its browser stops.</div></div>
  <script>
    const shot = document.getElementById("shot");
    const empty = document.getElementById("empty");
    const state = document.getElementById("state");
    const screenshotUrl = new URL(window.location.href);
    screenshotUrl.pathname = screenshotUrl.pathname.replace(/\\/+$/, "") + "/screenshot";
    screenshotUrl.searchParams.delete("format");
    let imageUrl;
    let timer;
    let closed = false;
    window.addEventListener("pagehide", () => {
      closed = true;
      clearTimeout(timer);
      if (imageUrl) URL.revokeObjectURL(imageUrl);
    });
    async function refresh() {
      if (document.visibilityState === "hidden" || closed) return;
      const src = new URL(screenshotUrl);
      src.searchParams.set("t", String(Date.now()));
      const controller = new AbortController();
      const deadline = setTimeout(() => controller.abort(), 5000);
      let frame;
      try {
        const response = await fetch(src, { cache: "no-store", signal: controller.signal });
        if ([401, 403, 410].includes(response.status)) {
          closed = true;
          shot.style.display = "none";
          empty.style.display = "block";
          empty.textContent = "Live link expired. Reopen Live Run View from this Test Case execution.";
          state.textContent = "Authorization expired";
          if (imageUrl) URL.revokeObjectURL(imageUrl);
          return;
        }
        if (response.ok && response.status !== 204) frame = await response.blob();
        const renewed = response.headers?.get("x-hellotest-live-view-grant");
        if (renewed && frame) screenshotUrl.searchParams.set("view_token", renewed);
      } catch { /* A temporary worker/proxy failure is retried by the next frame. */ }
      finally { clearTimeout(deadline); }
      if (!frame || !/^image\\/(?:jpeg|png)$/.test(frame.type) || frame.size > 8 * 1024 * 1024) {
        if (imageUrl) URL.revokeObjectURL(imageUrl);
        imageUrl = undefined;
        shot.removeAttribute("src");
        shot.style.display = "none";
        empty.style.display = "block";
        state.textContent = "Waiting for this test case";
        return;
      }
      if (closed) return;
      const nextImageUrl = URL.createObjectURL(frame);
      shot.src = nextImageUrl;
      if (imageUrl) URL.revokeObjectURL(imageUrl);
      imageUrl = nextImageUrl;
      shot.style.display = "block";
      empty.style.display = "none";
      state.textContent = "Connected";
    }
    async function poll() { try { await refresh(); } finally { if (!closed) timer = setTimeout(poll, 1000); } }
    poll();
  </script>
</body>
</html>`;
  }

  const seleniumLiveViewUrl = buildSeleniumLiveViewUrl();
  const playwrightLiveViewUrl = buildPlaywrightLiveViewUrl();
  const status = getLiveSessionStatus(provider, query.run_id);
  let caseLiveViewUrl: string | null = null;
  try {
    const url = new URL(playwrightLiveViewUrl || "");
    if (!url.pathname.endsWith("/api/v1/live-session")) url.pathname = `${url.pathname.replace(/\/+$/, "")}/api/v1/live-session`;
    url.searchParams.set("provider", provider);
    if (query.run_id) url.searchParams.set("run_id", query.run_id);
    url.searchParams.set('view_token', grant.token);
    caseLiveViewUrl = url.toString();
  } catch {}

  return {
    ok: true,
    provider,
    available: status.available || Boolean(await readPeerLiveScreenshot(provider, query.run_id)),
    live_view_url: caseLiveViewUrl,
    selenium_grid_url: process.env.SELENIUM_GRID_URL || "http://selenium-hub:4444/wd/hub",
    playwright_live_view_url: playwrightLiveViewUrl,
    selenium_live_view_url: seleniumLiveViewUrl,
    note: "Open the test case live_view_url to view this browser session. A run_id keeps the view scoped to its dispatched case."
  };
});

app.get("/api/v1/runs", { preHandler: privilegedRunGuard }, async () => ({
  items: listRuns()
}));

app.get("/api/v1/runs/:id", { preHandler: privilegedRunGuard }, async (request, reply) => {
  const params = request.params as { id: string };
  const run = getRun(params.id);

  if (!run) {
    reply.code(404);
    return { message: "Run not found" };
  }

  return run;
});

const trackDirectExecution = (execution: Promise<void>) => {
  activeDirectExecutions.add(execution);
  void execution.finally(() => {
    activeDirectExecutions.delete(execution);
  });
};

app.post("/api/v1/runs", { preHandler: privilegedRunGuard }, async (request, reply) => {
  const envelope = request.body as EngineRunEnvelope;

  if (!envelope?.engine_run_id || !envelope?.hellotest_run_id || !envelope?.hellotest_test_case_id) {
    reply.code(400);
    return { message: "engine_run_id, hellotest_run_id, and hellotest_test_case_id are required" };
  }

  if (!envelope.automated) {
    reply.code(400);
    return { message: "Test Engine only accepts automated run handoff requests" };
  }

  if (!envelope.callback?.url || !envelope.callback?.signing_secret) {
    reply.code(400);
    return { message: "callback.url and callback.signing_secret are required" };
  }

  const accepted = saveAcceptedRun(envelope, buildAcceptedRun(envelope));
  trackDirectExecution(queueRunExecution(envelope, accepted, app.log));
  reply.code(202);
  return {
    id: accepted.id,
    state: accepted.state,
    summary: accepted.summary
  };
});

app.post("/api/v1/runs/:id/callbacks/retry", { preHandler: privilegedRunGuard }, async (request, reply) => {
  try {
    const delivery = await retryRunCallbacks((request.params as {id: string}).id);
    return { callback_delivery: delivery };
  } catch {
    reply.code(409);
    return { message: "No retained callback can be retried with the current runner credential." };
  }
});

app.post("/api/v1/runs/:id/retry", { preHandler: privilegedRunGuard }, async (request, reply) => {
  const params = request.params as { id: string };
  const existing = getRun(params.id);

  if (!existing) {
    reply.code(404);
    return { message: "Run not found" };
  }

  const envelope = getRunEnvelope(params.id);

  if (!envelope) {
    reply.code(409);
    return { message: "Run handoff payload is no longer available for retry" };
  }

  const retried = saveRun({
    ...existing,
    state: "running",
    healing_attempted: false,
    healing_succeeded: false,
    summary: "Retry requested. Deterministic engine execution will run before any healing attempt.",
    updated_at: new Date().toISOString()
  }, envelope);

  trackDirectExecution(queueRunExecution(envelope, retried, app.log));

  reply.code(202);
  return retried;
});

const startServer = async () => {
  opsTelemetry = await createOpsTelemetry(app.log);
  await opsTelemetry.register(app);
  await registerRecorderRoutes(app);
  await registerAutomationMcp(app, privilegedRunGuard);
  await registerAutomationPlaywrightMcp(app, privilegedRunGuard);
  await registerAutomationVerification(app, privilegedRunGuard);
  await registerQualityAgentRoutes(app, privilegedRunGuard);
  queueWorker = startQueueWorker(app.log, opsTelemetry);
  app.addHook("onClose", async () => {
    shuttingDown = true;
    const configuredTimeout = Number.parseInt(process.env.TESTENGINE_SHUTDOWN_TIMEOUT_MS || "30000", 10);
    const timeoutMs = Number.isFinite(configuredTimeout)
      ? Math.max(1, Math.min(120_000, configuredTimeout))
      : 30_000;
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    let directExecutionsTimedOut = false;
    const drainDirectExecutions = Promise.allSettled(Array.from(activeDirectExecutions)).then(() => undefined);
    const directExecutionTimeout = new Promise<void>((resolve) => {
      timeoutHandle = setTimeout(() => {
        directExecutionsTimedOut = true;
        resolve();
      }, timeoutMs);
      timeoutHandle.unref?.();
    });

    await Promise.all([
      queueWorker?.stop({ timeoutMs }),
      Promise.race([drainDirectExecutions, directExecutionTimeout])
    ]);

    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }

    if (directExecutionsTimedOut && activeDirectExecutions.size > 0) {
      app.log.error({
        active_direct_executions: activeDirectExecutions.size,
        timeout_ms: timeoutMs
      }, "Test Engine shutdown timed out while direct executions were still active");
    }
  });
  await app.listen({
    port,
    host: process.env.HOST || "0.0.0.0"
  });
};

let shutdownPromise: Promise<void> | null = null;
const shutdown = (signal: NodeJS.Signals) => {
  if (shutdownPromise) {
    return shutdownPromise;
  }

  shuttingDown = true;
  app.log.info({ signal }, "Test Engine graceful shutdown started");
  const configuredTimeout = Number.parseInt(process.env.TESTENGINE_SHUTDOWN_TIMEOUT_MS || "30000", 10);
  const timeoutMs = Number.isFinite(configuredTimeout)
    ? Math.max(1, Math.min(120_000, configuredTimeout))
    : 30_000;
  const forceExitTimer = setTimeout(() => {
    app.log.error({ signal, timeout_ms: timeoutMs }, "Test Engine graceful shutdown exceeded its deadline");
    process.exit(1);
  }, timeoutMs + 2_000);

  shutdownPromise = app.close()
    .then(() => {
      const workerHealth = queueWorker?.getHealthSnapshot();
      const pendingWork = activeDirectExecutions.size + (workerHealth?.active_jobs || 0);

      if (pendingWork === 0 && !workerHealth?.polling) {
        clearTimeout(forceExitTimer);
        app.log.info({ signal }, "Test Engine graceful shutdown completed");
        return;
      }

      app.log.error({
        signal,
        pending_work: pendingWork,
        worker_polling: Boolean(workerHealth?.polling)
      }, "Test Engine stopped accepting requests but could not drain all work before its deadline");
      process.exitCode = 1;
    })
    .catch((error) => {
      clearTimeout(forceExitTimer);
      app.log.error({ error, signal }, "Test Engine graceful shutdown failed");
      process.exitCode = 1;
    });

  return shutdownPromise;
};

process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});
process.once("SIGINT", () => {
  void shutdown("SIGINT");
});

startServer().catch(async (error) => {
  app.log.error(error);
  await app.close().catch(() => undefined);
  process.exitCode = 1;
});
