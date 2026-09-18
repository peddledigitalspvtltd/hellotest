import Fastify from "fastify";
import { remote } from "webdriverio";
import { randomUUID } from "crypto";
import { readFile } from "fs/promises";
import { resolve } from "path";
import { fileURLToPath } from "url";
import {
  buildMobileParameterValues,
  interpolateMobileText,
  interpolateMobileValue,
  normalizeMobileParameterKey
} from "./parameters.js";
import {
  createGracefulShutdown,
  probeProviderReadiness,
  remoteFileToBase64,
  resolveOperationalLimits
} from "./operational.js";
import {
  createMobileEngineRouteGuard,
  digestRecorderSessionToken,
  generateRecorderSessionToken,
  MOBILE_SESSION_TOKEN_HEADER,
  resolveMobileEngineSecurity
} from "./security.js";

const port = Number(process.env.PORT || 4312);
const sessions = new Map();
const pendingScreenshots = new WeakMap();
const lifecycleState = { shuttingDown: false };
const requiresProviderReadiness = () => ["1", "true", "yes", "on"]
  .includes(String(process.env.MOBILE_REQUIRE_PROVIDER_READY || "false").trim().toLowerCase());

const mobileEngineSecurity = resolveMobileEngineSecurity();
const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || "info",
    serializers: {
      req: (request) => ({
        method: request.method,
        url: String(request.url || "").split("?", 1)[0],
        hostname: request.headers?.host,
        remoteAddress: request.socket?.remoteAddress,
        remotePort: request.socket?.remotePort
      })
    }
  }
});

const normalizeText = (value) => String(value || "").trim();
const nowIso = () => new Date().toISOString();
const escapeUiSelectorText = (value) => String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');

const resolveRecorderSessionId = (request) => {
  const configured = normalizeText(request.params?.id);
  if (configured) return configured;
  const path = String(request.raw?.url || request.url || "").split("?", 1)[0];
  const match = path.match(/^\/api\/v1\/mobile\/recorder\/sessions\/([^/]+)/);
  if (!match) return "";
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return "";
  }
};

app.addHook("onRequest", createMobileEngineRouteGuard({
  security: mobileEngineSecurity,
  resolveSessionTokenDigest: (request) => sessions.get(resolveRecorderSessionId(request))?.sessionTokenDigest
}));

const buildRecorderSessionResponse = (session, sessionToken = "") => {
  const { driver, sessionTokenDigest, ...serializableSession } = session;
  const tokenQuery = sessionToken ? `?session_token=${encodeURIComponent(sessionToken)}` : "";
  return {
    ...serializableSession,
    status_url: `/api/v1/mobile/recorder/sessions/${encodeURIComponent(session.id)}${tokenQuery}`,
    live_view_url: `/api/v1/mobile/recorder/sessions/${encodeURIComponent(session.id)}/live${tokenQuery}`
  };
};

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

