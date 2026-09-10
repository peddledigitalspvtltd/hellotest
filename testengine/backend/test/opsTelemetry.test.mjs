import assert from "node:assert/strict";
import { appendFile, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
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

test("project telemetry filters isolate events, service counts and scoped deletion from other and unscoped events", async () => {
  const fixture = await createFixture({ OPS_TELEMETRY_ENVIRONMENT: "production", OPS_TELEMETRY_API_KEY: "project-isolation-key" });
  const headers = { authorization: "Bearer project-isolation-key" };
  const payloads = [
    { project_id: "project-a", service_name: "api", event_type: "run.started", status: "running", summary: "Checkout" },
    { project_id: "project-a", service_name: "api", event_type: "run.finished", status: "passed", summary: "Checkout" },
    { project_id: "project-a", service_name: "worker", event_type: "job.finished", status: "passed" },
    { project_id: "project-b", service_name: "api", event_type: "run.finished", status: "passed", summary: "Checkout" },
    { project_id: "project-b", service_name: "mobile", event_type: "run.finished", status: "failed" },
    { service_name: "host", event_type: "health", status: "passed" }
  ];
  const read = async (url) => {
    const response = await fixture.app.inject({ method: "GET", url, headers });
    assert.equal(response.statusCode, 200, response.body);
    return response.json();
  };
  try {
    for (const payload of payloads) assert.equal((await fixture.app.inject({ method: "POST", url: "/api/v1/events", headers, payload })).statusCode, 202);
    const events = await read("/api/v1/events?project_id=project-a&limit=1");
    assert.equal(events.project_id, "project-a");
    assert.equal(events.total, 3, "total is scoped before the limit is applied");
    assert.equal(events.items.length, 1);
    assert.ok(events.items.every((event) => event.project_id === "project-a"));
    const filtered = await read("/api/v1/events?project_id=project-a&service_name=api&event_type=run.finished&status=passed&search=Checkout");
    assert.equal(filtered.total, 1);
    assert.equal(filtered.items[0].project_id, "project-a");
    assert.equal((await read("/api/v1/events?project_id=project")).total, 0, "scope matching is exact");
    const services = await read("/api/v1/ops-telemetry/services?project_id=project-a");
    assert.equal(services.project_id, "project-a");
    assert.deepEqual(services.items.map(({ service_name, count }) => ({ service_name, count })), [{ service_name: "api", count: 2 }, { service_name: "worker", count: 1 }]);
    assert.deepEqual((await read("/api/v1/ops-telemetry/services?project_id=missing")).items, []);
    assert.equal((await read("/api/v1/events")).total, 6, "direct engine operators retain the unfiltered view");

    const denied = await fixture.app.inject({ method: "DELETE", url: "/api/v1/events/projects/project-a" });
    assert.equal(denied.statusCode, 401, "the dedicated route retains engine authentication");
    const cleared = await fixture.app.inject({ method: "DELETE", url: "/api/v1/events/projects/project-a", headers });
    assert.equal(cleared.statusCode, 200, cleared.body);
    assert.deepEqual(cleared.json(), { ok: true, project_id: "project-a", deleted: 3 });
    assert.equal((await read("/api/v1/events?project_id=project-a")).total, 0);
    assert.equal((await read("/api/v1/events?project_id=project-b")).total, 2);
    assert.equal((await read("/api/v1/events")).total, 3);
    assert.deepEqual((await read("/api/v1/ops-telemetry/services?project_id=project-a")).items, []);
    assert.deepEqual((await read("/api/v1/ops-telemetry/services?project_id=project-b")).items.map(({ service_name, count }) => ({ service_name, count })), [{ service_name: "api", count: 1 }, { service_name: "mobile", count: 1 }]);
    const durable = (await readFile(fixture.storePath, "utf8")).trim().split("\n").map(JSON.parse);
    assert.equal(durable.length, 3);
    assert.ok(durable.every((event) => event.project_id !== "project-a"));
    assert.ok(durable.some((event) => event.project_id === null), "unscoped host events remain on disk");

    const queryCleared = await fixture.app.inject({ method: "DELETE", url: "/api/v1/events?project_id=project-b", headers });
    assert.deepEqual(queryCleared.json(), { ok: true, project_id: "project-b", deleted: 2 });
    assert.equal((await read("/api/v1/events")).total, 1);
    const globalCleared = await fixture.app.inject({ method: "DELETE", url: "/api/v1/events", headers });
    assert.deepEqual(globalCleared.json(), { ok: true, deleted: 1 });
    assert.equal(await readFile(fixture.storePath, "utf8"), "");
  } finally {
    await fixture.cleanup();
  }
});

test("explicitly invalid project scopes cannot become global reads or clears and custom event paths support scoped deletion", async () => {
  const fixture = await createFixture({ OPS_TELEMETRY_ENVIRONMENT: "local", OPS_TELEMETRY_EVENTS_PATH: "/custom/events/" });
  try {
    for (const project_id of ["project-a", "project-b"]) assert.equal((await fixture.app.inject({ method: "POST", url: "/custom/events/", payload: { project_id, event_type: "run.finished" } })).statusCode, 202);
    for (const url of ["/api/v1/events?project_id=", "/api/v1/events?project_id=%20%20", "/api/v1/events?project_id=a&project_id=b", "/api/v1/ops-telemetry/services?project_id="]) {
      assert.equal((await fixture.app.inject({ method: "GET", url })).statusCode, 400, url);
    }
    for (const url of ["/api/v1/events?project_id=", "/api/v1/events?project_id=a&project_id=b", "/api/v1/events/projects/%20%20", "/custom/events/projects/%20"]) {
      assert.equal((await fixture.app.inject({ method: "DELETE", url })).statusCode, 400, url);
    }
    assert.equal((await fixture.app.inject({ method: "GET", url: "/api/v1/events" })).json().total, 2);
    const cleared = await fixture.app.inject({ method: "DELETE", url: "/custom/events/projects/project-a" });
    assert.equal(cleared.statusCode, 200, cleared.body);
    assert.deepEqual(cleared.json(), { ok: true, project_id: "project-a", deleted: 1 });
    const listed = (await fixture.app.inject({ method: "GET", url: "/custom/events/" })).json();
    assert.equal(listed.total, 1);
    assert.equal(listed.items[0].project_id, "project-b");
  } finally {
    await fixture.cleanup();
  }
});

test("scoped clear preserves another writer's records and does not report success when the store cannot be replaced", async () => {
  const received_at = new Date().toISOString();
  const record = (id, project_id) => ({ id, project_id, received_at, payload: { project_id, event_type: "run.finished" } });
  const fixture = await createFixture({ OPS_TELEMETRY_ENVIRONMENT: "local" }, JSON.stringify(record("initial", "project-a")) + "\n");
  try {
    // A second writer's durable record is not present in this process's cache.
    await appendFile(fixture.storePath, JSON.stringify(record("foreign", "project-b")) + "\n");
    const savedPath = fixture.storePath + ".saved";
    await rename(fixture.storePath, savedPath);
    await mkdir(fixture.storePath);
    const failed = await fixture.app.inject({ method: "DELETE", url: "/api/v1/events/projects/project-a" });
    assert.equal(failed.statusCode, 500);
    const unchanged = (await fixture.app.inject({ method: "GET", url: "/api/v1/events?project_id=project-a" })).json();
    assert.equal(unchanged.total, 1, "failed durable clear leaves the in-memory record intact");
    await rm(fixture.storePath, { recursive: true });
    await rename(savedPath, fixture.storePath);

    const cleared = await fixture.app.inject({ method: "DELETE", url: "/api/v1/events/projects/project-a" });
    assert.deepEqual(cleared.json(), { ok: true, project_id: "project-a", deleted: 1 });
    const durable = (await readFile(fixture.storePath, "utf8")).trim().split("\n").map(JSON.parse);
    assert.deepEqual(durable.map((event) => event.id), ["foreign"], "scoped replacement retains the other writer's project");
    assert.equal((await fixture.app.inject({ method: "GET", url: "/api/v1/events?project_id=project-a" })).json().total, 0);
  } finally {
    await fixture.cleanup();
  }
});
