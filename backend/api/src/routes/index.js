const { routeModules } = require("./manifest");

module.exports = async function registerRoutes(fastify) {
  for (const route of routeModules) {
    fastify.register(route.module);
  }
};
