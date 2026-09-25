const { defineRoute } = require("@hellotest/platform/backend/src/routes/routeDefinition");

module.exports = {
  id: "trace",
  routes: [defineRoute("trace", "trace", "opsTelemetry.routes.js"), defineRoute("trace", "ops-console", "opsConsole.routes.js")]
};
