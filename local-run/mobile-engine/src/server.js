import Fastify from "fastify";
import { remote } from "webdriverio";
import { randomUUID } from "crypto";

const port = Number(process.env.PORT || 4312);
const sessions = new Map();

const app = Fastify({ logger: { level: process.env.LOG_LEVEL || "info" } });

const normalizeText = (value) => String(value || "").trim();
const nowIso = () => new Date().toISOString();

const KEYWORDS = [
  "tap",
  "type",
  "clear",
  "swipe",
  "waitForDisplayed",
  "expectText",
  "pressBack",
  "pause"
];

function parseKeywordLine(line) {
  const trimmed = normalizeText(line);
  if (!trimmed || trimmed.startsWith("//")) return null;

  const match = trimmed.match(/^await\s+android\.(\w+)\((.*)\);?$/);
  if (!match) return null;

  const keyword = match[1];
  const argsSource = `[${match[2]}]`;
  try {
    const args = Function(`"use strict"; return (${argsSource});`)();
    return { keyword, args: Array.isArray(args) ? args : [] };
  } catch {
    return null;
  }
}

function parseKeywordScript(source) {
  return String(source || "")
    .split(/\r?\n/)
    .map(parseKeywordLine)
    .filter(Boolean);
}

function buildCapabilities(input = {}) {
  const provider = normalizeText(input.provider || process.env.MOBILE_PROVIDER || "local-appium");
  const config = input.config && typeof input.config === "object" ? input.config : {};
  const appiumServerUrl = normalizeText(input.appium_server_url || config.appium_server_url || process.env.APPIUM_SERVER_URL || "http://host.docker.internal:4723");
  const deviceName = normalizeText(input.device_name || config.device_name || process.env.ANDROID_DEVICE_NAME || "Android Device");
  const platformVersion = normalizeText(input.platform_version || config.platform_version || process.env.ANDROID_PLATFORM_VERSION);
  const appPath = normalizeText(input.app || config.app || process.env.ANDROID_APP);

  const capabilities = {
    platformName: "Android",
    "appium:automationName": "UiAutomator2",
    "appium:deviceName": deviceName,
    ...(platformVersion ? { "appium:platformVersion": platformVersion } : {}),
    ...(appPath ? { "appium:app": appPath } : {}),
    ...(config.app_package ? { "appium:appPackage": config.app_package } : {}),
    ...(config.app_activity ? { "appium:appActivity": config.app_activity } : {}),
    ...(config.no_reset !== undefined ? { "appium:noReset": Boolean(config.no_reset) } : { "appium:noReset": true })
  };

  if (provider === "saucelabs" || provider === "browserstack" || provider === "lambdatest") {
    return {
      provider,
      appiumServerUrl: normalizeText(input.remote_url || config.remote_url || process.env.MOBILE_REMOTE_URL) || appiumServerUrl,
      capabilities: {
        ...capabilities,
        ...(config.provider_options && typeof config.provider_options === "object" ? config.provider_options : {})
      }
    };
  }

  return { provider, appiumServerUrl, capabilities };
}

async function withDriver(input, fn) {
  const { appiumServerUrl, capabilities } = buildCapabilities(input);
  const parsed = new URL(appiumServerUrl);
  const driver = await remote({
    protocol: parsed.protocol.replace(":", ""),
    hostname: parsed.hostname,
    port: Number(parsed.port || (parsed.protocol === "https:" ? 443 : 80)),
    path: parsed.pathname && parsed.pathname !== "/" ? parsed.pathname : "/",
    capabilities
  });

  try {
    return await fn(driver);
  } finally {
    await driver.deleteSession().catch(() => undefined);
  }
}

async function executeKeyword(driver, command) {
  const [selector, value, extra] = command.args;
  switch (command.keyword) {
    case "tap":
      await driver.$(String(selector)).click();
      return { status: "passed", note: `Tapped ${selector}` };
    case "type":
      await driver.$(String(selector)).setValue(String(value || ""));
      return { status: "passed", note: `Typed into ${selector}` };
    case "clear":
      await driver.$(String(selector)).clearValue();
      return { status: "passed", note: `Cleared ${selector}` };
    case "waitForDisplayed":
      await driver.$(String(selector)).waitForDisplayed({ timeout: Number(value) || 10000 });
      return { status: "passed", note: `${selector} displayed` };
    case "expectText": {
      const text = await driver.$(String(selector)).getText();
      if (!String(text).includes(String(value || ""))) {
        throw new Error(`Expected ${selector} text to contain ${value}, received ${text}`);
      }
      return { status: "passed", note: `${selector} text matched` };
    }
    case "swipe":
      await driver.touchAction([
        { action: "press", x: Number(selector) || 500, y: Number(value) || 1500 },
        { action: "wait", ms: Number(extra) || 300 },
        { action: "moveTo", x: Number(command.args[3]) || 500, y: Number(command.args[4]) || 500 },
        "release"
      ]);
      return { status: "passed", note: "Swipe completed" };
    case "pressBack":
      await driver.back();
      return { status: "passed", note: "Pressed Android back" };
    case "pause":
      await driver.pause(Number(selector) || 1000);
      return { status: "passed", note: "Pause completed" };
    default:
      throw new Error(`Unsupported Android keyword ${command.keyword}`);
  }
}

