const db = require("../db");
const { randomUUID: uuid } = require("crypto");
const { INTEGRATION_TYPE_OPTIONS, INTEGRATION_TYPE_VALUES } = require("../domain/catalog");

const normalizeText = (value) => {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
};

const isPlainObject = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const normalizeObject = (value) => {
  return isPlainObject(value) ? value : {};
};

const normalizeInteger = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
};

const normalizeNumber = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
};

const normalizeScheduleMode = (value, fallback = "manual") => {
  const normalized = normalizeText(value);
  return ["manual", "hourly", "daily", "weekly"].includes(normalized) ? normalized : fallback;
};

const normalizeTestEngineBrowser = (value, fallback = "chromium") => {
  const normalized = normalizeText(value);
  return ["chromium", "firefox", "webkit"].includes(normalized) ? normalized : fallback;
};

const normalizeTestEngineWebEngine = (value, fallback = "playwright") => {
  const normalized = normalizeText(value);
  return ["playwright", "selenium"].includes(normalized) ? normalized : fallback;
};

const normalizeTestEngineTraceMode = (value, fallback = "on-first-retry") => {
  const normalized = normalizeText(value);
  return ["off", "on", "on-first-retry", "retain-on-failure"].includes(normalized) ? normalized : fallback;
};

const normalizeTestEngineVideoMode = (value, fallback = "retain-on-failure") => {
  const normalized = normalizeText(value);
  return ["off", "on", "retain-on-failure"].includes(normalized) ? normalized : fallback;
};

const normalizeCloudRunProvider = (value, fallback = "browserstack") => {
  const normalized = normalizeText(value);
  return ["browserstack", "lambdatest", "saucelabs", "crossbrowser", "other"].includes(normalized) ? normalized : fallback;
};

const normalizeTestEnginePollIntervalMinutes = (value, fallback = 5) => {
  const parsed = normalizeNumber(value);
  const normalizedFallback = Math.max(0.5, normalizeNumber(fallback) || 5);
  return Math.max(0.5, Math.min(1440, parsed ?? normalizedFallback));
};

const normalizeTestEngineTimeoutMs = (value, fallback, { min = 100, max = 300000 } = {}) => {
  const parsed = normalizeInteger(value);
  const normalizedFallback = Math.max(min, normalizeInteger(fallback) || min);
  return Math.max(min, Math.min(max, parsed ?? normalizedFallback));
};

const normalizeTestEngineAttachmentLimitMb = (value, fallback = 25) => {
  const parsed = normalizeInteger(value);
  const normalizedFallback = Math.max(1, normalizeInteger(fallback) || 25);
  return Math.max(1, Math.min(250, parsed ?? normalizedFallback));
};

const TESTENGINE_CONNECTION_TIMEOUT_MS = Math.max(
  1500,
  normalizeInteger(process.env.TESTENGINE_CONNECTION_TIMEOUT_MS) || 5000
);
const MASKED_SECRET_VALUE = "********";

const isMaskedSecretValue = (value) => {
  if (typeof value !== "string") {
    return false;
  }

  const normalized = value.trim();
  return normalized === MASKED_SECRET_VALUE || /^\*{6,}$/.test(normalized) || /^[•●]{6,}$/.test(normalized);
};

