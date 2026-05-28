const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const DEFAULT_WEB_URLS = ["http://localhost:4311", "http://127.0.0.1:4311", "http://host.docker.internal:4311"];
const DEFAULT_MOBILE_URLS = ["http://localhost:4312", "http://127.0.0.1:4312", "http://mobile-engine:4312"];
const DEFAULT_APPIUM_URLS = ["http://localhost:4723", "http://127.0.0.1:4723", "http://host.docker.internal:4723"];

const normalizeText = (value) => {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized || null;
};

const normalizeBaseUrl = (value) => {
  const normalized = normalizeText(value);

  if (!normalized) {
    return null;
  }

  const parsed = new URL(normalized);
  return parsed.toString().replace(/\/+$/, "");
};

const withTimeout = async (url, timeoutMs = 900) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal
    });
    const payload = await response.json().catch(() => null);
    return {
      ok: response.ok,
      status: response.status,
      payload
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: error instanceof Error ? error.message : "Unable to reach service"
    };
  } finally {
    clearTimeout(timeout);
  }
};

const probeCandidates = async (kind, candidates) => {
  const normalizedCandidates = [...new Set(candidates.map(normalizeBaseUrl).filter(Boolean))];
  const attempts = [];

  for (const baseUrl of normalizedCandidates) {
    const health = await withTimeout(`${baseUrl}/health`);
    attempts.push({ base_url: baseUrl, ...health });

    if (health.ok) {
      return {
        kind,
        ready: true,
        base_url: baseUrl,
        health: health.payload,
        attempts
      };
    }
  }

  return {
    kind,
    ready: false,
    base_url: normalizedCandidates[0] || null,
    health: null,
    attempts
  };
};

const resolveLocalRunRoot = () =>
  path.resolve(process.env.QAIRA_LOCAL_RUN_ROOT || path.join(__dirname, "../../../../local-run"));

const launchHostRecorder = () => {
  if (process.env.QAIRA_ALLOW_LOCAL_AGENT_LAUNCH !== "true") {
    return {
      started: false,
      launch_supported: false,
      message: "One-click local agent launch is disabled. Set QAIRA_ALLOW_LOCAL_AGENT_LAUNCH=true on the API process to allow QAira to run the fixed local runner script."
    };
  }

  const localRunRoot = resolveLocalRunRoot();
  const isWindows = process.platform === "win32";
  const script = path.join(localRunRoot, "bin", isWindows ? "start-host-recorder.cmd" : "start-host-recorder.sh");

  if (!fs.existsSync(script)) {
    return {
      started: false,
      launch_supported: false,
      message: `QAira local runner script was not found at ${script}. Install local-run or use the packaged desktop agent.`
    };
  }

  const child = spawn(script, [], {
    cwd: localRunRoot,
    detached: true,
    shell: isWindows,
    stdio: "ignore",
    env: {
      ...process.env,
      QAIRA_HOST_RECORDER_PORT: process.env.QAIRA_HOST_RECORDER_PORT || "4311"
    }
  });

  child.on("error", () => undefined);
  child.unref();

  return {
    started: true,
    launch_supported: true,
    pid: child.pid,
    script,
    message: "QAira local runner launch requested. It will use the packaged recorder when present, otherwise it installs npm/Playwright packages and starts the local Playwright service."
  };
};

exports.getStatus = async () => {
  const [web, mobile, appium] = await Promise.all([
    probeCandidates("playwright", DEFAULT_WEB_URLS),
    probeCandidates("mobile-engine", DEFAULT_MOBILE_URLS),
    probeCandidates("appium", DEFAULT_APPIUM_URLS)
  ]);

  return {
    launch_supported: process.env.QAIRA_ALLOW_LOCAL_AGENT_LAUNCH === "true",
    web,
    mobile,
    appium,
    recommended: {
      web_public_base_url: web.ready ? web.base_url : "http://localhost:4311",
      mobile_public_base_url: mobile.ready ? mobile.base_url : "http://localhost:4312",
      appium_server_url: appium.ready ? appium.base_url : "http://localhost:4723"
    }
  };
};

exports.start = async ({ target } = {}) => {
  const normalizedTarget = normalizeText(target) || "playwright";

  if (normalizedTarget !== "playwright" && normalizedTarget !== "web") {
    return {
      started: false,
      launch_supported: false,
      message: "Only the host Playwright runner can be launched by this API. Start Appium/mobile engine through local-run Docker or your packaged desktop agent."
    };
  }

  const existing = await probeCandidates("playwright", DEFAULT_WEB_URLS);

  if (existing.ready) {
    return {
      started: false,
      launch_supported: true,
      already_running: true,
      base_url: existing.base_url,
      message: "QAira local Playwright runner is already running."
    };
  }

  return launchHostRecorder();
};
