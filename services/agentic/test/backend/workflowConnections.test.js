const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const connections = require("../../backend/workflows/connections");
const mcp = require("../../backend/workflows/mcpClient");
const settings = require("../../backend/workflows/connectionSettings");
test.beforeEach(t => t.mock.method(settings._internals.store, "list", async () => []));
const operations = require("../../backend/workflows/nodeOperations");
async function server(t, handler) {
  const instance = http.createServer(handler);
  await new Promise((resolve) => instance.listen(0, "127.0.0.1", resolve));
  const previous = process.env.AGENTIC_HTTP_CONNECTIONS;
  t.after(async () => {
    if (previous === undefined) delete process.env.AGENTIC_HTTP_CONNECTIONS;
    else process.env.AGENTIC_HTTP_CONNECTIONS = previous;
    instance.closeAllConnections();
    await new Promise((resolve) => instance.close(resolve));
  });
  const url = `http://127.0.0.1:${instance.address().port}`;
  return url;
}
test("HTTP uses a scoped connection, pins destinations, redacts credentials, and rejects redirects", async (t) => {
  let count = 0;
  const url = await server(t, (req, res) => {
    count++;
    if (req.url.endsWith("/redirect")) {
      res.writeHead(302, { Location: "/api" });
      res.end();
      return;
    }
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        authorization: req.headers.authorization,
        token: "private",
        ok: true,
      }),
    );
  });
  const previous = process.env.AGENTIC_SECRET_FIXTURE;
  process.env.AGENTIC_SECRET_FIXTURE = "connection-fixture-secret";
  t.after(() => {
    if (previous === undefined) delete process.env.AGENTIC_SECRET_FIXTURE;
    else process.env.AGENTIC_SECRET_FIXTURE = previous;
  });
  process.env.AGENTIC_HTTP_CONNECTIONS = JSON.stringify([
    {
      id: "api",
      name: "Fixture",
      url: url + "/api",
      projectIds: ["p"],
      secretEnv: "AGENTIC_SECRET_FIXTURE",
      allowPrivateNetwork: true,
    },
  ]);
  const result = await connections.callHttp({
    projectId: "p",
    data: { connectionId: "api" },
  });
  assert.equal(result.data.ok, true);
  assert.equal(result.data.authorization, "[REDACTED]");
  assert.doesNotMatch(
    JSON.stringify(await connections.list("p")),
    /connection-fixture-secret|secretEnv/,
  );
  assert.deepEqual((await connections.list("other")).filter(row=>row.id!=="hellotest"), []);
  await assert.rejects(
    connections.callHttp({ projectId: "other", data: { connectionId: "api" } }),
    { statusCode: 403 },
  );
  await assert.rejects(
    connections.callHttp({
      projectId: "p",
      data: { connectionId: "api", apiUrl: url + "/different" },
    }),
    { statusCode: 403 },
  );
  await assert.rejects(
    connections.callHttp({ projectId: "p", data: { apiUrl: url + "/api" } }),
    { statusCode: 403 },
  );
  assert.equal(count, 1);
  await assert.rejects(
    connections.callHttp({
      projectId: "p",
      data: { connectionId: "api", apiUrl: url + "/api/redirect" },
    }),
    /302/,
  );
  assert.equal(count, 2);
});
test("MCP negotiates sessions, reads JSON/SSE tools, validates arguments and calls only enabled tools", async (t) => {
  const messages = [];
  let closed = 0;
  let changedSchema = false, invalidOutput = false;
  const outputSchema = { type: "object", properties: { id: { type: "string" }, status: { type: "string" } }, required: ["id", "status"] };
  const url = await server(t, async (req, res) => {
    if (req.method === "DELETE") {
      closed++;
      res.writeHead(204);
      res.end();
      return;
    }
    let body = "";
    for await (const chunk of req) body += chunk;
    const msg = JSON.parse(body);
    messages.push(msg);
    if (msg.method === "initialize") {
      res.setHeader("MCP-Session-Id", "session-fixture");
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: msg.id,
          result: {
            protocolVersion: "2025-11-25",
            capabilities: { tools: {} },
          },
        }),
      );
      return;
    }
    assert.equal(req.headers["mcp-session-id"], "session-fixture");
    assert.equal(req.headers["mcp-protocol-version"], "2025-11-25");
    if (msg.method === "notifications/initialized") {
      res.writeHead(202);
      res.end();
      return;
    }
    const result =
      msg.method === "tools/list"
        ? {
            tools: [
              {
                name: "read_status",
                description: "Status",
                outputSchema,
                inputSchema: {
                  type: "object",
                  properties: { id: { type: changedSchema ? "number" : "string" } },
                  required: ["id"],
                  additionalProperties: false,
                },
              },
              { name: "delete_everything", inputSchema: { type: "object" } },
            ],
          }
        : {
            content: [{ type: "text", text: "Status read" }],
            structuredContent: { id: msg.params.arguments.id, status: invalidOutput ? 42 : "ready" },
          };
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(": heartbeat\n\n");
    res.end(
      `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: msg.id, result })}\n\n`,
    );
  });
  process.env.AGENTIC_HTTP_CONNECTIONS = JSON.stringify([
    {
      id: "mcp",
      kind: "mcp",
      url: url + "/mcp",
      projectIds: ["p"],
      allowPrivateNetwork: true,
      tools: ["read_status"],
    },
  ]);
  const input = { projectId: "p", connectionId: "mcp" };
  assert.deepEqual(
    (await mcp.discover(input)).map((t) => t.name),
    ["read_status"],
  );
  const approved = JSON.parse(process.env.AGENTIC_HTTP_CONNECTIONS);
  approved[0].toolDefinitions = [{ name: "read_status", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false }, outputSchema }];
  approved[0].protocolVersion = "2025-11-25";
  process.env.AGENTIC_HTTP_CONNECTIONS = JSON.stringify(approved);
  const result = await mcp.call(input, "read_status", { id: "case-1" });
  assert.equal(result.output_schema_verified, true);
  assert.equal(result.postcondition_verified, false);
  assert.equal(result.data.status, "ready");
  await assert.rejects(mcp.call(input, "read_status", { id: 12 }), /schema/);
  await assert.rejects(mcp.call(input, "delete_everything", {}), {
    statusCode: 403,
  });
  assert.equal(messages.filter((m) => m.method === "tools/call").length, 1);
  assert.equal(closed, 4);
  changedSchema = true;
  await assert.rejects(mcp.call(input, "read_status", { id: "case-1" }), { code: "MCP_SCHEMA_CHANGED" });
  assert.equal(messages.filter(m => m.method === "tools/call").length, 1, "Changed schemas must fail before a tool call");
  changedSchema = false; invalidOutput = true;
  await assert.rejects(mcp.call(input, "read_status", { id: "case-1" }), { code: "MCP_OUTPUT_INVALID", outcome_unknown: true, retryable: false });
  assert.equal(messages.filter(m => m.method === "tools/call").length, 2, "Ambiguous tool outcomes are never replayed");
});
test("data paths cannot access prototypes and mappings preserve literal values", () => {
  assert.throws(
    () =>
      operations._internals.readPath({ input: {} }, "input.__proto__.token"),
    /prototype/,
  );
  assert.deepEqual(
    operations._internals.mapValues(
      { title: "$item.title", constant: 3, missing: "$input.missing" },
      { item: { title: "One" }, input: {} },
    ),
    { title: "One", constant: 3, missing: null },
  );
});
test("public address policy rejects internal and mapped addresses", () => {
  for (const ip of [
    "127.0.0.1",
    "10.1.2.3",
    "172.18.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "::1",
    "::ffff:127.0.0.1",
    "fd00::1",
    "fe80::1",
  ])
    assert.equal(connections._internals.publicAddress(ip), false, ip);
  assert.equal(connections._internals.publicAddress("8.8.8.8"), true);
});