app.get("/health", async () => ({
  ok: true,
  service: "qaira-mobile-engine",
  runner: "webdriverio+appium"
}));

app.get("/api/v1/capabilities", async () => ({
  runner: "mobile",
  supported_platforms: ["android"],
  supported_engines: ["webdriverio", "appium"],
  supported_providers: ["local-appium", "saucelabs", "lambdatest", "browserstack", "other"],
  android_keywords: KEYWORDS,
  recorder_modes: ["local", "remote"]
}));

app.post("/api/v1/mobile/execute", async (request) => {
  const payload = request.body || {};
  const steps = Array.isArray(payload.steps) ? payload.steps : [];
  const results = [];

  await withDriver(payload, async (driver) => {
    for (const step of steps) {
      const commands = parseKeywordScript(step.automation_code);
      if (!commands.length) {
        results.push({
          step_id: step.id,
          status: "blocked",
          note: "Android step has no executable android keyword script."
        });
        continue;
      }

      try {
        for (const command of commands) {
          await executeKeyword(driver, command);
        }
        results.push({ step_id: step.id, status: "passed", note: "Android step completed." });
      } catch (error) {
        results.push({
          step_id: step.id,
          status: "failed",
          note: error instanceof Error ? error.message : "Android step failed."
        });
        break;
      }
    }
  });

  return { status: results.some((item) => item.status === "failed") ? "failed" : results.some((item) => item.status === "blocked") ? "blocked" : "passed", results };
});

app.post("/api/v1/mobile/recorder/sessions", async (request) => {
  const payload = request.body || {};
  const id = randomUUID();
  const mode = normalizeText(payload.recorder_mode) === "remote" ? "remote" : "local";
  const session = {
    id,
    status: "running",
    recorder_mode: mode,
    display_mode: mode === "remote" ? "cloud-device" : "local-adb-device",
    action_count: 0,
    network_count: 0,
    actions: [],
    started_at: nowIso(),
    last_activity_at: nowIso(),
    live_view_url: `/api/v1/mobile/recorder/sessions/${id}/live`
  };
  sessions.set(id, session);
  return session;
});

app.get("/api/v1/mobile/recorder/sessions/:id", async (request, reply) => {
  const session = sessions.get(request.params.id);
  if (!session) {
    reply.code(404);
    return { message: "Mobile recorder session not found" };
  }
  return session;
});

app.get("/api/v1/mobile/recorder/sessions/:id/live", async (request, reply) => {
  const session = sessions.get(request.params.id);
  if (!session) {
    reply.code(404);
    return "Mobile recorder session not found";
  }
  reply.header("content-type", "text/html; charset=utf-8");
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>QAira Mobile Recorder</title><style>body{margin:0;background:#101827;color:#f8fafc;font-family:Inter,system-ui,sans-serif}.bar{padding:12px 14px;background:#172033;border-bottom:1px solid rgba(255,255,255,.14)}.stage{height:calc(100vh - 50px);display:grid;place-items:center;text-align:center;padding:24px}.device{width:min(380px,88vw);min-height:640px;border:10px solid #263246;border-radius:34px;background:#0b1220;display:grid;place-items:center;box-shadow:0 24px 80px rgba(0,0,0,.45)}code{color:#8bd3ff}</style></head><body><div class="bar"><strong>QAira Mobile Recorder</strong> · ${session.display_mode}</div><div class="stage"><div class="device"><div><h2>Connected Android device</h2><p>Use local ADB mirroring/scrcpy or your cloud provider live view to interact. QAira keeps this session open for captured Appium keyword import.</p><code>${session.id}</code></div></div></div></body></html>`;
});

app.post("/api/v1/mobile/recorder/sessions/:id/stop", async (request, reply) => {
  const session = sessions.get(request.params.id);
  if (!session) {
    reply.code(404);
    return { message: "Mobile recorder session not found" };
  }
  session.status = "stopped";
  session.last_activity_at = nowIso();
  sessions.set(session.id, session);
  return session;
});

app.listen({ port, host: "0.0.0.0" });
