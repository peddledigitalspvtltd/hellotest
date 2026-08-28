const assert = require("node:assert/strict");
const test = require("node:test");

const {
  aggregateStatus,
  createRuntimeHealthService,
  sanitizeEndpoint,
  sanitizeError
} = require("../src/services/runtimeHealth.service");

const createDependencies = (overrides = {}) => ({
  config: {
    storageProvider: "minio",
    postgres: { password: "main-password" },
    obsPostgres: { password: "obs-password" },
    objectStorage: { accessKey: "access-key", secretKey: "storage-secret" },
    knowledge: { tikaUrl: "http://tika:9998" },
    enableObservability: true,
    otelEndpoint: "http://collector:4318"
  },
  db: { query: async () => ({ rows: [{ checked_at: "2026-01-01T00:00:00.000Z" }] }) },
  obsDb: { query: async () => ({ rows: [{ ready: 1 }] }) },
  cache: { ensureRedis: async () => true, redis: { ping: async () => "PONG" } },
  objectStorage: {
    isEnabled: () => true,
    probeBucket: async () => ({ enabled: true, exists: true, bucket: "artifacts" })
  },
  fetchImpl: async () => ({ ok: true, status: 200 }),
  getTelemetryState: () => ({ enabled: true, exporterConfigured: true, started: true, error: null }),
  probeTimeoutMs: 250,
  version: "test",
  ...overrides
});

test("runtime health executes independent service adapters and returns a ready snapshot", async () => {
  const service = createRuntimeHealthService(createDependencies());
  const snapshot = await service.runChecks({ includeOptional: true });

  assert.equal(snapshot.status, "ready");
  assert.deepEqual(snapshot.checks.map((check) => check.key), [
    "database",
    "execution_database",
    "cache",
    "storage",
    "document_extraction",
    "telemetry"
  ]);
  assert.equal(snapshot.checks.every((check) => check.status === "ready"), true);
});

test("readiness is blocked by a critical dependency but optional failures only degrade", async () => {
  const criticalFailure = createRuntimeHealthService(createDependencies({
    obsDb: { query: async () => { throw new Error("execution store offline"); } }
  }));
  const requiredSnapshot = await criticalFailure.runChecks({ includeOptional: false });
  assert.equal(requiredSnapshot.status, "blocked");

  const optionalFailure = createRuntimeHealthService(createDependencies({
    cache: { ensureRedis: async () => false, redis: { ping: async () => "PONG" } }
  }));
  const fullSnapshot = await optionalFailure.runChecks({ includeOptional: true });
  assert.equal(fullSnapshot.status, "degraded");
  assert.equal(fullSnapshot.checks.find((check) => check.key === "cache").status, "degraded");
});

test("health probes are read-only and sanitize endpoints and error details", async () => {
  let probeCalls = 0;
  const service = createRuntimeHealthService(createDependencies({
    objectStorage: {
      isEnabled: () => true,
      probeBucket: async () => {
        probeCalls += 1;
        return { enabled: true, exists: true, bucket: "artifacts" };
      },
      ensureBucket: async () => { throw new Error("health must not provision buckets"); }
    }
  }));

  await service.runChecks({ includeOptional: true });
  assert.equal(probeCalls, 1);
  assert.equal(sanitizeEndpoint("https://user:password@example.com/path?token=secret"), "https://example.com/path");
  assert.doesNotMatch(sanitizeError(new Error("failed with storage-secret"), ["storage-secret"]), /storage-secret/);
});

test("health status aggregation respects dependency criticality", () => {
  assert.equal(aggregateStatus([{ critical: false, status: "blocked" }]), "degraded");
  assert.equal(aggregateStatus([{ critical: true, status: "blocked" }]), "blocked");
  assert.equal(aggregateStatus([{ critical: false, status: "ready" }]), "ready");
});
