import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { createServer } from "node:https";
import { execFileSync } from "node:child_process";
import Fastify from "fastify";
import { chromium } from "playwright";

const pairToken = "test-pairing-token-for-isolated-browser-fixture";

async function agentFixture(t, pairedToHostedApp) {
  // Exercise the runtime shipped by the API installer, not a mocked status.
  const bundle = JSON.parse(await readFile(new URL("../../../../services/platform/backend/src/assets/inspection-agent-runtime.json", import.meta.url), "utf8"));
  const modules = JSON.parse(gunzipSync(Buffer.from(bundle.gzip_base64, "base64")).toString("utf8"));
  const directory = await mkdtemp(fileURLToPath(new URL("../../.inspection-cors-", import.meta.url)));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const certPath = join(directory, "fixture-cert.pem");
  const keyPath = join(directory, "fixture-key.pem");
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=app.hellotest.ai", "-keyout", keyPath, "-out", certPath], { stdio: "ignore" });
  const secureHost = createServer({ key: await readFile(keyPath), cert: await readFile(certPath) }, (_request, reply) => {
    reply.writeHead(200, { "content-type": "text/html" });
    reply.end("<!doctype html><title>Inspection agent connection fixture</title>");
  });
  await new Promise(resolve => secureHost.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => { secureHost.closeAllConnections(); secureHost.close(resolve); }));
  const hostedOrigin = `https://app.hellotest.ai:${secureHost.address().port}`;
  const origin = pairedToHostedApp ? hostedOrigin : "http://localhost:8080";
  for (const [key, name] of Object.entries({ recorder: "recorder", security: "testEngineSecurity", inspection_security: "inspectionSecurity", inspection_proxy: "inspectionProxy" })) {
    await writeFile(join(directory, `${name}.js`), modules[key]);
  }
  const previous = process.env.HELLOTEST_INSPECTOR_TOKEN;
  process.env.HELLOTEST_INSPECTOR_TOKEN = pairToken;
  t.after(() => previous === undefined ? delete process.env.HELLOTEST_INSPECTOR_TOKEN : process.env.HELLOTEST_INSPECTOR_TOKEN = previous);
  const { registerRecorderRoutes } = await import(pathToFileURL(join(directory, "recorder.js")));
  const { createCorsHook, resolveCorsPolicy } = await import(pathToFileURL(join(directory, "testEngineSecurity.js")));
  const app = Fastify();
  const requests = [];
  app.addHook("onRequest", async request => { requests.push({ method: request.method, origin: request.headers.origin }); });
  app.addHook("onRequest", createCorsHook(resolveCorsPolicy({ HELLOTEST_INSPECTOR_TOKEN: pairToken, TESTENGINE_CORS_ORIGINS: origin })));
  app.options("/*", async (_request, reply) => reply.code(204).send());
  await registerRecorderRoutes(app);
  const baseUrl = await app.listen({ host: "127.0.0.1", port: 0 });
  t.after(() => app.close());
  // Resolve the named secure origin exclusively to this ephemeral fixture. No
  // request interception: Chromium must perform its real CORS preflight.
  const browser = await chromium.launch({ headless: true, args: ["--host-resolver-rules=MAP app.hellotest.ai 127.0.0.1"] });
  t.after(() => browser.close());
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  await context.grantPermissions(["local-network-access"], { origin: hostedOrigin });
  const page = await context.newPage();
  await page.goto(`${hostedOrigin}/inspection-connection-fixture`);
  const check = token => page.evaluate(async ({ baseUrl, token }) => {
    try {
      const response = await fetch(`${baseUrl}/api/v1/recorder/agent/status`, { headers: { "X-HelloTest-Agent-Token": token }, credentials: "omit", cache: "no-store", signal: AbortSignal.timeout(5000) });
      return { status: response.status, payload: await response.json() };
    } catch (error) { return { error: error.name }; }
  }, { baseUrl, token });
  return { check, requests, baseUrl, hostedOrigin };
}

test("API-packaged agent permits real secure-origin CORS and exposes a wrong pairing as readable401", { timeout: 30000 }, async t => {
  const { check, requests, baseUrl, hostedOrigin } = await agentFixture(t, true);
  const allowed = await check(pairToken);
  assert.equal(allowed.status, 200, JSON.stringify(allowed));
  assert.equal(allowed.payload.service, "hellotest-inspection-agent");
  assert.equal(allowed.payload.ready, true);
  assert.ok(requests.some(request => request.method === "OPTIONS" && request.origin === hostedOrigin));
  const wrongPairing = await check("wrong-pairing-token");
  assert.equal(wrongPairing.status, 401, "Pairing errors remain readable instead of becoming CORS failures");
  const preflight = await fetch(`${baseUrl}/api/v1/recorder/agent/status`, { method: "OPTIONS", headers: { origin: hostedOrigin, "access-control-request-method": "GET", "access-control-request-headers": "x-hellotest-agent-token", "access-control-request-private-network": "true" } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), hostedOrigin);
  assert.equal(preflight.headers.get("access-control-allow-private-network"), "true");
});

test("an agent paired to localhost rejects the cloud origin before a status request", { timeout: 30000 }, async t => {
  const { check, requests, hostedOrigin } = await agentFixture(t, false);
  const blocked = await check(pairToken);
  assert.equal(blocked.error, "TypeError", "Reproduces the reported cloud-to-local CORS failure");
  assert.ok(requests.some(request => request.method === "OPTIONS" && request.origin === hostedOrigin));
  assert.equal(requests.filter(request => request.method === "GET").length, 0, "Another origin cannot discover the paired agent");
});
