import { MobileEngineOperationalError } from "./operational.js";

/** Bounded, process-local device sessions; never reused between independent runs. */
export function createExecutionSessions({ createDriver, maxSessions = 2, idleMs = 300_000, onCloseError = () => {} }) {
  const sessions = new Map();
  let disposed = false;
  const close = async (id, entry = sessions.get(id)) => {
    if (!entry) return;
    if (entry.closing) return entry.closing;
    entry.closing = Promise.resolve().then(async () => {
      try {
        const driver = await entry.driver.catch(() => null);
        await driver?.deleteSession();
      } catch { try { onCloseError({ code: "MOBILE_SESSION_CLOSE_FAILED", session_id: id }); } catch { /* Diagnostics must not replace the execution failure. */ } }
      finally { if (sessions.get(id) === entry) sessions.delete(id); }
    });
    return entry.closing;
  };
  const timer = setInterval(() => {
    for (const [id, entry] of sessions) if (!entry.busy && Date.now() - entry.lastUsed > idleMs) void close(id);
  }, Math.min(idleMs, 30_000));
  timer.unref();
  return {
    async execute(id, platform, input, operation) {
      if (disposed) throw new MobileEngineOperationalError("MOBILE_ENGINE_STOPPING", "Mobile execution is shutting down.", 503);
      if (!/^[a-zA-Z0-9-]{16,80}$/.test(id)) throw new MobileEngineOperationalError("INVALID_EXECUTION_SESSION", "Invalid execution session identifier", 400);
      let entry = sessions.get(id);
      if (!entry) {
        if (sessions.size >= maxSessions) throw new MobileEngineOperationalError("MOBILE_EXECUTION_CAPACITY", "Mobile execution capacity reached. Retry when a device session finishes.", 429);
        entry = { platform, driver: Promise.resolve().then(() => createDriver(input)), busy: false, lastUsed: Date.now() };
        sessions.set(id, entry);
      }
      if (entry.platform !== platform) throw new MobileEngineOperationalError("MOBILE_SESSION_PLATFORM_MISMATCH", "A device session cannot change platform during a run.", 409);
      if (entry.closing) throw new MobileEngineOperationalError("MOBILE_SESSION_CLOSING", "This device session is closing.", 409);
      if (entry.busy) throw new MobileEngineOperationalError("MOBILE_SESSION_BUSY", "This device session is already executing a step.", 409);
      entry.busy = true;
      try {
        const driver = await entry.driver;
        if (entry.closing || disposed) throw new MobileEngineOperationalError("MOBILE_SESSION_CLOSING", "This device session is closing.", 409);
        return await operation(driver);
      }
      catch (error) { await close(id, entry); throw error; }
      finally { entry.busy = false; entry.lastUsed = Date.now(); }
    },
    close,
    async dispose() { disposed = true; clearInterval(timer); await Promise.allSettled([...sessions.keys()].map((id) => close(id))); }
  };
}
