import Fastify from "fastify";
import { remote } from "webdriverio";
import { randomUUID } from "crypto";

const port = Number(process.env.PORT || 4312);
const sessions = new Map();

const app = Fastify({ logger: { level: process.env.LOG_LEVEL || "info" } });

const normalizeText = (value) => String(value || "").trim();
const nowIso = () => new Date().toISOString();

const KEYWORDS = [
  "aiStep",
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

async function createSessionDriver(input) {
  const { appiumServerUrl, capabilities } = buildCapabilities(input);
  const parsed = new URL(appiumServerUrl);
  return remote({
    protocol: parsed.protocol.replace(":", ""),
    hostname: parsed.hostname,
    port: Number(parsed.port || (parsed.protocol === "https:" ? 443 : 80)),
    path: parsed.pathname && parsed.pathname !== "/" ? parsed.pathname : "/",
    capabilities
  });
}

function recordAction(session, action) {
  const next = {
    index: session.actions.length + 1,
    timestamp: nowIso(),
    ...action
  };
  session.actions.push(next);
  session.action_count = session.actions.length;
  session.last_activity_at = next.timestamp;
  sessions.set(session.id, session);
  return next;
}

async function executeKeyword(driver, command) {
  const [selector, value, extra] = command.args;
  switch (command.keyword) {
    case "aiStep":
      return { status: "passed", note: `AI step noted: ${selector || value || "instruction"}` };
    case "tap":
      if (String(selector).startsWith("point:")) {
        const [x, y] = String(selector).replace(/^point:/, "").split(",").map((item) => Number(item.trim()) || 0);
        await driver.action("pointer").move({ x, y }).down().up().perform();
      } else {
        await driver.$(String(selector)).click();
      }
      return { status: "passed", note: `Tapped ${selector}` };
    case "type":
      if (String(selector) === "focused") {
        await driver.keys(String(value || ""));
      } else {
        await driver.$(String(selector)).setValue(String(value || ""));
      }
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
    live_view_url: `/api/v1/mobile/recorder/sessions/${id}/live`,
    driver: null,
    driver_error: null
  };
  sessions.set(id, session);
  createSessionDriver(payload)
    .then((driver) => {
      const current = sessions.get(id);
      if (!current || current.status !== "running") {
        return driver.deleteSession().catch(() => undefined);
      }
      current.driver = driver;
      current.last_activity_at = nowIso();
      sessions.set(id, current);
    })
    .catch((error) => {
      const current = sessions.get(id);
      if (!current) return;
      current.driver_error = error instanceof Error ? error.message : "Unable to connect to Appium.";
      current.last_activity_at = nowIso();
      sessions.set(id, current);
    });
  return session;
});

app.get("/api/v1/mobile/recorder/sessions/:id", async (request, reply) => {
  const session = sessions.get(request.params.id);
  if (!session) {
    reply.code(404);
    return { message: "Mobile recorder session not found" };
  }
  const { driver, ...serializableSession } = session;
  return serializableSession;
});

