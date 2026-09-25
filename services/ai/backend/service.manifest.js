const { defineRoute } = require("@hellotest/platform/backend/src/routes/routeDefinition");

module.exports = {
  id: "ai",
  routes: [defineRoute("ai", "ai", "qualityAssistance.routes.js")]
};