function buildCapabilities(input = {}) {
  const provider = normalizeText(input.provider || process.env.MOBILE_PROVIDER || "local-appium").toLowerCase();
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
    // WebDriver protocol logs include typed values; scoped secrets stay in requests.
    logLevel: "silent",
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
    logLevel: "silent",
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

const numericArgument = (value, fallback) => {
  if (value === null || value === undefined || String(value).trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

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

async function executeCodedAndroidScript(driver, source, resolveSelector, params) {
  const driverFacade = createDriverFacade(driver, (selector) => resolveSelector(interpolateMobileText(selector, params)));
  const android = buildAndroidApi(driver, resolveSelector, params);
  const $ = (selector) => driverFacade.$(selector);
  const fn = new AsyncFunction("android", "driver", "browser", "$", "params", "capture", source);
  const captures = {};
  const capture = (key, value) => {
    const normalizedKey = normalizeMobileParameterKey(key) || `capture_${Object.keys(captures).length + 1}`;
    const normalizedValue = String(value ?? "");
    captures[normalizedKey] = normalizedValue;
    params[normalizedKey] = normalizedValue;
    if (!normalizedKey.includes(".")) params[`t.${normalizedKey}`] = normalizedValue;
  };
  await fn(android, driverFacade, driverFacade, $, params, capture);
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
      await driver.action("pointer").move({ x: resolved.x, y: resolved.y }).down().pause(numericArgument(value, 800)).up().perform();
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
      await driver.$(String(resolvedSelector)).waitForDisplayed({ timeout: numericArgument(value, 10000) });
      return { status: "passed", note: `${selector} displayed` };
    case "waitForExist":
      await driver.$(String(resolvedSelector)).waitForExist({ timeout: numericArgument(value, 10000) });
      return { status: "passed", note: `${selector} exists` };
    case "waitForEnabled": {
      const element = await driver.$(String(resolvedSelector));
      await driver.waitUntil(async () => element.isEnabled(), {
        timeout: numericArgument(value, 10000),
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
      await element.waitForDisplayed({ timeout: numericArgument(value, 10000), reverse: true });
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
        const [startX, startY, endX, endY, duration] = command.args;
        await driver.touchAction([
          { action: "press", x: numericArgument(startX, 500), y: numericArgument(startY, 1500) },
          { action: "wait", ms: numericArgument(duration, 300) },
          { action: "moveTo", x: numericArgument(endX, 500), y: numericArgument(endY, 500) },
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
      await driver.background(numericArgument(selector ?? value, 3));
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
      await driver.pause(numericArgument(selector, 1000));
      return { status: "passed", note: "Pause completed" };
    default:
      throw new Error(`Unsupported Android keyword ${command.keyword}`);
  }
}

function buildAndroidApi(driver, resolveSelector, params) {
  const run = (keyword, args) => executeKeyword(driver, {
    keyword,
    args: args.map((value) => interpolateMobileValue(value, params))
  }, resolveSelector);
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

const compatibleHealth = () => ({
  ok: true,
  service: "hellotest-mobile-engine",
  runner: "webdriverio+appium"
});

app.get("/health", async (_request, reply) => {
  reply.header("cache-control", "no-store");
  return compatibleHealth();
});

app.get("/health/live", async (_request, reply) => {
  reply.header("cache-control", "no-store");
  return {
    ...compatibleHealth(),
    status: lifecycleState.shuttingDown ? "stopping" : "live"
  };
});

app.get("/health/ready", async (_request, reply) => {
  reply.header("cache-control", "no-store");
  const { provider, appiumServerUrl } = buildCapabilities();
  if (lifecycleState.shuttingDown) {
    reply.code(503);
    return {
      ...compatibleHealth(),
      ok: false,
      status: "not_ready",
      provider,
      checks: {
        lifecycle: { required: true, status: "stopping" }
      }
    };
  }

  const readiness = await probeProviderReadiness(
    { provider, appiumServerUrl },
    { timeoutMs: resolveOperationalLimits().readinessTimeoutMs }
  );
  const providerRequired = requiresProviderReadiness();
  const serviceReady = readiness.ok || !providerRequired;
  reply.code(serviceReady ? 200 : 503);
  return {
    ...compatibleHealth(),
    ok: serviceReady,
    status: readiness.ok ? "ready" : (serviceReady ? "degraded" : readiness.status),
    provider: readiness.provider,
    checks: {
      provider: {
        ...readiness.dependency,
        required: providerRequired
      }
    }
  };
});

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
  return withDriver(payload, (driver) => executeAndroidStepsWithDriver(driver, payload));
});

export async function executeAndroidStepsWithDriver(driver, payload = {}) {
  const steps = Array.isArray(payload.steps) ? payload.steps : [];
  const params = buildMobileParameterValues(payload.parameter_values);
  const repositoryResolver = buildRepositoryResolver(payload.object_repository || payload.objectRepository || []);
  const resolveSelector = (selector) => {
    const resolved = repositoryResolver(selector);
    return resolved === String(selector || "") ? resolved : interpolateMobileText(resolved, params);
  };
  const results = [];

  for (const step of steps) {
    const source = String(step.automation_code || "").trim();
    if (!source) {
      results.push({
        step_id: step.id,
        status: "blocked",
        note: "Android step has no executable android keyword script."
      });
      break;
    }

    try {
      const captures = await executeCodedAndroidScript(driver, source, resolveSelector, params);
      results.push({ step_id: step.id, status: "passed", note: "Android step completed.", captures });
    } catch (error) {
      results.push({
        step_id: step.id,
        status: "failed",
        note: error instanceof Error ? error.message : "Android step failed."
      });
      break;
    }
  }

  return { status: results.some((item) => item.status === "failed") ? "failed" : results.some((item) => item.status === "blocked") ? "blocked" : "passed", results };
}

app.post("/api/v1/mobile/recorder/sessions", async (request) => {
  const payload = request.body || {};
  const id = randomUUID();
  const sessionToken = generateRecorderSessionToken();
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
    sessionTokenDigest: digestRecorderSessionToken(sessionToken),
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
  return buildRecorderSessionResponse(session, sessionToken);
});

app.get("/api/v1/mobile/recorder/sessions/:id", async (request, reply) => {
  const session = sessions.get(request.params.id);
  if (!session) {
    reply.code(404);
    return { message: "Mobile recorder session not found" };
  }
  return buildRecorderSessionResponse(session, normalizeText(request.query?.session_token));
});

app.get("/api/v1/mobile/recorder/sessions/:id/live", async (request, reply) => {
  const session = sessions.get(request.params.id);
  if (!session) {
    reply.code(404);
    return "Mobile recorder session not found";
  }
  const sessionToken = normalizeText(
    request.headers?.[MOBILE_SESSION_TOKEN_HEADER]
    || request.query?.session_token
  );
  reply
    .header("content-type", "text/html; charset=utf-8")
    .header("cache-control", "no-store")
    .header("referrer-policy", "no-referrer");
  return `<!doctype html><html><head><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width,initial-scale=1"><title>HelloTest Mobile Recorder</title><style>body{margin:0;background:#101827;color:#f8fafc;font-family:Inter,system-ui,sans-serif}.bar{padding:12px 14px;background:#172033;border-bottom:1px solid rgba(255,255,255,.14);display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}.stage{min-height:calc(100vh - 58px);display:grid;place-items:center;padding:18px}.device{width:min(390px,94vw);aspect-ratio:9/19.5;border:10px solid #263246;border-radius:34px;background:#0b1220;display:grid;place-items:center;box-shadow:0 24px 80px rgba(0,0,0,.45);overflow:hidden;position:relative}.device img{width:100%;height:100%;object-fit:contain;background:#000}.empty{padding:22px;text-align:center;color:#cbd5e1}.controls{position:fixed;left:0;right:0;bottom:0;display:flex;gap:8px;padding:10px;background:rgba(16,24,39,.92);border-top:1px solid rgba(255,255,255,.14)}input{flex:1;min-width:0;border:1px solid rgba(255,255,255,.18);border-radius:8px;background:#0b1220;color:#fff;padding:10px}button{border:1px solid rgba(255,255,255,.18);border-radius:8px;background:#2563eb;color:#fff;padding:10px 12px;font-weight:700}code{color:#8bd3ff}</style></head><body><div class="bar"><strong>HelloTest Mobile Recorder</strong><span>${session.display_mode} · <code>${session.id}</code></span></div><div class="stage"><div class="device" id="device"><img id="screen" alt="" /><div class="empty" id="empty">Connecting to Appium/scrcpy-style browser view...</div></div></div><div class="controls"><input id="text" placeholder="Type text on focused field" /><button id="type">Type</button><button id="back">Back</button></div><script>
const sessionId=${JSON.stringify(session.id)};
const sessionToken=${JSON.stringify(sessionToken)};
const sessionHeaders={"${MOBILE_SESSION_TOKEN_HEADER}":sessionToken};
const screen=document.getElementById("screen");
const empty=document.getElementById("empty");
const device=document.getElementById("device");
const withPath=(path)=>"/api/v1/mobile/recorder/sessions/"+encodeURIComponent(sessionId)+path;
async function refresh(){try{const response=await fetch(withPath("/screenshot")+"?t="+Date.now(),{cache:"no-store",headers:sessionHeaders});if(!response.ok)throw new Error(await response.text());const blob=await response.blob();screen.src=URL.createObjectURL(blob);screen.style.display="block";empty.style.display="none";}catch(error){screen.style.display="none";empty.style.display="block";empty.textContent=String(error.message||error||"Waiting for device screenshot");}}
async function send(payload){await fetch(withPath("/input"),{method:"POST",headers:{"Content-Type":"application/json",...sessionHeaders},body:JSON.stringify(payload)});setTimeout(refresh,250);}
device.addEventListener("click",(event)=>{const rect=device.getBoundingClientRect();send({type:"tap",x:Math.round(event.clientX-rect.left),y:Math.round(event.clientY-rect.top),width:Math.round(rect.width),height:Math.round(rect.height)});});
document.getElementById("type").addEventListener("click",()=>{const value=document.getElementById("text").value;send({type:"type",value});});
document.getElementById("back").addEventListener("click",()=>send({type:"pressBack"}));
refresh();setInterval(refresh,1000);
</script></body></html>`;
});

app.get("/api/v1/mobile/recorder/sessions/:id/screenshot", async (request, reply) => {
  reply.header("cache-control", "no-store");
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
    // Multiple live viewers share an in-flight capture for this driver only.
    // Do not retain completed frames or mix captures across recorder sessions.
    const driver = session.driver;
    let capture = pendingScreenshots.get(driver);
    if (!capture) {
      capture = Promise.resolve().then(() => driver.takeScreenshot());
      pendingScreenshots.set(driver, capture);
      const clear = () => { if (pendingScreenshots.get(driver) === capture) pendingScreenshots.delete(driver); };
      void capture.then(clear, clear);
    }
    const image = await capture;
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
  session.sessionTokenDigest = null;
  await session.driver?.deleteSession().catch(() => undefined);
  session.driver = null;
  sessions.set(session.id, session);
  return buildRecorderSessionResponse(session);
});

export const shutdown = createGracefulShutdown({
  app,
  sessions,
  state: lifecycleState,
  timeoutMs: resolveOperationalLimits().shutdownTimeoutMs
});

let signalHandlersInstalled = false;
export const installSignalHandlers = () => {
  if (signalHandlersInstalled) return;
  signalHandlersInstalled = true;
  for (const signal of ["SIGTERM", "SIGINT"]) {
    process.once(signal, () => {
      shutdown(signal)
        .then((result) => app.log.info(result, "Mobile engine stopped gracefully"))
        .catch((error) => {
          app.log.error({ error, signal }, "Mobile engine graceful shutdown failed");
          process.exitCode = 1;
          setImmediate(() => process.exit(1));
        });
    });
  }
};

export const startMobileEngine = async () => {
  installSignalHandlers();
  return app.listen({ port, host: "0.0.0.0" });
};

export { app, buildCapabilities, lifecycleState, sessions };

const isMainModule = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  startMobileEngine().catch((error) => {
    app.log.error({ error }, "Unable to start mobile engine");
    process.exitCode = 1;
  });
}
