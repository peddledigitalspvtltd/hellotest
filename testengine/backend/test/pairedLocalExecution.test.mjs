import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID, createHmac } from "node:crypto";
import Fastify from "fastify";
const root = await mkdtemp(path.join(tmpdir(), "hellotest-paired-native-"));
process.env.ARTIFACT_ROOT = path.join(root, "artifacts");
after(() => rm(root, { recursive: true, force: true }));
const { registerPairedLocalExecutionRoutes, priorPairedCaptures } = await import("../dist/lib/pairedLocalExecution.js");
const token = "paired-browser-secret-".repeat(3), grant = "scoped-execution-grant-".repeat(3), origin = "https://app.hellotest.example";
const waitFor = async fn => { const limit = Date.now() + 10000; for (;;) { const value = await fn(); if (value) return value; if (Date.now() > limit) throw new Error("Fixture execution did not finish"); await new Promise(resolve => setTimeout(resolve, 20)); } };
function envelope(executionId, base, order = 0) {
  return { engine_run_id: randomUUID(), hellotest_run_id: executionId, hellotest_execution_id: executionId, hellotest_test_case_id: randomUUID(), hellotest_test_case_title: "Paired native case", project: { id: "project-1", name: "Project" }, app_type: { id: "app-1", name: "Web", kind: "web" }, trigger: "manual", source_mode: "manual-spec", automated: true,
    browser: "chromium", headless: true, max_repair_attempts: 0, run_timeout_seconds: 30, parameters_frozen: true, suite_parameters: {}, case_parameters: {}, run_parameters: {}, manual_spec: { test_data: {} },
    execution_policy: { execution_order: order, suite_id: "suite-1" }, web_engine: { active: "playwright" },
    steps: [{ id: "step-1", order: 1, step_type: "api", title: "Get fixture", api_request: { method: "GET", url: `${base}/target`, validations: [{ kind: "status", expected: "200" }], captures: [{ parameter: "@r.token", path: "$.token" }] } }],
    artifact_policy: { trace_mode: "off", video_mode: "off", screenshot_on_failure: false, capture_console: false, capture_network: false, artifact_retention_days: 1 }, callback: { url: `${base}/api/testengine/callbacks/runs`, signing_secret: "per-run-callback-secret-".repeat(3) } };
}
async function fixture(t, options = {}) {
  const api = Fastify(), local = Fastify();
  const executionId = randomUUID(), dispatchId = randomUUID();
  let claims = 0, targets = 0; const callbacks = [], targetQueries = [], bridge = {};
  api.get("/web-target", async (_req, reply) => reply.type("text/html").send('<html><title>Local native fixture</title><button onclick="this.textContent=\"Clicked\"">Save locally</button><h1>Local native fixture</h1></html>'));
  api.get("/target", async req => { targets++; targetQueries.push(req.query); if (options.targetDelay) await new Promise(resolve => setTimeout(resolve, options.targetDelay)); return { token: "captured-on-user-machine" }; });
  api.get("/api/local-browser-bridges/:id/poll", async req => bridge.poll ? bridge.poll(req) : { state: "closed", command: null });
  api.post("/api/local-browser-bridges/:id/result", async (req, reply) => bridge.result ? bridge.result(req, reply) : { accepted: true });
  api.post(`/api/executions/${executionId}/local-dispatch/claim`, async req => {
    claims++; assert.equal(req.headers.authorization, `Bearer ${grant}`); assert.equal(typeof req.body.agent_id, "string");
    return { execution_id: executionId, dispatch_id: dispatchId, expires_at: new Date(Date.now() + 60000).toISOString(), envelopes: options.change ? options.change(envelopes) : envelopes };
  });
  api.get(`/api/executions/${executionId}/local-dispatch/control`, async () => ({ execution_id: executionId, cancelled: false }));
  api.post("/api/testengine/callbacks/runs", async req => {
    const expected = createHmac("sha256", envelopes.find(item => item.engine_run_id === req.body.engine_run_id).callback.signing_secret).update(JSON.stringify(req.body)).digest("hex");
    assert.equal(req.headers["x-testengine-signature"], expected); callbacks.push(req.body); return { accepted: true };
  });
  const base = await api.listen({ host: "127.0.0.1", port: 0 });
  const envelopes = [envelope(executionId, base)];
  if (options.web) {
    envelopes[0].steps = [{ id: "web-step", order: 1, step_type: "web", title: "Native browser assertion", automation_code: `await page.goto(${JSON.stringify(base + "/web-target")}); await expect(page.getByRole("heading", {name:"Local native fixture"})).toBeVisible();` }];
  }
  if (options.secondCase) { const second = envelope(executionId, base, 1); second.steps[0].api_request.url += "?from=@r.token"; envelopes.push(second); }
  const directory = path.join(root, randomUUID());
  const capabilities = await registerPairedLocalExecutionRoutes(local, { directory, origin, apiOrigin: base, token });
  t.after(async () => { await local.close(); await api.close(); });
  const payload = { execution_id: executionId, grant_token: grant, claim_url: `${base}/api/executions/${executionId}/local-dispatch/claim` };
  const headers = { origin, "x-hellotest-agent-token": token };
  return { local, api, base, payload, headers, executionId, envelopes, callbacks, directory, capabilities, bridge, targetQueries, claims: () => claims, targets: () => targets };
}

