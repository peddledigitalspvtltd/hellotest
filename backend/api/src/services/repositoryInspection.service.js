const crypto = require("node:crypto");
const integrationService = require("./integration.service");
const { resolveSessionSecret, resolveTestEngineSecret } = require("../security/runtimeSecrets");
const { readBoundedResponseJson } = require("../utils/boundedResponse");

const TTL_MS = 2 * 60 * 60 * 1000;
const error = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const key = () => crypto.createHash("sha256").update(`repository-inspection:${resolveSessionSecret()}`).digest();
const seal = (value) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64url");
};
const open = (value) => {
  try {
    if (typeof value !== "string" || value.length > 8192) throw new Error();
    const bytes = Buffer.from(value, "base64url");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key(), bytes.subarray(0, 12));
    decipher.setAuthTag(bytes.subarray(12, 28));
    const payload = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8"));
    if (!["repository-inspection", "repository-inspection-setup"].includes(payload.kind) || !payload.expires || payload.expires < Date.now()) throw new Error();
    return payload;
  } catch { throw error("Inspection session has expired. Open a new browser session.", 401); }
};
const engineBase = (integration) => {
  if (!integration?.base_url) throw error("Configure an active Test Engine integration for this project to use a remote browser.", 503);
  const url = new URL(integration.base_url);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw error("The configured Test Engine URL must be an HTTP(S) base URL without credentials or a query.", 503);
  }
  return url.href.replace(/\/+$/, "");
};
const engineHeaders = (integration, token) => ({
  "content-type": "application/json",
  "x-hellotest-testengine-secret": resolveTestEngineSecret(integration.config?.shared_secret, integration.config?.callback_secret),
  ...(token ? { "x-hellotest-recorder-token": token } : {})
});
const startUrl = (value) => {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error();
    return parsed.href;
  } catch { throw error("Enter an HTTP or HTTPS URL without embedded credentials."); }
};

exports.capabilities = async (projectId) => {
  const integration = await integrationService.getActiveIntegrationByTypeForProject("testengine", projectId);
  let reason = null;
  try { engineBase(integration); engineHeaders(integration); } catch (failure) { reason = failure.message; }
  return {
    remote: { available: !reason, reason },
    local: {
      base_url: "http://127.0.0.1:4311",
      setup_requires_checkout: false,
      setup_endpoint: "/repository-inspection/local-agent/setup",
      protocol_version: 1
    }
  };
};
exports.start = async ({ project_id, app_type_id, start_url, user_id, authorization, origin }) => {
  const integration = await integrationService.getActiveIntegrationByTypeForProject("testengine", project_id);
  const base = engineBase(integration);
  const response = await fetch(`${base}/api/v1/recorder/sessions`, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(60_000),
    headers: engineHeaders(integration),
    body: JSON.stringify({ start_url: startUrl(start_url), purpose: "repository-inspect", recorder_mode: "remote", reuse_existing: false })
  });
  const session = await readBoundedResponseJson(response, { maxBytes: 1024 * 1024, label: "Test Engine inspection response" });
  if (!response.ok) throw error(session?.message || "The Test Engine could not start an inspection browser.", response.status >= 500 ? 503 : response.status);
  if (!session?.id || !/^[a-zA-Z0-9-]{1,100}$/.test(session.id)) throw error("The Test Engine returned an invalid inspection session.", 502);
  const live = new URL(session.live_view_path || session.live_view_url || "", base);
  const engineToken = live.searchParams.get("token");
  if (!engineToken) throw error("Update the Test Engine to enable protected browser inspection sessions.", 502);
  const expires = Date.now() + TTL_MS;
  const token = seal({ kind: "repository-inspection", expires, session_id: session.id, project_id, app_type_id, user_id, authorization, integration_id: integration.id, engine_token: engineToken, origin: origin || null, engine_cookie: (response.headers.getSetCookie?.() || [response.headers.get("set-cookie")]).filter(Boolean).map(value => value.split(";")[0]).join("; ") });
  const path = `/repository-inspection/sessions/${encodeURIComponent(session.id)}`;
  return {
    id: session.id, status: session.status, purpose: "repository-inspect", recorder_mode: "remote",
    started_at: session.started_at, start_url: session.start_url, display_mode: session.display_mode,
    capture: session.capture, expires_at: new Date(expires).toISOString(),
    status_url: `${path}?token=${encodeURIComponent(token)}`,
    live_view_url: `${path}/live?token=${encodeURIComponent(token)}`
  };
};
exports.resolve = async (token, id) => {
  const session = open(token);
  if (session.kind !== "repository-inspection" || session.session_id !== id) throw error("Inspection session access is not valid for this browser.", 403);
  const integration = await integrationService.getIntegration(session.integration_id);
  if (!integration?.is_active || integration.type !== "testengine"
      || (integration.config?.project_id && integration.config.project_id !== session.project_id)) {
    throw error("This inspection session's Test Engine is no longer available.", 403);
  }
  return { ...session, base_url: engineBase(integration), headers: { ...engineHeaders(integration, session.engine_token), ...(session.engine_cookie ? { cookie: session.engine_cookie } : {}) } };
};
exports.proxyUrl = (session, suffix, query) => {
  const allowed = new Set(["", "live", "stream", "screenshot", "tabs", "tabs/activate", "input", "inspect/start", "inspect/stop", "inspect/result", "inspect/validate", "highlight", "stop", "pause", "resume"]);
  if (!allowed.has(suffix)) throw error("Unknown inspection browser operation.", 404);
  const url = new URL(`${session.base_url}/api/v1/recorder/sessions/${encodeURIComponent(session.session_id)}${suffix ? `/${suffix}` : ""}`);
  // Never forward caller-controlled routing, credentials, or URLs to the engine.
  for (const name of ["page_id", "embedded", "parent_origin", "parent_frame", "refresh"]) {
    if (typeof query?.[name] === "string" && query[name].length <= 2048) url.searchParams.set(name, query[name]);
  }
  url.searchParams.set("token", session.engine_token);
  return url;
};
exports._internals = { seal, open, startUrl, engineBase };

exports.createSetup = ({ project_id, origin, agent_token, authorization, user_id }) => {
  let parsed;
  try { parsed = new URL(origin); } catch { throw error("A valid application origin is required."); }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.origin !== origin || parsed.username || parsed.password) throw error("A valid application origin is required.");
  if (typeof agent_token !== "string" || !/^[a-zA-Z0-9_-]{32,128}$/.test(agent_token)) throw error("Generate a new local agent pairing token and try again.");
  const expires = Date.now() + 10 * 60_000;
  const token = seal({ kind: "repository-inspection-setup", expires, project_id, origin, agent_token, authorization, user_id });
  return { download_url: `/repository-inspection/local-agent/download?token=${encodeURIComponent(token)}`, expires_at: new Date(expires).toISOString() };
};
exports.resolveSetup = (token) => {
  const payload = open(token);
  if (payload.kind !== "repository-inspection-setup") throw error("Invalid local agent setup link.", 403);
  return payload;
};
exports.downloadSetup = async (setup) => {
  const bundle = require("../assets/inspection-agent-runtime.json");
  const source = JSON.parse(require("node:zlib").gunzipSync(Buffer.from(bundle.gzip_base64, "base64"), { maxOutputLength: 3 * 1024 * 1024 }).toString("utf8"));
  return require("./inspectionAgentInstaller").buildInstaller({ ...source, origin: setup.origin, agent_token: setup.agent_token });
};
