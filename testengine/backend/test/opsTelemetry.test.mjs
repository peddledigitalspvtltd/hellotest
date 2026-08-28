import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Fastify from "fastify";
import { createOpsTelemetry } from "../dist/lib/opsTelemetry.js";

const MANAGED_ENVIRONMENT_KEYS = [
  "ARTIFACT_ROOT",
  "ENGINE_PUBLIC_URL",
  "NODE_ENV",
  "OPS_ENVIRONMENT",
  "OPS_TELEMETRY_ALLOW_UNAUTHENTICATED_LOCAL",
  "OPS_TELEMETRY_API_KEY",
  "OPS_TELEMETRY_API_KEY_HEADER",
  "OPS_TELEMETRY_API_KEY_PREFIX",
  "OPS_TELEMETRY_ENABLED",
  "OPS_TELEMETRY_ENVIRONMENT",
  "OPS_TELEMETRY_EVENTS_PATH",
  "OPS_TELEMETRY_MAX_ARRAY_ITEMS",
  "OPS_TELEMETRY_MAX_DEPTH",
  "OPS_TELEMETRY_MAX_EVENTS",
  "OPS_TELEMETRY_MAX_OBJECT_KEYS",
  "OPS_TELEMETRY_MAX_PAYLOAD_BYTES",
  "OPS_TELEMETRY_MAX_STORE_BYTES",
  "OPS_TELEMETRY_MAX_STRING_CHARACTERS",
  "OPS_TELEMETRY_RETENTION_HOURS",
  "OPS_TELEMETRY_STORE_PATH"
];

const createFixture = async (environment = {}, seed = null) => {
  const previousEnvironment = new Map(MANAGED_ENVIRONMENT_KEYS.map((key) => [key, process.env[key]]));
  MANAGED_ENVIRONMENT_KEYS.forEach((key) => delete process.env[key]);

  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "hellotest-ops-telemetry-"));
  const storePath = path.join(temporaryDirectory, "events.ndjson");
  Object.assign(process.env, {
    OPS_TELEMETRY_ENABLED: "true",
    OPS_TELEMETRY_STORE_PATH: storePath,
    ...environment
  });

  if (seed !== null) {
    await writeFile(storePath, seed, { encoding: "utf8", mode: 0o600 });
  }

  const app = Fastify({ logger: false });
  const telemetry = await createOpsTelemetry(app.log);
  await telemetry.register(app);
  await app.ready();
  let closed = false;

  return {
    app,
    telemetry,
    storePath,
    async close() {
      if (!closed) {
        closed = true;
        await app.close();
      }
    },
    async cleanup() {
      if (!closed) {
        await app.close();
      }
      await rm(temporaryDirectory, { recursive: true, force: true });
      for (const [key, value] of previousEnvironment) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  };
};

test("non-local OPS routes fail closed when no API key is configured", async () => {
  const fixture = await createFixture({ OPS_TELEMETRY_ENVIRONMENT: "production" });

  try {
    const requests = [
      { method: "GET", url: "/api/v1/events" },
      { method: "POST", url: "/api/v1/events", payload: { event_type: "run.started" } },
      { method: "DELETE", url: "/api/v1/events" },
      { method: "GET", url: "/api/v1/ops-telemetry/services" },
      { method: "GET", url: "/ops-telemetry" }
    ];

    for (const request of requests) {
      const response = await fixture.app.inject(request);
      assert.equal(response.statusCode, 503, `${request.method} ${request.url} must fail closed`);
      assert.match(response.body, /authentication is not configured/);
    }

    const health = fixture.telemetry.getHealthSnapshot();
    assert.equal(health.authentication_required, true);
    assert.equal(health.authentication_configured, false);
    assert.equal(health.authentication_ready, false);
    assert.equal(health.unauthenticated_local_access, false);
  } finally {
    await fixture.cleanup();
  }
});

