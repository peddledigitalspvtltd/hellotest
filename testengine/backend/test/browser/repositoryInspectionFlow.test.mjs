import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { chromium } from "playwright";
import Fastify from "fastify";
import { registerRecorderRoutes } from "../../dist/lib/recorder.js";
const require = createRequire(import.meta.url);
const integrations = require("../../../../backend/api/src/services/integration.service.js");
const projects = require("../../../../backend/api/src/services/project.service.js");
const inspectionRoutes = require("../../../../backend/api/src/routes/repositoryInspection.routes.js");

test("real remote Chromium inspection streams through app proxy and closes its isolated context", { timeout: 60000 }, async t => {
  const previous = process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;
  process.env.RECORDER_ALLOWED_PRIVATE_HOSTS = "127.0.0.1";
  t.after(() => { if (previous === undefined) delete process.env.RECORDER_ALLOWED_PRIVATE_HOSTS; else process.env.RECORDER_ALLOWED_PRIVATE_HOSTS = previous; });
  const engine = Fastify();
  const api = Fastify();
  engine.get("/target", async (_req, reply) => reply.type("text/html").send('<!doctype html><title>Inspect fixture</title><button id="save">Save fixture</button>'));
  await registerRecorderRoutes(engine);
  const engineUrl = await engine.listen({ host: "127.0.0.1", port: 0 });
  const integration = { id: "engine-1", type: "testengine", is_active: true, base_url: engineUrl, config: {} };
  t.mock.method(integrations, "getActiveIntegrationByTypeForProject", async () => integration);
  t.mock.method(integrations, "getIntegration", async () => integration);
  t.mock.method(projects, "getProject", async (id, user) => { assert.equal(id, "project-1"); assert.equal(user, "user-1"); return { id }; });
  api.decorate("authenticate", async req => { assert.equal(req.headers.authorization, "Bearer user-1"); req.user = { id: "user-1" }; req.authMethod = "session"; });
  api.decorate("requirePermission", () => async req => { await api.authenticate(req); });
  api.get("/harness", async (_req, reply) => reply.type("text/html").send('<!doctype html><title>Inspection host</title>'));
  await api.register(inspectionRoutes, { prefix: "/api" });
  const apiUrl = await api.listen({ host: "127.0.0.1", port: 0 });
  const browser = await chromium.launch({ headless: true });
  t.after(async () => { await browser.close(); await api.close(); await engine.close(); });
  const created = await fetch(`${apiUrl}/api/repository-inspection/sessions`, {
    method: "POST", headers: { authorization: "Bearer user-1", origin: apiUrl, "content-type": "application/json" },
    body: JSON.stringify({ project_id: "project-1", start_url: `${engineUrl}/target` })
  });
  const session = await created.json();
  assert.equal(created.status, 200, JSON.stringify(session));
  const liveUrl = `${apiUrl}/api${session.live_view_url}`;
  const statusUrl = new URL(`${apiUrl}/api${session.status_url}`);
  const operation = async (suffix, body) => {
    const url = new URL(statusUrl); url.pathname += suffix ? `/${suffix}` : "";
    const response = await fetch(url, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {});
    return { status: response.status, body: await response.json() };
  };
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", err => errors.push(err.message));
  await page.goto(`${apiUrl}/harness`);
  await page.evaluate(src => { const frame = document.createElement("iframe"); frame.src = src; frame.width = "960"; frame.height = "680"; document.body.append(frame); }, liveUrl);
  const frame = page.frameLocator("iframe");
  await frame.locator("#screen").waitFor();
  await page.waitForFunction(() => document.querySelector("iframe")?.contentDocument?.querySelector("#screen")?.width === 1365, { timeout: 15000 });
  assert.deepEqual(errors, []);
  const tabs = await operation("tabs");
  assert.equal(tabs.status, 200);
  assert.ok(tabs.body.tabs.some(tab => tab.url.endsWith("/target")));
  const checked = await operation("inspect/validate", { fields: [{ locator: "#save", name: "Save fixture" }] });
  assert.equal(checked.status, 200, JSON.stringify(checked.body));
  const unauthorized = await fetch(`${engineUrl}/api/v1/recorder/sessions/${session.id}/tabs`);
  assert.equal(unauthorized.status, 401, "Direct engine access cannot enumerate a protected browser");
  const stopped = await operation("stop", {});
  assert.equal(stopped.status, 200);
  assert.equal(stopped.body.status, "stopped");
});

test("remote browser proxy blocks redirect and WebSocket access to non-allowlisted private addresses", { timeout: 30000 }, async t => {
  const { createInspectionProxy } = await import("../../dist/lib/inspectionProxy.js");
  const http = await import("node:http");
  const previous = process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;
  process.env.RECORDER_ALLOWED_PRIVATE_HOSTS = "localhost";
  t.after(() => { if (previous === undefined) delete process.env.RECORDER_ALLOWED_PRIVATE_HOSTS; else process.env.RECORDER_ALLOWED_PRIVATE_HOSTS = previous; });
  let privateHits = 0;
  let upgrades = 0;
  const site = http.createServer((request, reply) => {
    if (request.url === "/redirect") { reply.writeHead(302, { location: `http://127.0.0.1:${site.address().port}/private` }); reply.end(); }
    else if (request.url === "/private") { privateHits++; reply.end("Private content must not be reached"); }
    else { reply.writeHead(200, { "content-type": "text/html" }); reply.end("<!doctype html><title>Public fixture</title>"); }
  });
  site.on("upgrade", (_req, socket) => { upgrades++; socket.destroy(); });
  await new Promise(resolve => site.listen(0, "::", resolve));
  const port = site.address().port;
  const proxy = await createInspectionProxy();
  const browser = await chromium.launch({ headless: true, args: ["--disable-quic"], proxy: { server: proxy.server, bypass: "<-loopback>" } });
  t.after(async () => { await browser.close(); await proxy.close(); await new Promise(resolve => site.close(resolve)); });
  const context = await browser.newContext({ serviceWorkers: "block" });
  const page = await context.newPage();
  const response = await page.goto(`http://localhost:${port}/redirect`);
  assert.equal(response.status(), 403);
  assert.equal(privateHits, 0, "A browser redirect must never connect to a private destination");
  await page.goto(`http://localhost:${port}/`);
  const socketResult = await page.evaluate(port => new Promise(resolve => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    socket.onerror = () => resolve("blocked");
    socket.onopen = () => { socket.close(); resolve("opened"); };
    setTimeout(() => resolve("timeout"), 5000);
  }), port);
  assert.equal(socketResult, "blocked");
  assert.equal(upgrades, 0, "Private WebSocket upgrade must not reach the destination");
  const proxyUrl = new URL(proxy.server);
  const connectStatus = await new Promise((resolve, reject) => {
    const request = http.request({ hostname: proxyUrl.hostname, port: proxyUrl.port, method: "CONNECT", path: `127.0.0.1:${port}` });
    request.on("connect", (response, socket) => { resolve(response.statusCode); socket.destroy(); });
    request.on("error", reject); request.end();
  });
  assert.equal(connectStatus, 403, "TLS/WebSocket CONNECT tunnels must also enforce private-network policy");
});
