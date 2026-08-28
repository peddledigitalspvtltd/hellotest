const apiPackage = require("../../package.json");
const { config: defaultConfig } = require("../config");
const defaultDb = require("../db");
const defaultObsDb = require("../obsDb");
const defaultCache = require("../utils/cache");
const defaultObjectStorage = require("./objectStorage.service");

const HEALTH_STATUSES = Object.freeze({
  READY: "ready",
  DEGRADED: "degraded",
  BLOCKED: "blocked"
});

const DEFAULT_PROBE_TIMEOUT_MS = 3_000;

const normalizeTimeout = (value, fallback = DEFAULT_PROBE_TIMEOUT_MS) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 100 ? Math.trunc(parsed) : fallback;
};

const sanitizeEndpoint = (value) => {
  if (!value) return null;

  try {
    const endpoint = new URL(String(value));
    endpoint.username = "";
    endpoint.password = "";
    endpoint.search = "";
    endpoint.hash = "";
    return endpoint.toString().replace(/\/$/, "");
  } catch {
    return String(value)
      .replace(/:\/\/[^/@\s]+@/g, "://[redacted]@")
      .replace(/([?&](?:token|key|secret|password)=)[^&\s]+/gi, "$1[redacted]");
  }
};

const sanitizeError = (error, secrets = []) => {
  let message = error instanceof Error ? error.message : String(error || "Health probe failed");

  for (const secret of secrets) {
    if (secret && String(secret).length >= 3) {
      message = message.split(String(secret)).join("[redacted]");
    }
  }

  return message
    .replace(/:\/\/([^/@\s]+)@/g, "://[redacted]@")
    .replace(/\b(password|secret|token|api[_-]?key)\s*[=:]\s*[^\s,;]+/gi, "$1=[redacted]")
    .slice(0, 500);
};

const runWithTimeout = async (operation, timeoutMs, label) => {
  let timeout;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
        timeout.unref?.();
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
};

const aggregateStatus = (checks) => {
  if (checks.some((check) => check.critical && check.status === HEALTH_STATUSES.BLOCKED)) {
    return HEALTH_STATUSES.BLOCKED;
  }

  if (checks.some((check) => check.status !== HEALTH_STATUSES.READY)) {
    return HEALTH_STATUSES.DEGRADED;
  }

  return HEALTH_STATUSES.READY;
};

const buildCheck = ({
  key,
  label,
  critical = false,
  status,
  summary,
  detail = null,
  remediation = null,
  metrics = {}
}) => ({
  key,
  label,
  critical,
  status,
  summary,
  detail,
  remediation,
  metrics
});

