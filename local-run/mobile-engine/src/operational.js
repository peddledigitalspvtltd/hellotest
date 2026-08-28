const MEBIBYTE = 1024 * 1024;
const REMOTE_PROVIDER_NAMES = new Set(["saucelabs", "browserstack", "lambdatest", "crossbrowser"]);

export class MobileEngineOperationalError extends Error {
  constructor(code, message, statusCode = 500) {
    super(message);
    this.name = "MobileEngineOperationalError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export const boundedInteger = (value, fallback, minimum, maximum) => {
  if (value === undefined || value === null || String(value).trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
};

export const resolveOperationalLimits = (env = process.env) => ({
  readinessTimeoutMs: boundedInteger(env.MOBILE_READINESS_TIMEOUT_MS, 2_000, 100, 10_000),
  remoteDownloadTimeoutMs: boundedInteger(env.MOBILE_REMOTE_DOWNLOAD_TIMEOUT_MS, 15_000, 100, 120_000),
  remoteDownloadMaxBytes: boundedInteger(env.MOBILE_REMOTE_DOWNLOAD_MAX_BYTES, 25 * MEBIBYTE, 1, 100 * MEBIBYTE),
  shutdownTimeoutMs: boundedInteger(env.MOBILE_SHUTDOWN_TIMEOUT_MS, 10_000, 100, 60_000)
});

const sanitizedEndpoint = (value) => {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
};

const appiumStatusUrl = (value) => {
  const parsed = new URL(value);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new MobileEngineOperationalError(
      "INVALID_PROVIDER_URL",
      "The configured mobile provider URL must use HTTP or HTTPS.",
      503
    );
  }
  parsed.username = "";
  parsed.password = "";
  parsed.search = "";
  parsed.hash = "";
  const basePath = parsed.pathname.replace(/\/+$/, "");
  parsed.pathname = basePath.endsWith("/status") ? basePath : `${basePath}/status`;
  return parsed;
};

const failReadiness = ({ provider, endpoint, startedAt, reason, httpStatus = null }) => ({
  ok: false,
  status: "not_ready",
  provider,
  dependency: {
    name: "appium",
    required: true,
    status: "not_ready",
    reason,
    endpoint,
    latency_ms: Date.now() - startedAt,
    ...(httpStatus ? { http_status: httpStatus } : {})
  }
});

export async function probeProviderReadiness({ provider, appiumServerUrl } = {}, {
  fetchImpl = globalThis.fetch,
  timeoutMs = resolveOperationalLimits().readinessTimeoutMs
} = {}) {
  const normalizedProvider = String(provider || "local-appium").trim().toLowerCase();
  const boundedTimeoutMs = boundedInteger(timeoutMs, 2_000, 100, 10_000);
  const startedAt = Date.now();
  const endpoint = sanitizedEndpoint(appiumServerUrl);

  if (!endpoint) {
    return failReadiness({
      provider: normalizedProvider,
      endpoint: null,
      startedAt,
      reason: "invalid_configuration"
    });
  }

  if (REMOTE_PROVIDER_NAMES.has(normalizedProvider)) {
    return {
      ok: true,
      status: "ready",
      provider: normalizedProvider,
      dependency: {
        name: "remote-provider",
        required: false,
        status: "configured",
        endpoint,
        latency_ms: Date.now() - startedAt
      }
    };
  }

  let statusUrl;
  try {
    statusUrl = appiumStatusUrl(appiumServerUrl);
  } catch {
    return failReadiness({
      provider: normalizedProvider,
      endpoint,
      startedAt,
      reason: "invalid_configuration"
    });
  }

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, boundedTimeoutMs);

  try {
    const response = await fetchImpl(statusUrl, {
      method: "GET",
      headers: { accept: "application/json" },
      redirect: "manual",
      signal: controller.signal
    });
    if (!response.ok) {
      return failReadiness({
        provider: normalizedProvider,
        endpoint,
        startedAt,
        reason: "http_error",
        httpStatus: response.status
      });
    }

    let reportedReady = null;
    try {
      const payload = await response.json();
      reportedReady = payload?.value?.ready ?? payload?.ready ?? null;
    } catch {
      if (timedOut) throw new Error("Appium status response timed out");
      // Older Appium servers may return a successful non-JSON status response.
    }

    if (reportedReady === false) {
      return failReadiness({
        provider: normalizedProvider,
        endpoint,
        startedAt,
        reason: "provider_reported_not_ready"
      });
    }

    return {
      ok: true,
      status: "ready",
      provider: normalizedProvider,
      dependency: {
        name: "appium",
        required: true,
        status: "ready",
        endpoint,
        latency_ms: Date.now() - startedAt
      }
    };
  } catch {
    return failReadiness({
      provider: normalizedProvider,
      endpoint,
      startedAt,
      reason: timedOut ? "timeout" : "unreachable"
    });
  } finally {
    clearTimeout(timer);
  }
}

