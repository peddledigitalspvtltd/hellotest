const APP_MODES = new Set(["local", "docker", "aws", "k8s"]);
const STORAGE_PROVIDERS = new Set(["local", "minio", "s3"]);
const QUEUE_PROVIDERS = new Set(["redis"]);
const KNOWLEDGE_VECTOR_PROVIDERS = new Set(["postgresql", "qdrant"]);
const { httpConfig } = require("./runtime/httpConfig");

const normalizeBoolean = (value, fallback = false) => {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
};

const normalizeNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

const enumValue = (value, allowed, fallback) => {
  const normalized = String(value || "").trim().toLowerCase();
  return allowed.has(normalized) ? normalized : fallback;
};

const appMode = enumValue(process.env.APP_MODE, APP_MODES, "local");
const localOnly = appMode === "local";
const production = process.env.NODE_ENV === "production";

const serviceHost = (name, localFallback) => (localOnly ? localFallback : name);

const postgresUrl = process.env.POSTGRES_URL || process.env.DATABASE_URL || "";
const postgres = {
  host: process.env.PGHOST || process.env.POSTGRES_HOST || serviceHost("postgres", "localhost"),
  port: normalizeNumber(process.env.PGPORT || process.env.POSTGRES_PORT, 5432),
  user: process.env.PGUSER || process.env.POSTGRES_USER || "hellotest",
  password: process.env.PGPASSWORD || process.env.POSTGRES_PASSWORD || "hellotest",
  database: process.env.PGDATABASE || process.env.POSTGRES_DB || "hellotest"
};
const explicitObsPostgresUrl = process.env.OBS_POSTGRES_URL || process.env.OBS_DATABASE_URL || "";
const obsPostgresUrl = explicitObsPostgresUrl || postgresUrl;
const obsPostgres = {
  host: process.env.OBS_PGHOST || process.env.OBS_POSTGRES_HOST || postgres.host,
  port: normalizeNumber(process.env.OBS_PGPORT || process.env.OBS_POSTGRES_PORT, postgres.port),
  user: process.env.OBS_PGUSER || process.env.OBS_POSTGRES_USER || postgres.user,
  password: process.env.OBS_PGPASSWORD || process.env.OBS_POSTGRES_PASSWORD || postgres.password,
  database: process.env.OBS_PGDATABASE || process.env.OBS_POSTGRES_DB || postgres.database
};

