const { sanitizeInternalErrorText } = require("./serviceErrors");

/** Optional cache boundary. The injected client also serves the health probe. */
function createRedisCache(redis, {
  connectTimeoutMs = 1_000,
  operationTimeoutMs = 250,
  retryCooldownMs = 1_000,
  logger = console,
  now = Date.now
} = {}) {
  let connecting = null;
  let closing = null;
  let closed = false;
  let retryAt = 0;
  let lastWarningAt = -Infinity;

  const warn = (error) => {
    if (now() - lastWarningAt < retryCooldownMs) return;
    lastWarningAt = now();
    // Cache keys can contain private record identifiers; never log their values.
    logger.warn?.(`Redis cache unavailable: ${sanitizeInternalErrorText(error?.message || error)}`);
  };

  const bounded = (operation, milliseconds) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(Object.assign(new Error("Redis operation exceeded its time budget"), { code: "CACHE_TIMEOUT" }));
    }, milliseconds);
    timer.unref?.();
    Promise.resolve().then(operation).then(resolve, reject).finally(() => clearTimeout(timer));
  });

  const unavailable = (error) => {
    retryAt = now() + retryCooldownMs;
    warn(error);
    // Do not retain timed-out commands or replay writes after callers gave up.
    redis.disconnect(false);
  };

  const isRedisAvailable = () => !closed && redis.status === "ready";
  redis.on("error", warn);
  redis.on("ready", () => { retryAt = 0; });

  const ensureRedis = () => {
    if (closed) return Promise.resolve(false);
    if (isRedisAvailable()) return Promise.resolve(true);
    if (connecting) return connecting;
    // The client owns its in-progress reconnect. Calling connect() again races.
    if (now() < retryAt || !["wait", "end"].includes(redis.status)) return Promise.resolve(false);
    connecting = bounded(async () => {
      if (closed) return;
      await redis.connect();
      if (closed) redis.disconnect(false);
    }, connectTimeoutMs)
      .then(() => isRedisAvailable())
      .catch(error => { unavailable(error); return false; })
      .finally(() => { connecting = null; });
    return connecting;
  };

  const execute = async (operation, fallback) => {
    if (!(await ensureRedis())) return fallback;
    try {
      return await bounded(() => isRedisAvailable() ? operation() : fallback, operationTimeoutMs);
    } catch (error) {
      unavailable(error);
      return fallback;
    }
  };

  const getCache = async (key) => {
    const value = await execute(() => redis.get(key), null);
    if (!value) return null;
    try { return JSON.parse(value); } catch { return null; }
  };

  const setCache = async (key, value, ttlSeconds = 300) => {
    const ttl = Number(ttlSeconds);
    if (!Number.isSafeInteger(ttl) || ttl <= 0) return;
    let serialized;
    try { serialized = JSON.stringify(value); } catch { return; }
    if (serialized === undefined) return;
    await execute(() => redis.set(key, serialized, "EX", ttl), undefined);
  };

  const invalidateCache = async (key) => {
    await execute(() => redis.del(key), undefined);
  };

  const close = () => {
    if (closing) return closing;
    closed = true;
    closing = (async () => {
      try {
        if (redis.status === "ready") await bounded(() => redis.quit(), operationTimeoutMs);
      } catch (error) {
        warn(error);
      } finally {
        redis.disconnect(false);
      }
    })();
    return closing;
  };

  return { redis, ensureRedis, isRedisAvailable, getCache, setCache, invalidateCache, close };
}

module.exports = { createRedisCache };
