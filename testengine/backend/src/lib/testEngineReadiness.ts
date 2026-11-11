import type { FastifyInstance } from "fastify";
import type { QueueWorkerHealthSnapshot } from "./queueWorker.js";
import type { SharedSecretConfig } from "./testEngineSecurity.js";

type ReadinessDependencies = {
  sharedSecret: SharedSecretConfig;
  isShuttingDown: () => boolean;
  isTelemetryInitialized: () => boolean;
  isRuntimeInitialized: () => boolean;
  getQueueHealth: () => QueueWorkerHealthSnapshot | null;
  serviceName: () => string;
};

/** Session transport must stay reachable when an unrelated queue poll fails.
 * New queue work continues to use the stricter admission readiness endpoint. */
export function registerTestEngineReadiness(app: FastifyInstance, dependencies: ReadinessDependencies) {
  const transportHealth = () => {
    const checks = {
      accepting_requests: !dependencies.isShuttingDown(),
      shared_secret: {
        ready: dependencies.sharedSecret.ready,
        configured: Boolean(dependencies.sharedSecret.source && dependencies.sharedSecret.source !== "development-fallback"),
        source: dependencies.sharedSecret.source,
        reason: dependencies.sharedSecret.reason
      },
      ops_telemetry_initialized: dependencies.isTelemetryInitialized(),
      playwright_mcp_initialized: dependencies.isRuntimeInitialized()
    };
    const ready = checks.accepting_requests && checks.shared_secret.ready
      && checks.ops_telemetry_initialized && checks.playwright_mcp_initialized;
    return { ok: ready, status: ready ? "ready" : "not_ready", service: dependencies.serviceName(), checks };
  };

  app.get("/health/transport", async (_request, reply) => {
    const health = transportHealth();
    return reply.code(health.ok ? 200 : 503).header("cache-control", "no-store").send(health);
  });

  app.get("/health/ready", async (_request, reply) => {
    const health = transportHealth();
    const worker = dependencies.getQueueHealth();
    const ready = health.ok && Boolean(worker?.ready);
    return reply.code(ready ? 200 : 503).header("cache-control", "no-store").send({
      ...health, ok: ready, status: ready ? "ready" : "not_ready", checks: { ...health.checks, queue_worker: worker }
    });
  });
}
