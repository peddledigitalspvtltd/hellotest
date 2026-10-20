import { retryRunCallbacks } from "./lib/callbackDelivery.js";
import { registerAutomationVerification } from "./lib/automationVerification.js";
import { registerAutomationMcp } from "./lib/automationMcp.js";
import { registerQualityAgentRoutes } from "./lib/qualityAgents/routes.js";
import Fastify from "fastify";
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
    parsed.pathname = "/api/v1/live-session";
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

app.get("/health/ready", async (_request, reply) => {
  const worker = queueWorker?.getHealthSnapshot() || null;
  const ready = !shuttingDown
    && Boolean(opsTelemetry)
    && sharedSecretConfig.ready
    && Boolean(worker?.ready);

  reply.code(ready ? 200 : 503).header("cache-control", "no-store");
  return {
    ok: ready,
    status: ready ? "ready" : "not_ready",
    service: process.env.ENGINE_NAME || "HelloTest Test Engine",
    checks: {
      accepting_requests: !shuttingDown,
      shared_secret: {
        ready: sharedSecretConfig.ready,
        configured: Boolean(sharedSecretConfig.source && sharedSecretConfig.source !== "development-fallback"),
        source: sharedSecretConfig.source,
        reason: sharedSecretConfig.reason
      },
      queue_worker: worker,
      ops_telemetry_initialized: Boolean(opsTelemetry)
    }
  };
});

// Compatibility endpoint for older operators. Deployment probes use the explicit live/ready endpoints.
app.get("/health", async () => ({
  ...buildLiveHealth(),
  supported_web_engines: ["playwright", "selenium"],
  queue_worker: queueWorker?.getHealthSnapshot() || null,
  ops_telemetry: getOpsTelemetry().getHealthSnapshot()
}));

app.get("/api/v1/capabilities", async () => buildCapabilities());

app.get("/api/v1/live-session/screenshot", async (request, reply) => {
  const query = request.query as { provider?: string; run_id?: string };
  const provider = query.provider === "selenium" ? "selenium" : "playwright";
  const screenshot = await captureLiveSessionScreenshot(provider, query.run_id);

  if (!screenshot) {
    reply.code(204);
    return "";
  }

  reply.header("Content-Type", "image/jpeg").header("Cache-Control", "no-store");
  return screenshot;
});

app.get("/api/v1/live-session", async (request, reply) => {
  const query = request.query as { provider?: string; format?: string; run_id?: string };
  const provider = query.provider === "selenium" ? "selenium" : "playwright";

  if (provider === "playwright" && query.format !== "json") {
    const status = getLiveSessionStatus("playwright", query.run_id);
    const screenshotPath = "/api/v1/live-session/screenshot?provider=playwright" + (query.run_id ? "&run_id=" + encodeURIComponent(query.run_id) : "");
    reply.header("Content-Type", "text/html; charset=utf-8");
    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>HelloTest Playwright Live View</title>
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
  <div class="bar"><strong>HelloTest Playwright live view</strong><span id="state">${status.available ? "Connected" : "Waiting for a Playwright run"}</span></div>
  <div class="stage"><img id="shot" alt="" /><div class="empty" id="empty">Waiting for an active Playwright browser session.</div></div>
  <script>
    const shot = document.getElementById("shot");
    const empty = document.getElementById("empty");
    const state = document.getElementById("state");
    async function refresh() {
      const src = "${screenshotPath}&t=" + Date.now();
      const response = await fetch(src, { cache: "no-store" }).catch(() => null);
      if (!response || response.status === 204) {
        shot.removeAttribute("src");
        shot.style.display = "none";
        empty.style.display = "block";
        state.textContent = "Waiting for a Playwright run";
        return;
      }
      shot.src = src;
      shot.style.display = "block";
      empty.style.display = "none";
      state.textContent = "Connected";
    }
    refresh();
    setInterval(refresh, 1000);
  </script>
</body>
</html>`;
  }

  const seleniumLiveViewUrl = buildSeleniumLiveViewUrl();
  const playwrightLiveViewUrl = buildPlaywrightLiveViewUrl();
  const status = getLiveSessionStatus(provider, query.run_id);

  return {
    ok: true,
    provider,
    available: provider === "selenium" ? Boolean(seleniumLiveViewUrl) : status.available,
    live_view_url: provider === "selenium" ? seleniumLiveViewUrl : playwrightLiveViewUrl,
    selenium_grid_url: process.env.SELENIUM_GRID_URL || "http://selenium-hub:4444/wd/hub",
    playwright_live_view_url: playwrightLiveViewUrl,
    selenium_live_view_url: seleniumLiveViewUrl,
    note: provider === "selenium"
      ? "Use the Selenium noVNC live_view_url while a Selenium web run is active."
      : "Use the Playwright live_view_url while a Playwright web run is active."
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
