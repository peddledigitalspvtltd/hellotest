const { defineRoute } = require("@hellotest/platform/backend/src/routes/routeDefinition");

module.exports = {
  id: "automation",
  routes: [
    defineRoute("automation", "engine", "testEngineCallbacks.routes.js"),
    defineRoute("automation", "engine", "testEngineInternal.routes.js"),
    defineRoute("automation", "engine", "engine.routes.js"),
    defineRoute("automation", "automation", "automationGenerator.routes.js"),
    defineRoute("automation", "automation", "localAgent.routes.js"),
    defineRoute("automation", "automation", "pairedBrowserBridge.routes.js")
  ]
};
