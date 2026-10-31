const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const connections = require("../../backend/workflows/connections");
const settings = require("../../backend/workflows/connectionSettings");
const operations = require("../../backend/workflows/nodeOperations");
const events = require("../../backend/workflows/runtimeEvents");

async function fixture(t, handler, patch = {}) {
  t.mock.method(settings, "all", async () => []);
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const before = process.env.AGENTIC_HTTP_CONNECTIONS, beforeSecret = process.env.AGENTIC_SECRET_HTTP_TEST;
  process.env.AGENTIC_SECRET_HTTP_TEST = "hellotest_fixture-private-api-key";
  const base = `http://127.0.0.1:${server.address().port}/api`;
  process.env.AGENTIC_HTTP_CONNECTIONS = JSON.stringify([{ id: "http-fixture", name: "Named project API", kind: "http", url: base,
    projectIds: ["project-a"], methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"],
    authType: "header", header: "X-API-Key", secretEnv: "AGENTIC_SECRET_HTTP_TEST", allowPrivateNetwork: true, ...patch }]);
  t.after(async () => {
    if (before === undefined) delete process.env.AGENTIC_HTTP_CONNECTIONS; else process.env.AGENTIC_HTTP_CONNECTIONS = before;
    if (beforeSecret === undefined) delete process.env.AGENTIC_SECRET_HTTP_TEST; else process.env.AGENTIC_SECRET_HTTP_TEST = beforeSecret;
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  return { base, data: { connectionId: "http-fixture" } };
}
const json = (res, value, status = 200) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(value)); };

test("all seven HTTP methods reach the actual endpoint once with managed API-key auth and mapped JSON values", async t => {
  const received = [];
  const { base, data } = await fixture(t, async (req, res) => {
    let body = ""; for await (const chunk of req) body += chunk;
    received.push({ method: req.method, url: req.url, body, key: req.headers["x-api-key"] });
    json(res, { method: req.method, accepted: true, echoed_key: req.headers["x-api-key"] });
  });
  for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) {
    const node = { data: { kind: "apiTool", ...data, apiMethod: method, apiUrl: `${base}/{{ $input.id }}`,
      apiBody: method === "GET" || method === "HEAD" ? "stale ignored body" : '["$input.quantity",null,false,{"name":"$input.name"}]' } };
    assert.deepEqual(operations.validate(node), []);
    const result = await operations.execute({ run: { project_id: "project-a", input_payload: {} }, node,
      sources: [{ node_id: "previous", output: { data: { id: "row A/1", quantity: 3, name: "Invoice" } } }] });
    assert.equal(result.status, 200);
    assert.equal(result.request.method, method);
    assert.equal(result.request.url, `${base}/row%20A%2F1`);
    assert.equal(result.request.response_received, true);
    if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
      assert.match(result.request.operation_id, /^http-/);
      assert.equal(result.request.postcondition_verified, false);
    }
    assert.doesNotMatch(JSON.stringify(result), /hellotest_fixture-private-api-key/);
  }
  assert.deepEqual(received.map(item => item.method), ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
  assert.ok(received.every(item => item.url === "/api/row%20A%2F1" && item.key === "hellotest_fixture-private-api-key"));
  assert.deepEqual(received.filter(item => !["GET", "HEAD"].includes(item.method)).map(item => JSON.parse(item.body)),
    Array.from({ length: 5 }, () => [3, null, false, { name: "Invoice" }]));
  assert.ok(received.filter(item => ["GET", "HEAD"].includes(item.method)).every(item => item.body === ""));
});

test("HTTP status failures and redirects preserve actual status and never replay writes", async t => {
  const received = [];
  const { base, data } = await fixture(t, (req, res) => {
    received.push(req.method);
    const status = Number(req.url.split("/").at(-1));
    res.writeHead(status, { "content-type": "application/json", ...(status === 302 ? { location: "/api/200" } : {}) });
    res.end(JSON.stringify({ secret: "private-upstream-error" }));
  });
  for (const status of [302, 400, 401, 403, 404, 409, 422, 429, 500, 503]) {
    await assert.rejects(connections.callHttp({ projectId: "project-a", data: { ...data, apiUrl: `${base}/${status}`, apiMethod: "POST", apiBody: "{}" } }), failure => {
      assert.equal(failure.statusCode, status);
      assert.equal(failure.retryable, false);
      assert.equal(events.retryable(failure), false);
      assert.equal(Boolean(failure.outcome_unknown), status >= 500);
      assert.doesNotMatch(failure.publicMessage, /private-upstream-error|hellotest_fixture/);
      return true;
    });
  }
  assert.equal(received.length, 10);
  assert.ok(received.every(method => method === "POST"));
  await assert.rejects(connections.callHttp({ projectId: "project-a", data: { ...data, apiUrl: `${base}/429` } }), failure => {
    assert.equal(events.retryable(failure), true); return true;
  });
  assert.equal(events.canRetry("apiTool", { apiMethod: "POST" }), false);
});

