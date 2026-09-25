const DEFAULT_SHUTDOWN_TIMEOUT_MS = 15_000;

const normalizeReason = (reason) => reason instanceof Error
  ? { message: reason.message, stack: reason.stack }
  : { message: String(reason || "unknown") };

function createRuntimeLifecycle({
  app,
  resources = [],
  processRef = process,
  shutdownTimeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS,
  forceExit = (code) => processRef.exit(code)
}) {
  let shutdownPromise = null;

  const shutdown = ({ reason, exitCode = 0, fatal = false } = {}) => {
    if (shutdownPromise) return shutdownPromise;

    shutdownPromise = (async () => {
      const logMethod = fatal ? "fatal" : "info";
      app.log[logMethod]?.({ reason: normalizeReason(reason), exitCode }, "API shutdown started");

      const forceTimer = setTimeout(() => {
        app.log.fatal({ exitCode }, "API graceful shutdown timed out; forcing process exit");
        forceExit(exitCode || 1);
      }, shutdownTimeoutMs);
      forceTimer.unref?.();

      const results = [];
      try {
        await app.close();
        results.push({ status: "fulfilled" });
      } catch (reason) {
        results.push({ status: "rejected", reason });
      }

      results.push(...await Promise.allSettled(
        resources.map((resource) => Promise.resolve().then(() => resource.close()))
      ));
      clearTimeout(forceTimer);

      const failures = results.filter((result) => result.status === "rejected");
      if (failures.length) {
        app.log.error({ failures: failures.map((result) => normalizeReason(result.reason)) }, "One or more API resources failed to close cleanly");
        processRef.exitCode = exitCode || 1;
      } else {
        processRef.exitCode = exitCode;
      }

      app.log.info({ exitCode: processRef.exitCode }, "API shutdown complete");
    })();

    return shutdownPromise;
  };

  const registerProcessHandlers = () => {
    processRef.once("SIGTERM", () => void shutdown({ reason: "SIGTERM", exitCode: 0 }));
    processRef.once("SIGINT", () => void shutdown({ reason: "SIGINT", exitCode: 0 }));
    processRef.once("unhandledRejection", (reason) => void shutdown({ reason, exitCode: 1, fatal: true }));
    processRef.once("uncaughtException", (error) => void shutdown({ reason: error, exitCode: 1, fatal: true }));
  };

  return {
    registerProcessHandlers,
    shutdown
  };
}

module.exports = {
  createRuntimeLifecycle,
  DEFAULT_SHUTDOWN_TIMEOUT_MS
};
