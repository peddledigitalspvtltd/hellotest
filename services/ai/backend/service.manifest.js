const { defineRoute } = require("@hellotest/platform/backend/src/routes/routeDefinition");

module.exports = {
  id: "ai",
  routes: [
    defineRoute("ai", "ai", "releasePolicy.routes.js"),
    defineRoute("ai", "ai", "coverageMappings.routes.js"),
    defineRoute("ai", "ai", "richText.routes.js"),
    defineRoute("ai", "ai", "artifactImpact.routes.js"),
    defineRoute("ai", "ai", "executionAnalysis.routes.js")
  ]
};
