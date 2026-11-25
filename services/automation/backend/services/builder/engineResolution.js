// engineResolution: cohesive builder implementation; dependencies are explicit lazy ports.
function createEngineResolution(ports) {
const exports = ports.exports;
const require = ports.require;


const resolveTestEngineIntegration = async (testCase) => {
  const integration = await ports.integrationService.getActiveIntegrationByTypeForProject("testengine", testCase.project_id);

  if (!integration?.base_url) {
    const { browserEntryError } = require("../../lib/browser/automationBrowserEntry");
    throw browserEntryError("AUTOMATION_BROWSER_ENGINE_UNAVAILABLE", "Configure an active Test Engine integration before using browser automation or recording.", 503);
  }

  return integration;
};


const resolveBuildBrowserIntegration=async(testCase,pairedScope)=>{
  if(!pairedScope)return resolveTestEngineIntegration(testCase);
  // A local bridge remains usable without a remote worker. If a project/global
  // TestEngine policy exists, freeze only its public browser wait settings here.
  const configured=await ports.integrationService.getActiveIntegrationByTypeForProject('testengine',testCase.project_id);
  const assertionTimeoutMs=require("../../lib/build/automationAssertionTimeout").configuredAssertionTimeoutMs(configured?.config?.assertion_timeout_ms);
  const navigationTimeoutMs=require("../../lib/build/automationAssertionTimeout").configuredNavigationTimeoutMs(configured?.config?.navigation_timeout_ms);
  return {paired_browser_bridge:pairedScope,config:{...(assertionTimeoutMs!==undefined?{assertion_timeout_ms:assertionTimeoutMs}:{}),...(navigationTimeoutMs!==undefined?{navigation_timeout_ms:navigationTimeoutMs}:{})}};
};


const resolveMobileEngineBaseUrl = (integration, recorderMode) => {
  const config = integration?.config && typeof integration.config === "object" && !Array.isArray(integration.config)
    ? integration.config
    : {};
  const configured = ports.normalizeText(config.mobile_engine_url) || ports.normalizeText(process.env.MOBILE_ENGINE_PUBLIC_URL);
  const internal = ports.normalizeText(process.env.MOBILE_ENGINE_URL) || ports.normalizeText(config.mobile_engine_internal_url);

  if (recorderMode === "local") {
    return ports.normalizeText(process.env.MOBILE_ENGINE_LOCAL_URL) || configured || "http://host.docker.internal:4312";
  }

  return configured || internal || "http://mobile-engine:4312";
};


const hasRemoteMobileProvider = (integration) => {
  const config = integration?.config && typeof integration.config === "object" && !Array.isArray(integration.config)
    ? integration.config
    : {};
  const provider = ports.normalizeText(config.mobile_cloud_provider);
  const remoteUrl = ports.normalizeText(config.mobile_remote_url);
  return Boolean(provider && provider !== "none" && remoteUrl);
};


const readEngineJson = async (url, init = {}) => {
  const response = await ports.resilientHttpRequest(url, {
    ...init,
    headers: {
      accept: "application/json",
      ...(init.headers || {})
    }
  }, { dependency: 'test-engine', operation: 'automation.engine.request', deadlineMs: ports.ENGINE_TIMEOUT_MS,
    attemptTimeoutMs: ports.ENGINE_TIMEOUT_MS, maxAttempts: 1, idempotent: !init.method || init.method === 'GET' });
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw Object.assign(new Error(payload?.message || `Test Engine request failed with status ${response.status}`), { upstreamStatus: response.status, code: 'AUTOMATION_ENGINE_REJECTED' });
  }

  return payload;
};


const readMobileEngineJson = async (url, init = {}) => readEngineJson(url, {
  ...init,
  headers: {
    [ports.MOBILE_ENGINE_SECRET_HEADER]: ports.resolveMobileEngineSecret(),
    ...(init.headers || {})
  }
});


const buildEngineUrl = (baseUrl, value) => {
  const normalized = ports.normalizeText(value);

  if (!normalized) {
    return null;
  }

  try {
    return new URL(normalized).toString();
  } catch {
    return new URL(normalized, `${String(baseUrl || "").replace(/\/+$/, "")}/`).toString();
  }
};


const isPrivateAddress = (hostname) =>
  hostname === "localhost"
  || hostname === "host.docker.internal"
  || hostname === "testengine"
  || hostname === "127.0.0.1"
  || hostname === "::1"
  || /^10\./.test(hostname)
  || /^192\.168\./.test(hostname)
  || /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname);


const normalizeLocalEngineBaseUrl = (value) => {
  const normalized = ports.normalizeText(value);

  if (!normalized) {
    return null;
  }

  let parsed;

  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error("Local recorder engine URL must be an absolute http or https URL.");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Local recorder engine URL must use http or https.");
  }

  if (!isPrivateAddress(parsed.hostname)) {
    throw new Error("Local recorder engine URL must point to localhost, the local Docker service, or a private network address.");
  }

  if ((parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") && process.env.DATABASE_URL?.includes("postgres")) {
    parsed.hostname = "host.docker.internal";
  }

  return parsed.toString().replace(/\/+$/, "");
};


const resolveRecorderPublicBaseUrl = (integration, fallbackBaseUrl, recorderMode) => {
  if (recorderMode === "local" && fallbackBaseUrl) {
    let parsedFallback;
    try {
      parsedFallback = new URL(fallbackBaseUrl);
      if (parsedFallback.hostname === "host.docker.internal") {
        parsedFallback.hostname = "localhost";
      }
      return parsedFallback.toString().replace(/\/+$/, "");
    } catch {
      // Ignore
    }
  }
  const config = integration?.config && typeof integration.config === "object" ? integration.config : {};
  return ports.normalizeText(config.recorder_public_base_url)
    || ports.normalizeText(config.public_base_url)
    || ports.normalizeText(config.live_view_url)
    || fallbackBaseUrl;
};


const parseTransactionMetadata = (transaction) => ports.safeJson(transaction?.metadata, {});


const isRecorderSessionPastOrphanTtl = (session, transaction) => {
  const metadata = parseTransactionMetadata(transaction);
  const lastActivity = Date.parse(
    session?.last_activity_at
    || session?.started_at
    || metadata.recorder_started_at
    || transaction?.started_at
    || transaction?.created_at
    || ""
  );

  if (!Number.isFinite(lastActivity)) {
    return true;
  }

  return Date.now() - lastActivity > ports.RECORDER_ORPHAN_TTL_MS;
};
return { resolveTestEngineIntegration, resolveBuildBrowserIntegration, resolveMobileEngineBaseUrl, hasRemoteMobileProvider, readEngineJson, readMobileEngineJson, buildEngineUrl, isPrivateAddress, normalizeLocalEngineBaseUrl, resolveRecorderPublicBaseUrl, parseTransactionMetadata, isRecorderSessionPastOrphanTtl };
}
module.exports = { createEngineResolution };
