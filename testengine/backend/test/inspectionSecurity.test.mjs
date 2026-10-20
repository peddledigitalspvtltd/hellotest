import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { assertRemoteInspectionUrl, isPrivateInspectionAddress, resolveRemoteInspectionTarget } from "../dist/lib/inspectionSecurity.js";
import { registerRecorderRoutes } from "../dist/lib/recorder.js";
import { createCorsHook, resolveCorsPolicy } from "../dist/lib/testEngineSecurity.js";

test("inspection retries temporary DNS failures and reports persistent lookup failures accurately", async () => {
  let attempts = 0;
  const transient = () => Object.assign(new Error("DNS unavailable"), { code: "EAI_AGAIN" });
  assert.equal(await resolveRemoteInspectionTarget("https://app.example.test", async () => {
    if (++attempts < 3) throw transient();
    return [{ address: "93.184.216.34" }];
  }), "93.184.216.34");
  assert.equal(attempts, 3);
  attempts = 0;
  await assert.rejects(resolveRemoteInspectionTarget("https://app.example.test", async () => { attempts++; throw transient(); }), error => error.code === "INSPECTION_DNS_FAILED" && error.statusCode === 503 && error.retryable);
  assert.equal(attempts, 3);
  attempts = 0;
  await assert.rejects(resolveRemoteInspectionTarget("https://staging.example.test/login?secret=hidden", async () => { attempts++; throw Object.assign(new Error("Not found"), { code: "ENOTFOUND" }); }), error => {
    assert.equal(error.statusCode, 400); assert.equal(error.retryable, false);
    assert.match(error.message, /staging.example.test/); assert.match(error.message, /blank browser/);
    assert.doesNotMatch(error.message, /secret|hidden/); return true;
  });
  assert.equal(attempts, 1, "Unknown hostnames must be corrected instead of blindly retried");
  await assert.rejects(resolveRemoteInspectionTarget("https://public.example.test", async () => [{ address: "93.184.216.34" }, { address: "10.0.0.1" }]), error => error.code === "INSPECTION_PRIVATE_TARGET");
});

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
  const missingToken = await app.inject({ url, headers: { origin: "https://app.example.test" } });
  assert.equal(missingToken.statusCode, 401);
  assert.equal(missingToken.json().code, "INSPECTION_AGENT_UNPAIRED");
  assert.equal(missingToken.headers["access-control-allow-origin"], "https://app.example.test", "an allowed app can read pairing errors instead of receiving an opaque CORS failure");
  assert.equal((await app.inject({ url, headers: { origin: "https://app.example.test", "x-hellotest-testengine-secret": "hellotest-testengine-dev-secret" } })).statusCode, 401);
  const response = await app.inject({ url, headers: { origin: "https://app.example.test", "x-hellotest-agent-token": "local-pair-token" } });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().service, "hellotest-inspection-agent");
  assert.equal(typeof response.json().ready, "boolean");
  assert.equal(response.headers["access-control-allow-origin"], "https://app.example.test");
  assert.equal(response.headers["cache-control"], "no-store");
  assert.equal((await app.inject({ url, headers: { "x-hellotest-agent-token": "local-pair-token" } })).statusCode, 200, "the installer may verify its own token without a browser origin");
  const preflight = await app.inject({ method: "OPTIONS", url, headers: { origin: "https://app.example.test", "access-control-request-private-network": "true", "access-control-request-headers": "x-hellotest-agent-token" } });
  assert.equal(preflight.statusCode, 204);
  assert.equal(preflight.headers["access-control-allow-private-network"], "true");
  assert.match(preflight.headers["access-control-allow-headers"], /x-hellotest-agent-token/);
});

test("an agent paired on localhost does not silently trust the hosted application origin", async t => {
  const app = Fastify();
  app.addHook("onRequest", createCorsHook(resolveCorsPolicy({ HELLOTEST_INSPECTOR_TOKEN: "local-pair-token", TESTENGINE_CORS_ORIGINS: "http://localhost:8080" })));
  app.options("/*", async (_req, reply) => reply.code(204).send());
  t.after(() => app.close());
  const preflight = origin => app.inject({ method: "OPTIONS", url: "/api/v1/recorder/agent/status", headers: { origin, "access-control-request-method": "GET", "access-control-request-headers": "x-hellotest-agent-token", "access-control-request-private-network": "true" } });
  const allowed = await preflight("http://localhost:8080");
  assert.equal(allowed.statusCode, 204);
  assert.equal(allowed.headers["access-control-allow-private-network"], "true");
  const hosted = await preflight("https://app.hellotest.ai");
  assert.equal(hosted.statusCode, 403);
  assert.equal(hosted.json().code, "INSPECTION_ORIGIN_NOT_PAIRED");
  assert.equal(hosted.headers["access-control-allow-origin"], undefined);
  assert.equal(hosted.headers["access-control-allow-private-network"], undefined);
});