test("a configured key protects every read, write, delete, service, and board route", async () => {
  const fixture = await createFixture({
    OPS_TELEMETRY_ENVIRONMENT: "production",
    OPS_TELEMETRY_API_KEY: "correct-horse-battery-staple"
  });
  const authorization = { authorization: "Bearer correct-horse-battery-staple" };

  try {
    for (const request of [
      { method: "GET", url: "/api/v1/events" },
      { method: "POST", url: "/api/v1/events", payload: { event_type: "run.started" } },
      { method: "DELETE", url: "/api/v1/events" },
      { method: "GET", url: "/api/v1/ops-telemetry/services" },
      { method: "GET", url: "/ops-telemetry" }
    ]) {
      assert.equal((await fixture.app.inject(request)).statusCode, 401, `${request.method} ${request.url} must require authentication`);
    }

    assert.equal((await fixture.app.inject({
      method: "POST",
      url: "/api/v1/events",
      headers: { authorization: "Bearer wrong" },
      payload: { event_type: "run.started" }
    })).statusCode, 401);

    const accepted = await fixture.app.inject({
      method: "POST",
      url: "/api/v1/events",
      headers: authorization,
      payload: { service_name: "api", event_type: "run.started" }
    });
    assert.equal(accepted.statusCode, 202);

    assert.equal((await fixture.app.inject({ method: "GET", url: "/api/v1/events", headers: authorization })).statusCode, 200);
    assert.equal((await fixture.app.inject({ method: "GET", url: "/api/v1/ops-telemetry/services", headers: authorization })).statusCode, 200);
    assert.equal((await fixture.app.inject({ method: "GET", url: "/ops-telemetry", headers: authorization })).statusCode, 200);
    assert.equal((await fixture.app.inject({ method: "DELETE", url: "/api/v1/events", headers: authorization })).statusCode, 200);
  } finally {
    await fixture.cleanup();
  }
});

test("explicit local environments remain usable without a key", async () => {
  const fixture = await createFixture({ OPS_TELEMETRY_ENVIRONMENT: "local" });

  try {
    assert.equal((await fixture.app.inject({
      method: "POST",
      url: "/api/v1/events",
      payload: { service_name: "local-api", event_type: "run.started" }
    })).statusCode, 202);
    assert.equal((await fixture.app.inject({ method: "GET", url: "/api/v1/events" })).statusCode, 200);
    assert.equal((await fixture.app.inject({ method: "GET", url: "/api/v1/ops-telemetry/services" })).statusCode, 200);
    assert.equal((await fixture.app.inject({ method: "GET", url: "/ops-telemetry" })).statusCode, 200);
    const health = fixture.telemetry.getHealthSnapshot();
    assert.equal(health.authentication_required, false);
    assert.equal(health.authentication_ready, true);
    assert.equal(health.unauthenticated_local_access, true);
  } finally {
    await fixture.cleanup();
  }
});

