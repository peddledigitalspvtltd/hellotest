import Fastify from "fastify";
import { buildAcceptedRun, buildCapabilities } from "./lib/pipeline.js";
import { queueRunExecution, saveAcceptedRun } from "./lib/executor.js";
import { createOpsTelemetry } from "./lib/opsTelemetry.js";
import { startQueueWorker } from "./lib/queueWorker.js";
import { getRun, getRunEnvelope, listRuns, saveRun } from "./lib/runStore.js";
import { registerRecorderRoutes } from "./lib/recorder.js";
import { captureLiveSessionScreenshot, getLiveSessionStatus } from "./lib/webEngine.js";
import type { EngineRunEnvelope } from "./contracts/qaira.js";

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
  logger: {
    level: process.env.LOG_LEVEL || "info"
  }
});

app.addHook("onRequest", async (request, reply) => {
  const origin = request.headers.origin;
  reply.header("access-control-allow-origin", typeof origin === "string" ? origin : "*");
  reply.header("access-control-allow-methods", "GET,POST,OPTIONS");
  reply.header("access-control-allow-headers", "content-type,x-qaira-recorder-token,authorization");
  reply.header("access-control-max-age", "600");

  if (request.method === "OPTIONS") {
    reply.code(204).send();
  }
});

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

app.get("/health", async () => ({
  ok: true,
  service: process.env.ENGINE_NAME || "QAira Test Engine",
  runner: process.env.TESTENGINE_WORKER_CLASS || "hybrid",
  ui: "qaira",
  execution_scope: process.env.TESTENGINE_WORKER_CLASS || "api+web+android",
  supported_web_engines: ["playwright", "selenium"],
  ops_telemetry: getOpsTelemetry().getHealthSnapshot()
}));

app.get("/api/v1/capabilities", async () => buildCapabilities());

app.get("/api/v1/live-session/screenshot", async (request, reply) => {
  const query = request.query as { provider?: string };
  const provider = query.provider === "selenium" ? "selenium" : "playwright";
  const screenshot = await captureLiveSessionScreenshot(provider);

  if (!screenshot) {
    reply.code(204);
    return "";
  }

  reply.header("Content-Type", "image/jpeg").header("Cache-Control", "no-store");
  return screenshot;
});

app.get("/api/v1/live-session", async (request, reply) => {
  const query = request.query as { provider?: string; format?: string };
  const provider = query.provider === "selenium" ? "selenium" : "playwright";

  if (provider === "playwright" && query.format !== "json") {
    const status = getLiveSessionStatus("playwright");
    const screenshotPath = "/api/v1/live-session/screenshot?provider=playwright";
    reply.header("Content-Type", "text/html; charset=utf-8");
    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>QAira Playwright Live View</title>
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
  <div class="bar"><strong>QAira Playwright live view</strong><span id="state">${status.available ? "Connected" : "Waiting for a Playwright run"}</span></div>
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
  const status = getLiveSessionStatus(provider);

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

app.get("/api/v1/runs", async () => ({
  items: listRuns()
}));

app.get("/api/v1/runs/:id", async (request, reply) => {
  const params = request.params as { id: string };
  const run = getRun(params.id);

  if (!run) {
    reply.code(404);
    return { message: "Run not found" };
  }

  return run;
});

app.post("/api/v1/runs", async (request, reply) => {
  const envelope = request.body as EngineRunEnvelope;

  if (!envelope?.engine_run_id || !envelope?.qaira_run_id || !envelope?.qaira_test_case_id) {
    reply.code(400);
    return { message: "engine_run_id, qaira_run_id, and qaira_test_case_id are required" };
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
  queueRunExecution(envelope, accepted, app.log);
  reply.code(202);
  return {
    id: accepted.id,
    state: accepted.state,
    summary: accepted.summary
  };
});

app.post("/api/v1/runs/:id/retry", async (request, reply) => {
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

  queueRunExecution(envelope, retried, app.log);

  reply.code(202);
  return retried;
});

const startServer = async () => {
  opsTelemetry = await createOpsTelemetry(app.log);
  await opsTelemetry.register(app);
  await registerRecorderRoutes(app);
  startQueueWorker(app.log, opsTelemetry);
  await app.listen({
    port,
    host: "0.0.0.0"
  });
};

startServer().catch((error) => {
  app.log.error(error);
  process.exit(1);
});