const cancelBody = async (body) => {
  if (!body || typeof body.cancel !== "function") return;
  await body.cancel().catch(() => undefined);
};

const readResponseBody = async (response, maxBytes) => {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await cancelBody(response.body);
    throw new MobileEngineOperationalError(
      "REMOTE_FILE_TOO_LARGE",
      `Remote mobile file exceeds the ${maxBytes}-byte limit.`,
      413
    );
  }

  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new MobileEngineOperationalError(
          "REMOTE_FILE_TOO_LARGE",
          `Remote mobile file exceeds the ${maxBytes}-byte limit.`,
          413
        );
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks, totalBytes);
};

export async function remoteFileToBase64(url, {
  fetchImpl = globalThis.fetch,
  timeoutMs = resolveOperationalLimits().remoteDownloadTimeoutMs,
  maxBytes = resolveOperationalLimits().remoteDownloadMaxBytes
} = {}) {
  const boundedTimeoutMs = boundedInteger(timeoutMs, 15_000, 100, 120_000);
  const boundedMaxBytes = boundedInteger(maxBytes, 25 * MEBIBYTE, 1, 100 * MEBIBYTE);
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, boundedTimeoutMs);

  try {
    const response = await fetchImpl(url, {
      redirect: "follow",
      signal: controller.signal
    });
    if (!response.ok) {
      await cancelBody(response.body);
      throw new MobileEngineOperationalError(
        "REMOTE_FILE_HTTP_ERROR",
        `Unable to download remote mobile file: ${response.status} ${response.statusText}`.trim(),
        502
      );
    }
    return (await readResponseBody(response, boundedMaxBytes)).toString("base64");
  } catch (error) {
    if (timedOut) {
      throw new MobileEngineOperationalError(
        "REMOTE_FILE_DOWNLOAD_TIMEOUT",
        `Remote mobile file download exceeded ${boundedTimeoutMs}ms.`,
        504
      );
    }
    if (error instanceof MobileEngineOperationalError) throw error;
    throw new MobileEngineOperationalError(
      "REMOTE_FILE_DOWNLOAD_FAILED",
      "Unable to download the remote mobile file.",
      502
    );
  } finally {
    clearTimeout(timer);
  }
}

export const createGracefulShutdown = ({
  app,
  sessions,
  state,
  timeoutMs = resolveOperationalLimits().shutdownTimeoutMs,
  logger = app?.log
}) => {
  const boundedTimeoutMs = boundedInteger(timeoutMs, 10_000, 100, 60_000);
  let shutdownPromise = null;

  return (reason = "shutdown") => {
    if (shutdownPromise) return shutdownPromise;
    state.shuttingDown = true;

    const activeSessions = [...sessions.values()];
    sessions.clear();
    const closeSessions = Promise.allSettled(activeSessions.map(async (session) => {
      session.status = "stopped";
      const driver = session.driver;
      session.driver = null;
      if (driver?.deleteSession) await driver.deleteSession();
    })).then((results) => {
      const failed = results.filter((result) => result.status === "rejected").length;
      if (failed) logger?.warn?.({ failed, reason }, "Some mobile sessions did not close cleanly");
      return { closed: activeSessions.length - failed, failed };
    });

    let timer;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new MobileEngineOperationalError(
        "SHUTDOWN_TIMEOUT",
        `Mobile engine shutdown exceeded ${boundedTimeoutMs}ms.`,
        500
      )), boundedTimeoutMs);
    });
    const closeServer = Promise.resolve().then(() => app.close());

    shutdownPromise = Promise.race([
      Promise.all([closeServer, closeSessions]).then(([, sessionResult]) => ({ reason, ...sessionResult })),
      deadline
    ]).finally(() => clearTimeout(timer));
    return shutdownPromise;
  };
};