test("payloads are bounded and recursively redact secrets, captures, bodies, URLs, and remote addresses", async () => {
  const fixture = await createFixture({
    OPS_TELEMETRY_ENVIRONMENT: "local",
    OPS_TELEMETRY_MAX_PAYLOAD_BYTES: "4096",
    OPS_TELEMETRY_MAX_STRING_CHARACTERS: "128"
  });

  try {
    const oversized = await fixture.app.inject({
      method: "POST",
      url: "/api/v1/events",
      payload: { value: "x".repeat(5000) }
    });
    assert.equal(oversized.statusCode, 413);

    const secret = "super-secret-value";
    const accepted = await fixture.app.inject({
      method: "POST",
      url: "/api/v1/events",
      headers: { "x-hellotest-source": `Bearer ${secret}` },
      remoteAddress: "203.0.113.42",
      payload: {
        service_name: "api",
        event_type: "api.request",
        authorization: `Bearer ${secret}`,
        captures: [{ data_url: secret }],
        request: {
          headers: { cookie: `session=${secret}`, accessToken: secret, "x-safe": "safe" },
          body: { password: secret },
          url: `https://user:${secret}@example.test/run?access_token=${secret}`
        },
        execution: {
          id: "execution-1",
          notes: `${"n".repeat(200)} Bearer ${secret}`
        }
      }
    });
    assert.equal(accepted.statusCode, 202);

    const listed = await fixture.app.inject({ method: "GET", url: "/api/v1/events" });
    const item = listed.json().items[0];
    const serialized = JSON.stringify(item);
    assert.equal(serialized.includes(secret), false);
    assert.equal(item.payload.authorization, "[REDACTED]");
    assert.equal(item.payload.captures, "[REDACTED]");
    assert.equal(item.payload.request.body, "[REDACTED]");
    assert.match(item.payload.execution.notes, /\[TRUNCATED\]$/);
    assert.equal(item.payload.request.headers.accessToken, "[REDACTED]");
    assert.equal(item.remote_address, "[REDACTED]");

    await fixture.close();
    const durable = await readFile(fixture.storePath, "utf8");
    assert.equal(durable.includes(secret), false);
  } finally {
    await fixture.cleanup();
  }
});

test("startup and writes scrub legacy records and enforce age, count, and file bounds", async () => {
  const now = Date.now();
  const makeLegacyEvent = (id, receivedAt, payload) => JSON.stringify({
    id,
    received_at: receivedAt,
    remote_address: "198.51.100.20",
    payload,
    ...payload
  });
  const seed = [
    makeLegacyEvent("expired", new Date(now - 2 * 60 * 60 * 1000).toISOString(), { event_type: "old", password: "legacy-secret" }),
    makeLegacyEvent("one", new Date(now - 1000).toISOString(), { event_type: "one", authorization: "Bearer legacy-secret" }),
    makeLegacyEvent("two", new Date(now - 500).toISOString(), { event_type: "two" })
  ].join("\n") + "\n";
  const fixture = await createFixture({
    OPS_TELEMETRY_ENVIRONMENT: "local",
    OPS_TELEMETRY_MAX_EVENTS: "2",
    OPS_TELEMETRY_MAX_PAYLOAD_BYTES: "4096",
    OPS_TELEMETRY_MAX_STORE_BYTES: "16384",
    OPS_TELEMETRY_RETENTION_HOURS: "1"
  }, seed);

  try {
    let listed = (await fixture.app.inject({ method: "GET", url: "/api/v1/events?limit=10" })).json();
    assert.equal(listed.total, 2);
    assert.deepEqual(listed.items.map((item) => item.id), ["two", "one"]);
    const rewrittenSeed = await readFile(fixture.storePath, "utf8");
    assert.equal(rewrittenSeed.includes("legacy-secret"), false);
    assert.ok(rewrittenSeed.split("\n").filter(Boolean).every((line) => {
      const remoteAddress = JSON.parse(line).remote_address;
      return remoteAddress === "[REDACTED]";
    }));

    for (let index = 0; index < 4; index += 1) {
      assert.equal((await fixture.app.inject({
        method: "POST",
        url: "/api/v1/events",
        payload: { event_type: `new-${index}`, value: "v".repeat(1000) }
      })).statusCode, 202);
    }

    listed = (await fixture.app.inject({ method: "GET", url: "/api/v1/events?limit=10" })).json();
    assert.equal(listed.total, 2);
    assert.deepEqual(listed.items.map((item) => item.event_type), ["new-3", "new-2"]);

    await fixture.close();
    const durable = await readFile(fixture.storePath, "utf8");
    const durableLines = durable.trim().split("\n").filter(Boolean);
    assert.equal(durableLines.length, 2);
    assert.ok(Buffer.byteLength(durable, "utf8") <= 16_384);
    assert.equal(durable.includes("legacy-secret"), false);
  } finally {
    await fixture.cleanup();
  }
});
