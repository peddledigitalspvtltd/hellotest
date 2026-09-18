const { config } = require("../config");

const ADMIN_FETCH_TIMEOUT_MS = 10_000;

const proxyAdminAsset = async (req, reply, assetPath) => {
  const baseUrl = String(config.adminPortal.frontendInternalUrl || "").trim();

  if (!baseUrl) {
    const error = new Error("The administration frontend is not configured.");
    error.statusCode = 503;
    throw error;
  }

  let frontendUrl;
  try {
    frontendUrl = new URL(`${baseUrl.replace(/\/+$/, "")}/`);
    if (!["http:", "https:"].includes(frontendUrl.protocol)) throw new Error("Invalid frontend protocol");
  } catch {
    const error = new Error("The administration frontend URL is invalid.");
    error.statusCode = 500;
    throw error;
  }

  let upstreamUrl;
  try {
    upstreamUrl = new URL(assetPath.replace(/^\/+/, ""), frontendUrl);
    // URL resolution accepts absolute schemes and backslash authorities. The
    // public asset proxy must never become a gateway to a different service.
    if (upstreamUrl.origin !== frontendUrl.origin
      || !upstreamUrl.pathname.startsWith(frontendUrl.pathname)
      || upstreamUrl.username !== frontendUrl.username
      || upstreamUrl.password !== frontendUrl.password) {
      throw new Error("Asset path escaped the configured frontend");
    }
  } catch {
    throw Object.assign(new Error("Invalid administration asset path."), { statusCode: 400 });
  }

  let response;
  try {
    response = await fetch(upstreamUrl, {
      redirect: "error",
      headers: {
        accept: req.headers.accept || "*/*",
        "user-agent": req.headers["user-agent"] || "hellotest-admin-gateway"
      },
      signal: AbortSignal.timeout(ADMIN_FETCH_TIMEOUT_MS)
    });
  } catch (cause) {
    req.log.error({ cause, upstreamUrl: upstreamUrl.toString() }, "Administration frontend is unavailable");
    const error = new Error("The administration frontend is still starting. Retry in a moment.");
    error.statusCode = 503;
    throw error;
  }

  const contentType = response.headers.get("content-type");
  const cacheControl = response.headers.get("cache-control");
  if (contentType) reply.type(contentType);
  if (cacheControl) reply.header("Cache-Control", cacheControl);
  reply.header("X-HelloTest-Admin-Gateway", "frontend");
  reply.code(response.status);

  return reply.send(Buffer.from(await response.arrayBuffer()));
};

module.exports = async function (fastify) {
  fastify.get("/admin", async (_req, reply) => reply.redirect("/admin/"));

  fastify.get("/admin/runtime-config.js", async (_req, reply) => {
    reply.type("application/javascript; charset=utf-8");
    reply.header("Cache-Control", "no-store");
    return [
      "window.__HELLOTEST_CONFIG__ = window.__HELLOTEST_CONFIG__ || {};",
      "window.__HELLOTEST_CONFIG__.API_BASE_URL = '';"
    ].join("\n");
  });

  fastify.get("/admin/", async (req, reply) => proxyAdminAsset(req, reply, "admin.html"));
  fastify.get("/admin/*", async (req, reply) => proxyAdminAsset(req, reply, req.params["*"]));
};