app.get("/api/v1/mobile/recorder/sessions/:id/live", async (request, reply) => {
  const session = sessions.get(request.params.id);
  if (!session) {
    reply.code(404);
    return "Mobile recorder session not found";
  }
  reply.header("content-type", "text/html; charset=utf-8");
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>QAira Mobile Recorder</title><style>body{margin:0;background:#101827;color:#f8fafc;font-family:Inter,system-ui,sans-serif}.bar{padding:12px 14px;background:#172033;border-bottom:1px solid rgba(255,255,255,.14);display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}.stage{min-height:calc(100vh - 58px);display:grid;place-items:center;padding:18px}.device{width:min(390px,94vw);aspect-ratio:9/19.5;border:10px solid #263246;border-radius:34px;background:#0b1220;display:grid;place-items:center;box-shadow:0 24px 80px rgba(0,0,0,.45);overflow:hidden;position:relative}.device img{width:100%;height:100%;object-fit:contain;background:#000}.empty{padding:22px;text-align:center;color:#cbd5e1}.controls{position:fixed;left:0;right:0;bottom:0;display:flex;gap:8px;padding:10px;background:rgba(16,24,39,.92);border-top:1px solid rgba(255,255,255,.14)}input{flex:1;min-width:0;border:1px solid rgba(255,255,255,.18);border-radius:8px;background:#0b1220;color:#fff;padding:10px}button{border:1px solid rgba(255,255,255,.18);border-radius:8px;background:#2563eb;color:#fff;padding:10px 12px;font-weight:700}code{color:#8bd3ff}</style></head><body><div class="bar"><strong>QAira Mobile Recorder</strong><span>${session.display_mode} · <code>${session.id}</code></span></div><div class="stage"><div class="device" id="device"><img id="screen" alt="" /><div class="empty" id="empty">Connecting to Appium/scrcpy-style browser view...</div></div></div><div class="controls"><input id="text" placeholder="Type text on focused field" /><button id="type">Type</button><button id="back">Back</button></div><script>
const sessionId=${JSON.stringify(session.id)};
const screen=document.getElementById("screen");
const empty=document.getElementById("empty");
const device=document.getElementById("device");
const withPath=(path)=>"/api/v1/mobile/recorder/sessions/"+encodeURIComponent(sessionId)+path;
async function refresh(){try{const response=await fetch(withPath("/screenshot")+"?t="+Date.now(),{cache:"no-store"});if(!response.ok)throw new Error(await response.text());const blob=await response.blob();screen.src=URL.createObjectURL(blob);screen.style.display="block";empty.style.display="none";}catch(error){screen.style.display="none";empty.style.display="block";empty.textContent=String(error.message||error||"Waiting for device screenshot");}}
async function send(payload){await fetch(withPath("/input"),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});setTimeout(refresh,250);}
device.addEventListener("click",(event)=>{const rect=device.getBoundingClientRect();send({type:"tap",x:Math.round(event.clientX-rect.left),y:Math.round(event.clientY-rect.top),width:Math.round(rect.width),height:Math.round(rect.height)});});
document.getElementById("type").addEventListener("click",()=>{const value=document.getElementById("text").value;send({type:"type",value});});
document.getElementById("back").addEventListener("click",()=>send({type:"pressBack"}));
refresh();setInterval(refresh,1000);
</script></body></html>`;
});

app.get("/api/v1/mobile/recorder/sessions/:id/screenshot", async (request, reply) => {
  const session = sessions.get(request.params.id);
  if (!session) {
    reply.code(404);
    return "Mobile recorder session not found";
  }
  if (!session.driver) {
    reply.code(503);
    return session.driver_error || "Waiting for Appium device connection";
  }
  try {
    const image = await session.driver.takeScreenshot();
    reply.header("content-type", "image/png");
    return Buffer.from(image, "base64");
  } catch (error) {
    reply.code(500);
    return error instanceof Error ? error.message : "Unable to capture screenshot";
  }
});

app.post("/api/v1/mobile/recorder/sessions/:id/input", async (request, reply) => {
  const session = sessions.get(request.params.id);
  if (!session) {
    reply.code(404);
    return { message: "Mobile recorder session not found" };
  }
  const payload = request.body || {};
  try {
    if (payload.type === "tap") {
      const size = session.driver ? await session.driver.getWindowSize().catch(() => null) : null;
      const x = Math.round(Number(payload.x) * (Number(size?.width) || Number(payload.width) || 1) / (Number(payload.width) || 1));
      const y = Math.round(Number(payload.y) * (Number(size?.height) || Number(payload.height) || 1) / (Number(payload.height) || 1));
      if (session.driver) {
        await session.driver.action("pointer").move({ x, y }).down().up().perform();
      }
      return { action: recordAction(session, { type: "tap", x, y, locator: `point:${x},${y}` }) };
    }
    if (payload.type === "type") {
      const value = String(payload.value || "");
      if (session.driver) {
        await session.driver.keys(value);
      }
      return { action: recordAction(session, { type: "type", value }) };
    }
    if (payload.type === "pressBack") {
      if (session.driver) {
        await session.driver.back();
      }
      return { action: recordAction(session, { type: "pressBack" }) };
    }
    reply.code(400);
    return { message: "Unsupported mobile recorder input type" };
  } catch (error) {
    reply.code(500);
    return { message: error instanceof Error ? error.message : "Unable to send mobile recorder input" };
  }
});

app.post("/api/v1/mobile/recorder/sessions/:id/stop", async (request, reply) => {
  const session = sessions.get(request.params.id);
  if (!session) {
    reply.code(404);
    return { message: "Mobile recorder session not found" };
  }
  session.status = "stopped";
  session.last_activity_at = nowIso();
  await session.driver?.deleteSession().catch(() => undefined);
  session.driver = null;
  sessions.set(session.id, session);
  const { driver, ...serializableSession } = session;
  return serializableSession;
});

app.listen({ port, host: "0.0.0.0" });