test("paired dispatch executes immutable native envelopes once and signs its real result", async t => {
  const f = await fixture(t);
  const requests = await Promise.all(Array.from({ length: 3 }, () => f.local.inject({ method: "POST", url: "/api/v1/local-executions", headers: f.headers, payload: f.payload })));
  for (const response of requests) { assert.equal(response.statusCode, 202, response.body); assert.equal(response.json().execution_id, f.executionId); assert.doesNotMatch(response.body, /grant_token|signing_secret|captured-on-user-machine/); }
  const result = await waitFor(async () => { const result = await f.local.inject({ url: `/api/v1/local-executions/${f.executionId}`, headers: f.headers }); return result.json().status === "completed" ? result.json() : null; });
  assert.equal(result.completed_runs, 1); assert.equal(f.claims(), 1); assert.equal(f.targets(), 1);
  assert.equal(f.callbacks.at(-1).case_result.status, "passed");
  assert.equal(f.callbacks.at(-1).case_result.logs.stepCaptures["step-1"]["@r.token"], "[REDACTED]");
  const replay = await f.local.inject({ method: "POST", url: "/api/v1/local-executions", headers: f.headers, payload: f.payload });
  assert.equal(replay.statusCode, 202); assert.equal(f.targets(), 1); assert.equal(f.claims(), 1);
  assert.equal(JSON.parse(await readFile(path.join(f.directory, "agent.json"), "utf8")).agent_id, f.capabilities.agent_id);
});

test("exact Origin, pairing, pinned claim path and immutable payload are required", async t => {
  const f = await fixture(t);
  for (const headers of [{ origin }, { ...f.headers, origin: "https://other.example" }, { "x-hellotest-agent-token": token }]) {
    const response = await f.local.inject({ method: "POST", url: "/api/v1/local-executions", headers, payload: f.payload }); assert.ok([401, 403].includes(response.statusCode));
  }
  for (const payload of [{ ...f.payload, claim_url: "http://169.254.169.254/api/executions/x/local-dispatch/claim" }, { ...f.payload, claim_url: f.payload.claim_url + "?secret=x" }, { ...f.payload, envelopes: f.envelopes }, { ...f.payload, claim_url: f.payload.claim_url.replace(f.executionId, "other-execution") }]) {
    const response = await f.local.inject({ method: "POST", url: "/api/v1/local-executions", headers: f.headers, payload }); assert.equal(response.statusCode, 400, response.body);
  }
  assert.equal(f.claims(), 0); assert.equal(f.targets(), 0);
});

test("claims cannot redirect execution callbacks to another host", async t => {
  const f = await fixture(t, { change: envelopes => envelopes.map(item => ({ ...item, callback: { ...item.callback, url: "https://attacker.example/api/testengine/callbacks/runs" } })) });
  const response = await f.local.inject({ method: "POST", url: "/api/v1/local-executions", headers: f.headers, payload: f.payload }); assert.equal(response.statusCode, 400); assert.equal(f.targets(), 0);
});

