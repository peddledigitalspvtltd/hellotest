const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const { readBoundedResponseJson } = require("@hellotest/platform/backend/src/utils/boundedResponse");
const { resilientHttpRequest } = require("@hellotest/platform/backend/src/utils/resilientHttpClient");

const DEFAULT_WEB_URLS = ["http://localhost:4313", "http://127.0.0.1:4313", "http://host.docker.internal:4313", "http://localhost:4311", "http://127.0.0.1:4311", "http://host.docker.internal:4311"];
const webCandidates = () => {
  const configured = process.env.HELLOTEST_LOCAL_RUN_ENGINE_URL;
  if (!configured) return DEFAULT_WEB_URLS;
  const normalized = normalizeBaseUrl(configured);
  return DEFAULT_WEB_URLS.includes(normalized) ? [normalized, ...DEFAULT_WEB_URLS] : [normalized];
};
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
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("Local provider URL must be an http(s) base URL without credentials, query, or fragment");
  }
  return parsed.toString().replace(/\/+$/, "");
};

const browserBaseUrl = (baseUrl) => {
  const url = new URL(baseUrl);
  if (url.hostname === "host.docker.internal") url.hostname = "localhost";
  return url.toString().replace(/\/+$/, "");
};

const withTimeout = async (url, timeoutMs = 900) => {
  try {
    const response = await resilientHttpRequest(url, {
      cache: "no-store"
    }, {
      dependency: "local-execution-provider",
      operation: "health.probe",
      deadlineMs: timeoutMs,
      maxAttempts: 1,
      maxResponseBytes: 256 * 1024,
      maxConcurrent: 8,
      failureThreshold: 10,
      resetTimeoutMs: 5_000
    });
    const payload = await readBoundedResponseJson(response, {
      maxBytes: 256 * 1024,
      label: "Local execution provider response"
    });
    return {
      ok: response.ok,
      status: response.status,
      payload
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: error?.publicMessage || "Unable to reach service"
    };
  }
};

const probeCandidates = async (kind, candidates) => {
  const normalizedCandidates = [...new Set(candidates.filter(Boolean).map(normalizeBaseUrl).filter(Boolean))];
  const attempts = [];

  for (const baseUrl of normalizedCandidates) {
    const health = await withTimeout(`${baseUrl}/health`);
    attempts.push({ base_url: baseUrl, ...health });

    if (health.ok && (kind !== "playwright" || health.payload?.supported_web_engines?.includes("playwright") && health.payload?.ready !== false && health.payload?.capabilities?.local_execution !== false)) {
      return {
        kind,
        ready: true,
        base_url: baseUrl,
        health: health.payload,
        attempts,
        ...(kind === "playwright" ? { message: "The full local Playwright runner is reachable from the HelloTest API." } : {})
      };
    }
  }

  const inspectionOnly = attempts.some(attempt => attempt.ok && (attempt.payload?.service === "hellotest-inspection-agent" || attempt.payload?.capabilities?.local_execution === false));
  const notReady = attempts.some(attempt => attempt.ok && attempt.payload?.supported_web_engines?.includes("playwright") && attempt.payload?.ready === false);
  return {
    kind,
    ready: false,
    base_url: normalizedCandidates[0] || null,
    health: null,
    attempts,
    ...(kind === "playwright" ? {
      code: inspectionOnly ? "LOCAL_AGENT_INSPECTION_ONLY" : notReady ? "LOCAL_AGENT_NOT_READY" : "LOCAL_AGENT_UNAVAILABLE",
      message: inspectionOnly
        ? "The inspection agent is connected, but it cannot execute saved cases. Start ./local-run/bin/start-host-recorder.sh (Windows: local-run\\bin\\start-host-recorder.cmd) from your HelloTest folder, then check the runner again."
        : notReady
          ? "The local Playwright runner is running but is not ready. Check its terminal for startup errors and ensure its shared secret matches the HelloTest API configuration."
          : "The HelloTest API cannot reach a full local Playwright runner. Start ./local-run/bin/start-host-recorder.sh (Windows: local-run\\bin\\start-host-recorder.cmd) from your HelloTest folder. Hosted HelloTest requires an administrator-configured runner address reachable from its API; pairing the browser inspection agent alone does not connect local execution."
    } : {})
  };
};

const resolveLocalRunRoot = () =>
  path.resolve(process.env.HELLOTEST_LOCAL_RUN_ROOT || path.join(__dirname, "../../../../local-run"));

const localAgentLaunchEnabled = () =>
  process.env.HELLOTEST_ALLOW_LOCAL_AGENT_LAUNCH === "true";

const launchHostRecorder = async () => {
  if (!localAgentLaunchEnabled()) {
    return {
      started: false,
      launch_supported: false,
      message: "One-click local agent launch is disabled. Set HELLOTEST_ALLOW_LOCAL_AGENT_LAUNCH=true on the API process to allow HelloTest to run the fixed local runner script."
    };
  }

  const localRunRoot = resolveLocalRunRoot();
  const isWindows = process.platform === "win32";
  const script = path.join(localRunRoot, "bin", isWindows ? "start-host-recorder.cmd" : "start-host-recorder.sh");

  if (!fs.existsSync(script)) {
    return {
      started: false,
      launch_supported: false,
      message: `HelloTest local runner script was not found at ${script}. Install local-run or use the packaged desktop agent.`
    };
  }

  const logDirectory = path.join(localRunRoot, "artifacts", "host-recorder");
  fs.mkdirSync(logDirectory, { recursive: true, mode: 0o700 });
  const logPath = path.join(logDirectory, "launcher.log");
  const logFile = fs.openSync(logPath, "a", 0o600);
  let child;
  try {
    child = spawn(script, [], {
      cwd: localRunRoot,
      detached: true,
      shell: isWindows,
      stdio: ["ignore", logFile, logFile],
      env: {
        ...process.env,
        HELLOTEST_HOST_RECORDER_PORT: process.env.HELLOTEST_HOST_RECORDER_PORT || (process.env.HELLOTEST_LOCAL_RUN_ENGINE_URL ? new URL(process.env.HELLOTEST_LOCAL_RUN_ENGINE_URL).port : "") || "4313"
      }
    });
    await new Promise((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
  } catch {
    return {
      started: false,
      launch_supported: true,
      message: "The local runner script could not be started. Check that Node.js and npm are installed and that local-run/bin/start-host-recorder.sh is executable, or start the script directly in a terminal."
    };
  } finally { fs.closeSync(logFile); }
  child.unref();

  return {
    started: true,
    launch_supported: true,
    pid: child.pid,
    script,
    message: "HelloTest local runner launch requested. First setup installs npm packages and Chromium and can take several minutes. Check local-run/artifacts/host-recorder/launcher.log for progress or startup errors, then check the runner connection again."
  };
};

exports.getStatus = async () => {
  const [web, mobile, appium] = await Promise.all([
    probeCandidates("playwright", webCandidates()),
    probeCandidates("mobile-engine", DEFAULT_MOBILE_URLS),
    probeCandidates("appium", DEFAULT_APPIUM_URLS)
  ]);

  return {
    launch_supported: localAgentLaunchEnabled(),
    web,
    mobile,
    appium,
    recommended: {
      web_public_base_url: web.ready ? browserBaseUrl(web.base_url) : "http://localhost:4313",
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

  const existing = await probeCandidates("playwright", webCandidates());

  if (existing.ready) {
    return {
      started: false,
      launch_supported: true,
      already_running: true,
      base_url: existing.base_url,
      message: "HelloTest local Playwright runner is already running."
    };
  }

  return launchHostRecorder();
};
