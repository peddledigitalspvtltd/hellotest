const Redis = require('ioredis');

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    const delay = Math.min(times * 50, 2000);
    return delay;
  }
});

redis.on('error', (err) => {
  console.warn('Redis connection error:', err.message);
});

redis.on('connect', () => {
  console.log('Connected to Redis at', redisUrl);
});

/**
 * Get a value from the cache
 * @param {string} key 
 * @returns {Promise<any>}
 */
async function getCache(key) {
  try {
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
    await redis.del(key);
  } catch (error) {
    console.warn(`Failed to invalidate cache for key ${key}:`, error.message);
  }
}

module.exports = {
  redis,
  getCache,
  setCache,
  invalidateCache
};