test("suite captures retain scope, case identity, order and frozen dataset row", () => {
  const current = envelope("run", "http://api.test", 5); current.data_set = { id: "dataset", iteration: { index: 1 } };
  const previous = (patch, captures) => ({ envelope: { ...current, hellotest_test_case_id: "prior-case", execution_policy: { execution_order: 1, suite_id: "suite-1" }, ...patch }, captures });
  const rows = [previous({}, { "r.shared": "first", "s.shared": "suite", "t.private": "never" }), previous({ execution_policy: { execution_order: 2, suite_id: "other-suite" } }, { "r.shared": "last", "s.other": "never" }), previous({ hellotest_test_case_id: current.hellotest_test_case_id }, { "r.sibling": "never" }), previous({ data_set: { id: "dataset", iteration: { index: 0 } } }, { "r.row": "never" }), previous({ data_set: { id: "other", iteration: { index: 1 } } }, { "r.dataset": "never" })];
  assert.deepEqual(priorPairedCaptures(current, rows), { "r.shared": "last", "s.shared": "suite" });
});

test("browser MCP relay retains session affinity and retries receipts without replay", async t => {
  const f = await fixture(t);
  const bridgeId = randomUUID(), results = []; let polls = 0, receipts = 0;
  const commands = [{ id: "initialize-1", method: "initialize", params: { _meta: { hellotest: { start_url: "http://localhost:4567", allow_browser_actions: true } } } }, { id: "tools-1", method: "tools/list" }];
  f.bridge.poll = async req => { assert.equal(req.headers["x-hellotest-local-agent-id"], f.capabilities.agent_id); return polls < commands.length ? { state: "open", command: commands[polls++] } : { state: "closed", command: null }; };
  f.bridge.result = async (req, reply) => { receipts++; if (receipts === 1) return reply.code(503).send(); results.push(req.body); return { accepted: true }; };
  const descriptor = { id: bridgeId, token: grant, poll_url: `${f.base}/api/local-browser-bridges/${bridgeId}/poll`, result_url: `${f.base}/api/local-browser-bridges/${bridgeId}/result`, expires_at: new Date(Date.now() + 60000).toISOString() };
  const response = await f.local.inject({ method: "POST", url: "/api/v1/local-browser-bridges", headers: f.headers, payload: descriptor }); assert.equal(response.statusCode, 202, response.body); assert.equal(response.json().bridge_id, bridgeId);
  await waitFor(() => results.length === 2);
  assert.equal(receipts, 3); assert.equal(polls, 2); assert.equal(results[0].response.session_id, results[1].response.session_id);
  assert.ok(results[1].response.body.result.tools.some(item => item.name === "browser_click"));
  assert.equal((await f.local.inject({ method: "POST", url: "/api/v1/local-browser-bridges", headers: f.headers, payload: { ...descriptor, poll_url: "http://169.254.169.254/poll" } })).statusCode, 400);
});


test("native suite coordination forwards private run captures without exposing them in status", async t => {
  const f = await fixture(t, { secondCase: true });
  assert.equal((await f.local.inject({ method: "POST", url: "/api/v1/local-executions", headers: f.headers, payload: f.payload })).statusCode, 202);
  await waitFor(async () => (await f.local.inject({ url: `/api/v1/local-executions/${f.executionId}`, headers: f.headers })).json().status === "completed");
  assert.equal(f.targets(), 2); assert.equal(f.targetQueries[1].from, "captured-on-user-machine");
  const status = await f.local.inject({ url: `/api/v1/local-executions/${f.executionId}`, headers: f.headers }); assert.doesNotMatch(status.body, /captured-on-user-machine/);
});

test("local cancellation aborts a pending native API step and does not start later cases", async t => {
  const f = await fixture(t, { secondCase: true, targetDelay: 1500 });
  assert.equal((await f.local.inject({ method: "POST", url: "/api/v1/local-executions", headers: f.headers, payload: f.payload })).statusCode, 202);
  await waitFor(() => f.targets() === 1);
  const cancel = await f.local.inject({ method: "POST", url: `/api/v1/local-executions/${f.executionId}/cancel`, headers: f.headers }); assert.equal(cancel.json().cancellation_requested, true);
  await waitFor(async () => (await f.local.inject({ url: `/api/v1/local-executions/${f.executionId}`, headers: f.headers })).json().status === "cancelled");
  assert.equal(f.targets(), 1);
  const final=f.callbacks.filter(item=>['run.completed','run.failed','run.incident'].includes(item.event));
  assert.equal(final.length,2);assert.ok(final.every(item=>item.case_result.status==='failed'));
  assert.equal(f.callbacks.filter(item=>item.event==='run.progress').length,1,'A cancelled future case never reports that it started.');
});

