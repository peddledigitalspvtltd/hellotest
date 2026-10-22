const test = require("node:test");
const assert = require("node:assert/strict");
const Fastify = require("fastify");
const service = require("../../../agentic/backend/services/repositoryInspection.service");
const integrations = require("../../../integration/backend/services/integration.service");
const projects = require("../services/project.service");
const appTypes = require("../services/appType.service");
const routes = require("../../../agentic/backend/routes/repositoryInspection.routes");
const { ROUTE_PERMISSIONS } = require("../src/security/permissions.catalog");
const { buildInstaller } = require("../../../agentic/backend/services/inspectionAgentInstaller");
const integration = { id: "engine-1", is_active: true, type: "testengine", base_url: "http://testengine-internal:4301", config: { project_id: "project-1" } };
const json = value => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
const authorization = "Bearer user-1";
async function fixture(t) {
  t.mock.method(integrations, "getActiveIntegrationByTypeForProject", async () => integration);
  t.mock.method(integrations, "getIntegration", async () => integration);
  t.mock.method(projects, "getProject", async (project, user) => { assert.equal(project, "project-1"); if (user === "removed") throw Object.assign(new Error("Not a member"), { statusCode: 403 }); return { id: project }; });
  t.mock.method(appTypes, "getAppType", async id => ({ id, project_id: id === "wrong-app" ? "other-project" : "project-1" }));
  const app = Fastify();
  app.decorate("authenticate", async req => {
    const token = req.headers.authorization?.replace(/^Bearer /, "");
    if (!token) throw Object.assign(new Error("Missing bearer"), { statusCode: 401 });
    if (token === "expired") throw Object.assign(new Error("Expired bearer"), { statusCode: 401 });
    req.user = { id: token };
    req.authMethod = "session";
  });
  app.decorate("requirePermission", (permission, options = {}) => async req => {
    await app.authenticate(req);
    assert.ok(options.projectId || req.query?.project_id || req.body?.project_id, "A project scope must exist before automatic permission checks");
    if (req.user.id === "forbidden") throw Object.assign(new Error("Permission denied"), { statusCode: 403 });
  });
  app.addHook("onRoute", options => {
    const method = Array.isArray(options.method) ? options.method[0] : options.method;
    const permission = ROUTE_PERMISSIONS.get(`${method} ${options.url}`);
    if (permission) options.preHandler = [...(options.preHandler ? [options.preHandler] : []), app.requirePermission(permission)];
  });
  await app.register(require("../src/plugins/errorHandler"));
  await app.register(routes);
  t.after(() => app.close());
  return app;
}
function ticket(values = {}) {
  return service._internals.seal({ kind: "repository-inspection", expires: Date.now() + 10000, project_id: "project-1", session_id: "session-1", user_id: "user-1", authorization, integration_id: "engine-1", engine_token: "private-engine-token", origin: "https://app.example.test", ...values });
}
test("remote creation never accepts client engine overrides or reuses another browser", async t => {
  const app = await fixture(t);
  const calls = [];
  t.mock.method(global, "fetch", async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ id: "session-1", status: "running", live_view_path: "/api/v1/recorder/sessions/session-1/live?token=private-engine-token" }), { headers: { "content-type": "application/json", "set-cookie": "HELLOTEST_ENGINE=worker1; path=/; HttpOnly" } });
  });
  const response = await app.inject({ method: "POST", url: "/repository-inspection/sessions", headers: { authorization, origin: "https://app.example.test" }, payload: { project_id: "project-1", start_url: "https://example.test", engine_base_url: "http://localhost:1", reuse_existing: true } });
  assert.equal(response.statusCode, 200, response.body);
  const result = response.json();
  assert.match(result.live_view_url, /^\/repository-inspection\/sessions\/session-1\/live\?token=/);
  assert.ok(!response.body.includes("private-engine-token") && !response.body.includes("testengine-internal"));
  assert.equal(calls[0].url, "http://testengine-internal:4301/api/v1/recorder/sessions");
  assert.equal(JSON.parse(calls[0].init.body).reuse_existing, false);
  const resolved = await service.resolve(new URL(result.status_url, "https://app.test").searchParams.get("token"), result.id);
  assert.equal(resolved.headers.cookie, "HELLOTEST_ENGINE=worker1");
});
test("inspection start accepts an empty destination and normalizes absolute URLs without treating screen keys as URLs", async t => {
  const app = await fixture(t);
  const destinations = [];
  t.mock.method(global, "fetch", async (_url, init) => {
    destinations.push(JSON.parse(init.body).start_url);
    return json({ id: "session-1", status: "running", live_view_path: "/api/v1/recorder/sessions/session-1/live?token=engine-token" });
  });
  for (const start_url of [undefined, null, "   ", " https://example.test/checkout?step=2 "]) {
    const response = await app.inject({ method: "POST", url: "/repository-inspection/sessions?project_id=project-1", headers: { authorization }, payload: { project_id: "project-1", start_url } });
    assert.equal(response.statusCode, 200, response.body);
  }
  assert.deepEqual(destinations, [null, null, null, "https://example.test/checkout?step=2"]);
  for (const start_url of ["checkout-screen", "/checkout", "example.test", "javascript:alert(1)", "file:///tmp/index.html", "https://user:password@example.test", "https://exam\nple.test", false, 0, {}]) {
    const response = await app.inject({ method: "POST", url: "/repository-inspection/sessions?project_id=project-1", headers: { authorization }, payload: { project_id: "project-1", start_url } });
    assert.equal(response.statusCode, 400, response.body);
    assert.equal(response.json().code, "INSPECTION_URL_INVALID");
    assert.match(response.json().message, /full HTTP or HTTPS URL.*leave it empty/);
  }
  assert.equal(destinations.length, 4, "Invalid destinations never reach the Test Engine");
});
test("inspection preserves typed remote destination rejections without bypassing private-network validation", async t => {
  const app = await fixture(t);
  for (const [code, start_url, message] of [
    ["INSPECTION_PRIVATE_TARGET", "http://127.0.0.1:8080", "This address is private to the Test Engine. Use a connected local session."],
    ["INSPECTION_DNS_FAILED", "https://unresolvable.example.test", "The remote browser could not resolve this hostname. Check the URL or use a local session."],
    ["INSPECTION_URL_INVALID", "https://example.test", "Enter a valid HTTP(S) URL."]
  ]) {
    t.mock.method(global, "fetch", async (_url, init) => {
      assert.equal(JSON.parse(init.body).start_url, `${start_url}/`);
      return new Response(JSON.stringify({ code, message }), { status: 400, headers: { "content-type": "application/json" } });
    });
    const response = await app.inject({ method: "POST", url: "/repository-inspection/sessions", headers: { authorization }, payload: { project_id: "project-1", start_url } });
    assert.equal(response.statusCode, 400, response.body);
    assert.equal(response.json().code, code);
    assert.equal(response.json().message, message);
    assert.equal(response.json().retryable, false);
  }
});
test("invalid engine configuration is reported as a setup issue rather than a bad inspection request", async t => {
  const app = await fixture(t);
  let base_url;
  t.mock.method(integrations, "getActiveIntegrationByTypeForProject", async () => ({ ...integration, base_url }));
  t.mock.method(global, "fetch", () => assert.fail("Invalid integration URL must not issue a network request"));
  for (base_url of ["not a URL", "testengine-internal:bad-port", "https://user:secret@engine.example.test", "https://engine.example.test?token=secret"]) {
    const response = await app.inject({ method: "POST", url: "/repository-inspection/sessions", headers: { authorization }, payload: { project_id: "project-1", start_url: "https://example.test" } });
    assert.equal(response.statusCode, 503, response.body);
    assert.equal(response.json().code, "INSPECTION_ENGINE_CONFIGURATION");
    assert.match(response.json().message, /configured Test Engine URL/);
    assert.ok(!response.body.includes("secret"), "Configuration messages must not expose credentials");
  }
});
test("temporary engine DNS failures preserve retry guidance through the API", async t => {
  const app = await fixture(t);
  const message = 'The Test Engine DNS service could not resolve "app.example.test" after three attempts. Check the engine DNS, then retry.';
  t.mock.method(global, "fetch", async () => new Response(JSON.stringify({ code: "INSPECTION_DNS_FAILED", message, retryable: true }), { status: 503, headers: { "content-type": "application/json" } }));
  const response = await app.inject({ method: "POST", url: "/repository-inspection/sessions", headers: { authorization }, payload: { project_id: "project-1", start_url: "https://app.example.test" } });
  assert.equal(response.statusCode, 503);
  assert.equal(response.json().code, "INSPECTION_DNS_FAILED");
  assert.equal(response.json().retryable, true);
  assert.equal(response.json().message, message);
});
test("proxy authenticates iframe capability before permission checks and preserves reverse-proxy prefix", async t => {
  const app = await fixture(t);
  const cap = ticket();
  t.mock.method(global, "fetch", async (url, init) => {
    assert.equal(new URL(url).hostname, "testengine-internal");
    assert.equal(init.headers["x-hellotest-recorder-token"], "private-engine-token");
    return new Response('<script>const streamUrl = "/api/v1/recorder/sessions/" + encodeURIComponent(sessionId) + "/stream";</script>', { headers: { "content-type": "text/html" } });
  });
  const response = await app.inject(`/repository-inspection/sessions/session-1/live?token=${cap}`);
  assert.equal(response.statusCode, 200, response.body);
  assert.match(response.body, /window.location.pathname.replace/);
  assert.ok(!response.body.includes("/api/v1/recorder"));
  assert.match(response.headers["content-security-policy"], /https:\/\/app.example.test/);
});
test("cross-user, wrong-session, expired, tampered and revoked access fail before engine I/O", async t => {
  const app = await fixture(t);
  t.mock.method(global, "fetch", () => assert.fail("Unauthorized engine I/O"));
  for (const [cap, id, headers, expected] of [
    [ticket(), "session-1", { authorization: "Bearer user-2" }, 403],
    [ticket(), "other-session", {}, 403],
    [ticket({ expires: 1 }), "session-1", {}, 401],
    [ticket() + "corrupt", "session-1", {}, 401],
    [ticket({ authorization: "Bearer expired" }), "session-1", {}, 401],
    [ticket({ user_id: "removed", authorization: "Bearer removed" }), "session-1", {}, 403],
    [ticket({ user_id: "forbidden", authorization: "Bearer forbidden" }), "session-1", {}, 403]
  ]) assert.equal((await app.inject({ url: `/repository-inspection/sessions/${id}/tabs?token=${cap}`, headers })).statusCode, expected);
});
test("proxy strips engine transport URLs, allows bounded suffixes only, and protects project scope", async t => {
  const app = await fixture(t);
  t.mock.method(global, "fetch", async () => json({ id: "session-1", status: "running", status_url: "http://localhost:4311/x", live_view_path: "/api/v1/recorder/x", engine_base_url: "http://secret-host" }));
  const response = await app.inject(`/repository-inspection/sessions/session-1?token=${ticket()}`);
  assert.deepEqual(response.json(), { id: "session-1", status: "running" });
  assert.equal((await app.inject(`/repository-inspection/sessions/session-1/arbitrary?token=${ticket()}`)).statusCode, 405);
  assert.equal((await app.inject({ method: "POST", url: "/repository-inspection/sessions", headers: { authorization }, payload: { project_id: "project-1", app_type_id: "wrong-app" } })).statusCode, 403);
});
test("setup links expire, are user bound, contain no bearer plaintext and cannot access a browser session", async t => {
  await fixture(t);
  const setup = service.createSetup({ project_id: "project-1", origin: "https://app.example.test", agent_token: "a".repeat(48), authorization, user_id: "user-1" });
  assert.ok(!setup.download_url.includes(authorization));
  const token = new URL(setup.download_url, "https://app.test").searchParams.get("token");
  assert.equal(service.resolveSetup(token).origin, "https://app.example.test");
  await assert.rejects(service.resolve(token, "session-1"), /not valid/);
  assert.throws(() => service.resolveSetup(ticket()), /Invalid local agent/);
  assert.throws(() => service.createSetup({ origin: "file:///tmp/x", agent_token: "a".repeat(48) }), /origin/);
  assert.throws(() => service.createSetup({ origin: "https://app.test", agent_token: "short" }), /pairing/);
});
test("standalone installer embeds only scoped pairing and pins exact runtime dependencies", () => {
  const module = "export {};\n".repeat(20);
  const source = buildInstaller({ recorder: module, security: module, inspection_security: module, inspection_proxy: module, repository_locator: module, origin: "https://app.example.test", agent_token: "a".repeat(48) });
  const dependencies = JSON.parse(source.match(/dependencies: (\{[^\n]+?\}) \}\)/)[1]);
  assert.deepEqual(dependencies, { acorn: "8.18.0", fastify: "4.29.1", playwright: "1.59.1" });
  assert.match(source, /repository_inspection: true, local_execution: false/);
  assert.match(source, /host: "127.0.0.1", port: 4311/);
  assert.match(source, /TESTENGINE_CORS_ORIGINS = config.origin/);
  assert.ok(!source.includes(authorization));
  const syntax = require("node:child_process").spawnSync(process.execPath, ["--check", "--input-type=module"], { input: source, encoding: "utf8" });
  assert.equal(syntax.status, 0, syntax.stderr);
  assert.throws(() => buildInstaller({ recorder: "missing" }), /Update the HelloTest API/);
});
test("standalone setup detects an occupied agent port before installation and explains how to pair the correct application", async t => {
  const net = require("node:net");
  const server = net.createServer();
  const reserved = await new Promise((resolve, reject) => {
    server.once("error", error => error.code === "EADDRINUSE" ? resolve(false) : reject(error));
    server.listen({ host: "127.0.0.1", port: 4311 }, () => resolve(true));
  });
  if (reserved) t.after(() => new Promise(resolve => server.close(resolve)));
  const module = "export {};\n".repeat(20);
  const source = buildInstaller({ recorder: module, security: module, inspection_security: module, inspection_proxy: module, repository_locator: module, origin: "https://app.example.test", agent_token: "test-pairing-token" });
  // Execute the actual generated preflight, ending before filesystem/network
  // installation work so this regression test never installs npm dependencies.
  const preflight = source.slice(0, source.indexOf("const directory ="));
  assert.ok(preflight.includes("createServer"));
  const result = require("node:child_process").spawnSync(process.execPath, ["--input-type=module"], { input: preflight, encoding: "utf8", timeout: 10_000 });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /Port 4311 is already in use/);
  assert.match(result.stderr, /Stop the existing HelloTest inspection agent.*Ctrl\+C/);
  assert.match(result.stderr, /rerun the setup command copied from https:\/\/app.example.test/);
  assert.doesNotMatch(result.stdout, /Installing HelloTest/);
});