test("inspection target validation provides safe typed errors without weakening private-address checks", async () => {
  const publicDns = async () => [{ address: "93.184.216.34" }];
  for (const target of ["not a URL", "file:///etc/passwd", "https://user:secret@example.test"]) {
    await assert.rejects(assertRemoteInspectionUrl(target, publicDns), failure => failure.code === "INSPECTION_URL_INVALID");
  }
  await assert.rejects(assertRemoteInspectionUrl("http://127.0.0.1", publicDns), failure => failure.code === "INSPECTION_PRIVATE_TARGET");
  await assert.rejects(assertRemoteInspectionUrl("https://public.example", async () => [{ address: "93.184.216.34" }, { address: "192.168.1.1" }]), failure => failure.code === "INSPECTION_PRIVATE_TARGET");
  await assert.rejects(assertRemoteInspectionUrl("https://missing.example", async () => { throw new Error("SECRET_DNS_DIAGNOSTIC"); }), failure => failure.code === "INSPECTION_DNS_FAILED" && !failure.message.includes("SECRET_DNS_DIAGNOSTIC"));
  await assert.rejects(assertRemoteInspectionUrl("https://missing.example", async () => []), failure => failure.code === "INSPECTION_DNS_FAILED");
  assert.equal(await resolveRemoteInspectionTarget("https://public.example", publicDns), "93.184.216.34");
});

test("remote session creation returns stable target errors before launching a browser", async t => {
  const original = { token: process.env.HELLOTEST_INSPECTOR_TOKEN, secret: process.env.TESTENGINE_SHARED_SECRET };
  delete process.env.HELLOTEST_INSPECTOR_TOKEN;
  process.env.TESTENGINE_SHARED_SECRET = "isolated-inspection-test-secret-with-32-characters";
  t.after(() => {
    if (original.token === undefined) delete process.env.HELLOTEST_INSPECTOR_TOKEN; else process.env.HELLOTEST_INSPECTOR_TOKEN = original.token;
    if (original.secret === undefined) delete process.env.TESTENGINE_SHARED_SECRET; else process.env.TESTENGINE_SHARED_SECRET = original.secret;
  });
  const app = Fastify();
  await registerRecorderRoutes(app);
  t.after(() => app.close());
  for (const [start_url, code] of [["file:///etc/passwd", "INSPECTION_URL_INVALID"], ["https://user:secret@example.test", "INSPECTION_URL_INVALID"], ["http://127.0.0.1", "INSPECTION_PRIVATE_TARGET"]]) {
    const response = await app.inject({ method: "POST", url: "/api/v1/recorder/sessions", headers: { "x-hellotest-testengine-secret": process.env.TESTENGINE_SHARED_SECRET }, payload: { purpose: "repository-inspect", recorder_mode: "remote", start_url } });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().code, code);
  }
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
  const bundle = JSON.parse(await readFile(new URL("../../../services/platform/backend/src/assets/inspection-agent-runtime.json", import.meta.url), "utf8"));
  const modules = JSON.parse(gunzipSync(Buffer.from(bundle.gzip_base64, "base64")).toString("utf8"));
  for (const [key, name] of Object.entries({ recorder: "recorder", security: "testEngineSecurity", inspection_security: "inspectionSecurity", inspection_proxy: "inspectionProxy", repository_locator: "repositoryLocator" })) {
    const current = await readFile(new URL(`../dist/lib/${name}.js`, import.meta.url), "utf8");
    assert.equal(createHash("sha256").update(current).digest("hex"), bundle.hashes[key], "Regenerate the local installer with npm run package:inspection-agent");
    assert.equal(modules[key], current);
  }
});

test('administrator origin routes preserve exact scheme and port scope without granting loopback access elsewhere', async t => {
 const prior=process.env.RECORDER_TARGET_ORIGIN_ALIASES;
 t.after(()=>{if(prior===undefined)delete process.env.RECORDER_TARGET_ORIGIN_ALIASES;else process.env.RECORDER_TARGET_ORIGIN_ALIASES=prior;});
 process.env.RECORDER_TARGET_ORIGIN_ALIASES=JSON.stringify({'http://localhost:8080':'http://frontend:4400'});
 const {resolveRemoteInspectionEndpoint}=await import('../dist/lib/inspectionSecurity.js');
 const queries=[];const dns=async(host)=>{queries.push(host);return [{address:'172.18.0.7'}];};
 assert.deepEqual(await resolveRemoteInspectionEndpoint('http://localhost:8080/auth?token=private',dns),{address:'172.18.0.7',port:4400});assert.deepEqual(queries,['frontend']);
 for(const url of ['http://localhost:8081','https://localhost:8080','http://127.0.0.1:8080','http://169.254.169.254','http://other.test:8080'])await assert.rejects(resolveRemoteInspectionEndpoint(url,dns),{code:'INSPECTION_PRIVATE_TARGET'});
 for(const map of [{'http://localhost:8080':'https://frontend:4400'},{'http://localhost:8080':'http://user:secret@frontend:4400'},{'http://localhost:8080':'http://frontend/path'},{'*':'http://frontend'}]){
  process.env.RECORDER_TARGET_ORIGIN_ALIASES=JSON.stringify(map);await assert.rejects(resolveRemoteInspectionEndpoint('http://localhost:8080',dns),error=>error.code==='INSPECTION_URL_INVALID'&&!error.message.includes('secret'));
 }
});
