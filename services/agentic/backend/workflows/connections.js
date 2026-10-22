const dns = require("node:dns").promises;
const http = require("node:http");
const https = require("node:https");
const net = require("node:net");
const execution = require("@hellotest/knowledge/backend/services/knowledgeExecution.service");
const {
  sanitizeAiText,
} = require("@hellotest/platform/backend/src/security/aiTextPolicy");
const { fail, cleanUrl } = require("./endpointPolicy");
const settings = require("./connectionSettings");
async function configured() {
  let rows;
  try {
    rows = JSON.parse(process.env.AGENTIC_HTTP_CONNECTIONS || "[]");
  } catch {
    throw fail(
      "Workflow connections are misconfigured. Contact your administrator.",
      503,
    );
  }
  if (!Array.isArray(rows))
    throw fail("Workflow connections must be a configured list.", 503);
  const saved = await settings.all();
  const savedIds = new Set(saved.map(row => row.id));
  return [...rows.filter(row => !savedIds.has(row?.id)), ...saved].filter(row=>row?.id!=='hellotest').filter(row => row.enabled !== false).filter(
    (row) => row && typeof row.id === "string" && typeof row.url === "string",
  );
}
const scoped = (connection, projectId) =>
  Array.isArray(connection.projectIds) &&
  connection.projectIds.includes(projectId);
const builtin = projectId => ({id:'hellotest',name:'HelloTest',kind:'mcp',builtin:true,url:process.env.HELLOTEST_MCP_PUBLIC_URL||'http://api:3000/mcp',projectIds:[projectId],enabled:true,tools:require('@hellotest/mcp/backend/server').toolDefinitions().map(tool=>tool.name),toolDefinitions:require('@hellotest/mcp/backend/server').toolDefinitions(),transport:'streamable-http',protocolVersion:'2026-07-28',timeoutMs:30000,serverInfo:{name:'HelloTest',version:'1.0.0'}});
const list = async (projectId) =>
  [builtin(projectId),...(await configured())]
    .filter((row) => scoped(row, projectId))
    .map((row) => ({
      id: row.id,
      builtin: Boolean(row.builtin),
      name: row.name || row.id,
      kind: row.kind === "mcp" ? "mcp" : "http",
      url: cleanUrl(row.url).toString(),
      authenticated: Boolean(row.builtin || row.secretEnv || row.encryptedSecret || row.encryptedHeaders),
      authenticationMode: row.builtin ? "current-user" : "managed-credential",
      methods: row.methods || ["GET", "HEAD"],
      tools: row.tools || [],
      toolDefinitions: (row.toolDefinitions || []).filter(tool => row.tools?.includes(tool.name)),
      timeoutMs: row.timeoutMs || 30000,
      transport: row.kind === "mcp" ? "streamable-http" : undefined,
      serverInfo: row.serverInfo,
      discovered_at: row.discovered_at,
    }));
