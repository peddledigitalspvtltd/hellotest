const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");
const { createRedisCache } = require("../src/utils/redisCache");

class RedisFixture extends EventEmitter {
  status = "wait";
  connects = 0;
  disconnects = 0;
  commands = [];
  values = new Map();
  async connect() {
    this.connects += 1;
    this.status = "connecting";
    await this.connectGate;
    this.status = "ready";
    this.emit("ready");
  }
  disconnect() { this.disconnects += 1; this.status = "end"; }
  async get(key) { this.commands.push(["get", key]); return this.values.get(key) || null; }
  async set(...args) { this.commands.push(["set", ...args]); this.values.set(args[0], args[1]); }
  async del(key) { this.commands.push(["del", key]); this.values.delete(key); }
  async quit() { this.commands.push(["quit"]); this.status = "end"; }
}
const cacheFor = (client, options = {}) => createRedisCache(client, { logger: { warn() {} }, ...options });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test("100 concurrent cold reads share one ready connection without losing cached values", async () => {
  const client = new RedisFixture();
  const gate = deferred();
  client.connectGate = gate.promise;
  client.values.set("key", '{"cached":true}');
  const cache = cacheFor(client);
  const reads = Array.from({ length: 100 }, () => cache.getCache("key"));
  await new Promise(setImmediate);
  assert.equal(client.connects, 1);
  assert.equal(client.commands.length, 0);
  assert.equal(cache.isRedisAvailable(), false);
  gate.resolve();
  assert.deepEqual(await Promise.all(reads), Array(100).fill({ cached: true }));
  assert.equal(cache.isRedisAvailable(), true);
  await cache.close();
});

test("a TCP connect event alone never reports Redis ready or issues commands", async () => {
  const client = new RedisFixture();
  client.status = "connect";
  const cache = cacheFor(client);
  client.emit("connect");
  assert.equal(cache.isRedisAvailable(), false);
  assert.equal(await cache.getCache("key"), null);
  assert.equal(client.connects, 0);
  assert.deepEqual(client.commands, []);
  client.status = "ready"; client.emit("ready");
  assert.equal(await cache.ensureRedis(), true);
  await cache.close();
});

test("stalled commands fall back, disconnect pending work, cool down, and recover", { timeout: 2_000 }, async t => {
  const lifetime = setTimeout(() => {}, 2_000);
  t.after(() => clearTimeout(lifetime));
  const client = new RedisFixture();
  let clock = 0;
  let gets = 0;
  client.get = async () => { gets += 1; return new Promise(() => {}); };
  const cache = cacheFor(client, { operationTimeoutMs: 20, retryCooldownMs: 100, now: () => clock });
  assert.equal(await cache.getCache("private-key"), null);
  assert.equal(client.disconnects, 1);
  assert.equal(await cache.getCache("private-key"), null);
  assert.equal(client.connects, 1);
  assert.equal(gets, 1);
  clock = 101;
  client.get = async () => '{"recovered":true}';
  assert.deepEqual(await cache.getCache("private-key"), { recovered: true });
  assert.equal(client.connects, 2);
  await cache.close();
});

test("a stalled connection is bounded and does not start a connect attempt per request", { timeout: 2_000 }, async t => {
  const lifetime = setTimeout(() => {}, 2_000);
  t.after(() => clearTimeout(lifetime));
  const client = new RedisFixture();
  client.connectGate = new Promise(() => {});
  const cache = cacheFor(client, { connectTimeoutMs: 20 });
  assert.deepEqual(await Promise.all(Array.from({ length: 50 }, () => cache.ensureRedis())), Array(50).fill(false));
  assert.equal(client.connects, 1);
  assert.equal(client.disconnects, 1);
  assert.equal(await cache.ensureRedis(), false);
  await cache.close();
});

test("JSON corruption is only a miss; writes and invalidations retain TTL and JSON semantics", async () => {
  const client = new RedisFixture();
  const cache = cacheFor(client);
  await cache.setCache("key", { score: 0 }, 60);
  assert.deepEqual(client.commands[0], ["set", "key", '{"score":0}', "EX", 60]);
  assert.deepEqual(await cache.getCache("key"), { score: 0 });
  client.values.set("key", "broken-json");
  assert.equal(await cache.getCache("key"), null);
  assert.equal(cache.isRedisAvailable(), true);
  await cache.invalidateCache("key");
  assert.equal(client.values.has("key"), false);
  await cache.close();
});

test("shutdown is idempotent, bounded, and prevents a queued connection from reopening", { timeout: 2_000 }, async t => {
  const lifetime = setTimeout(() => {}, 2_000);
  t.after(() => clearTimeout(lifetime));
  const client = new RedisFixture();
  const cache = cacheFor(client, { operationTimeoutMs: 20 });
  const connecting = cache.ensureRedis();
  const close = cache.close();
  assert.equal(cache.close(), close);
  await close;
  assert.equal(await connecting, false);
  assert.equal(client.connects, 0);
  assert.equal(await cache.ensureRedis(), false);
  const stalled = new RedisFixture();
  stalled.status = "ready";
  stalled.quit = () => new Promise(() => {});
  await cacheFor(stalled, { operationTimeoutMs: 20 }).close();
  assert.equal(stalled.status, "end");
});