test("metadata aliases are blocked even for managed private connections and quoted secrets are redacted", async t => {
  for (const ip of ["169.254.169.254", "::ffff:169.254.169.254", "0:0:0:0:0:ffff:a9fe:a9fe"]) {
    assert.equal(connections._internals.metadataAddress(ip), true, ip);
    await assert.rejects(connections.request({ url: new URL(`http://${ip.includes(':') ? `[${ip}]` : ip}/`), connection: {allowPrivateNetwork:true} }), {statusCode:403});
  }
  assert.equal(connections._internals.metadataAddress("::1"), false);
  const previous = process.env.AGENTIC_SECRET_ECHO;
  const secret = 'quoted"credential';
  process.env.AGENTIC_SECRET_ECHO = secret;
  t.after(() => {if(previous === undefined) delete process.env.AGENTIC_SECRET_ECHO; else process.env.AGENTIC_SECRET_ECHO=previous;});
  const result = connections.redact({echo:`server echoed ${secret}`, nested:{value:Buffer.from(secret).toString('base64')}}, {secretEnv:'AGENTIC_SECRET_ECHO'});
  assert.deepEqual(result,{echo:'server echoed [REDACTED]',nested:{value:'[REDACTED]'}});
});


test("MCP schemas default to JSON Schema 2020-12 and preserve draft-07 compatibility", () => {
  const compile = require("../../backend/workflows/mcpClient")._internals.compileSchema;
  const modern = compile({ type: "object", properties: { operation: { type: "string" }, receipt: { type: "string" } }, dependentRequired: { operation: ["receipt"] } }, "output");
  assert.equal(modern({ operation: "saved" }), false);
  assert.equal(modern({ operation: "saved", receipt: "receipt-1" }), true);
  const legacy = compile({ $schema: "http://json-schema.org/draft-07/schema#", type: "object", required: ["id"], properties: { id: { type: "string" } } }, "input");
  assert.equal(legacy({}), false);
  assert.equal(legacy({ id: "item" }), true);
});

test('default HelloTest MCP is authenticated through the verified current user without a shared credential',async()=>{
 const rows=await connections.list('p');const builtin=rows.find(row=>row.id==='hellotest');
 assert.equal(builtin.builtin,true);assert.equal(builtin.authenticated,true);assert.equal(builtin.authenticationMode,'current-user');assert.ok(builtin.tools.includes('hellotest_context_build'));
 assert.equal(builtin.secret,undefined);assert.equal(builtin.encryptedSecret,undefined);
});