const databaseIdentity = (connectionUrl, settings, label) => {
  if (!connectionUrl) {
    return {
      host: String(settings.host).trim().toLowerCase(),
      port: Number(settings.port),
      database: String(settings.database).trim()
    };
  }

  try {
    const parsed = new URL(connectionUrl);
    return {
      host: parsed.hostname.toLowerCase(),
      port: Number(parsed.port || 5432),
      database: decodeURIComponent(parsed.pathname.replace(/^\//, ""))
    };
  } catch {
    throw new Error(`${label} must be a valid PostgreSQL connection URL`);
  }
};

const hasExplicitObsDatabase = Boolean(
  explicitObsPostgresUrl
  || process.env.OBS_PGHOST
  || process.env.OBS_POSTGRES_HOST
  || process.env.OBS_PGPORT
  || process.env.OBS_POSTGRES_PORT
  || process.env.OBS_PGDATABASE
  || process.env.OBS_POSTGRES_DB
);

if (hasExplicitObsDatabase) {
  const mainIdentity = databaseIdentity(postgresUrl, postgres, "DATABASE_URL");
  const obsIdentity = databaseIdentity(obsPostgresUrl, obsPostgres, "OBS_DATABASE_URL");
  const isSameDatabase = mainIdentity.host === obsIdentity.host
    && mainIdentity.port === obsIdentity.port
    && mainIdentity.database === obsIdentity.database;

  if (!isSameDatabase) {
    throw new Error(
      "A separate OBS database is not supported by this release because execution records still reference product-domain tables. Point OBS_DATABASE_URL at the primary HelloTest database."
    );
  }
}

const config = {
  appMode,
  port: normalizeNumber(process.env.PORT, 3000),
  postgresUrl,
  postgres,
  obsPostgresUrl,
  obsPostgres,
  redisUrl: process.env.REDIS_URL || `redis://${serviceHost("redis", "localhost")}:6379`,
  storageProvider: enumValue(process.env.STORAGE_PROVIDER, STORAGE_PROVIDERS, "local"),
  evidenceLocalPath: process.env.EVIDENCE_LOCAL_PATH || "/tmp/hellotest-evidence",
  s3Bucket: process.env.S3_BUCKET || process.env.MINIO_BUCKET || "hellotest-artifacts",
  objectStorage: {
    endpoint: process.env.MINIO_ENDPOINT || process.env.S3_ENDPOINT || serviceHost("minio", "localhost"),
    port: normalizeNumber(process.env.MINIO_PORT || process.env.S3_PORT, 9000),
    useSsl: normalizeBoolean(process.env.MINIO_USE_SSL || process.env.S3_USE_SSL, false),
    accessKey: process.env.MINIO_ACCESS_KEY || process.env.MINIO_ROOT_USER || process.env.S3_ACCESS_KEY || "hellotest",
    secretKey: process.env.MINIO_SECRET_KEY || process.env.MINIO_ROOT_PASSWORD || process.env.S3_SECRET_KEY || "hellotest-minio-dev-secret",
    region: process.env.MINIO_REGION || process.env.S3_REGION || "us-east-1",
    bucket: process.env.MINIO_BUCKET || process.env.S3_BUCKET || "hellotest-attachments",
    maxAttachmentBytes: normalizeNumber(process.env.MAX_ATTACHMENT_BYTES, 100 * 1024 * 1024)
  },
  knowledge: {
    maxFileBytes: normalizeNumber(process.env.KNOWLEDGE_MAX_FILE_BYTES, 50 * 1024 * 1024),
    extractionMaxBytes: normalizeNumber(process.env.KNOWLEDGE_EXTRACTION_MAX_BYTES, 20 * 1024 * 1024),
    tikaUrl: String(process.env.KNOWLEDGE_TIKA_URL || "").trim(),
    tikaTimeoutMs: normalizeNumber(process.env.KNOWLEDGE_TIKA_TIMEOUT_MS, 30_000),
    vectorStore: {
      provider: enumValue(
        process.env.KNOWLEDGE_VECTOR_STORE,
        KNOWLEDGE_VECTOR_PROVIDERS,
        process.env.KNOWLEDGE_QDRANT_URL ? "qdrant" : "postgresql"
      ),
      qdrantUrl: String(process.env.KNOWLEDGE_QDRANT_URL || "").trim(),
      qdrantApiKey: String(process.env.KNOWLEDGE_QDRANT_API_KEY || "").trim(),
      qdrantCollectionPrefix: String(process.env.KNOWLEDGE_QDRANT_COLLECTION_PREFIX || "hellotest_knowledge_dense_v1").trim(),
      qdrantTimeoutMs: normalizeNumber(process.env.KNOWLEDGE_QDRANT_TIMEOUT_MS, 4_000)
    }
  },
  queueProvider: enumValue(process.env.QUEUE_PROVIDER, QUEUE_PROVIDERS, "redis"),
  enableObservability: normalizeBoolean(process.env.ENABLE_OBSERVABILITY, process.env.NODE_ENV === "production"),
  enableRealtime: normalizeBoolean(process.env.ENABLE_REALTIME, true),
  maxParallelRuns: normalizeNumber(process.env.MAX_PARALLEL_RUNS, 3),
  maxParallelSuites: normalizeNumber(process.env.MAX_PARALLEL_SUITES, 4),
  maxParallelTests: normalizeNumber(process.env.MAX_PARALLEL_TESTS, 10),
  maxWorkersApi: normalizeNumber(process.env.MAX_WORKERS_API, 30),
  maxWorkersWeb: normalizeNumber(process.env.MAX_WORKERS_WEB, 5),
  maxWorkersAndroid: normalizeNumber(process.env.MAX_WORKERS_ANDROID, 2),
  retryMaxAttempts: normalizeNumber(process.env.RETRY_MAX_ATTEMPTS, 3),
  retryBackoffSeconds: normalizeNumber(process.env.RETRY_BACKOFF_SECONDS, 5),
  jobSleepSeconds: normalizeNumber(process.env.JOB_SLEEP_SECONDS, 1),
  corsOrigins: (process.env.CORS_ORIGIN || (localOnly ? "http://localhost:5173,http://localhost:5174,http://localhost:8080,http://localhost:8081" : ""))
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
  otelEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || "",
  http: httpConfig,
  adminPortal: {
    port: normalizeNumber(process.env.ADMIN_PORTAL_PORT, 5174),
    frontendInternalUrl: process.env.ADMIN_FRONTEND_INTERNAL_URL || serviceHost("frontend", "localhost") + (localOnly ? ":5174" : ":81"),
    bootstrapEnabled: normalizeBoolean(process.env.ADMIN_BOOTSTRAP_ENABLED, !production),
    bootstrapUsername: process.env.ADMIN_BOOTSTRAP_USERNAME || "admin",
    bootstrapPassword: process.env.ADMIN_BOOTSTRAP_PASSWORD || (production ? "" : "admin")
  }
};

module.exports = {
  config,
  normalizeBoolean,
  normalizeNumber
};
