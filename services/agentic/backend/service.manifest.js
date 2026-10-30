const { defineRoute } = require("@hellotest/platform/backend/src/routes/routeDefinition");

module.exports = {
  id: "agentic",
  routes: [
    defineRoute("agentic", "agentic", "agenticWorkflows.routes.js"),
    defineRoute("agentic", "agentic", "workflowModelCalls.routes.js"),
    defineRoute("agentic", "agentic", "repositoryAgents.routes.js"),
    defineRoute("agentic", "agentic", "repositoryInspection.routes.js"),
    defineRoute("agentic", "agentic", "qualityAgents.routes.js")
  ]
};
