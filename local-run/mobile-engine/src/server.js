import Fastify from "fastify";
import { remote } from "webdriverio";
import { randomUUID } from "crypto";
import { readFile } from "fs/promises";

const port = Number(process.env.PORT || 4312);
const sessions = new Map();

const app = Fastify({ logger: { level: process.env.LOG_LEVEL || "info" } });

const normalizeText = (value) => String(value || "").trim();
const nowIso = () => new Date().toISOString();
const escapeUiSelectorText = (value) => String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');

async function remoteFileToBase64(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Unable to download remote mobile file: ${response.status} ${response.statusText}`);
  }
  return Buffer.from(await response.arrayBuffer()).toString("base64");
}

async function localFileToBase64(value) {
  const normalized = normalizeText(value);
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(normalized) && normalized.length > 64) {
    return normalized;
  }
  return (await readFile(normalized)).toString("base64");
}

const KEYWORDS = [
  "aiStep",
  "step",
  "tap",
  "tapPoint",
  "doubleTap",
  "longPress",
  "type",
  "clear",
  "hideKeyboard",
  "swipe",
  "waitForDisplayed",
  "waitForExist",
  "waitForEnabled",
  "tapByText",
  "expectText",
  "expectDisplayed",
  "expectNotDisplayed",
  "expectEnabled",
  "expectValue",
  "scrollIntoView",
  "pushFile",
  "pushRemoteFile",
  "pullFile",
  "installApp",
  "removeApp",
  "startActivity",
  "openDeepLink",
  "deepLink",
  "pressBack",
  "pressKeyCode",
  "backgroundApp",
  "activateApp",
  "terminateApp",
  "setOrientation",
  "pause"
];

function parseKeywordLine(line) {
  const trimmed = normalizeText(line);
  if (!trimmed || trimmed.startsWith("//")) return null;

  const match = trimmed.match(/^await\s+android\.(\w+)\((.*)\);?$/);
  if (!match) return null;

  const keyword = match[1];
  if (keyword === "step") return null;
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

  if (provider === "saucelabs" || provider === "browserstack" || provider === "lambdatest" || provider === "crossbrowser") {
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

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

function parsePoint(value) {
  const normalized = normalizeText(value).replace(/^point:/i, "");
  const [x, y] = normalized.split(",").map((item) => Number(item.trim()) || 0);
  return { x, y };
}

function normalizeRepositoryKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/page\b/g, "")
    .replace(/[^a-z0-9.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildRepositoryResolver(entries = []) {
  const locatorValue = (value) => {
    if (typeof value === "string") return normalizeText(value);
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return normalizeText(value.locator || value.selector || value.value);
    }
    return "";
  };
  const normalizedEntries = (Array.isArray(entries) ? entries : [])
    .filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry))
    .map((entry) => {
      const metadata = entry.metadata && typeof entry.metadata === "object" && !Array.isArray(entry.metadata) ? entry.metadata : {};
      const fallbackLocators = [
        ...(Array.isArray(entry.fallback_locators) ? entry.fallback_locators : []),
        ...(Array.isArray(metadata.fallback_locators) ? metadata.fallback_locators : []),
        ...(Array.isArray(metadata.locator_candidates) ? metadata.locator_candidates : [])
      ].map(locatorValue).filter(Boolean);
      return {
        locator: normalizeText(entry.locator),
        candidates: [
          entry.locator,
          entry.locator_intent,
          entry.object_name,
          entry.screen_name && entry.object_name ? `${entry.screen_name}.${entry.object_name}` : null,
          entry.page_key && entry.object_name ? `${entry.page_key}.${entry.object_name}` : null,
          entry.screen_name && entry.locator_intent ? `${entry.screen_name}.${entry.locator_intent}` : null,
          entry.page_key && entry.locator_intent ? `${entry.page_key}.${entry.locator_intent}` : null,
          ...(Array.isArray(entry.previous_locators) ? entry.previous_locators : []),
          ...fallbackLocators
        ].map(normalizeRepositoryKey).filter(Boolean)
      };
    })
    .filter((entry) => entry.locator);

  return (selector) => {
    const raw = String(selector || "");
    const key = normalizeRepositoryKey(raw);
    const match = normalizedEntries.find((entry) => entry.candidates.includes(key));
    return match?.locator || raw;
  };
}

function createDriverFacade(driver, resolveSelector) {
  return new Proxy(driver, {
    get(target, prop) {
      if (prop === "$") {
        return (selector) => target.$(resolveSelector(selector));
      }
      const value = target[prop];
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
}

async function tapPoint(driver, point) {
  await driver.action("pointer").move(point).down().up().perform();
}

async function resolveElementCenter(driver, selector, resolveSelector = (value) => value) {
  const resolvedSelector = resolveSelector(selector);

  if (String(resolvedSelector).startsWith("point:")) {
    return parsePoint(resolvedSelector);
  }

  const element = await driver.$(String(resolvedSelector));
  const location = await element.getLocation();
  const size = await element.getSize();
  return {
    x: Math.round(location.x + size.width / 2),
    y: Math.round(location.y + size.height / 2),
    element
  };
}

async function executeCodedAndroidScript(driver, source, resolveSelector = (value) => value) {
  const driverFacade = createDriverFacade(driver, resolveSelector);
  const android = buildAndroidApi(driverFacade, resolveSelector);
  const $ = (selector) => driverFacade.$(selector);
  const fn = new AsyncFunction("android", "driver", "browser", "$", "params", "capture", source);
  const captures = {};
  const capture = (key, value) => {
    captures[String(key || "").replace(/^@?[trs]\./, "") || `capture_${Object.keys(captures).length + 1}`] = String(value ?? "");
  };
  await fn(android, driverFacade, driverFacade, $, {}, capture);
  return captures;
}

async function executeKeyword(driver, command, resolveSelector = (value) => value) {
  const [selector, value, extra] = command.args;
  const resolvedSelector = selector !== undefined && selector !== null ? resolveSelector(selector) : selector;
  switch (command.keyword) {
    case "step":
      if (typeof value === "function") {
        await value();
      }
      return { status: "passed", note: `Completed Android step ${selector || ""}`.trim() };
    case "aiStep":
      return { status: "passed", note: `AI step noted: ${selector || value || "instruction"}` };
    case "tap":
      if (String(resolvedSelector).startsWith("point:")) {
        await tapPoint(driver, parsePoint(resolvedSelector));
      } else {
        await driver.$(String(resolvedSelector)).click();
      }
      return { status: "passed", note: `Tapped ${selector}` };
    case "tapByText": {
      const text = String(selector || value || "");
      const selectorText = `android=new UiSelector().textContains("${escapeUiSelectorText(text)}")`;
      await driver.$(selectorText).click();
      return { status: "passed", note: `Tapped text ${text}` };
    }
    case "tapPoint":
      await tapPoint(driver, parsePoint(resolvedSelector));
      return { status: "passed", note: `Tapped point ${selector}` };
    case "doubleTap":
      if (String(resolvedSelector).startsWith("point:")) {
        const point = parsePoint(resolvedSelector);
        await tapPoint(driver, point);
        await driver.pause(80);
        await tapPoint(driver, point);
      } else {
        const element = await driver.$(String(resolvedSelector));
        await element.click();
        await driver.pause(80);
        await element.click();
      }
      return { status: "passed", note: `Double tapped ${selector}` };
    case "longPress": {
      const resolved = await resolveElementCenter(driver, selector, resolveSelector);
      await driver.action("pointer").move({ x: resolved.x, y: resolved.y }).down().pause(Number(value) || 800).up().perform();
      return { status: "passed", note: `Long pressed ${selector}` };
    }
    case "type":
      if (String(selector) === "focused") {
        await driver.keys(String(value || ""));
      } else {
        await driver.$(String(resolvedSelector)).setValue(String(value || ""));
      }
      return { status: "passed", note: `Typed into ${selector}` };
    case "clear":
      await driver.$(String(resolvedSelector)).clearValue();
      return { status: "passed", note: `Cleared ${selector}` };
    case "hideKeyboard":
      await driver.hideKeyboard().catch(() => undefined);
      return { status: "passed", note: "Keyboard hidden" };
    case "waitForDisplayed":
      await driver.$(String(resolvedSelector)).waitForDisplayed({ timeout: Number(value) || 10000 });
      return { status: "passed", note: `${selector} displayed` };
    case "waitForExist":
      await driver.$(String(resolvedSelector)).waitForExist({ timeout: Number(value) || 10000 });
      return { status: "passed", note: `${selector} exists` };
    case "waitForEnabled": {
      const element = await driver.$(String(resolvedSelector));
      await driver.waitUntil(async () => element.isEnabled(), {
        timeout: Number(value) || 10000,
        timeoutMsg: `${selector} was not enabled`
      });
      return { status: "passed", note: `${selector} enabled` };
    }
    case "expectText": {
      const text = await driver.$(String(resolvedSelector)).getText();
      if (!String(text).includes(String(value || ""))) {
        throw new Error(`Expected ${selector} text to contain ${value}, received ${text}`);
      }
      return { status: "passed", note: `${selector} text matched` };
    }
    case "expectDisplayed": {
      const displayed = await driver.$(String(resolvedSelector)).isDisplayed();
      if (!displayed) throw new Error(`Expected ${selector} to be displayed`);
      return { status: "passed", note: `${selector} is displayed` };
    }
    case "expectNotDisplayed": {
      const element = await driver.$(String(resolvedSelector));
      await element.waitForDisplayed({ timeout: Number(value) || 10000, reverse: true });
      return { status: "passed", note: `${selector} is not displayed` };
    }
    case "expectEnabled": {
      const enabled = await driver.$(String(resolvedSelector)).isEnabled();
      if (!enabled) throw new Error(`Expected ${selector} to be enabled`);
      return { status: "passed", note: `${selector} is enabled` };
    }
    case "expectValue": {
      const element = await driver.$(String(resolvedSelector));
      const actual = await element.getAttribute("value").catch(() => null) || await element.getText().catch(() => "");
      if (!String(actual).includes(String(value || ""))) {
        throw new Error(`Expected ${selector} value to contain ${value}, received ${actual}`);
      }
      return { status: "passed", note: `${selector} value matched` };
    }
    case "swipe":
      {
        const [startX, startY, endX, endY, duration] = command.args.map((item) => Number(item) || 0);
        await driver.touchAction([
          { action: "press", x: startX || 500, y: startY || 1500 },
          { action: "wait", ms: duration || 300 },
          { action: "moveTo", x: endX || 500, y: endY || 500 },
          "release"
        ]);
      }
      return { status: "passed", note: "Swipe completed" };
    case "scrollIntoView": {
      const direction = /^(up|left)$/i.test(String(value || "")) ? "up" : "down";
      const maxScrolls = Number(extra?.maxScrolls || extra) || 6;
      for (let index = 0; index < maxScrolls; index += 1) {
        const element = await driver.$(String(resolvedSelector));
        if (await element.isDisplayed().catch(() => false)) {
          return { status: "passed", note: `${selector} scrolled into view` };
        }
        const size = await driver.getWindowSize();
        const startY = direction === "down" ? Math.round(size.height * 0.75) : Math.round(size.height * 0.25);
        const endY = direction === "down" ? Math.round(size.height * 0.25) : Math.round(size.height * 0.75);
        await driver.touchAction([
          { action: "press", x: Math.round(size.width / 2), y: startY },
          { action: "wait", ms: 250 },
          { action: "moveTo", x: Math.round(size.width / 2), y: endY },
          "release"
        ]);
      }
      throw new Error(`Unable to scroll ${selector} into view`);
    }
    case "pushFile": {
      const remotePath = String(selector || "");
      const base64 = await localFileToBase64(value);
      await driver.pushFile(remotePath, base64);
      return { status: "passed", note: `Pushed file to ${remotePath}` };
    }
    case "pushRemoteFile": {
      const remotePath = String(selector || "");
      const base64 = await remoteFileToBase64(value);
      await driver.pushFile(remotePath, base64);
      return { status: "passed", note: `Pushed remote file to ${remotePath}` };
    }
    case "pullFile": {
      const remotePath = String(selector || "");
      const content = await driver.pullFile(remotePath);
      return { status: "passed", note: `Pulled file ${remotePath}`, value: content };
    }
    case "installApp":
      await driver.installApp(String(selector || value || ""));
      return { status: "passed", note: `Installed app ${selector || value}` };
    case "removeApp":
      await driver.removeApp(String(selector || value || ""));
      return { status: "passed", note: `Removed app ${selector || value}` };
    case "startActivity": {
      const appPackage = String(selector || extra?.appPackage || "");
      const appActivity = String(value || extra?.appActivity || "");
      if (typeof driver.startActivity === "function") {
        await driver.startActivity(appPackage, appActivity);
      } else {
        await driver.execute("mobile: startActivity", { appPackage, appActivity });
      }
      return { status: "passed", note: `Started activity ${appPackage}/${appActivity}` };
    }
    case "openDeepLink":
    case "deepLink": {
      const url = String(selector || "");
      const appPackage = String(value || extra?.package || extra?.appPackage || "");
      try {
        await driver.execute("mobile: deepLink", { url, package: appPackage || undefined });
      } catch {
        await driver.url(url);
      }
      return { status: "passed", note: `Opened deep link ${url}` };
    }
    case "pressBack":
      await driver.back();
      return { status: "passed", note: "Pressed Android back" };
    case "pressKeyCode":
      await driver.pressKeyCode(Number(selector) || Number(value) || 0);
      return { status: "passed", note: `Pressed Android key code ${selector || value}` };
    case "backgroundApp":
      await driver.background(Number(selector) || Number(value) || 3);
      return { status: "passed", note: "Backgrounded app" };
    case "activateApp":
      await driver.activateApp(String(selector));
      return { status: "passed", note: `Activated app ${selector}` };
    case "terminateApp":
      await driver.terminateApp(String(selector));
      return { status: "passed", note: `Terminated app ${selector}` };
    case "setOrientation":
      await driver.setOrientation(/landscape/i.test(String(selector)) ? "LANDSCAPE" : "PORTRAIT");
      return { status: "passed", note: `Set orientation ${selector}` };
    case "pause":
      await driver.pause(Number(selector) || 1000);
      return { status: "passed", note: "Pause completed" };
    default:
      throw new Error(`Unsupported Android keyword ${command.keyword}`);
  }
}

function buildAndroidApi(driver, resolveSelector = (value) => value) {
  const run = (keyword, args) => executeKeyword(driver, { keyword, args }, resolveSelector);
  return {
    step: async (_name, fn) => (typeof fn === "function" ? fn() : undefined),
    aiStep: (instruction, options) => run("aiStep", [instruction, options]),
    tap: (selector, options) => run("tap", [selector, options]),
    tapByText: (text, options) => run("tapByText", [text, options]),
    tapPoint: (point, options) => run("tapPoint", [point, options]),
    doubleTap: (selector, options) => run("doubleTap", [selector, options]),
    longPress: (selector, durationMs, options) => run("longPress", [selector, durationMs, options]),
    type: (selector, value, options) => run("type", [selector, value, options]),
    clear: (selector, options) => run("clear", [selector, options]),
    hideKeyboard: () => run("hideKeyboard", []),
    waitForDisplayed: (selector, timeoutMs, options) => run("waitForDisplayed", [selector, timeoutMs, options]),
    waitForExist: (selector, timeoutMs, options) => run("waitForExist", [selector, timeoutMs, options]),
    waitForEnabled: (selector, timeoutMs, options) => run("waitForEnabled", [selector, timeoutMs, options]),
    expectText: (selector, value, options) => run("expectText", [selector, value, options]),
    expectDisplayed: (selector, options) => run("expectDisplayed", [selector, options]),
    expectNotDisplayed: (selector, timeoutMs) => run("expectNotDisplayed", [selector, timeoutMs]),
    expectEnabled: (selector, options) => run("expectEnabled", [selector, options]),
    expectValue: (selector, value, options) => run("expectValue", [selector, value, options]),
    swipe: (startX, startY, endX, endY, durationMs) => run("swipe", [startX, startY, endX, endY, durationMs]),
    scrollIntoView: (selector, options) => run("scrollIntoView", [selector, options?.direction, options]),
    pushFile: (remotePath, localPathOrBase64, options) => run("pushFile", [remotePath, localPathOrBase64, options]),
    pushRemoteFile: (remotePath, url, options) => run("pushRemoteFile", [remotePath, url, options]),
    pullFile: (remotePath, options) => run("pullFile", [remotePath, options]),
    installApp: (appPath) => run("installApp", [appPath]),
    removeApp: (appId) => run("removeApp", [appId]),
    startActivity: (appPackage, appActivity, options) => run("startActivity", [appPackage, appActivity, options]),
    openDeepLink: (url, appPackage, options) => run("openDeepLink", [url, appPackage, options]),
    deepLink: (url, appPackage, options) => run("deepLink", [url, appPackage, options]),
    pressBack: () => run("pressBack", []),
    pressKeyCode: (code) => run("pressKeyCode", [code]),
    backgroundApp: (seconds) => run("backgroundApp", [seconds]),
    activateApp: (appId) => run("activateApp", [appId]),
    terminateApp: (appId) => run("terminateApp", [appId]),
    setOrientation: (orientation) => run("setOrientation", [orientation]),
    pause: (ms) => run("pause", [ms])
  };
}

app.get("/health", async () => ({
  ok: true,
  service: "hellotest-mobile-engine",
  runner: "webdriverio+appium"
}));

app.get("/api/v1/capabilities", async () => ({
  runner: "mobile",
  supported_platforms: ["android"],
  supported_engines: ["webdriverio", "appium"],
  supported_providers: ["local-appium", "saucelabs", "lambdatest", "browserstack", "crossbrowser", "other"],
  android_keywords: KEYWORDS,
  recorder_modes: ["local", "remote"]
}));

app.post("/api/v1/mobile/execute", async (request) => {
  const payload = request.body || {};
  const steps = Array.isArray(payload.steps) ? payload.steps : [];
  const resolveSelector = buildRepositoryResolver(payload.object_repository || payload.objectRepository || []);
  const results = [];

  await withDriver(payload, async (driver) => {
    for (const step of steps) {
      const commands = parseKeywordScript(step.automation_code);
      const source = String(step.automation_code || "").trim();
      if (!commands.length && !source) {
        results.push({
          step_id: step.id,
          status: "blocked",
          note: "Android step has no executable android keyword script."
        });
        continue;
      }

      try {
        if (commands.length) {
          for (const command of commands) {
            await executeKeyword(driver, command, resolveSelector);
          }
        } else {
          await executeCodedAndroidScript(driver, source, resolveSelector);
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
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>HelloTest Mobile Recorder</title><style>body{margin:0;background:#101827;color:#f8fafc;font-family:Inter,system-ui,sans-serif}.bar{padding:12px 14px;background:#172033;border-bottom:1px solid rgba(255,255,255,.14);display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}.stage{min-height:calc(100vh - 58px);display:grid;place-items:center;padding:18px}.device{width:min(390px,94vw);aspect-ratio:9/19.5;border:10px solid #263246;border-radius:34px;background:#0b1220;display:grid;place-items:center;box-shadow:0 24px 80px rgba(0,0,0,.45);overflow:hidden;position:relative}.device img{width:100%;height:100%;object-fit:contain;background:#000}.empty{padding:22px;text-align:center;color:#cbd5e1}.controls{position:fixed;left:0;right:0;bottom:0;display:flex;gap:8px;padding:10px;background:rgba(16,24,39,.92);border-top:1px solid rgba(255,255,255,.14)}input{flex:1;min-width:0;border:1px solid rgba(255,255,255,.18);border-radius:8px;background:#0b1220;color:#fff;padding:10px}button{border:1px solid rgba(255,255,255,.18);border-radius:8px;background:#2563eb;color:#fff;padding:10px 12px;font-weight:700}code{color:#8bd3ff}</style></head><body><div class="bar"><strong>HelloTest Mobile Recorder</strong><span>${session.display_mode} · <code>${session.id}</code></span></div><div class="stage"><div class="device" id="device"><img id="screen" alt="" /><div class="empty" id="empty">Connecting to Appium/scrcpy-style browser view...</div></div></div><div class="controls"><input id="text" placeholder="Type text on focused field" /><button id="type">Type</button><button id="back">Back</button></div><script>
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
