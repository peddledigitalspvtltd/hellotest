const projectService = require("@hellotest/platform/backend/public/projectAccess");
const opsTelemetryService = require("../services/opsTelemetry.service");
const opsPlatformService = require("../services/opsPlatform.service");
const opsMonitoringService = require("../services/opsMonitoring.service");
const grafana = require("../services/opsGrafana.service");
const { Readable, Transform } = require("node:stream");

module.exports = async function (fastify) {
  fastify.post("/ops-telemetry/grafana-session", { bodyLimit: 4096, preHandler: [fastify.requireAdmin] }, async (req, reply) => {
    const projectId = req.body?.project_id;
    if (typeof projectId !== "string" || !projectId.trim() || projectId.length > 128 || !req.headers.authorization?.startsWith("Bearer ") || req.authMethod === "api_key") {
      throw Object.assign(new Error("A signed-in administrator and project are required."), { statusCode: 403 });
    }
    await projectService.getProject(projectId, req.user.id);
    await grafana.gateway.ready();
    const token = grafana.sealSession({ user_id: req.user.id, project_id: projectId, authorization: req.headers.authorization, origin: req.headers.origin || null });
    const secure = req.protocol === "https" || req.headers["x-forwarded-proto"] === "https";
    reply.header("cache-control", "no-store").header("set-cookie", `${grafana.COOKIE}=${token}; Path=${grafana.PREFIX}/; HttpOnly; SameSite=Strict; Max-Age=${grafana.TTL / 1000}${secure ? "; Secure" : ""}`);
    return { url: `${grafana.PREFIX}/d/hellotest-runtime-overview?orgId=1&kiosk&refresh=30s&from=now-1h&to=now`, expires_at: new Date(Date.now() + grafana.TTL).toISOString() };
  });
  fastify.delete("/ops-telemetry/grafana-session", async (_req, reply) => {
    reply.header("cache-control", "no-store").header("set-cookie", [`${grafana.COOKIE}=; Path=${grafana.PREFIX}/; HttpOnly; SameSite=Strict; Max-Age=0`, ...["traces", "alerts"].map(provider => `hellotest_ops_${provider}=; Path=/api/ops-telemetry/console/${provider}/; HttpOnly; SameSite=Strict; Max-Age=0`)]);
    return { closed: true };
  });
  const grafanaAccess = async req => {
    if (req.headers["sec-fetch-site"] === "cross-site") throw Object.assign(new Error("Cross-site dashboard access is not allowed."), { statusCode: 403 });
    const token = String(req.headers.cookie || "").split(";").map(part => part.trim()).find(part => part.startsWith(`${grafana.COOKIE}=`))?.slice(grafana.COOKIE.length + 1);
    const session = grafana.openSession(token);
    if (session.console) throw Object.assign(new Error("Dashboard session mismatch."), { statusCode: 403 });
    if (req.method === "POST" && (!req.headers.origin || req.headers.origin !== session.origin)) throw Object.assign(new Error("Dashboard origin mismatch."), { statusCode: 403 });
    req.headers.authorization = session.authorization;
    req.query.project_id = session.project_id;
    await fastify.requireAdmin(req);
    if (req.user.id !== session.user_id) throw Object.assign(new Error("Dashboard session mismatch."), { statusCode: 403 });
    await projectService.getProject(session.project_id, req.user.id);
  };
  fastify.route({ method: ["GET", "POST"], url: "/ops-telemetry/grafana/*", bodyLimit: 256 * 1024, preHandler: [grafanaAccess], handler: async (req, reply) => {
    const path = req.params["*"] || "";
    reply.header("cache-control", "no-store").header("referrer-policy", "no-referrer");
    if (path === "api/frontend-metrics" && req.method === "POST") return reply.code(204).send();
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), 20000);
    const cleanup = () => { clearTimeout(deadline); controller.abort(); };
    reply.raw.once("close", cleanup);
    try {
      const upstream = await grafana.gateway.request({ method: req.method, path, query: req.query, body: req.body, signal: controller.signal });
      // Never forward cookies, credentials, redirects, or upstream server details.
      if (!upstream.ok) {
        await upstream.body?.cancel();
        throw Object.assign(new Error("Grafana is temporarily unavailable. Reconnect from the dashboard tab."), { statusCode: 502 });
      }
      reply.header("content-type", upstream.headers.get("content-type") || "application/octet-stream")
        .header("x-frame-options", "SAMEORIGIN")
        .header("content-security-policy", "frame-ancestors 'self'");
      let bytes = 0;
      const stream = Readable.fromWeb(upstream.body);
      const bounded = new Transform({ transform(chunk, _encoding, callback) {
        bytes += chunk.length;
        callback(bytes > 20 * 1024 * 1024 ? new Error("Dashboard response exceeded its limit") : null, chunk);
      } });
      stream.once("error", error => bounded.destroy(error));
      bounded.once("close", () => { stream.destroy(); cleanup(); });
      return reply.send(stream.pipe(bounded));
    } catch (error) { cleanup(); reply.raw.off("close", cleanup); throw error; }
  } });
  // Infrastructure logs/alerts span projects, so project membership alone is insufficient.
  fastify.get("/ops-telemetry/monitoring/:section", { preHandler: [fastify.requireAdmin] }, async (req) => {
    const { project_id } = req.query || {};
    if (!project_id) {
      const error = new Error("project_id is required");
      error.statusCode = 400;
      throw error;
    }
    await projectService.getProject(project_id, req.user.id);
    return opsMonitoringService.snapshot(req.params.section);
  });
  fastify.get("/ops-telemetry/platform", async (req) => {
    const { project_id } = req.query || {};
    if (!project_id) {
      const error = new Error("project_id is required");
      error.statusCode = 400;
      throw error;
    }
    await projectService.getProject(project_id, req.user.id);
    return opsPlatformService.snapshot();
  });
  fastify.get("/ops-telemetry/snapshot", async (req) => {
    const { project_id } = req.query || {};
    if (!project_id) {
      const error = new Error("project_id is required");
      error.statusCode = 400;
      throw error;
    }

    await projectService.getProject(project_id, req.user.id);
    const includeWorkers = req.query.include_workers === "true";
    if (includeWorkers) await fastify.requireAdmin(req);
    return opsTelemetryService.getTelemetrySnapshot({ ...req.query, include_workers: includeWorkers });
  });

  fastify.delete("/ops-telemetry/logs", async (req) => {
    const { project_id } = req.query || {};

    if (!project_id) {
      const error = new Error("project_id is required");
      error.statusCode = 400;
      throw error;
    }
    await projectService.getProject(project_id, req.user.id);

    return opsTelemetryService.clearTelemetryLogs({
      project_id
    });
  });
};
