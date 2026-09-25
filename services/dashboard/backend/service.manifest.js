const { defineRoute } = require("@hellotest/platform/backend/src/routes/routeDefinition");

module.exports = {
  id: "dashboard",
  routes: [defineRoute("dashboard", "dashboard", "qualityAnalytics.routes.js")]
};
