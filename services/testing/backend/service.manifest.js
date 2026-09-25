const { defineRoute } = require("@hellotest/platform/backend/src/routes/routeDefinition");
module.exports = {
  id: "testing",
  routes: [
    defineRoute("testing", "ops", "issues.routes.js"),
    defineRoute("testing", "ops", "testCaseDefects.routes.js"),
    defineRoute("testing", "design", "testCaseModules.routes.js"),
    defineRoute("testing", "design", "testSuites.routes.js"),
    defineRoute("testing", "design", "suiteTestCases.routes.js"),
    defineRoute("testing", "design", "testCases.routes.js"),
    defineRoute("testing", "design", "testSteps.routes.js"),
    defineRoute("testing", "design", "sharedStepGroups.routes.js"),
    defineRoute("testing", "environment", "testEnvironments.routes.js"),
    defineRoute("testing", "environment", "testConfigurations.routes.js"),
    defineRoute("testing", "environment", "testDataSets.routes.js"),
    defineRoute("testing", "execution", "executions.routes.js"),
    defineRoute("testing", "execution", "executionSchedules.routes.js"),
    defineRoute("testing", "execution", "executionResults.routes.js")
  ]
};
