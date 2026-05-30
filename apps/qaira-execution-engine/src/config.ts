import process from "node:process";

const getString = (key: string, fallback?: string): string => {
  const value = process.env[key] || fallback;
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
};

export const config = {
  backendUrl: getString("BACKEND_URL", "http://localhost:3000"),
  redisUrl: getString("REDIS_URL", "redis://localhost:6379"),
  queueName: process.env.QUEUE_NAME || "qaira-engine-runs",
  engineId: process.env.ENGINE_ID || process.env.HOSTNAME || "qaira-engine-unknown",
  minioEndpoint: getString("MINIO_ENDPOINT", "localhost:9000"),
  minioPort: Number(process.env.MINIO_PORT || 9000),
  minioUseTls: process.env.MINIO_USE_TLS === "true",
  minioAccessKey: getString("MINIO_ACCESS_KEY", "minio"),
  minioSecretKey: getString("MINIO_SECRET_KEY", "minio123"),
  minioBucket: process.env.MINIO_BUCKET || "qaira-artifacts",
  otelEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || "http://localhost:4318/v1/traces",
  heartbeatIntervalSeconds: Number(process.env.HEARTBEAT_INTERVAL_SECONDS || 12),
  maxWorkerPoolCount: Number(process.env.MAX_WORKER_POOL_COUNT || 4),
  parallelEnabled: process.env.PARALLEL_ENABLED !== "false",
  parallelCount: Number(process.env.PARALLEL_COUNT || 2),
  logLevel: process.env.LOG_LEVEL || "info",
  runTimeoutMs: Number(process.env.RUN_TIMEOUT_MS || 30_000_000)
};
