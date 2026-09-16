import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { assertRemoteInspectionUrl, isPrivateInspectionAddress } from "../dist/lib/inspectionSecurity.js";
import { registerRecorderRoutes } from "../dist/lib/recorder.js";
import { createCorsHook, resolveCorsPolicy } from "../dist/lib/testEngineSecurity.js";

test("remote inspection blocks local, metadata, mapped IPv6, protocols and private DNS destinations", async () => {
  for (const address of ["127.0.0.1", "169.254.169.254", "10.4.5.6", "172.16.0.1", "192.168.1.1", "100.64.1.1", "::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "fd00::1", "fe80::1"]) assert.equal(isPrivateInspectionAddress(address), true, address);
  assert.equal(isPrivateInspectionAddress("93.184.216.34"), false);
  const publicDns = async () => [{ address: "93.184.216.34" }];
  for (const url of ["file:///etc/passwd", "javascript:alert(1)", "http://127.1", "http://2130706433", "http://metadata.google.internal/", "http://[::ffff:7f00:1]", "https://user:secret@example.test"]) await assert.rejects(assertRemoteInspectionUrl(url, publicDns));
  await assert.rejects(assertRemoteInspectionUrl("https://public-name.test", async () => [{ address: "10.0.0.1" }]), /private/);
  await assertRemoteInspectionUrl("https://example.test", publicDns);
});

test("paired local agent accepts only exact configured origin and matching agent credentials", async t => {
  const original = process.env.HELLOTEST_INSPECTOR_TOKEN;
  process.env.HELLOTEST_INSPECTOR_TOKEN = "local-pair-token";
  t.after(() => { if (original === undefined) delete process.env.HELLOTEST_INSPECTOR_TOKEN; else process.env.HELLOTEST_INSPECTOR_TOKEN = original; });
  const app = Fastify();
  app.addHook("onRequest", createCorsHook(resolveCorsPolicy({ HELLOTEST_INSPECTOR_TOKEN: "local-pair-token", TESTENGINE_CORS_ORIGINS: "https://app.example.test" })));
  app.options("/*", async (_req, reply) => reply.code(204).send());
  await registerRecorderRoutes(app);
  t.after(() => app.close());
  const url = "/api/v1/recorder/agent/status";
  assert.equal((await app.inject({ url, headers: { origin: "https://evil.test", "x-hellotest-agent-token": "local-pair-token" } })).statusCode, 403);
  assert.equal((await app.inject({ url, headers: { origin: "http://localhost:8080", "x-hellotest-agent-token": "local-pair-token" } })).statusCode, 403);
  assert.equal((await app.inject({ url, headers: { origin: "https://app.example.test" } })).statusCode, 401);
  assert.equal((await app.inject({ url, headers: { origin: "https://app.example.test", "x-hellotest-testengine-secret": "hellotest-testengine-dev-secret" } })).statusCode, 401);
  const response = await app.inject({ url, headers: { origin: "https://app.example.test", "x-hellotest-agent-token": "local-pair-token" } });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().service, "hellotest-inspection-agent");
  assert.equal(typeof response.json().ready, "boolean");
  const preflight = await app.inject({ method: "OPTIONS", url, headers: { origin: "https://app.example.test", "access-control-request-private-network": "true", "access-control-request-headers": "x-hellotest-agent-token" } });
  assert.equal(preflight.statusCode, 204);
  assert.equal(preflight.headers["access-control-allow-private-network"], "true");
  assert.match(preflight.headers["access-control-allow-headers"], /x-hellotest-agent-token/);
});

test("remote repository browser creation requires Test Engine credentials", async t => {
  const app = Fastify();
  await registerRecorderRoutes(app);
  t.after(() => app.close());
  assert.equal((await app.inject({ method: "POST", url: "/api/v1/recorder/sessions", payload: { purpose: "repository-inspect" } })).statusCode, 401);
});

test("API-bundled local agent matches the compiled inspection runtime", async () => {
  const { readFile } = await import("node:fs/promises");
  const { createHash } = await import("node:crypto");
  const { gunzipSync } = await import("node:zlib");
  const bundle = JSON.parse(await readFile(new URL("../../../backend/api/src/assets/inspection-agent-runtime.json", import.meta.url), "utf8"));
  const modules = JSON.parse(gunzipSync(Buffer.from(bundle.gzip_base64, "base64")).toString("utf8"));
  for (const [key, name] of Object.entries({ recorder: "recorder", security: "testEngineSecurity", inspection_security: "inspectionSecurity", inspection_proxy: "inspectionProxy" })) {
    const current = await readFile(new URL(`../dist/lib/${name}.js`, import.meta.url), "utf8");
    assert.equal(createHash("sha256").update(current).digest("hex"), bundle.hashes[key], "Regenerate the local installer with npm run package:inspection-agent");
    assert.equal(modules[key], current);
  }
});
