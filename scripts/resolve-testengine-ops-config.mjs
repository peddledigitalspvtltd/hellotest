#!/usr/bin/env node

const normalizeText = (value) => {
  if (typeof value !== "string") {
    return "";
  }

  const normalized = value.trim();
  return normalized;
};

const normalizeUrl = (value) => {
  const normalized = normalizeText(value);

  if (!normalized) {
    return "";
  }

  try {
    const parsed = new URL(normalized);
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return normalized.replace(/\/+$/, "");
  }
};

const normalizePath = (value, fallback) => {
  const normalized = normalizeText(value) || fallback;
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
};

const normalizeInteger = (value, fallback = null) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  return fallback;
};

const normalizeNumber = (value, fallback = null) => {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const shQuote = (value) => `'${String(value ?? "").replace(/'/g, `'\"'\"'`)}'`;

const requestJson = async (url, init = {}) => {
  const response = await fetch(url, {
    ...init,
    headers: {
      accept: "application/json",
      ...(init.headers || {})
    },
    signal: AbortSignal.timeout(15000)
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && typeof payload.message === "string"
        ? payload.message
        : `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  return payload;
};

const pickIntegration = (integrations, type, projectId) => {
  const active = integrations.filter((integration) => integration && integration.type === type && integration.is_active);

  if (!active.length) {
    return null;
  }

  const normalizedProjectId = normalizeText(projectId);

  if (normalizedProjectId) {
    const projectScoped = active.find(
      (integration) => normalizeText(integration?.config?.project_id) === normalizedProjectId
    );

    if (projectScoped) {
      return projectScoped;
    }
  }

  const global = active.find((integration) => !normalizeText(integration?.config?.project_id));
  return global || active[0] || null;
};

const buildUrl = (baseUrl, path) => {
  const normalizedBaseUrl = normalizeUrl(baseUrl);

  if (!normalizedBaseUrl) {
    return "";
  }

  try {
    return new URL(normalizePath(path, "/"), `${normalizedBaseUrl}/`).toString();
  } catch {
    return "";
  }
};

const baseUrl = normalizeUrl(process.env.HELLOTEST_API_BASE_URL);
const authToken = normalizeText(process.env.HELLOTEST_AUTH_TOKEN || process.env.HELLOTEST_BEARER_TOKEN);
const authEmail = normalizeText(process.env.HELLOTEST_AUTH_EMAIL);
const authPassword = normalizeText(process.env.HELLOTEST_AUTH_PASSWORD);
const projectId = normalizeText(process.env.HELLOTEST_PROJECT_ID);
const fallbackEngineUrl = normalizeUrl(process.env.ENGINE_PUBLIC_URL);
const fallbackPollIntervalMinutes = Math.max(0.5, normalizeNumber(process.env.TESTENGINE_POLL_INTERVAL_MINUTES, 5));
const fallbackOpsServiceName = normalizeText(
  process.env.OPS_TELEMETRY_SERVICE_NAME || process.env.OTEL_SERVICE_NAME || process.env.OPS_SERVICE_NAME
);
const fallbackOpsEnvironment = normalizeText(
  process.env.OPS_TELEMETRY_ENVIRONMENT || process.env.OPS_ENVIRONMENT
);
const fallbackEventsPath = normalizePath(process.env.OPS_TELEMETRY_EVENTS_PATH, "/api/v1/events");
const fallbackBoardPath = normalizePath(process.env.OPS_TELEMETRY_BOARD_PATH, "/ops-telemetry");
const fallbackApiKeyHeader = normalizeText(process.env.OPS_TELEMETRY_API_KEY_HEADER) || "Authorization";
const fallbackApiKeyPrefix = Object.prototype.hasOwnProperty.call(process.env, "OPS_TELEMETRY_API_KEY_PREFIX")
  ? String(process.env.OPS_TELEMETRY_API_KEY_PREFIX ?? "")
  : "Bearer";
const fallbackApiKey = normalizeText(process.env.OPS_TELEMETRY_API_KEY);

const warnings = [];
const info = [];

let lookupStatus = "skipped";
let resolvedToken = authToken;
let integrations = [];
let engineIntegration = null;
let opsIntegration = null;

if (!baseUrl) {
  warnings.push("HELLOTEST_API_BASE_URL is not set, so integration lookup was skipped.");
} else {
  try {
    if (!resolvedToken && authEmail && authPassword) {
      const loginPayload = await requestJson(`${baseUrl}/auth/login`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          email: authEmail,
          password: authPassword
        })
      });

      resolvedToken = normalizeText(loginPayload?.token);
      lookupStatus = resolvedToken ? "logged-in" : "login-missing-token";
    }

    if (resolvedToken) {
      const payload = await requestJson(`${baseUrl}/integrations`, {
        headers: {
          Authorization: `Bearer ${resolvedToken}`
        }
      });

      integrations = Array.isArray(payload) ? payload : [];
      lookupStatus = "resolved";
      engineIntegration = pickIntegration(integrations, "testengine", projectId);
      opsIntegration = pickIntegration(integrations, "ops", projectId);
    } else {
      warnings.push(
        "No HELLOTEST_AUTH_TOKEN or HELLOTEST_AUTH_EMAIL/HELLOTEST_AUTH_PASSWORD was provided, so HelloTest integrations could not be read."
      );
    }
  } catch (error) {
    lookupStatus = "error";
    warnings.push(
      `Unable to read HelloTest integrations: ${error instanceof Error ? error.message : "request failed"}`
    );
  }
}

const enginePublicUrl = fallbackEngineUrl || normalizeUrl(engineIntegration?.base_url);
const configuredPollIntervalMinutes = normalizeNumber(process.env.TESTENGINE_POLL_INTERVAL_MINUTES, null);
const integrationPollIntervalMinutes = normalizeNumber(
  engineIntegration?.config?.queue_poll_interval_minutes,
  fallbackPollIntervalMinutes
);
const testEnginePollIntervalMinutes = Math.max(0.5, configuredPollIntervalMinutes ?? integrationPollIntervalMinutes);
const testEnginePollIntervalMs = Math.max(
  1000,
  normalizeInteger(process.env.TESTENGINE_POLL_INTERVAL_MS, testEnginePollIntervalMinutes * 60 * 1000)
);
const opsHostOverride = normalizeUrl(opsIntegration?.base_url);
const opsTransportHost = opsHostOverride || enginePublicUrl;
const opsEventsPath = normalizePath(opsIntegration?.config?.events_path, fallbackEventsPath);
const opsHealthPath = normalizePath(opsIntegration?.config?.health_path, "/health");
const opsBoardPath = fallbackBoardPath;
const opsServiceName =
  fallbackOpsServiceName
  || normalizeText(opsIntegration?.config?.service_name)
  || "hellotest-testengine";
const opsEnvironment =
  fallbackOpsEnvironment
  || normalizeText(opsIntegration?.config?.environment)
  || "production";
const opsApiKeyHeader =
  normalizeText(opsIntegration?.config?.api_key_header)
  || fallbackApiKeyHeader;
const opsApiKeyPrefix =
  Object.prototype.hasOwnProperty.call(process.env, "OPS_TELEMETRY_API_KEY_PREFIX")
    ? String(process.env.OPS_TELEMETRY_API_KEY_PREFIX ?? "")
    : Object.prototype.hasOwnProperty.call(opsIntegration?.config || {}, "api_key_prefix")
      ? String(opsIntegration?.config?.api_key_prefix ?? "")
      : fallbackApiKeyPrefix;
const opsApiKey = fallbackApiKey || normalizeText(opsIntegration?.api_key);

if (engineIntegration) {
  info.push(`Resolved Test Engine integration "${engineIntegration.name}".`);
}

if (opsIntegration) {
  info.push(`Resolved OPS integration "${opsIntegration.name}".`);
}

if (!enginePublicUrl) {
  warnings.push(
    "No Test Engine host URL could be resolved. Set ENGINE_PUBLIC_URL or provide HelloTest auth so the active Test Engine integration can be read."
  );
}

if (!opsIntegration) {
  warnings.push(
    "No active OPS integration was found for the selected scope. The local telemetry board will run, but HelloTest will not emit execution hierarchy events until OPS is configured."
  );
}

if (opsHostOverride && enginePublicUrl && opsHostOverride !== enginePublicUrl) {
  warnings.push(
    `The active OPS integration overrides its host URL to ${opsHostOverride}. HelloTest's current implementation normally rides on the Test Engine host ${enginePublicUrl}, so clear that override if you want OPS to follow the engine automatically.`
  );
}

const lines = [
  `RESOLVED_LOOKUP_STATUS=${shQuote(lookupStatus)}`,
  `RESOLVED_ENGINE_PUBLIC_URL=${shQuote(enginePublicUrl)}`,
  `RESOLVED_ENGINE_INTEGRATION_NAME=${shQuote(engineIntegration?.name || "")}`,
  `RESOLVED_TESTENGINE_POLL_INTERVAL_MINUTES=${shQuote(testEnginePollIntervalMinutes)}`,
  `RESOLVED_TESTENGINE_POLL_INTERVAL_MS=${shQuote(testEnginePollIntervalMs)}`,
  `RESOLVED_OPS_INTEGRATION_NAME=${shQuote(opsIntegration?.name || "")}`,
  `RESOLVED_OPS_TRANSPORT_HOST=${shQuote(opsTransportHost)}`,
  `RESOLVED_OPS_EVENTS_PATH=${shQuote(opsEventsPath)}`,
  `RESOLVED_OPS_HEALTH_PATH=${shQuote(opsHealthPath)}`,
  `RESOLVED_OPS_BOARD_PATH=${shQuote(opsBoardPath)}`,
  `RESOLVED_OPS_EVENTS_URL=${shQuote(buildUrl(opsTransportHost, opsEventsPath))}`,
  `RESOLVED_OPS_HEALTH_URL=${shQuote(buildUrl(opsTransportHost, opsHealthPath))}`,
  `RESOLVED_OPS_BOARD_URL=${shQuote(buildUrl(opsTransportHost, opsBoardPath))}`,
  `RESOLVED_OPS_SERVICE_NAME=${shQuote(opsServiceName)}`,
  `RESOLVED_OPS_ENVIRONMENT=${shQuote(opsEnvironment)}`,
  `RESOLVED_OPS_API_KEY=${shQuote(opsApiKey)}`,
  `RESOLVED_OPS_API_KEY_HEADER=${shQuote(opsApiKeyHeader)}`,
  `RESOLVED_OPS_API_KEY_PREFIX=${shQuote(opsApiKeyPrefix)}`,
  `RESOLVED_INFO_TEXT=${shQuote(info.join("\n"))}`,
  `RESOLVED_WARNING_TEXT=${shQuote(warnings.join("\n"))}`
];

process.stdout.write(`${lines.join("\n")}\n`);
