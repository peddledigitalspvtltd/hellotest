const fp = require("fastify-plugin");
const { config } = require("../config");

const UNRESTRICTED_ROUTES = new Set(["/health", "/health/live", "/health/ready", "/metrics"]);

async function capacityGuardPlugin(fastify, options = {}) {
  const limits = options.httpConfig || config.http;
  const state = {
    active: 0,
    activeLarge: 0,
    rejected: 0,
    rejectedLarge: 0
  };

  fastify.decorate("capacityGuard", {
    snapshot: () => ({
      ...state,
      max: limits.maxInflightRequests,
      maxLarge: limits.maxInflightLargeRequests
    })
  });
  fastify.decorateRequest("capacityAdmission", null);

  const release = (request) => {
    const admission = request.capacityAdmission;
    if (!admission || admission.released) return;
    admission.released = true;
    state.active = Math.max(0, state.active - 1);
    if (admission.large) state.activeLarge = Math.max(0, state.activeLarge - 1);
  };

  fastify.addHook("onRequest", async (request, reply) => {
    const route = request.routeOptions?.url || request.routerPath || "";
    if (UNRESTRICTED_ROUTES.has(route)) return;

    const routeBodyLimit = Number(request.routeOptions?.bodyLimit || limits.bodyLimitBytes);
    const declaredLarge = routeBodyLimit > limits.bodyLimitBytes;
    const contentLength = Number(request.headers["content-length"] || 0);
    const large = declaredLarge || (Number.isFinite(contentLength) && contentLength > limits.bodyLimitBytes);
    const atCapacity = state.active >= limits.maxInflightRequests;
    const largeAtCapacity = large && state.activeLarge >= limits.maxInflightLargeRequests;

    if (atCapacity || largeAtCapacity) {
      state.rejected += 1;
      if (largeAtCapacity) state.rejectedLarge += 1;
      request.log.warn({
        event: "request_load_shed",
        active_requests: state.active,
        active_large_requests: state.activeLarge,
        route,
        resource_class: large ? "large" : "standard"
      }, "Request rejected to protect API capacity");
      return reply
        .code(503)
        .header("Retry-After", "1")
        .send({
          success: false,
          code: "API_CAPACITY_EXCEEDED",
          message: "HelloTest is temporarily busy. Retry this request shortly.",
          requestId: request.id
        });
    }

    request.capacityAdmission = { large, released: false };
    state.active += 1;
    if (large) state.activeLarge += 1;
    reply.raw.once("close", () => release(request));
  });

  fastify.addHook("onResponse", async (request) => release(request));
  fastify.addHook("onRequestAbort", async (request) => release(request));
  fastify.addHook("onTimeout", async (request) => release(request));
}

module.exports = fp(capacityGuardPlugin, {
  name: "hellotest-capacity-guard"
});