test("standalone setup download works without a bearer header or a reachable configured remote engine", async t => {
  const app = await fixture(t);
  t.mock.method(global, "fetch", () => assert.fail("Local setup must not depend on remote engine I/O"));
  t.mock.method(integrations, "getActiveIntegrationByTypeForProject", async () => null);
  const response = await app.inject({ method: "POST", url: "/repository-inspection/local-agent/setup", headers: { authorization, origin: "https://app.example.test" }, payload: { project_id: "project-1", origin: "https://app.example.test", agent_token: "a".repeat(48) } });
  assert.equal(response.statusCode, 200, response.body);
  const download = await app.inject(response.json().download_url);
  assert.equal(download.statusCode, 200, download.body);
  assert.match(download.headers["content-disposition"], /\.mjs/);
  assert.ok(!download.body.includes(authorization));
  assert.match(download.body, /registerRecorderRoutes/);
});

test("real accessControl prehandlers revalidate capability login, permission and feature gates before proxy or setup download", async t => {
  const db = require("../src/db");
  const permissionService = require("../services/permission.service");
  const featureService = require("../services/featureFlag.service");
  const { createToken } = require("../src/utils/token");
  const bearer = `Bearer ${createToken({ id: "user-1", email: "test@example.test" })}`;
  let suspended = false;
  let permitted = true;
  let featureEnabled = true;
  let engineRequests = 0;
  t.mock.method(db, "prepare", () => ({ get: async id => ({ id, email: "test@example.test", status: suspended ? "suspended" : "active", is_workspace_admin: false }) }));
  t.mock.method(permissionService, "hasPermission", async (_user, permission, project) => { assert.equal(project, "project-1"); assert.equal(permission, "automation.repository.manage"); return permitted; });
  t.mock.method(featureService, "areEnabled", async keys => { assert.ok(!keys.some(key => /recorder|execution/.test(key))); return featureEnabled; });
  t.mock.method(integrations, "getIntegration", async () => integration);
  t.mock.method(integrations, "getActiveIntegrationByTypeForProject", async () => integration);
  t.mock.method(projects, "getProject", async () => ({ id: "project-1" }));
  t.mock.method(global, "fetch", async () => { engineRequests++; return json({ id: "session-1", status: "running" }); });
  const app = Fastify();
  app.addHook("onRequest", async (_req, reply) => { reply.header("X-Frame-Options", "DENY"); });
  await app.register(require("../src/plugins/accessControl"));
  await app.register(routes);
  t.after(() => app.close());
  const url = `/repository-inspection/sessions/session-1?token=${ticket({ authorization: bearer })}`;
  assert.equal((await app.inject(url)).statusCode, 200);
  suspended = true;
  assert.equal((await app.inject(url)).statusCode, 403);
  suspended = false; permitted = false;
  assert.equal((await app.inject(url)).statusCode, 403);
  permitted = true; featureEnabled = false;
  assert.equal((await app.inject(url)).statusCode, 403);
  assert.equal(engineRequests, 1);
  const setup = service.createSetup({ project_id: "project-1", origin: "https://app.example.test", agent_token: "a".repeat(48), authorization: bearer, user_id: "user-1" });
  assert.equal((await app.inject(setup.download_url)).statusCode, 403);
  assert.equal(engineRequests, 1);
  featureEnabled = true;
  t.mock.method(global, "fetch", async () => new Response('<script>"/api/v1/recorder/sessions/" + encodeURIComponent(sessionId)</script>', { headers: { "content-type": "text/html" } }));
  const live = await app.inject(`/repository-inspection/sessions/session-1/live?token=${ticket({ authorization: bearer })}`);
  assert.equal(live.statusCode, 200, live.body);
  assert.equal(live.headers["x-frame-options"], undefined, "The scoped frame must override the API's global DENY header");
  assert.match(live.headers["content-security-policy"], /frame-ancestors 'self' https:\/\/app.example.test/);
});


test("remote startup reports actionable failures and can retry after an engine outage", async t => {
  const app = await fixture(t);
  let attempt = 0;
  t.mock.method(global, "fetch", async () => {
    attempt++;
    if (attempt === 1) throw new TypeError("fetch failed");
    if (attempt === 2) return new Response("<html>Proxy unavailable</html>", { status: 502 });
    return json({ id: "session-1", status: "running", live_view_path: "/api/v1/recorder/sessions/session-1/live?token=engine-token" });
  });
  const request = { method: "POST", url: "/repository-inspection/sessions", headers: { authorization }, payload: { project_id: "project-1" } };
  for (let i = 0; i < 2; i++) {
    const response = await app.inject(request);
    assert.equal(response.statusCode, 503);
    assert.equal(response.json().code, "INSPECTION_ENGINE_UNAVAILABLE");
    assert.match(response.json().message, /integration URL.*retry/);
  }
  assert.equal((await app.inject(request)).statusCode, 200);
});