test("lost, timed-out and cancelled write responses are unknown outcomes with no automatic retry", async t => {
  let calls = 0, received;
  const observed = () => new Promise(resolve => { received = resolve; });
  const { base, data } = await fixture(t, async (req, res) => {
    for await (const _chunk of req) { /* consume the real write */ }
    calls += 1; received?.();
    if (req.url.endsWith("/lost")) {
      res.writeHead(200, { "content-type": "application/json" }); res.write('{"changed":'); setImmediate(() => res.destroy());
    }
  });
  await assert.rejects(connections.callHttp({ projectId: "project-a", data: { ...data, apiUrl: `${base}/lost`, apiMethod: "PATCH", apiBody: '{"changed":true}' } }), failure => {
    assert.equal(failure.outcome_unknown, true); assert.equal(failure.retryable, false); assert.match(failure.operation_id, /^http-/); return true;
  });
  await assert.rejects(connections.callHttp({ projectId: "project-a", data: { ...data, apiUrl: `${base}/timeout`, apiMethod: "PUT", apiBody: "{}", timeoutMs: 50 } }), failure => {
    assert.equal(failure.statusCode, 504); assert.equal(failure.outcome_unknown, true); assert.equal(events.retryable(failure), false); return true;
  });
  const controller = new AbortController(), arrived = observed();
  const pending = connections.callHttp({ projectId: "project-a", data: { ...data, apiUrl: `${base}/cancel`, apiMethod: "DELETE" }, signal: controller.signal });
  await arrived; controller.abort();
  await assert.rejects(pending, failure => {
    assert.equal(failure.statusCode, 499); assert.equal(failure.outcome_unknown, true); assert.equal(events.failureInfo(failure).reconciliation_required, true); return true;
  });
  assert.equal(calls, 3);
  const stopped = new AbortController(); stopped.abort();
  await assert.rejects(connections.callHttp({ projectId: "project-a", data: { ...data, apiMethod: "POST" }, signal: stopped.signal }), { statusCode: 499 });
  assert.equal(calls, 3, "An already-cancelled request never reaches the server");
});

test("complete cursor pages preserve every record and apply aggregate count and deadline bounds", async t => {
  const requests = [];
  const { base, data } = await fixture(t, (req, res) => {
    const url = new URL(req.url, "http://local"), cursor = Number(url.searchParams.get("cursor") || 0);
    requests.push({ cursor, key: req.headers["x-api-key"], project: url.searchParams.get("project_id"), sprint: url.searchParams.get("sprint_id") });
    const items = Array.from({ length: 20 }, (_, index) => ({ id: `story-${cursor + index}`, description: `Full story ${cursor + index}` }));
    json(res, { items, total: 100, is_last: cursor === 80, next_cursor: cursor === 80 ? null : String(cursor + 20) });
  });
  const result = await connections.callHttp({ projectId: "project-a", data: { ...data, apiUrl: `${base}/requirements?project_id=project-a&sprint_id=sprint-a&include_page=true`, apiPagination: "cursor", apiResource: "sprintStories" } });
  assert.equal(result.data.items.length, 100);
  assert.deepEqual(result.data.items.map(item => item.id), Array.from({ length: 100 }, (_, index) => `story-${index}`));
  assert.deepEqual(result.pagination, { pages: 5, fetched: 100, complete: true });
  assert.deepEqual(requests.map(item => item.cursor), [0, 20, 40, 60, 80]);
  assert.ok(requests.every(item => item.key === "hellotest_fixture-private-api-key" && item.project === "project-a" && item.sprint === "sprint-a"));
  await assert.rejects(connections.callHttp({ projectId: "project-a", data: { ...data, apiPagination: "cursor", apiMaxItems: 50 } }), /no records were silently omitted/);
  assert.equal(requests.length, 6, "An oversized declared total stops on the first response");
});

