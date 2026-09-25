// Bounded Streamable HTTP client (MCP 2025-11-25 / 2025-06-18 / 2025-03-26).
// No local process launching, automatic tool choice, OAuth token forwarding or retries of tool calls.
const { randomUUID } = require("node:crypto");
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
  { projectId, connectionId, signal, timeoutMs = 30000 },
  task,
) {
  const { connection, url } = connections.resolve(
    connectionId,
    projectId,
    null,
    "mcp",
  );
  const headers = { Accept: "application/json, text/event-stream" };
  const deadline = Date.now() + Math.min(70000, Math.max(1000, timeoutMs));
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
            connection.tools?.includes(tool.name),
        ),
      );
      cursor = result.nextCursor;
      if (!cursor) break;
    }
    return connections.redact(
      await task({ rpc, tools, connection }),
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
const discover = (input) =>
  withServer(input, async ({ tools }) =>
    tools.map((tool) => ({
      name: tool.name,
      description: String(tool.description || "").slice(0, 2000),
      inputSchema: tool.inputSchema || { type: "object" },
    })),
  );
const call = (input, name, args) =>
  withServer(input, async ({ rpc, tools }) => {
    const tool = tools.find((item) => item.name === name);
    if (!tool)
      throw connections.fail(
        "This tool is not available or is not enabled for the selected MCP connection.",
        403,
      );
    if (!args || typeof args !== "object" || Array.isArray(args))
      throw connections.fail("MCP arguments must be a JSON object.");
    // Validate locally as well as remotely. Never load external schema references.
    let validate;
    try {
      validate = new (String(tool.inputSchema?.$schema || "").includes(
        "2020-12",
      )
        ? Ajv2020
        : Ajv)({
        strict: false,
        allErrors: false,
        validateFormats: false,
      }).compile(tool.inputSchema || { type: "object" });
    } catch {
      throw connections.fail(
        "The MCP tool input schema is unsupported or invalid.",
        422,
      );
    }
    if (!validate(args))
      throw connections.fail(
        "Tool arguments do not match the server input schema. Review required fields and types.",
        422,
      );
    const result = await rpc("tools/call", { name, arguments: args });
    if (result.isError)
      throw connections.fail(
        "The MCP tool reported an error. Check its input and server status.",
        502,
      );
    return {
      tool: name,
      data: result.structuredContent || null,
      content: (result.content || [])
        .filter((item) => item.type === "text")
        .map((item) => String(item.text || "").slice(0, 32000)),
      omitted_media: (result.content || []).filter(
        (item) => item.type !== "text",
      ).length,
    };
  });
module.exports = { discover, call, _internals: { parseResponse } };
