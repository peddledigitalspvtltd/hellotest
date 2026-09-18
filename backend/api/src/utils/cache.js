const Redis = require("ioredis");
const { config } = require("../config");
const { createRedisCache } = require("./redisCache");

// Optional cache/health infrastructure, not a durable job queue. Cache failures
// must not hold request handlers or shutdown indefinitely.
const redis = new Redis(config.redisUrl, {
  lazyConnect: true,
  enableOfflineQueue: false,
  connectTimeout: 1_000,
  commandTimeout: 250,
  maxRetriesPerRequest: 0,
  autoResendUnfulfilledCommands: false,
  retryStrategy(times) {
    return Math.min(times * 100, 2_000);
  }
});

module.exports = createRedisCache(redis);