test("agent restart preserves device identity and durable run idempotency", async t => {
  const f = await fixture(t);
  assert.equal((await f.local.inject({ method: "POST", url: "/api/v1/local-executions", headers: f.headers, payload: f.payload })).statusCode, 202);
  await waitFor(async () => (await f.local.inject({ url: `/api/v1/local-executions/${f.executionId}`, headers: f.headers })).json().status === "completed");
  await f.local.close();
  const restarted = Fastify(); t.after(() => restarted.close());
  const capabilities = await registerPairedLocalExecutionRoutes(restarted, { directory: f.directory, origin, apiOrigin: f.base, token }); assert.equal(capabilities.agent_id, f.capabilities.agent_id);
  const retry = await restarted.inject({ method: "POST", url: "/api/v1/local-executions", headers: f.headers, payload: f.payload }); assert.equal(retry.statusCode, 202); assert.equal(retry.json().status, "completed"); assert.equal(f.targets(), 1); assert.equal(f.claims(), 1);
});


test("paired execution uses the real native Playwright source/assertion pipeline", { timeout: 30000 }, async t => {
  const f = await fixture(t, { web: true });
  const accepted = await f.local.inject({ method: "POST", url: "/api/v1/local-executions", headers: f.headers, payload: f.payload }); assert.equal(accepted.statusCode, 202, accepted.body);
  const result = await waitFor(async () => { const result = (await f.local.inject({ url: `/api/v1/local-executions/${f.executionId}`, headers: f.headers })).json(); return ["completed", "failed"].includes(result.status) ? result : null; });
  assert.equal(result.status, "completed", JSON.stringify(f.callbacks)); assert.equal(f.callbacks.at(-1).case_result.status, "passed");
  assert.ok(f.callbacks.at(-1).case_result.logs.stepWebDetails["web-step"]);
});

test("local Build Agent verification runs the exact recorded program in a fresh native browser", { timeout: 30000 }, async t => {
  const f = await fixture(t), bridgeId = randomUUID(), results = [];
  const { compileRecordedProgram } = await import("../dist/lib/automationVerificationProgram.js");
  const operations = [{ name: "browser_assert", arguments: { assertion: "visible", locator: 'getByRole("heading", {name:"Local native fixture"})' } }];
  const program = compileRecordedProgram(operations); assert.ok(program);
  const commands = [
    { id: "verify-init", method: "initialize", params: { _meta: { hellotest: { start_url: `${f.base}/web-target`, allow_browser_actions: false } } } },
    { id: "verify-native", method: "verification/run", params: { schema_version: 1, verification_id: randomUUID(), lease_token: "private-verification-lease-".repeat(2), start_url: `${f.base}/web-target`,
      sections: [{ step_id: "verified-section", automation_code: program.source, operations }], parameters: {}, timeout_ms: 10000, replay_policy: { mode: "read_only" } } }
  ]; let index = 0;
  f.bridge.poll = async () => index < commands.length ? { state: "open", command: commands[index++] } : { state: "closed", command: null };
  f.bridge.result = async req => { results.push(req.body); return { accepted: true }; };
  const descriptor = { id: bridgeId, token: grant, poll_url: `${f.base}/api/local-browser-bridges/${bridgeId}/poll`, result_url: `${f.base}/api/local-browser-bridges/${bridgeId}/result`, expires_at: new Date(Date.now() + 60000).toISOString() };
  const response = await f.local.inject({ method: "POST", url: "/api/v1/local-browser-bridges", headers: f.headers, payload: descriptor }); assert.equal(response.statusCode, 202, response.body);
  await waitFor(() => results.length === 2);
  assert.equal(results[1].response.status, 200, JSON.stringify(results[1])); assert.equal(results[1].response.body.status, "passed"); assert.equal(results[1].response.body.verification_status, "verified");
});
