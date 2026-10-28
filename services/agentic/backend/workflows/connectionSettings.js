const db = require("@hellotest/platform/backend/src/db");
const { randomUUID, randomBytes, createHash, createCipheriv, createDecipheriv } = require("node:crypto");
const PREFIX = "agentic_connection:";
const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode, publicMessage: message });
const store = {
  list: async () => (await db.prepare("SELECT value FROM app_settings WHERE key LIKE ? ORDER BY key").all(`${PREFIX}%`)).map(row => row.value),
  get: async id => (await db.prepare("SELECT value FROM app_settings WHERE key = ?").get(PREFIX + id))?.value,
  save: async row => db.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP").run(PREFIX + row.id, row),
  remove: async id => db.prepare("DELETE FROM app_settings WHERE key = ?").run(PREFIX + id),
};
function key() {
  const secret = process.env.WORKFLOW_CREDENTIAL_KEY || process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw fail("Configure WORKFLOW_CREDENTIAL_KEY (at least 32 characters) on the server to store credentials, or use a secret environment reference.", 503);
  return createHash("sha256").update(`workflow-credentials-v1:${secret}`).digest();
}
function encrypt(value, id) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(id));
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return { iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") };
}
function decrypt(encrypted, id) {
  if (!encrypted) return "";
  try {
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(encrypted.iv, "base64"));
    decipher.setAAD(Buffer.from(id));
    decipher.setAuthTag(Buffer.from(encrypted.tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(encrypted.ciphertext, "base64")), decipher.final()]).toString("utf8");
  } catch { throw fail("The saved credential cannot be read. Restore the credential key or replace the connection credential.", 503); }
}
const credential = row => decrypt(row.encryptedSecret, row.id);
const headers = row => row?.encryptedHeaders ? JSON.parse(decrypt(row.encryptedHeaders, row.id + ":headers")) : {};
function projectScope(projectId) {
  if (typeof projectId !== "string" || !projectId.trim() || projectId.length > 255) throw fail("Select a project to manage workflow connections.");
  return projectId;
}
function publicRow(row, projectId) {
  const { encryptedSecret, encryptedHeaders, projectIds, ...safe } = row;
  return { ...safe, headers: Object.fromEntries((row.headerNames || []).map(name => [name, ""])), project_id: projectId, authenticated: Boolean(encryptedSecret || row.secretEnv || encryptedHeaders) };
}
function normalize(input, previous = {}) {
  const id = previous.id || randomUUID();
  const name = String(input.name || "").trim();
  if (name.length < 2 || name.length > 120) throw fail("Enter a server name between 2 and 120 characters.");
  const url = require("./endpointPolicy").cleanUrl(input.url);
  if (url.search || new URL(input.url).hash) throw fail("Put credentials in authentication settings; use an endpoint without a query string or fragment.");
  const projectId = projectScope(input.project_id);
  if (input.projectIds !== undefined) throw fail("Connections use the current project; project access cannot be supplied separately.");
  // Preserve existing deployment-era scopes; newly created connections have one owner project.
  const projectIds = previous.projectIds || [projectId];
  if (!["mcp", "http"].includes(input.kind || "mcp")) throw fail("Choose an MCP server or HTTP connection.");
  const kind = input.kind || "mcp";
  if (kind === "mcp" && input.transport && input.transport !== "streamable-http") throw fail("Use MCP Streamable HTTP. Local stdio and legacy SSE transports are not supported.");
  const timeoutMs = Number(input.timeoutMs ?? previous.timeoutMs ?? 30000);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 70000) throw fail("Choose a connection timeout between 1,000 and 70,000 milliseconds.");
  const tools = input.tools || [], methods = kind === "mcp" ? ["POST"] : input.methods || ["GET", "HEAD"];
  if (!Array.isArray(tools) || tools.length > 100 || tools.some(tool => typeof tool !== "string" || !/^[\w.:-]{1,128}$/.test(tool))) throw fail("Enter up to 100 valid tool names.");
  if (!Array.isArray(methods) || !methods.length || methods.some(method => !["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"].includes(method))) throw fail("Choose supported HTTP methods.");
  const authType = input.authType || "none", header = input.header || (authType === "header" ? "X-API-Key" : "Authorization");
  if (!["none", "bearer", "basic", "header"].includes(authType)) throw fail("Choose a supported authentication method.");
  if (!/^[A-Za-z0-9-]+$/.test(header) || /^(host|connection|content-length|transfer-encoding|cookie|set-cookie|accept|content-type|mcp-session-id|mcp-protocol-version|proxy-authorization)$/i.test(header)) throw fail("Choose a valid credential header.");
  const secretEnv = String(input.secretEnv || "").trim();
  if (authType === "bearer" && typeof input.secret === "string") {
    input = {...input, secret: input.secret.trim()};
    if (/^Bearer\s/i.test(input.secret)) throw fail("Enter only the token in the Bearer credential field; the Authorization prefix is added automatically.");
  }
  if (authType === "header" && header.toLowerCase() === "x-api-key" && typeof input.secret === "string") {
    input = { ...input, secret: input.secret.trim() };
    if (/^(?:Bearer|Basic)\s/i.test(input.secret)) throw fail("Enter only the API key for X-API-Key; authorization prefixes belong to Bearer or Basic authentication.");
  }
  if (secretEnv && !/^AGENTIC_SECRET_[A-Z0-9_]+$/.test(secretEnv)) throw fail("Secret environment references must begin with AGENTIC_SECRET_.");
  if (input.secret && (typeof input.secret !== "string" || input.secret.length > 8192 || /[\r\n]/.test(input.secret))) throw fail("Use a credential up to 8 KB without line breaks.");
  if (input.secret && secretEnv) throw fail("Choose a saved credential or an environment reference.");
  if (previous.authType && previous.authType !== authType && authType !== "none" && !input.secret && !secretEnv) throw fail("Enter a credential for the new authentication method.");
  if (authType === "basic" && previous.authType === "basic" && input.username !== undefined && input.username !== previous.username && !input.secret && !secretEnv) throw fail("Enter the password again when changing the Basic authentication username.");
  const encryptedSecret = authType === "none" || secretEnv ? undefined : input.secret ? encrypt(input.secret, id) : previous.encryptedSecret;
  if (authType !== "none" && !secretEnv && !encryptedSecret) throw fail("Enter a credential or its environment reference.");
  const incomingHeaders = input.headers ?? Object.fromEntries((previous.headerNames || []).map(name => [name, ""]));
  if (!incomingHeaders || typeof incomingHeaders !== "object" || Array.isArray(incomingHeaders) || Object.keys(incomingHeaders).length > 16) throw fail("Add up to 16 custom request headers.");
  const previousHeaders = headers(previous), resolvedHeaders = {}, names = new Set();
  for (const [name, value] of Object.entries(incomingHeaders)) {
    const lower = name.toLowerCase();
    if (!/^[A-Za-z0-9-]{1,64}$/.test(name) || /^(authorization|host|connection|content-length|transfer-encoding|cookie|set-cookie|accept|content-type|mcp-session-id|mcp-protocol-version|proxy-authorization)$/i.test(name) || (authType !== "none" && lower === header.toLowerCase()) || names.has(lower)) throw fail("Use unique custom headers; authentication and transport headers are managed separately.");
    if (typeof value !== "string" || value.length > 2048 || /[\r\n]/.test(value)) throw fail("Header values must be text up to 2,048 characters without line breaks.");
    const resolved = value || previousHeaders[name];
    if (!resolved) throw fail(`Enter a value for the ${name} header.`);
    names.add(lower); resolvedHeaders[name] = resolved;
  }
  const toolDefinitions = kind === "mcp" ? input.toolDefinitions ?? previous.toolDefinitions ?? [] : [];
  if (!Array.isArray(toolDefinitions) || toolDefinitions.length > 100 || toolDefinitions.some(tool => !tool || typeof tool.name !== "string" || !/^[\w.:-]{1,128}$/.test(tool.name) || !tool.inputSchema || typeof tool.inputSchema !== "object" || Array.isArray(tool.inputSchema)) || Buffer.byteLength(JSON.stringify(toolDefinitions)) > 98304) throw fail("The tool catalog must contain up to 100 tools with valid input schemas and fit within 96 KB.");
  if (new Set(toolDefinitions.map(tool => tool.name)).size !== toolDefinitions.length) throw fail("The tool catalog contains duplicate names.");
  if (toolDefinitions.length && tools.some(name => !toolDefinitions.some(tool => tool.name === name))) throw fail("Select enabled tools from the discovered server catalog.");
  const keepCatalogMetadata = !Object.hasOwn(input, "toolDefinitions");
  return { id, name, kind, url: url.toString(), projectIds: [...new Set(projectIds)], tools: [...new Set(tools)], methods: [...new Set(methods)],
    authType, header: authType === "header" ? header : "Authorization", username: authType === "basic" ? String(input.username ?? previous.username ?? "").slice(0, 255) : undefined, secretEnv: authType === "none" ? "" : secretEnv, encryptedSecret,
    encryptedHeaders: Object.keys(resolvedHeaders).length ? encrypt(JSON.stringify(resolvedHeaders), id + ":headers") : undefined, headerNames: Object.keys(resolvedHeaders),
    transport: kind === "mcp" ? "streamable-http" : undefined, timeoutMs, toolDefinitions,
    serverInfo: kind === "mcp" && input.serverInfo && typeof input.serverInfo === "object" ? { name: String(input.serverInfo.name || "").slice(0, 160), version: String(input.serverInfo.version || "").slice(0, 80) } : keepCatalogMetadata ? previous.serverInfo : undefined,
    protocolVersion: kind === "mcp" ? String(input.protocolVersion || (keepCatalogMetadata ? previous.protocolVersion : "") || "").slice(0, 40) : undefined,
    discovered_at: kind === "mcp" && input.discovered_at && Number.isFinite(Date.parse(input.discovered_at)) ? new Date(input.discovered_at).toISOString() : keepCatalogMetadata ? previous.discovered_at : undefined,
    allowPrivateNetwork: input.allowPrivateNetwork === true, enabled: input.enabled !== false,
    updated_at: new Date().toISOString(),
  };
}
async function get(id, projectId) {
  projectScope(projectId);
  if (!/^[\w-]{1,160}$/.test(id)) throw fail("Invalid connection ID.");
  const row = await store.get(id);
  if (!row || !row.projectIds?.includes(projectId)) throw fail("This connection is not available in the current project.", 404);
  return row;
}
async function save(input, id, userId) {
  const projectId = projectScope(input.project_id);
  const previous = id ? await get(id, projectId) : undefined;
  const row = { ...normalize(input, previous), updated_by: userId };
  if (!await db.prepare("SELECT id FROM projects WHERE id = ?").get(projectId)) throw fail("The current project no longer exists.");
  await store.save(row);
  return publicRow(row, projectId);
}
module.exports = { list: async projectId => { projectScope(projectId); return (await store.list()).filter(row => row.projectIds?.includes(projectId)).map(row => publicRow(row, projectId)); }, all: () => store.list(), get, save,
  preview: async (input, id) => normalize(input, id ? await get(id, projectScope(input.project_id)) : undefined),
  remove: async (id, projectId) => { await get(id, projectId); await store.remove(id); return { deleted: true }; },
  credential, headers, publicRow, _internals: { store, normalize, encrypt, key },
};