const ensureAbsoluteHttpUrl = (value, label) => {
  const normalized = normalizeText(value);

  if (!normalized) {
    throw new Error(`${label} is required`);
  }

  let parsed;

  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error(`${label} must be an absolute http or https URL`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${label} must use http or https`);
  }

  return parsed;
};

function normalizeAbsoluteBaseUrl(value, label) {
  return ensureAbsoluteHttpUrl(value, label)
    .toString()
    .replace(/\/+$/, "");
}

const resolveOpsBaseUrl = async ({ base_url, project_id } = {}) => {
  const normalizedBaseUrl = normalizeText(base_url);

  if (normalizedBaseUrl) {
    return normalizeAbsoluteBaseUrl(normalizedBaseUrl, "OPS host URL");
  }

  const testEngineIntegration = await exports.getActiveIntegrationByTypeForProject("testengine", project_id);
  const engineBaseUrl = normalizeText(testEngineIntegration?.base_url);

  if (!engineBaseUrl) {
    throw new Error("OPS telemetry uses the active Test Engine host. Configure an active Test Engine integration first.");
  }

  return normalizeAbsoluteBaseUrl(engineBaseUrl, "Test Engine host URL");
};

const fetchWithTimeout = async (url, init = {}, timeoutMs = TESTENGINE_CONNECTION_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    }

    throw error;
  } finally {
    clearTimeout(timer);
  }
};

const readResponsePayload = async (response) => {
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  const rawBody = await response.text();

  if (!rawBody) {
    return null;
  }

  if (!contentType.includes("application/json")) {
    return rawBody;
  }

  try {
    return JSON.parse(rawBody);
  } catch {
    return rawBody;
  }
};

const testTestEngineConnection = async ({ base_url }) => {
  const engineBaseUrl = ensureAbsoluteHttpUrl(base_url, "Engine host URL");
  let normalizedBaseUrl = normalizeAbsoluteBaseUrl(base_url, "Engine host URL");
  let activeEngineBaseUrl = engineBaseUrl;
  let healthUrl = new URL("/health", activeEngineBaseUrl).toString();
  let capabilitiesUrl = new URL("/api/v1/capabilities", activeEngineBaseUrl).toString();
  const startedAt = Date.now();

  let healthResponse;

  try {
    healthResponse = await fetchWithTimeout(healthUrl, {
      headers: {
        accept: "application/json"
      }
    });
  } catch (error) {
    const localhostFallbacks = ["localhost", "127.0.0.1"].includes(engineBaseUrl.hostname.toLowerCase())
      ? ["http://host.docker.internal:4301", "http://testengine:4301"]
      : [];
    let fallbackError = error;

    for (const fallbackBaseUrl of localhostFallbacks) {
      try {
        activeEngineBaseUrl = ensureAbsoluteHttpUrl(fallbackBaseUrl, "Engine host URL");
        normalizedBaseUrl = normalizeAbsoluteBaseUrl(fallbackBaseUrl, "Engine host URL");
        healthUrl = new URL("/health", activeEngineBaseUrl).toString();
        capabilitiesUrl = new URL("/api/v1/capabilities", activeEngineBaseUrl).toString();
        healthResponse = await fetchWithTimeout(healthUrl, {
          headers: {
            accept: "application/json"
          }
        });
        fallbackError = null;
        break;
      } catch (nextError) {
        fallbackError = nextError;
      }
    }

    if (fallbackError) {
      throw new Error(
        `Unable to reach Test Engine health endpoint at ${new URL("/health", engineBaseUrl).toString()}: ${error instanceof Error ? error.message : "request failed"}`
      );
    }
  }

  const healthPayload = await readResponsePayload(healthResponse);

  if (!healthResponse.ok) {
    throw new Error(
      `Test Engine health check failed with status ${healthResponse.status}${healthResponse.statusText ? ` ${healthResponse.statusText}` : ""}`
    );
  }

  if (!healthPayload || typeof healthPayload !== "object" || healthPayload.ok !== true) {
    throw new Error("The target host responded, but it does not look like a healthy HelloTest Test Engine service");
  }

  let capabilitiesResponse;

  try {
    capabilitiesResponse = await fetchWithTimeout(capabilitiesUrl, {
      headers: {
        accept: "application/json"
      }
    });
  } catch (error) {
    throw new Error(
      `Reached the Test Engine host, but capabilities could not be read from ${capabilitiesUrl}: ${error instanceof Error ? error.message : "request failed"}`
    );
  }

  const capabilitiesPayload = await readResponsePayload(capabilitiesResponse);

  if (!capabilitiesResponse.ok) {
    throw new Error(
      `Test Engine capabilities check failed with status ${capabilitiesResponse.status}${capabilitiesResponse.statusText ? ` ${capabilitiesResponse.statusText}` : ""}`
    );
  }

  if (!capabilitiesPayload || typeof capabilitiesPayload !== "object" || !capabilitiesPayload.runner) {
    throw new Error("The target host responded, but its capabilities payload is missing the expected runner metadata");
  }

  const supportedStepTypes = Array.isArray(capabilitiesPayload.supported_step_types)
    ? capabilitiesPayload.supported_step_types.filter((item) => typeof item === "string")
    : [];
  const supportedWebEngines = Array.isArray(capabilitiesPayload.supported_web_engines)
    ? capabilitiesPayload.supported_web_engines.filter((item) => typeof item === "string")
    : [];

  return {
    ok: true,
    type: "testengine",
    base_url: normalizedBaseUrl,
    health_url: healthUrl,
    capabilities_url: capabilitiesUrl,
    latency_ms: Math.max(Date.now() - startedAt, 1),
    service: normalizeText(healthPayload.service) || "HelloTest Test Engine",
    runner: normalizeText(capabilitiesPayload.runner) || normalizeText(healthPayload.runner) || "unknown",
    ui: normalizeText(healthPayload.ui) || normalizeText(capabilitiesPayload.control_plane) || "unknown",
    control_plane: normalizeText(capabilitiesPayload.control_plane) || "unknown",
    execution_scope: normalizeText(capabilitiesPayload.execution_scope) || normalizeText(healthPayload.execution_scope) || "unknown",
    supported_step_types: supportedStepTypes,
    supported_web_engines: supportedWebEngines,
    qaira_result_log_compatibility: normalizeText(capabilitiesPayload.qaira_result_log_compatibility) || null
  };
};

const testOpsConnection = async ({ base_url, config = {}, api_key } = {}) => {
  const normalizedConfig = normalizeObject(config);
  const normalizedBaseUrl = await resolveOpsBaseUrl({
    base_url,
    project_id: normalizeText(normalizedConfig.project_id)
  });
  const opsBaseUrl = ensureAbsoluteHttpUrl(normalizedBaseUrl, "OPS host URL");
  const healthUrl = new URL(normalizeText(normalizedConfig.health_path) || "/health", opsBaseUrl).toString();
  const eventsPath = normalizeText(normalizedConfig.events_path) || "/api/v1/events";
  const eventsUrl = new URL(eventsPath, opsBaseUrl).toString();
  const boardUrl = new URL("/ops-telemetry", opsBaseUrl).toString();
  const startedAt = Date.now();
  const authHeaderName = normalizeText(normalizedConfig.api_key_header) || "Authorization";
  const authHeaderPrefix = Object.prototype.hasOwnProperty.call(normalizedConfig, "api_key_prefix")
    ? String(normalizedConfig.api_key_prefix ?? "")
    : "Bearer";
  const normalizedApiKey = normalizeText(api_key);
  const headers = {
    accept: "application/json"
  };

  if (normalizedApiKey) {
    headers[authHeaderName] = authHeaderPrefix ? `${authHeaderPrefix} ${normalizedApiKey}` : normalizedApiKey;
  }

  let healthResponse;

  try {
    healthResponse = await fetchWithTimeout(healthUrl, { headers });
  } catch (error) {
    throw new Error(
      `Unable to reach OPS health endpoint at ${healthUrl}: ${error instanceof Error ? error.message : "request failed"}`
    );
  }

  const healthPayload = await readResponsePayload(healthResponse);

  if (!healthResponse.ok) {
    throw new Error(
      `OPS health check failed with status ${healthResponse.status}${healthResponse.statusText ? ` ${healthResponse.statusText}` : ""}`
    );
  }

  let eventsResponse;

  try {
    eventsResponse = await fetchWithTimeout(eventsUrl, { headers });
  } catch (error) {
    throw new Error(
      `Reached the OPS host, but the events endpoint could not be read from ${eventsUrl}: ${error instanceof Error ? error.message : "request failed"}`
    );
  }

  if (!eventsResponse.ok) {
    throw new Error(
      `OPS events endpoint check failed with status ${eventsResponse.status}${eventsResponse.statusText ? ` ${eventsResponse.statusText}` : ""}`
    );
  }

  return {
    ok: true,
    type: "ops",
    base_url: normalizedBaseUrl,
    health_url: healthUrl,
    events_url: eventsUrl,
    board_url: normalizeText(healthPayload?.ops_telemetry?.board_url) || boardUrl,
    latency_ms: Math.max(Date.now() - startedAt, 1),
    service: normalizeText(healthPayload?.ops_telemetry?.service_name) || normalizeText(healthPayload?.service) || "OPS service",
    events_path: eventsPath
  };
};

const normalizeConfig = (type, input, username) => {
  const raw = normalizeObject(input);
  const integrationTypeConfig = INTEGRATION_TYPE_OPTIONS.find((option) => option.value === type)?.defaults || {};

  if (type === "email") {
    const host = normalizeText(raw.host);
    const port = normalizeInteger(raw.port);
    const password = normalizeText(raw.password);
    const secure = Boolean(raw.secure);
    const sender_email = normalizeText(raw.sender_email) || integrationTypeConfig.sender_email || null;
    const sender_name = normalizeText(raw.sender_name) || integrationTypeConfig.sender_name || null;

    if (!host) {
      throw new Error("Email integrations require an SMTP host");
    }

    if (!port || port <= 0) {
      throw new Error("Email integrations require a valid SMTP port");
    }

    if (!username) {
      throw new Error("Email integrations require an SMTP username or email");
    }

    if (!password) {
      throw new Error("Email integrations require an SMTP password");
    }

    return {
      host,
      port,
      secure,
      password,
      sender_email,
      sender_name
    };
  }

  if (type === "google_auth") {
    const client_id = normalizeText(raw.client_id);

    if (!client_id) {
      throw new Error("Google sign-in integrations require a Google client ID");
    }

    return {
      client_id
    };
  }

  if (type === "google_drive") {
    const project_id = normalizeText(raw.project_id);
    const folder_id = normalizeText(raw.folder_id);

    if (!project_id) {
      throw new Error("Google Drive backup integrations require a project");
    }

    if (!folder_id) {
      throw new Error("Google Drive backup integrations require a Drive folder ID");
    }

    return {
      project_id,
      folder_id,
      schedule_mode: normalizeScheduleMode(raw.schedule_mode),
      include_requirements_csv: raw.include_requirements_csv !== false,
      include_test_cases_csv: raw.include_test_cases_csv !== false,
      next_sync_at: normalizeText(raw.next_sync_at),
      last_synced_at: normalizeText(raw.last_synced_at),
      last_sync_status: normalizeText(raw.last_sync_status),
      last_sync_transaction_id: normalizeText(raw.last_sync_transaction_id),
      last_sync_summary: normalizeText(raw.last_sync_summary)
    };
  }

  if (type === "github") {
    const project_id = normalizeText(raw.project_id);
    const owner = normalizeText(raw.owner);
    const repo = normalizeText(raw.repo);

    if (!project_id) {
      throw new Error("GitHub sync integrations require a project");
    }

    if (!owner || !repo) {
      throw new Error("GitHub sync integrations require both repository owner and repository name");
    }

    return {
      project_id,
      owner,
      repo,
      branch: normalizeText(raw.branch) || "main",
      directory: normalizeText(raw.directory) || "qaira-sync",
      file_extension: normalizeText(raw.file_extension) || "ts",
      schedule_mode: normalizeScheduleMode(raw.schedule_mode),
      next_sync_at: normalizeText(raw.next_sync_at),
      last_synced_at: normalizeText(raw.last_synced_at),
      last_sync_status: normalizeText(raw.last_sync_status),
      last_sync_transaction_id: normalizeText(raw.last_sync_transaction_id),
      last_sync_summary: normalizeText(raw.last_sync_summary)
    };
  }

  if (type === "testengine" || type === "local-desktop") {
    const project_id = normalizeText(raw.project_id);
    const active_web_engine = normalizeTestEngineWebEngine(raw.active_web_engine, String(integrationTypeConfig.active_web_engine || "playwright"));

    return {
      project_id,
      runner: type === "local-desktop" ? "local" : "hybrid",
      dispatch_mode: "qaira-pull",
      execution_scope: "api+web",
      active_web_engine,
      browser: normalizeTestEngineBrowser(raw.browser, String(integrationTypeConfig.browser || "chromium")),
      headless: raw.headless === true,
      healing_enabled: raw.healing_enabled !== false,
      max_repair_attempts: normalizeInteger(raw.max_repair_attempts) ?? Number(integrationTypeConfig.max_repair_attempts ?? 0),
      trace_mode: normalizeTestEngineTraceMode(raw.trace_mode, String(integrationTypeConfig.trace_mode || "off")),
      video_mode: normalizeTestEngineVideoMode(raw.video_mode, String(integrationTypeConfig.video_mode || "off")),
      capture_console: raw.capture_console !== false,
      capture_network: raw.capture_network !== false,
      artifact_retention_days: normalizeInteger(raw.artifact_retention_days) ?? Number(integrationTypeConfig.artifact_retention_days ?? 7),
      run_timeout_seconds: normalizeInteger(raw.run_timeout_seconds) ?? Number(integrationTypeConfig.run_timeout_seconds ?? 1800),
      navigation_timeout_ms: normalizeTestEngineTimeoutMs(
        raw.navigation_timeout_ms,
        integrationTypeConfig.navigation_timeout_ms ?? 30000,
        { min: 1000, max: 600000 }
      ),
      action_timeout_ms: normalizeTestEngineTimeoutMs(
        raw.action_timeout_ms,
        integrationTypeConfig.action_timeout_ms ?? 5000,
        { min: 250, max: 120000 }
      ),
      assertion_timeout_ms: normalizeTestEngineTimeoutMs(
        raw.assertion_timeout_ms,
        integrationTypeConfig.assertion_timeout_ms ?? 10000,
        { min: 250, max: 120000 }
      ),
      recovery_wait_ms: normalizeTestEngineTimeoutMs(
        raw.recovery_wait_ms,
        integrationTypeConfig.recovery_wait_ms ?? 750,
        { min: 100, max: 30000 }
      ),
      max_video_attachment_mb: normalizeTestEngineAttachmentLimitMb(
        raw.max_video_attachment_mb,
        integrationTypeConfig.max_video_attachment_mb ?? 25
      ),
      queue_poll_interval_minutes: normalizeTestEnginePollIntervalMinutes(
        raw.queue_poll_interval_minutes,
        integrationTypeConfig.queue_poll_interval_minutes ?? 5
      ),
      qaira_api_base_url: normalizeText(raw.qaira_api_base_url),
      promote_healed_patches: normalizeText(raw.promote_healed_patches) || String(integrationTypeConfig.promote_healed_patches || "review"),
      public_base_url: normalizeText(raw.public_base_url),
      recorder_public_base_url: normalizeText(raw.recorder_public_base_url),
      ops_public_base_url: normalizeText(raw.ops_public_base_url),
      live_view_url: normalizeText(raw.live_view_url),
      mobile_engine_url: normalizeText(raw.mobile_engine_url),
      mobile_engine_internal_url: normalizeText(raw.mobile_engine_internal_url),
      mobile_cloud_provider: normalizeText(raw.mobile_cloud_provider),
      mobile_remote_url: normalizeText(raw.mobile_remote_url),
      mobile_username: normalizeText(raw.mobile_username),
      mobile_access_key: normalizeText(raw.mobile_access_key),
      device_name: normalizeText(raw.device_name),
      platform_version: normalizeText(raw.platform_version),
      android_app: normalizeText(raw.android_app),
      appium_server_url: normalizeText(raw.appium_server_url),
      app_package: normalizeText(raw.app_package),
      app_activity: normalizeText(raw.app_activity)
    };
  }

  if (type === "cloudrun") {
    return {
      provider: normalizeCloudRunProvider(raw.provider, String(integrationTypeConfig.provider || "browserstack")),
      project_id: normalizeText(raw.project_id),
      remote_url: normalizeText(raw.remote_url),
      browser: normalizeText(raw.browser) || String(integrationTypeConfig.browser || "Chrome"),
      os: normalizeText(raw.os) || String(integrationTypeConfig.os || "Windows"),
      device_name: normalizeText(raw.device_name),
      platform_version: normalizeText(raw.platform_version),
      build_name: normalizeText(raw.build_name),
      session_name: normalizeText(raw.session_name),
      provider_options: isPlainObject(raw.provider_options) ? raw.provider_options : {}
    };
  }

  if (type === "ops") {
    return {
      project_id: normalizeText(raw.project_id),
      events_path: normalizeText(raw.events_path) || String(integrationTypeConfig.events_path || "/api/v1/events"),
      health_path: normalizeText(raw.health_path) || String(integrationTypeConfig.health_path || "/health"),
      service_name: normalizeText(raw.service_name) || String(integrationTypeConfig.service_name || "qaira-testengine"),
      environment: normalizeText(raw.environment) || String(integrationTypeConfig.environment || "production"),
      timeout_ms: Math.max(500, normalizeInteger(raw.timeout_ms) ?? Number(integrationTypeConfig.timeout_ms ?? 4000)),
      emit_step_events: raw.emit_step_events !== false,
      emit_case_events: raw.emit_case_events !== false,
      emit_suite_events: raw.emit_suite_events !== false,
      emit_run_events: raw.emit_run_events !== false
    };
  }

  return {};
};

const normalizeIntegration = (integration) => {
  if (!integration) {
    return integration;
  }

  return {
    ...integration,
    is_active: Boolean(integration.is_active),
    config: isPlainObject(integration.config) ? integration.config : {}
  };
};

const validateType = (type) => {
  if (!INTEGRATION_TYPE_VALUES.includes(type)) {
    throw new Error(`Unsupported integration type: ${type}`);
  }
};

const validatePayload = (payload) => {
  const type = normalizeText(payload.type);
  const name = normalizeText(payload.name);
  const base_url = normalizeText(payload.base_url);
  const api_key = normalizeText(payload.api_key);
  const model = normalizeText(payload.model);
  const project_key = normalizeText(payload.project_key);
  const username = normalizeText(payload.username);
  const is_active = payload.is_active !== undefined ? Boolean(payload.is_active) : true;

  validateType(type);

  if (!name) {
    throw new Error("Integration name is required");
  }

  if (type === "llm") {
    if (!api_key) {
      throw new Error("LLM integrations require an API key");
    }

    if (!model) {
      throw new Error("LLM integrations require a model");
    }
  }

  if (type === "jira") {
    if (!base_url) {
      throw new Error("Jira integrations require a base URL");
    }

    if (!api_key) {
      throw new Error("Jira integrations require an API key");
    }
  }

  if (type === "google_drive" || type === "github") {
    if (!api_key) {
      throw new Error(`${type === "google_drive" ? "Google Drive" : "GitHub"} integrations require an access token`);
    }
  }

  if (type === "testengine" || type === "local-desktop") {
    if (!base_url) {
      throw new Error(`${type === "local-desktop" ? "Local Desktop" : "Test Engine"} integrations require a host URL`);
    }
  }

  if (type === "cloudrun" && is_active) {
    const cloudConfig = normalizeObject(payload.config);

    if (!base_url && !normalizeText(cloudConfig.remote_url)) {
      throw new Error("Cloud Run integrations require a remote hub URL");
    }

    if (!username) {
      throw new Error("Cloud Run integrations require a provider username");
    }

    if (!api_key) {
      throw new Error("Cloud Run integrations require an access key");
    }
  }

  if (type === "ops") {
    // OPS telemetry resolves its host from the active Test Engine integration unless an override URL is provided.
  }

  const config = normalizeConfig(type, payload.config, username);

  return {
    type,
    name,
    base_url,
    api_key,
    model,
    project_key,
    username,
    config,
    is_active
  };
};

exports.createIntegration = async (input) => {
  const payload = validatePayload(input);
  const id = uuid();

  await db.prepare(`
    INSERT INTO integrations (id, type, name, base_url, api_key, model, project_key, username, config, is_active, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).run(
    id,
    payload.type,
    payload.name,
    payload.base_url,
    payload.api_key,
    payload.model,
    payload.project_key,
    payload.username,
    payload.config,
    payload.is_active
  );

  return { id };
};

exports.getIntegrations = async ({ type, is_active } = {}) => {
  let query = `
    SELECT *
    FROM integrations
    WHERE 1=1
  `;
  const params = [];

  if (type) {
    validateType(type);
    query += ` AND type = ?`;
    params.push(type);
  }

  if (is_active !== undefined) {
    query += ` AND is_active = ?`;
    params.push(Boolean(is_active));
  }

  query += ` ORDER BY is_active DESC, updated_at DESC, created_at DESC, name ASC`;

  const rows = await db.prepare(query).all(...params);
  return rows.map(normalizeIntegration);
};

exports.getIntegration = async (id) => {
  const integration = await db.prepare(`
    SELECT *
    FROM integrations
    WHERE id = ?
  `).get(id);

  if (!integration) {
    throw new Error("Integration not found");
  }

  return normalizeIntegration(integration);
};

exports.getActiveIntegrationByType = async (type) => {
  validateType(type);

  const integration = await db.prepare(`
    SELECT *
    FROM integrations
    WHERE type = ? AND is_active = TRUE
    ORDER BY updated_at DESC, created_at DESC
    LIMIT 1
  `).get(type);

  return normalizeIntegration(integration || null);
};

exports.getActiveIntegrationByTypeForProject = async (type, projectId) => {
  validateType(type);

  const normalizedProjectId = normalizeText(projectId);

  if (normalizedProjectId) {
    const projectScopedIntegration = await db.prepare(`
      SELECT *
      FROM integrations
      WHERE type = ?
        AND is_active = TRUE
        AND config->>'project_id' = ?
      ORDER BY updated_at DESC, created_at DESC
      LIMIT 1
    `).get(type, normalizedProjectId);

    if (projectScopedIntegration) {
      return normalizeIntegration(projectScopedIntegration);
    }
  }

  const globalIntegration = await db.prepare(`
    SELECT *
    FROM integrations
    WHERE type = ?
      AND is_active = TRUE
      AND COALESCE(NULLIF(config->>'project_id', ''), '') = ''
    ORDER BY updated_at DESC, created_at DESC
    LIMIT 1
  `).get(type);

  if (globalIntegration) {
    return normalizeIntegration(globalIntegration);
  }

  return normalizedProjectId ? null : exports.getActiveIntegrationByType(type);
};

exports.updateIntegration = async (id, input) => {
  const existing = await exports.getIntegration(id);
  const nextType = input.type ?? existing.type;
  const nextConfig =
    input.config === undefined
      ? existing.config
      : nextType === existing.type
        ? {
            ...(existing.config || {}),
            ...normalizeObject(input.config),
            ...(isMaskedSecretValue(input.config?.password) ? { password: existing.config?.password || null } : {}),
            ...(isMaskedSecretValue(input.config?.callback_secret) ? { callback_secret: existing.config?.callback_secret || null } : {}),
            ...(isMaskedSecretValue(input.config?.mobile_access_key) ? { mobile_access_key: existing.config?.mobile_access_key || null } : {})
          }
        : normalizeObject(input.config);
  const nextApiKey = Object.prototype.hasOwnProperty.call(input, "api_key")
    ? isMaskedSecretValue(input.api_key)
      ? existing.api_key
      : input.api_key
    : existing.api_key;
  const payload = validatePayload({
    type: nextType,
    name: input.name ?? existing.name,
    base_url: input.base_url ?? existing.base_url,
    api_key: nextApiKey,
    model: input.model ?? existing.model,
    project_key: input.project_key ?? existing.project_key,
    username: input.username ?? existing.username,
    config: nextConfig,
    is_active: input.is_active ?? existing.is_active
  });

  await db.prepare(`
    UPDATE integrations
    SET type = ?, name = ?, base_url = ?, api_key = ?, model = ?, project_key = ?, username = ?, config = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    payload.type,
    payload.name,
    payload.base_url,
    payload.api_key,
    payload.model,
    payload.project_key,
    payload.username,
    payload.config,
    payload.is_active,
    id
  );

  return { updated: true };
};

exports.deleteIntegration = async (id) => {
  await exports.getIntegration(id);

  await db.prepare(`
    DELETE FROM integrations
    WHERE id = ?
  `).run(id);

  return { deleted: true };
};

exports.exportIntegrations = async () => {
  const integrations = await exports.getIntegrations();

  return {
    version: 1,
    exported_at: new Date().toISOString(),
    integrations
  };
};

exports.importIntegrations = async (input = {}) => {
  const entries = Array.isArray(input) ? input : input.integrations;

  if (!Array.isArray(entries)) {
    throw new Error("Integration import requires an integrations array");
  }

  const result = {
    imported: 0,
    updated: 0,
    failed: 0,
    failures: []
  };

  for (const entry of entries) {
    if (!isPlainObject(entry)) {
      result.failed += 1;
      result.failures.push({ name: "Unknown integration", error: "Entry must be an object" });
      continue;
    }

    const id = normalizeText(entry.id);
    const existing = id
      ? normalizeIntegration(await db.prepare(`SELECT * FROM integrations WHERE id = ?`).get(id) || null)
      : null;
    const payload = {
      type: entry.type,
      name: entry.name,
      base_url: entry.base_url,
      api_key: entry.api_key,
      model: entry.model,
      project_key: entry.project_key,
      username: entry.username,
      config: entry.config,
      is_active: entry.is_active
    };

    try {
      if (existing) {
        await exports.updateIntegration(existing.id, payload);
        result.updated += 1;
      } else {
        if (
          isMaskedSecretValue(payload.api_key)
          || isMaskedSecretValue(payload.config?.password)
          || isMaskedSecretValue(payload.config?.mobile_access_key)
        ) {
          throw new Error("Masked secrets can only update an existing integration. Provide real credentials to import a new one.");
        }

        await exports.createIntegration(payload);
        result.imported += 1;
      }
    } catch (error) {
      result.failed += 1;
      result.failures.push({
        name: normalizeText(entry.name) || normalizeText(entry.id) || "Unknown integration",
        error: error instanceof Error ? error.message : "Import failed"
      });
    }
  }

  return result;
};

exports.mergeIntegrationConfig = async (id, configUpdates = {}) => {
  const existing = await exports.getIntegration(id);
  const nextConfig = {
    ...(existing.config || {}),
    ...normalizeObject(configUpdates)
  };

  await db.prepare(`
    UPDATE integrations
    SET config = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(nextConfig, id);

  return exports.getIntegration(id);
};

exports.testConnection = async (input = {}) => {
  const type = normalizeText(input.type);

  validateType(type);

  if (type === "testengine" || type === "local-desktop") {
    return testTestEngineConnection({
      base_url: input.base_url
    });
  }

  if (type === "ops") {
    return testOpsConnection({
      base_url: input.base_url,
      config: input.config,
      api_key: input.api_key
    });
  }

  throw new Error("Connection testing is currently available only for Test Engine and OPS integrations");
};
