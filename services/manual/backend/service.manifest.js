const { defineRoute } = require("@hellotest/platform/backend/src/routes/routeDefinition");
module.exports = {
  id: "manual",
  routes: [
    defineRoute("manual", "design", "requirements.routes.js"),
    defineRoute("manual", "design", "requirementIterations.routes.js"),
    defineRoute("manual", "design", "requirementReleases.routes.js"),
    defineRoute("manual", "design", "requirementTestCases.routes.js"),
    defineRoute("manual", "ops", "requirementDefects.routes.js")
  ]
};
