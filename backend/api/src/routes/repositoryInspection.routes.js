const { Readable } = require("node:stream");
const service = require("../services/repositoryInspection.service");
const projects = require("../services/project.service");
const appTypes = require("../services/appType.service");
const { readBoundedResponseText, readBoundedResponseBuffer } = require("../utils/boundedResponse");

const scope = async (fastify, req, projectId, permission = "automation.repository.manage") => {
  if (!projectId || typeof projectId !== "string") throw Object.assign(new Error("project_id is required"), { statusCode: 400 });
  await fastify.authenticate(req);
  await projects.getProject(projectId, req.user.id);
  await fastify.requirePermission(permission, { projectId })(req);
};

module.exports = async function repositoryInspectionRoutes(fastify) {
  fastify.get("/repository-inspection/capabilities", async (req, reply) => {
    await scope(fastify, req, req.query.project_id, "automation.view");
    reply.header("cache-control", "no-store");
    return service.capabilities(req.query.project_id);
  });
  fastify.post("/repository-inspection/sessions", async (req, reply) => {
    const input = req.body || {};
    await scope(fastify, req, input.project_id);
    if (req.authMethod === "api_key" || !String(req.headers.authorization || "").startsWith("Bearer ")) {
      throw Object.assign(new Error("Browser inspection requires a signed-in browser session."), { statusCode: 403 });
    }
    if (input.app_type_id) {
      const app = await appTypes.getAppType(input.app_type_id);
      if (app.project_id !== input.project_id) throw Object.assign(new Error("Application scope does not belong to this project."), { statusCode: 403 });
    }
    reply.header("cache-control", "no-store");
    return service.start({ ...input, user_id: req.user.id, authorization: req.headers.authorization, origin: req.headers.origin });
  });
  fastify.post("/repository-inspection/local-agent/setup", async (req, reply) => {
    const input = req.body || {};
    await scope(fastify, req, input.project_id);
    if (req.authMethod === "api_key" || !String(req.headers.authorization || "").startsWith("Bearer ")) {
      throw Object.assign(new Error("Local inspection setup requires a signed-in browser session."), { statusCode: 403 });
    }
    if (req.headers.origin && req.headers.origin !== input.origin) throw Object.assign(new Error("Pairing origin must match this application."), { statusCode: 403 });
    reply.header("cache-control", "no-store");
    return service.createSetup({ ...input, user_id: req.user.id, authorization: req.headers.authorization });
  });
  const setupAccess = async req => {
    const setup = service.resolveSetup(req.query.token);
    if (!req.headers.authorization) req.headers.authorization = setup.authorization;
    req.query.project_id = setup.project_id;
    req.inspectionSetup = setup;
  };
  fastify.get("/repository-inspection/local-agent/download", { preHandler: setupAccess }, async (req, reply) => {
    const setup = req.inspectionSetup;
    await scope(fastify, req, setup.project_id);
    if (req.user.id !== setup.user_id) throw Object.assign(new Error("This setup link belongs to another user."), { statusCode: 403 });
    reply.header("cache-control", "no-store").header("referrer-policy", "no-referrer")
      .header("content-disposition", 'attachment; filename="hellotest-inspection-agent.mjs"').header("content-type", "text/javascript; charset=utf-8");
    return service.downloadSetup(setup);
  });
  const sessionAccess = async req => {
    const token = req.query.token || req.headers["x-hellotest-recorder-token"];
    const session = await service.resolve(token, req.params.id);
    if (!req.headers.authorization) req.headers.authorization = session.authorization;
    req.query.project_id = session.project_id;
    req.inspectionSession = session;
  };
  const proxy = async (req, reply) => {
    const session = req.inspectionSession;
    // The frame's capability is encrypted, short lived, and limited to this one
    // browser. Revalidate the originating login, account and project grants on
    // every operation; no shared Test Engine secret reaches the browser.
    if (!req.headers.authorization) req.headers.authorization = session.authorization;
    await scope(fastify, req, session.project_id);
    if (req.user.id !== session.user_id) throw Object.assign(new Error("This inspection browser belongs to another user."), { statusCode: 403 });
    const suffix = req.params["*"] || "";
    const getOperations = new Set(["", "live", "stream", "screenshot", "tabs", "inspect/result"]);
    if ((req.method === "GET") !== getOperations.has(suffix)) throw Object.assign(new Error("Unsupported inspection operation method."), { statusCode: 405 });
    const target = service.proxyUrl(session, suffix, req.query);
    const controller = new AbortController();
    let streaming = false;
    const deadline = setTimeout(() => controller.abort(), suffix === "stream" ? 5 * 60_000 : 60_000);
    const abort = () => controller.abort();
    reply.raw.once("close", abort);
    try {
      const response = await fetch(target, {
        method: req.method, headers: session.headers, redirect: "error", signal: controller.signal,
        ...(req.method === "POST" ? { body: JSON.stringify(req.body || {}) } : {})
      });
      reply.code(response.status).header("cache-control", "no-store").header("referrer-policy", "no-referrer");
      if (suffix === "stream" && response.ok && response.body) {
        reply.header("content-type", "text/event-stream").header("x-accel-buffering", "no");
        streaming = true;
        const stream = Readable.fromWeb(response.body);
        stream.once("close", () => { clearTimeout(deadline); reply.raw.off("close", abort); });
        return reply.send(stream);
      }
      if (suffix === "live" && response.ok) {
        const html = await readBoundedResponseText(response, { maxBytes: 2 * 1024 * 1024 });
        const prefix = 'window.location.pathname.replace(/\\/live$/, \"\")';
        // Keep live view fetch/SSE requests on the authenticated app proxy.
        const patched = html.replaceAll('"/api/v1/recorder/sessions/" + encodeURIComponent(sessionId)', prefix);
        reply.removeHeader("x-frame-options");
        reply.header("content-type", "text/html; charset=utf-8")
          .header("content-security-policy", `frame-ancestors 'self'${session.origin ? ` ${new URL(session.origin).origin}` : ""}`);
        return patched;
      }
      let body = await readBoundedResponseBuffer(response, { maxBytes: 12 * 1024 * 1024 });
      if ((response.headers.get("content-type") || "").includes("application/json")) {
        const payload = JSON.parse(body.toString("utf8"));
        for (const field of ["status_url", "live_view_url", "live_view_path", "engine_base_url", "live_token"]) delete payload[field];
        body = Buffer.from(JSON.stringify(payload));
      }
      reply.header("content-type", response.headers.get("content-type") || "application/json");
      return body;
    } finally {
      if (!streaming) { clearTimeout(deadline); reply.raw.off("close", abort); }
    }
  };
  fastify.get("/repository-inspection/sessions/:id", { preHandler: sessionAccess }, proxy);
  fastify.route({ method: ["GET", "POST"], url: "/repository-inspection/sessions/:id/*", preHandler: sessionAccess, handler: proxy });
};
