const { routeModules } = require("./manifest");
const { profile, routeEnabled } = require("../runtime/serviceProfile");

module.exports = async function registerRoutes(fastify) {
  const enabledRoutes = routeModules.filter(routeEnabled);
  for (const route of enabledRoutes) {
    fastify.register(route.load());
  }
  fastify.log.info({ serviceProfile: profile, routeCount: enabledRoutes.length }, "Route profile registered");
};