function createRuntimeHealthService({
  config = defaultConfig,
  db = defaultDb,
  obsDb = defaultObsDb,
  cache = defaultCache,
  objectStorage = defaultObjectStorage,
  fetchImpl = globalThis.fetch,
  getTelemetryState = () => require("../tracing").getState(),
  now = () => Date.now(),
  version = apiPackage.version,
  probeTimeoutMs = normalizeTimeout(process.env.HEALTH_PROBE_TIMEOUT_MS)
} = {}) {
  const secrets = [
    config.postgres?.password,
    config.obsPostgres?.password,
    config.objectStorage?.accessKey,
    config.objectStorage?.secretKey
  ];

  const executeProbe = async ({ key, label, critical, failureSummary, remediation }, operation) => {
    const startedAt = now();
    try {
      const result = await runWithTimeout(operation, probeTimeoutMs, label);
      const durationMs = Math.max(0, now() - startedAt);
      return buildCheck({
        key,
        label,
        critical,
        status: HEALTH_STATUSES.READY,
        summary: result?.summary || `${label} is ready.`,
        detail: result?.detail || null,
        remediation: null,
        metrics: { latency_ms: durationMs, ...(result?.metrics || {}) }
      });
    } catch (error) {
      const durationMs = Math.max(0, now() - startedAt);
      return buildCheck({
        key,
        label,
        critical,
        status: HEALTH_STATUSES.BLOCKED,
        summary: failureSummary,
        detail: sanitizeError(error, secrets),
        remediation,
        metrics: { latency_ms: durationMs }
      });
    }
  };

  const probeMainDatabase = () => executeProbe({
    key: "database",
    label: "HelloTest database",
    critical: true,
    failureSummary: "The primary PostgreSQL service is unavailable.",
    remediation: "Restore the configured PostgreSQL service and verify its credentials and network policy."
  }, async () => {
    const result = await db.query("SELECT CURRENT_TIMESTAMP AS checked_at");
    const pool = db.getPoolStats?.();
    return {
      summary: "Primary PostgreSQL is accepting authenticated queries.",
      detail: result.rows?.[0]?.checked_at ? `Database checked at ${result.rows[0].checked_at}.` : null,
      metrics: {
        provider: "postgresql",
        ...(pool ? {
          pool_active: pool.active,
          pool_idle: pool.idle,
          pool_waiting: pool.waiting,
          pool_max: pool.max,
          pool_saturated: pool.saturated
        } : {})
      }
    };
  });

  const probeExecutionDatabase = () => executeProbe({
    key: "execution_database",
    label: "Execution and observability database",
    critical: true,
    failureSummary: "The execution and observability PostgreSQL service is unavailable.",
    remediation: "Provision the configured observability database and run the API runtime schema bootstrap."
  }, async () => {
    await obsDb.query("SELECT 1 AS ready");
    const pool = obsDb.getPoolStats?.();
    return {
      summary: "Execution state and operational records are available.",
      metrics: {
        provider: "postgresql",
        ...(pool ? {
          pool_active: pool.active,
          pool_idle: pool.idle,
          pool_waiting: pool.waiting,
          pool_max: pool.max,
          pool_saturated: pool.saturated
        } : {})
      }
    };
  });

  const probeCache = async () => {
    const startedAt = now();
    try {
      const connected = await runWithTimeout(() => cache.ensureRedis(), probeTimeoutMs, "Redis cache");
      if (!connected) throw new Error("Redis did not accept a connection");
      const response = await runWithTimeout(() => cache.redis.ping(), probeTimeoutMs, "Redis cache");
      if (response !== "PONG") throw new Error("Redis returned an unexpected health response");
      return buildCheck({
        key: "cache",
        label: "Cache and coordination",
        status: HEALTH_STATUSES.READY,
        summary: "Redis is ready for cache and coordination workloads.",
        metrics: { latency_ms: Math.max(0, now() - startedAt), provider: "redis" }
      });
    } catch (error) {
      return buildCheck({
        key: "cache",
        label: "Cache and coordination",
        status: HEALTH_STATUSES.DEGRADED,
        summary: "Redis is unavailable; cache-backed operations are degraded.",
        detail: sanitizeError(error, secrets),
        remediation: "Restore Redis or update REDIS_URL. The API continues with reduced cache and coordination capabilities.",
        metrics: { latency_ms: Math.max(0, now() - startedAt), provider: "redis" }
      });
    }
  };

  const probeStorage = async () => {
    if (!objectStorage.isEnabled()) {
      return buildCheck({
        key: "storage",
        label: "Object storage",
        status: HEALTH_STATUSES.DEGRADED,
        summary: "Object storage is disabled; binary evidence features are unavailable.",
        remediation: "Configure MinIO or S3 when attachments and generated artifacts are required.",
        metrics: { enabled: false, provider: config.storageProvider }
      });
    }

    const check = await executeProbe({
      key: "storage",
      label: "Object storage",
      critical: false,
      failureSummary: "The configured object storage service is unavailable.",
      remediation: "Verify the MinIO/S3 endpoint, credentials, network, and bucket permissions."
    }, async () => {
      const result = await objectStorage.probeBucket();
      if (!result.exists) {
        throw new Error(`Configured bucket ${result.bucket} does not exist`);
      }
      return {
        summary: "Object storage is reachable and the configured bucket exists.",
        detail: `Bucket ${result.bucket} was verified without modifying storage.`,
        metrics: { enabled: true, provider: config.storageProvider, bucket: result.bucket }
      };
    });

    return check.status === HEALTH_STATUSES.BLOCKED
      ? { ...check, critical: false }
      : check;
  };

  const probeDocumentExtraction = async () => {
    const tikaUrl = String(config.knowledge?.tikaUrl || "").trim();
    if (!tikaUrl) {
      return buildCheck({
        key: "document_extraction",
        label: "Document extraction",
        status: HEALTH_STATUSES.DEGRADED,
        summary: "Apache Tika is not configured; rich document extraction is limited.",
        remediation: "Configure KNOWLEDGE_TIKA_URL to process PDFs, Office files, and other rich formats.",
        metrics: { enabled: false }
      });
    }

    return executeProbe({
      key: "document_extraction",
      label: "Document extraction",
      critical: false,
      failureSummary: "Apache Tika is configured but unavailable.",
      remediation: "Restore the Tika service or update KNOWLEDGE_TIKA_URL."
    }, async () => {
      if (typeof fetchImpl !== "function") throw new Error("HTTP client is unavailable");
      const response = await fetchImpl(new URL("/version", tikaUrl), {
        headers: { accept: "text/plain" },
        signal: AbortSignal.timeout(probeTimeoutMs)
      });
      if (!response.ok) throw new Error(`Tika health request failed with status ${response.status}`);
      return {
        summary: "Apache Tika is ready for rich document extraction.",
        detail: `Endpoint: ${sanitizeEndpoint(tikaUrl)}`,
        metrics: { enabled: true }
      };
    });
  };

  const describeTelemetry = async () => {
    const endpoint = sanitizeEndpoint(config.otelEndpoint);
    if (!config.enableObservability) {
      return buildCheck({
        key: "telemetry",
        label: "Distributed telemetry",
        status: HEALTH_STATUSES.DEGRADED,
        summary: "OpenTelemetry export is disabled.",
        remediation: "Set ENABLE_OBSERVABILITY=true and configure an OTLP Collector endpoint.",
        metrics: { enabled: false, endpoint: endpoint || null }
      });
    }

    if (!endpoint) {
      return buildCheck({
        key: "telemetry",
        label: "Distributed telemetry",
        status: HEALTH_STATUSES.DEGRADED,
        summary: "OpenTelemetry is enabled without an OTLP endpoint.",
        remediation: "Configure OTEL_EXPORTER_OTLP_ENDPOINT with the Collector base endpoint.",
        metrics: { enabled: true, exporter_configured: false }
      });
    }

    const telemetryState = getTelemetryState();
    if (!telemetryState.started) {
      return buildCheck({
        key: "telemetry",
        label: "Distributed telemetry",
        status: HEALTH_STATUSES.BLOCKED,
        summary: "OpenTelemetry was enabled but its SDK did not start.",
        detail: sanitizeError(telemetryState.error || "OpenTelemetry SDK is inactive", secrets),
        remediation: "Verify the OpenTelemetry SDK configuration and Collector endpoint, then restart the API.",
        metrics: { enabled: true, exporter_configured: Boolean(telemetryState.exporterConfigured), started: false }
      });
    }

    return buildCheck({
      key: "telemetry",
      label: "Distributed telemetry",
      status: HEALTH_STATUSES.READY,
      summary: "OpenTelemetry tracing is enabled and an OTLP exporter is configured.",
      detail: `Collector endpoint: ${endpoint}`,
      metrics: { enabled: true, exporter_configured: true, started: true, endpoint }
    });
  };

  const runChecks = async ({ includeOptional = true } = {}) => {
    const required = [probeMainDatabase(), probeExecutionDatabase()];
    const optional = includeOptional
      ? [probeCache(), probeStorage(), probeDocumentExtraction(), describeTelemetry()]
      : [];
    const checks = await Promise.all([...required, ...optional]);

    return {
      status: aggregateStatus(checks),
      checked_at: new Date().toISOString(),
      version,
      service: "hellotest-api",
      checks
    };
  };

  return {
    aggregateStatus,
    runChecks,
    sanitizeEndpoint,
    sanitizeError
  };
}

module.exports = {
  HEALTH_STATUSES,
  aggregateStatus,
  createRuntimeHealthService,
  runtimeHealthService: createRuntimeHealthService(),
  sanitizeEndpoint,
  sanitizeError
};