test("cursor cycles, duplicate Stories, changing membership and incomplete final pages never succeed", async t => {
  let mode = "cycle", count = 0;
  const { data } = await fixture(t, (_req, res) => {
    count += 1;
    const id = mode === "duplicate" ? "duplicate" : `story-${count}`;
    const total = mode === "changed" ? count : mode === "incomplete" ? 3 : 2;
    json(res, { items: [{ id }], total, is_last: mode === "incomplete" || (mode === "changed" && count === 2), next_cursor: "same-cursor" });
  });
  for (const [scenario, message] of [["cycle", /stopped advancing/], ["duplicate", /duplicate record/], ["changed", /membership changed/], ["incomplete", /incomplete Sprint page/]]) {
    mode = scenario; count = 0;
    await assert.rejects(connections.callHttp({ projectId: "project-a", data: { ...data, apiPagination: "cursor", apiResource: "sprintStories" } }), message);
    assert.ok(count <= 2);
  }
});

test("page requests share one node deadline and Sprint API rejects MCP credentials before dispatch", async t => {
  let requests = 0;
  const { data } = await fixture(t, (_req, res) => {
    requests += 1; const id = requests;
    setTimeout(() => { if (!res.destroyed) json(res, { items: [{ id: `story-${id}` }], total: 4, is_last: false, next_cursor: String(id) }); }, 40);
  });
  await assert.rejects(connections.callHttp({ projectId: "project-a", data: { ...data, apiPagination: "cursor", timeoutMs: 65 } }), { statusCode: 504 });
  assert.ok(requests <= 2, "Later pages cannot reset the timeout");
  const before = requests;
  process.env.AGENTIC_SECRET_HTTP_TEST = "mcp1.host-session-signature";
  await assert.rejects(connections.callHttp({ projectId: "project-a", data: { ...data, apiResource: "sprintStories", apiPagination: "cursor" } }), /MCP host credentials/);
  assert.equal(requests, before);
});

test("managed API diagnostics use the same real HTTP transport and never accept inline override credentials", async t => {
  const requests = [];
  const { base, data } = await fixture(t, async (req, res) => {
    let body = ""; for await (const chunk of req) body += chunk;
    requests.push({ method: req.method, body, key: req.headers["x-api-key"] });
    json(res, { saved: true, secret: req.headers["x-api-key"] });
  });
  const service = require("../../backend/services/agenticWorkflow.service");
  const result = await service.testApiAgent({ project_id: "project-a", connectionId: data.connectionId, url: `${base}/stories`, method: "POST", body: '{"title":"Invoice"}' });
  assert.equal(result.ok, true); assert.equal(result.status, 200); assert.equal(result.preview.saved, true);
  assert.equal(result.request.postcondition_verified, false);
  assert.doesNotMatch(JSON.stringify(result), /hellotest_fixture-private-api-key/);
  await assert.rejects(service.testApiAgent({ project_id: "project-a", connectionId: data.connectionId, url: `${base}/stories`, method: "POST", credential: { secret: "override" } }), /inline credential/);
  assert.deepEqual(requests, [{ method: "POST", body: '{"title":"Invoice"}', key: "hellotest_fixture-private-api-key" }]);
});

test('API diagnostics cannot bypass connection policy through inline auth, raw private hosts or query credentials', async t => {
 let received = 0;
 const { base } = await fixture(t, (_req, res) => { received++; json(res, { ok: true }); });
 const service = require('../../backend/services/agenticWorkflow.service');
 await assert.rejects(service.testApiAgent({ project_id: 'project-a', url: `${base}/stories`, credential: { secret: 'inline-secret' } }), /inline credential/);
 await assert.rejects(service.testApiAgent({ project_id: 'project-a', url: `${base}/stories`, auth: 'Bearer inline-secret' }), /inline credential/);
 await assert.rejects(service.testApiAgent({ project_id: 'project-a', url: `${base}/stories` }), /Private network endpoints/);
 await assert.rejects(service.testApiAgent({ project_id: 'project-a', url: `${base}/stories?access_token=inline-secret` }), /managed connection/);
 await assert.rejects(service.testApiAgent({ project_id: 'project-a', url: `${base}/stories`, method: 'POST', body: '{}' }), /method is not enabled/);
 assert.equal(received, 0, 'Every legacy bypass is rejected before a request reaches the local server.');
});

