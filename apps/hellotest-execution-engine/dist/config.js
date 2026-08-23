import process from "node:process";
const appModes = new Set(["local", "docker", "aws", "k8s"]);
const storageProviders = new Set(["local", "minio", "s3"]);
const getString = (key, fallback) => {
    const value = process.env[key] || fallback;
    if (!value) {
        throw new Error(`Missing required environment variable: ${key}`);
    }
    return value;
};
const enumValue = (value, allowed, fallback) => {
    const normalized = String(value || "").trim().toLowerCase();
    return allowed.has(normalized) ? normalized : fallback;
};
const boolValue = (key, fallback) => {
    const value = process.env[key];
    if (value === undefined || value === null || value === "") {
        return fallback;
    }
    return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
};
const appMode = enumValue(process.env.APP_MODE, appModes, "local");
const serviceHost = (name, localFallback) => appMode === "local" ? localFallback : name;
export const config = {
    appMode,
    backendUrl: getString("BACKEND_URL", `http://${serviceHost("hellotest-api", "localhost")}:3000`),
    redisUrl: getString("REDIS_URL", `redis://${serviceHost("redis", "localhost")}:6379`),
    queueName: process.env.QUEUE_NAME || "hellotest-engine-runs",
    engineId: process.env.ENGINE_ID || process.env.HOSTNAME || "hellotest-engine-unknown",
    storageProvider: enumValue(process.env.STORAGE_PROVIDER, storageProviders, "local"),
    evidenceLocalPath: process.env.EVIDENCE_LOCAL_PATH || "/tmp/hellotest-evidence",
    minioEndpoint: getString("MINIO_ENDPOINT", serviceHost("minio", "localhost")),
    minioPort: Number(process.env.MINIO_PORT || 9000),
    minioUseTls: process.env.MINIO_USE_TLS === "true",
    minioAccessKey: getString("MINIO_ACCESS_KEY", "minio"),
    minioSecretKey: getString("MINIO_SECRET_KEY", "minio123"),
    minioBucket: process.env.MINIO_BUCKET || process.env.S3_BUCKET || "hellotest-artifacts",
    otelEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || "",
    enableObservability: boolValue("ENABLE_OBSERVABILITY", process.env.NODE_ENV === "production"),
    retryMaxAttempts: Number(process.env.RETRY_MAX_ATTEMPTS || 3),
    retryBackoffSeconds: Number(process.env.RETRY_BACKOFF_SECONDS || 5),
    jobSleepSeconds: Number(process.env.JOB_SLEEP_SECONDS || 1),
    heartbeatIntervalSeconds: Number(process.env.HEARTBEAT_INTERVAL_SECONDS || 12),
    maxWorkerPoolCount: Number(process.env.MAX_WORKER_POOL_COUNT || process.env.MAX_PARALLEL_TESTS || 4),
    maxWorkersApi: Number(process.env.MAX_WORKERS_API || 30),
    maxWorkersWeb: Number(process.env.MAX_WORKERS_WEB || 5),
    maxWorkersAndroid: Number(process.env.MAX_WORKERS_ANDROID || 2),
    parallelEnabled: process.env.PARALLEL_ENABLED !== "false",
    parallelCount: Number(process.env.PARALLEL_COUNT || 2),
    logLevel: process.env.LOG_LEVEL || "info",
    runTimeoutMs: Number(process.env.RUN_TIMEOUT_MS || 30_000_000)
};
//# sourceMappingURL=config.js.map