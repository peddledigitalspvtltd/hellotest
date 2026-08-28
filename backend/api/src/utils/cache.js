const Redis = require('ioredis');
const { config } = require("../config");

let redisAvailable = false;
const redisUrl = config.redisUrl;
const redis = new Redis(redisUrl, {
  lazyConnect: true,
  enableOfflineQueue: false,
  connectTimeout: 1000,
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    const delay = Math.min(times * 100, 2000);
    return delay;
  }
});

redis.on('error', (err) => {
  redisAvailable = false;
  console.warn('Redis connection error:', err.message);
});

redis.on('connect', () => {
  redisAvailable = true;
  console.log('Connected to Redis cache and coordination service.');
});

redis.on('end', () => {
  redisAvailable = false;
});

const ensureRedis = async () => {
  if (redisAvailable) {
    return true;
  }

  try {
    await redis.connect();
    redisAvailable = true;
    return true;
  } catch (error) {
    redisAvailable = false;
    console.warn(`Redis unavailable; continuing without cache/queue: ${error.message}`);
    return false;
  }
};

/**
 * Get a value from the cache
 * @param {string} key 
 * @returns {Promise<any>}
 */
async function getCache(key) {
  try {
    if (!(await ensureRedis())) {
      return null;
    }

    const data = await redis.get(key);
    return data ? JSON.parse(data) : null;
  } catch (error) {
    console.warn(`Failed to get cache for key ${key}:`, error.message);
    return null;
  }
}

/**
 * Set a value in the cache with an expiration time
 * @param {string} key 
 * @param {any} value 
 * @param {number} ttlSeconds Default 300 seconds (5 minutes)
 */
async function setCache(key, value, ttlSeconds = 300) {
  try {
    if (!(await ensureRedis())) {
      return;
    }

    const stringValue = JSON.stringify(value);
    await redis.set(key, stringValue, 'EX', ttlSeconds);
  } catch (error) {
    console.warn(`Failed to set cache for key ${key}:`, error.message);
  }
}

/**
 * Delete a value from the cache
 * @param {string} key 
 */
async function invalidateCache(key) {
  try {
    if (!(await ensureRedis())) {
      return;
    }

    await redis.del(key);
  } catch (error) {
    console.warn(`Failed to invalidate cache for key ${key}:`, error.message);
  }
}

async function close() {
  redisAvailable = false;

  if (redis.status === "end") {
    return;
  }

  try {
    if (["ready", "connect", "connecting", "reconnecting"].includes(redis.status)) {
      await redis.quit();
      return;
    }
  } catch (error) {
    console.warn(`Redis graceful shutdown failed; disconnecting: ${error.message}`);
  }

  redis.disconnect(false);
}

module.exports = {
  redis,
  close,
  ensureRedis,
  isRedisAvailable: () => redisAvailable,
  getCache,
  setCache,
  invalidateCache
};
