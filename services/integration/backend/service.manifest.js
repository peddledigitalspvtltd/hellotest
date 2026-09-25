const { defineRoute } = require("@hellotest/platform/backend/src/routes/routeDefinition");

module.exports = {
  id: "integration",
  routes: [defineRoute("integration", "connect", "aiPromptTemplates.routes.js"), defineRoute("integration", "connect", "projectSync.routes.js"), defineRoute("integration", "connect", "integrations.routes.js")]
};
