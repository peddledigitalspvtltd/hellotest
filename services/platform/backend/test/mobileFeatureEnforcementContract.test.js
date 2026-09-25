const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");
const {
  MOBILE_FEATURE_KEY,
  containsMobileIntegrationConfig,
  containsMobileStepPayload,
  executionShapeUsesMobile,
  isMobileAppType,
  isMobileRecorderTarget
} = require("../src/utils/mobileFeature");

const readSource = (relativePath) => readFile(path.join(__dirname, relativePath), "utf8");

test("pure mobile detectors recognize nested authoring payloads without matching prose", () => {
  assert.equal(MOBILE_FEATURE_KEY, "hellotest.mobile.appium");
  assert.equal(containsMobileStepPayload({ steps: [{ step_type: "android" }] }), true);
  assert.equal(containsMobileStepPayload({ batches: [{ rows: [{ steps: [{ stepType: "iOS" }] }] }] }), true);
  assert.equal(containsMobileStepPayload({ action: "Verify the Android download page", step_type: "web" }), false);
  assert.equal(isMobileAppType("ANDROID"), true);
  assert.equal(isMobileAppType("unified"), false);
  assert.equal(isMobileRecorderTarget("appium"), true);
  assert.equal(isMobileRecorderTarget("web"), false);
});

test("pure integration and execution detectors cover Appium configuration and snapshots", () => {
  assert.equal(containsMobileIntegrationConfig({ type: "testengine", config: { mobile_engine_url: null } }), true);
  assert.equal(containsMobileIntegrationConfig({ type: "testengine", config: { browser: "chromium" } }), false);
  assert.equal(containsMobileIntegrationConfig({ type: "cloudrun", config: { device_name: "Pixel 9" } }), true);
  assert.equal(executionShapeUsesMobile({ app_type: { type: "ios" } }), true);
  assert.equal(executionShapeUsesMobile({ test_configuration: { snapshot: { mobile_os: "Android" } } }), true);
  assert.equal(executionShapeUsesMobile({ step_snapshots: [{ step_type: "android" }] }), true);
  assert.equal(executionShapeUsesMobile({ step_snapshots: [{ step_type: "api" }] }), false);
});

test("mobile authoring and recorder routes require target-project mobile management", async () => {
  const [steps, cases, groups, configurations, integrations] = await Promise.all([
    readSource("../../../testing/backend/routes/testSteps.routes.js"),
    readSource("../../../testing/backend/routes/testCases.routes.js"),
    readSource("../../../testing/backend/routes/sharedStepGroups.routes.js"),
    readSource("../../../testing/backend/routes/testConfigurations.routes.js"),
    readSource("../../../integration/backend/routes/integrations.routes.js")
  ]);

  assert.match(steps, /requirePermission\("mobile\.manage", \{ projectId: scope\.projectId \}\)/);
  assert.match(cases, /requireMobileAuthoringPermission/);
  assert.match(cases, /isMobileRecorderTarget\(recorderTarget\)/);
  assert.match(groups, /requireMobileGroupWrite/);
  assert.match(configurations, /"mobile\.view"/);
  assert.match(configurations, /"mobile\.manage"/);
  assert.match(integrations, /requireMobileIntegrationWrite/);
  assert.match(integrations, /requirePermission\("mobile\.manage", projectId \? \{ projectId \} : \{\}\)/);
});

test("execution routes and background services enforce the retained mobile feature", async () => {
  const [executionRoutes, scheduleRoutes, executionService, scheduleService, mobileService] = await Promise.all([
    readSource("../../../testing/backend/routes/executions.routes.js"),
    readSource("../../../testing/backend/routes/executionSchedules.routes.js"),
    readSource("../../../testing/backend/services/execution.service.js"),
    readSource("../../../testing/backend/services/executionSchedule.service.js"),
    readSource("../services/mobileFeature.service.js")
  ]);

  assert.match(executionRoutes, /requireMobileExecutionPermission/);
  assert.match(scheduleRoutes, /requireMobileSchedulePermission/);
  assert.match(executionService, /assertExecutionMobileFeatureEnabled/);
  assert.match(scheduleService, /assertExecutionMobileFeatureEnabled/);
  assert.match(mobileService, /featureFlagService\.isEnabled\(MOBILE_FEATURE_KEY\)/);
  assert.match(mobileService, /error\.statusCode = 403/);
});

test("iOS authoring is dispatched through the shared Appium mobile engine", async () => {
  const dispatchService = await readSource("../../../automation/backend/services/testEngineDispatch.service.js");

  assert.match(dispatchService, /if \(normalized === "ios"\) \{\s*return "android";/);
  assert.match(dispatchService, /stepTypes\.has\("android"\) \|\| stepTypes\.has\("ios"\)/);
  assert.match(dispatchService, /appTypeKind === "ios"/);
  assert.match(dispatchService, /integrationConfig\.ios_app/);
});

test("service-level authoring guards protect accepted and background-imported cases", async () => {
  const [testCaseService, testStepService, sharedGroupService, recorderService] = await Promise.all([
    readSource("../../../testing/backend/services/testCase.service.js"),
    readSource("../../../testing/backend/services/testStep.service.js"),
    readSource("../../../testing/backend/services/sharedStepGroup.service.js"),
    readSource("../../../automation/backend/services/aiAutomationBuilder.service.js")
  ]);

  assert.match(testCaseService, /assertAuthoringMobileFeatureEnabled/);
  assert.match(testStepService, /assertMobileStepMutationEnabled/);
  assert.match(sharedGroupService, /assertAuthoringMobileFeatureEnabled/);
  assert.match(recorderService, /assertMobileFeatureEnabled/);
});