async function resolve(id, projectId, endpoint, kind = "http") {
  const connection = id === 'hellotest' && kind === 'mcp' ? builtin(projectId) : id
    ? (await configured()).find((row) => row.id === id && scoped(row, projectId))
    : null;
  if (id && !connection)
    throw fail("This connection is unavailable in the selected project.", 403);
  if (kind === "mcp" && (!connection || connection.kind !== "mcp"))
    throw fail("Select a configured MCP server.");
  if (kind === "http" && connection?.kind === "mcp")
    throw fail("Select an HTTP connection.");
  const url = cleanUrl(endpoint || connection?.url || "");
  if (connection) {
    const base = cleanUrl(connection.url);
    const path = decodeURIComponent(url.pathname),
      basePath = decodeURIComponent(base.pathname);
    if (
      url.origin !== base.origin ||
      (path !== basePath &&
        !path.startsWith(basePath.endsWith("/") ? basePath : `${basePath}/`)) ||
      /(?:^|\/)\.\.(?:\/|$)/.test(path)
    )
      throw fail("The endpoint must stay within the selected connection.", 403);
  }
  return { connection, url };
}
function publicAddress(address) {
  if (net.isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && [0, 168].includes(b)) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && [18, 19].includes(b))
    );
  }
  // IPv4-mapped, link-local, loopback and unique-local IPv6 are not public.
  return (
    net.isIP(address) === 6 &&
    (parseInt(address.split(":")[0], 16) & 0xe000) === 0x2000
  );
}
function metadataAddress(address) {
  if (address.startsWith("169.254.")) return true;
  // URL canonicalization also handles expanded IPv4-mapped IPv6 literals.
  if (net.isIP(address) !== 6) return false;
  const canonical = new URL(`http://[${address}]`).hostname;
  return canonical.startsWith("[::ffff:a9fe:");
}
function authHeaders(connection) {
  const extra = settings.headers(connection);
  if (!connection?.secretEnv && !connection?.encryptedSecret) return extra;
  if (connection.secretEnv && !/^AGENTIC_SECRET_[A-Z0-9_]+$/.test(connection.secretEnv))
    throw fail("The connection secret reference is invalid.", 503);
  const secret = connection.secretEnv ? process.env[connection.secretEnv] : settings.credential(connection);
  if (!secret)
    throw fail("The selected connection has no configured credential.", 503);
  const name = connection.header || "Authorization";
  if (
    !/^[A-Za-z0-9-]+$/.test(name) ||
    /^(host|connection|content-length|transfer-encoding)$/i.test(name)
  )
    throw fail("The connection credential header is invalid.", 503);
  return {
    ...extra,
    [name]:
      connection.authType === "basic"
        ? `Basic ${Buffer.from(secret).toString("base64")}`
        : connection.authType === "header"
          ? secret
          : `Bearer ${secret}`,
  };
}
function redact(value, connection) {
  const secret = connection?.secretEnv ? process.env[connection.secretEnv] : connection?.encryptedSecret ? settings.credential(connection) : "";
  const secrets = [secret, ...Object.values(settings.headers(connection))].filter(Boolean);
  return JSON.parse(JSON.stringify(value, (key, item) => {
    if (/^(authorization|cookie|set-cookie|password|secret|token|api[-_]?key|access[-_]?token)$/i.test(key)) return "[REDACTED]";
    if (typeof item !== "string") return item;
    // Redact before JSON escaping so credentials containing quotes/backslashes
    // cannot reappear in an endpoint's echo or diagnostic response.
    for (const secret of secrets) for (const token of [secret, Buffer.from(secret).toString("base64")]) item = item.split(token).join("[REDACTED]");
    return sanitizeAiText(item).text;
  }));
}
async function request({
  url,
  connection,
  method = "GET",
  headers = {},
  body,
  signal,
  timeoutMs = 30000,
  onChunk,
}) {
  if (signal?.aborted) throw fail("The node was cancelled.", 499);
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = net.isIP(hostname)
    ? [{ address: hostname, family: net.isIP(hostname) }]
    : await execution.bounded(() => dns.lookup(hostname, { all: true }), {
        timeoutMs: Math.min(5000, timeoutMs),
        signal,
      });
  if (signal?.aborted) throw fail("The node was cancelled.", 499);
  if (
    !addresses.length ||
    addresses.some(
      ({ address }) =>
        metadataAddress(address) ||
        (!connection?.allowPrivateNetwork && !publicAddress(address)),
    )
  )
    throw fail(
      "Private network endpoints require an administrator-configured connection.",
      403,
    );
  const pinned = addresses[0];
  if (body && Buffer.byteLength(body) > 128 * 1024)
    throw fail("Node request bodies are limited to 128 KB.");
  return new Promise((resolve, reject) => {
    let completed = false;
    let timer;
    const finish = (error, result) => {
      if (completed) return;
      completed = true;
      clearTimeout(timer);
      error ? reject(error) : resolve(result);
    };
    const req = (url.protocol === "https:" ? https : http).request(
      url,
      {
        method,
        signal,
        headers: {
          Accept: "application/json",
          ...(body ? { "Content-Type": "application/json" } : {}),
          ...headers,
          ...authHeaders(connection),
        },
        // Pin the checked address so DNS rebinding cannot redirect credentials.
        lookup: (_host, options, cb) =>
          options?.all
            ? cb(null, [pinned])
            : cb(null, pinned.address, pinned.family),
      },
      (res) => {
        const chunks = [];
        let bytes = 0;
        const finishBody = () =>
          finish(null, {
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        res.on("data", (chunk) => {
          bytes += chunk.length;
          if (bytes > 128 * 1024) {
            finish(fail("The node response exceeded 128 KB.", 502));
            res.destroy();
            req.destroy();
            return;
          }
          chunks.push(chunk);
          if (onChunk?.(Buffer.concat(chunks).toString("utf8"), res.headers)) {
            finishBody();
            res.destroy();
            req.destroy();
          }
        });
        res.on("end", finishBody);
        res.on("error", () =>
          finish(fail("The server response was interrupted.", 502)),
        );
      },
    );
    timer = setTimeout(
      () => {
        finish(fail("The external node timed out.", 504));
        req.destroy();
      },
      Math.min(70000, Math.max(1000, timeoutMs)),
    );
    req.on("error", () =>
      finish(
        fail(
          signal?.aborted
            ? "The node was cancelled."
            : "Unable to reach the configured endpoint.",
          signal?.aborted ? 499 : 502,
        ),
      ),
    );
    req.end(body);
  });
}
async function callHttp({ projectId, data, signal }) {
  const { connection, url } = await resolve(
    data.connectionId,
    projectId,
    data.apiUrl,
  );
  const method = String(data.apiMethod || "GET").toUpperCase();
  const allowed = connection?.methods || ["GET", "HEAD"];
  if (
    !allowed.includes(method) ||
    !["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"].includes(
      method,
    )
  )
    throw fail("This HTTP method is not enabled for the connection.", 403);
  if (data.apiAuth || data.credentialId)
    throw fail(
      "Select a server-managed connection instead of an inline credential.",
    );
  const paginated = data.apiPagination === "cursor";
  if (paginated && method !== "GET") throw fail("Cursor pagination is available only for HTTP GET.");
  const items = [], cursors = new Set();
  const maxItems = Math.min(100, Math.max(1, Number(data.apiMaxItems) || 100));
  let pages = 0;
  let expectedTotal = null;
  let result;
  do {
    const response = await request({ url, connection, method,
      body: ["GET", "HEAD"].includes(method) ? undefined : String(data.apiBody || ""),
      signal, timeoutMs: Number(data.timeoutMs) || connection?.timeoutMs || 30000 });
    if (response.status < 200 || response.status >= 300) throw fail(`The endpoint returned HTTP ${response.status}. Redirects are not followed.`, response.status);
    let content;
    try { content = JSON.parse(response.body); } catch { content = response.body; }
    result = { status: response.status, data: content, content_type: response.headers["content-type"] || "" };
    if (!paginated) return redact(result, connection);
    if (!content || !Array.isArray(content.items) || typeof content.is_last !== "boolean") throw fail("The Stories API must return items, is_last and next_cursor. Enable include_page=true.", 502);
    if (data.apiResource === "sprintStories" && (!Number.isInteger(content.total) || content.total < 0)) throw fail("The Stories API must return a valid total count.", 502);
    if (Number.isInteger(content.total)) {
      if (expectedTotal !== null && content.total !== expectedTotal) throw fail("Sprint membership changed during pagination. Retry against a stable Sprint scope.", 409);
      expectedTotal = content.total;
    }
    items.push(...content.items);
    pages += 1;
    if (items.length > maxItems || (Number.isFinite(content.total) && content.total > maxItems)) throw fail(`This Sprint contains more than ${maxItems} Stories. Split its scope before running; no Stories were silently omitted.`, 422);
    if (content.is_last) { if (expectedTotal !== null && items.length !== expectedTotal) throw fail("The Stories API returned an incomplete Sprint page set. Retry before generating drafts.", 502); break; }
    if (pages >= 100 || !content.next_cursor || cursors.has(content.next_cursor) || !content.items.length) throw fail("Stories pagination stopped advancing. Retry against a stable Sprint scope.", 502);
    cursors.add(content.next_cursor);
    url.searchParams.set("cursor", String(content.next_cursor));
  } while (!signal?.aborted);
  if (signal?.aborted) throw fail("The node was cancelled.", 499);
  return redact({ ...result, data: { items, total: items.length, is_last: true, next_cursor: null }, pagination: { pages, fetched: items.length, complete: true } }, connection);
}
module.exports = { builtin,
  list,
  resolve,
  request,
  callHttp,
  redact,
  fail,
  _internals: { publicAddress, metadataAddress, scoped, cleanUrl, authHeaders },
};
