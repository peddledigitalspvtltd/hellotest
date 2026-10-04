// Bounded Streamable HTTP client (MCP 2025-11-25 / 2025-06-18 / 2025-03-26).
// No local process launching, automatic tool choice, OAuth token forwarding or retries of tool calls.
const { randomUUID, createHash } = require("node:crypto");
const Ajv2020 = require("ajv/dist/2020");
const Ajv = require("ajv");
const connections = require("./connections");
const VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"];
function parseResponse(body, contentType, id) {
  if (/text\/event-stream/i.test(contentType || "")) {
    for (const event of body.split(/\r?\n\r?\n/).slice(0, -1)) {
      const text = event
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (!text) continue;
      let value;
      try {
        value = JSON.parse(text);
      } catch {
        continue;
      }
      if (value.id === id && value.jsonrpc === "2.0") return value;
    }
    return null;
  }
  try {
    const value = JSON.parse(body);
    return value.id === id && value.jsonrpc === "2.0" ? value : null;
  } catch {
    return null;
  }
}
async function withServer(
  { projectId, connectionId, signal, timeoutMs, discoverAll = false, draftConnection },
  task,
) {
  if (draftConnection && (draftConnection.kind !== "mcp" || !draftConnection.projectIds?.includes(projectId))) throw connections.fail("Select an MCP connection in the current project.", 403);
  const { connection, url } = draftConnection ? { connection: draftConnection, url: new URL(draftConnection.url) } : await connections.resolve(
    connectionId,
    projectId,
    null,
    "mcp",
  );
  const headers = { Accept: "application/json, text/event-stream" };
  const deadline = Date.now() + Math.min(70000, Math.max(1000, timeoutMs ?? connection.timeoutMs ?? 30000));
  const rpc = async (method, params, notify = false) => {
    if (Date.now() >= deadline)
      throw connections.fail("The MCP operation timed out.", 504);
    const id = notify ? undefined : randomUUID();
    const response = await connections.request({
      url,
      connection,
      method: "POST",
      headers,
      signal,
      timeoutMs: deadline - Date.now(),
      body: JSON.stringify({
        jsonrpc: "2.0",
        ...(id ? { id } : {}),
        method,
        ...(params ? { params } : {}),
      }),
      onChunk: (body, incoming) =>
        /text\/event-stream/i.test(incoming["content-type"] || "") &&
        Boolean(parseResponse(body, incoming["content-type"], id)),
    });
    if (response.status < 200 || response.status >= 300)
      throw connections.fail(
        `MCP server returned HTTP ${response.status}. Check the connection.`,
        502,
      );
    if (notify) return null;
    const message = parseResponse(
      response.body,
      response.headers["content-type"],
      id,
    );
    if (!message || message.error || !message.result)
      throw connections.fail(
        "The MCP server did not return a valid result for this request.",
        502,
      );
    if (method === "initialize" && response.headers["mcp-session-id"]) {
      const sessionId = response.headers["mcp-session-id"];
      if (!/^[\x21-\x7e]{1,1024}$/.test(sessionId))
        throw connections.fail("Invalid MCP session identifier.", 502);
      headers["MCP-Session-Id"] = sessionId;
    }
    return message.result;
  };
  try {
    const initialized = await rpc("initialize", {
      protocolVersion: VERSIONS[0],
      capabilities: {},
      clientInfo: { name: "HelloTest Agentic Studio", version: "1.0.0" },
    });
    if (
      !VERSIONS.includes(initialized.protocolVersion) ||
      !initialized.capabilities?.tools
    )
      throw connections.fail(
        "This server must support tools over MCP Streamable HTTP (2025-03-26, 2025-06-18 or 2025-11-25).",
        422,
      );
    headers["MCP-Protocol-Version"] = initialized.protocolVersion;
    await rpc("notifications/initialized", undefined, true);
    const tools = [];
    let cursor;
    for (let page = 0; page < 5; page++) {
      const result = await rpc("tools/list", cursor ? { cursor } : {});
      if (!Array.isArray(result.tools))
        throw connections.fail(
          "The MCP server returned an invalid tool catalog.",
          502,
        );
      tools.push(
        ...result.tools.filter(
          (tool) =>
            typeof tool.name === "string" &&
            (discoverAll || connection.tools?.includes(tool.name)),
        ),
      );
      if (tools.length > 100) throw connections.fail("The server catalog exceeds 100 tools. Configure a smaller catalog for this connection.", 422);
      cursor = result.nextCursor;
      if (!cursor) break;
    }
    if (cursor) throw connections.fail("The server tool catalog exceeds five pages. Configure a smaller catalog for this connection.", 422);
    return connections.redact(
      await task({ rpc, tools, connection, serverInfo: initialized.serverInfo, protocolVersion: initialized.protocolVersion }),
      connection,
    );
  } finally {
    if (headers["MCP-Session-Id"]) {
      // Best effort session release has its own short deadline even on cancellation.
      await connections
        .request({
          url,
          connection,
          method: "DELETE",
          headers,
          timeoutMs: 1500,
        })
        .catch(() => {});
    }
  }
}
const toolCatalog = tools => tools.map((tool) => ({
      name: tool.name,
      description: String(tool.description || "").slice(0, 2000),
      inputSchema: tool.inputSchema || { type: "object" },
      ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
      ...(tool.annotations ? { annotations: tool.annotations } : {}),
    }));