test("durable operation identity reuses a received write and blocks replay of an ambiguous write", async t => {
  const received = [];
  const { base, data } = await fixture(t, async (req, res) => {
    let body = ""; for await (const chunk of req) body += chunk;
    received.push({ url: req.url, body });
    if (req.url.endsWith("/lost")) { req.socket.destroy(); return; }
    json(res, { id: "saved-story", title: JSON.parse(body).title });
  });
  const db = require("@hellotest/platform/backend/src/db"), rows = new Map();
  t.mock.method(db, "prepare", sql => {
    if (sql.includes("INSERT INTO workflow_operation_receipts")) return { get: async (id, project_id, run_id, node_id, actor_id, request_hash) => {
      if (rows.has(id)) return null;
      rows.set(id, { id, project_id, run_id, node_id, actor_id, request_hash, state: "in_flight" }); return { id };
    } };
    if (sql.startsWith("SELECT * FROM workflow_operation_receipts")) return { get: async id => rows.get(id) };
    if (sql.includes("state='response_received'")) return { get: async (response, id) => { Object.assign(rows.get(id), { response, state: "response_received" }); return { id }; } };
    if (sql.includes("state='outcome_unknown'")) return { run: async (_code, id) => { rows.get(id).state = "outcome_unknown"; } };
    throw new Error(`Unexpected operation query: ${sql}`);
  });
  const journal = require("../../backend/workflows/operationJournal");
  const run = { id: "run-with-write", project_id: "project-a" }, user = { id: "user-a" };
  const node = { id: "write", data: { kind: "apiTool", ...data, apiUrl: `${base}/stories`, apiMethod: "POST", apiBody: '{"title":"Invoice"}' } };
  const invoke = target => journal.invoke({ run, node: target, input: {}, user }, () => connections.callHttp({ projectId: run.project_id, data: target.data }));
  const first = await invoke(node), reused = await invoke(node);
  assert.equal(first.data.id, "saved-story"); assert.equal(reused.data.id, "saved-story");
  assert.equal(reused.operation_receipt.reused, true);
  await assert.rejects(invoke({ ...node, data: { ...node.data, apiBody: '{"title":"Changed"}' } }), { code: "AGENT_OPERATION_CONFLICT" });
  assert.equal(received.length, 1);
  const lost = { id: "ambiguous", data: { ...node.data, apiUrl: `${base}/lost` } };
  await assert.rejects(invoke(lost), { outcome_unknown: true, retryable: false });
  await assert.rejects(invoke(lost), { code: "AGENT_OPERATION_OUTCOME_UNKNOWN", outcome_unknown: true });
  assert.equal(received.length, 2, "Neither a completed nor an ambiguous operation can cause a second remote write");
});

test("Sprint Stories HTTP resolves the complete selected Sprint URL and records pagination URLs", async t => {
  const requested=[];
  const {base,data}=await fixture(t,(req,res)=>{
    requested.push(new URL(req.url,base));
    const last=requested.length===2;
    json(res,{items:[{id:last?'story-two':'story-one'}],total:2,is_last:last,next_cursor:last?null:'page-two'});
  });
  t.mock.method(require('@hellotest/platform/backend/services/permission.service'),'hasPermission',async()=>true);
  t.mock.method(require('@hellotest/platform/backend/services/featureFlag.service'),'areEnabled',async()=>true);
  const result=await operations.execute({run:{project_id:'project-a',app_type_id:'web',input_payload:{sprint_id:'Sprint / A'}},
    node:{data:{kind:'apiTool',...data,apiResource:'sprintStories',apiUrl:`${base}/requirements?project_id=wrong&sprint_id=wrong`}},sources:[],user:{id:'reviewer'}});
  assert.equal(requested.length,2);
  assert.equal(requested[0].pathname,'/api/requirements');
  assert.equal(requested[0].searchParams.get('project_id'),'project-a');
  assert.equal(requested[0].searchParams.get('sprint_id'),'Sprint / A');
  assert.equal(requested[0].searchParams.get('include_page'),'true');
  assert.equal(requested[1].searchParams.get('cursor'),'page-two');
  assert.equal(result.request.url,requested[0].toString());
  assert.equal(result.request.last_page_url,requested[1].toString());
  assert.deepEqual(result.data.items.map(row=>row.id),['story-one','story-two']);
});

test("request URL diagnostics preserve configured endpoint identity while redacting query credentials",()=>{
  const value=connections.redact({request:{url:'http://127.0.0.1:3000/requirements?project_id=project-a&api_key=private-value&access_token=private-token'},data:{url:'client IP 192.168.1.1'}});
  const endpoint=new URL(value.request.url);
  assert.equal(endpoint.host,'127.0.0.1:3000');assert.equal(endpoint.searchParams.get('project_id'),'project-a');
  assert.equal(endpoint.searchParams.get('api_key'),'[REDACTED]');assert.equal(endpoint.searchParams.get('access_token'),'[REDACTED]');
  assert.doesNotMatch(JSON.stringify(value),/private-value|private-token|192\.168\.1\.1/);
});