const discover = input => withServer(input, async ({ tools }) => toolCatalog(tools));
const inspect = input => withServer({ ...input, discoverAll: true }, async ({ tools, serverInfo, protocolVersion }) => ({ tools: toolCatalog(tools), serverInfo, protocolVersion, discovered_at: new Date().toISOString() }));
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const schemaHash = tool => createHash("sha256").update(JSON.stringify(canonical({ name: tool.name, inputSchema: tool.inputSchema, outputSchema: tool.outputSchema || null, annotations: tool.annotations || {} }))).digest("hex");
function compileSchema(schema, label) {
  try { return new (/draft-0[467]/.test(String(schema?.$schema || "")) ? Ajv : Ajv2020)({ strict: false, allErrors: false, validateFormats: false }).compile(schema); }
  catch { throw connections.fail(`The MCP tool ${label} schema is unsupported or invalid.`, 422); }
}
const call = (input, name, args) =>
  withServer({ ...input, discoverAll: false }, async ({ rpc, tools, connection, protocolVersion }) => {
    const tool = tools.find((item) => item.name === name);
    if (!tool)
      throw connections.fail(
        "This tool is not available or is not enabled for the selected MCP connection.",
        403,
      );
    if (!args || typeof args !== "object" || Array.isArray(args))
      throw connections.fail("MCP arguments must be a JSON object.");
    const approved = connection.toolDefinitions?.find(item => item.name === name);
    if (!approved) throw Object.assign(connections.fail("Discover and save this server's tool catalog in Integrations before calling it.", 422), { code: "MCP_CATALOG_REQUIRED" });
    const toolHash = schemaHash(tool);
    if (toolHash !== schemaHash(approved) || input.expectedToolHash && input.expectedToolHash !== toolHash) throw Object.assign(connections.fail("The MCP tool contract changed. Refresh its catalog in Integrations and review the workflow before running it again.", 409), { code: "MCP_SCHEMA_CHANGED" });
    if (connection.protocolVersion && connection.protocolVersion !== protocolVersion) throw Object.assign(connections.fail("The MCP protocol revision changed. Refresh the connection catalog before execution.", 409), { code: "MCP_PROTOCOL_CHANGED" });
    // Compile both schemas before dispatch. Never load external schema references.
    const validate = compileSchema(tool.inputSchema || { type: "object" }, "input");
    const validateOutput = tool.outputSchema ? compileSchema(tool.outputSchema, "output") : null;
    if (!validate(args))
      throw connections.fail(
        "Tool arguments do not match the server input schema. Review required fields and types.",
        422,
      );
    let result;
    try { result = await rpc("tools/call", { name, arguments: args }); }
    catch (error) { error.outcome_unknown = true; error.retryable = false; throw error; }
    if (!result.isError && validateOutput && !validateOutput(result.structuredContent)) throw Object.assign(connections.fail("The MCP tool returned data that violates its approved output schema. Review the server outcome before trying again.", 502), { code: "MCP_OUTPUT_INVALID", outcome_unknown: true, retryable: false });
    if (result.isError)
      throw Object.assign(connections.fail("The MCP tool reported an error. Inspect the server outcome before trying again.", 502), { code: "MCP_TOOL_FAILED", outcome_unknown: true, retryable: false });
    return {
      tool: name, schema_hash: toolHash, protocol_version: protocolVersion, output_schema_verified: Boolean(validateOutput), postcondition_verified: false,
      data: result.structuredContent ?? (result.content || []).filter(item => item.type === "text").map(item => { try { return JSON.parse(item.text); } catch { return String(item.text || ""); } }),
      content: (result.content || [])
        .filter((item) => item.type === "text")
        .map((item) => String(item.text || "").slice(0, 32000)),
      omitted_media: (result.content || []).filter(
        (item) => item.type !== "text",
      ).length,
    };
  });
module.exports = { discover, inspect, call, _internals: { parseResponse, schemaHash, compileSchema } };
