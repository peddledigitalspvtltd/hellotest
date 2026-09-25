const db = require("../src/db");
const featureFlagService = require("./featureFlag.service");
const {
  MOBILE_FEATURE_KEY,
  containsMobileStepPayload,
  executionShapeUsesMobile,
  hasMobileOperatingSystem,
  isMobileAppType
} = require("../src/utils/mobileFeature");
const { configurationTargetsUseMobile } = require("../src/utils/configurationTargets");

const selectAppType = db.prepare(`
  SELECT id, project_id, type
  FROM app_types
  WHERE id = ?
`);

const selectConfiguration = db.prepare(`
  SELECT id, project_id, app_type_id, mobile_os, targets
  FROM test_configurations
  WHERE id = ?
`);

const selectTestCaseMobileUsage = db.prepare(`
  SELECT
    app_types.type AS app_type_type,
    EXISTS (
      SELECT 1
      FROM test_steps
      WHERE test_steps.test_case_id = test_cases.id
        AND LOWER(COALESCE(test_steps.step_type, '')) IN ('android', 'ios')
    ) AS has_mobile_steps
  FROM test_cases
  LEFT JOIN app_types ON app_types.id = test_cases.app_type_id
  WHERE test_cases.id = ?
`);

const selectSuiteMobileUsage = db.prepare(`
  SELECT
    app_types.type AS app_type_type,
    EXISTS (
      SELECT 1
      FROM suite_test_cases
      JOIN test_steps ON test_steps.test_case_id = suite_test_cases.test_case_id
      WHERE suite_test_cases.suite_id = test_suites.id
        AND LOWER(COALESCE(test_steps.step_type, '')) IN ('android', 'ios')
    ) AS has_mobile_steps
  FROM test_suites
  JOIN app_types ON app_types.id = test_suites.app_type_id
  WHERE test_suites.id = ?
`);

const normalizeIds = (values = []) => [...new Set(
  (Array.isArray(values) ? values : [values])
    .map((value) => String(value || "").trim())
    .filter(Boolean)
)];

const createDisabledError = (message = "Mobile and Appium capabilities are disabled for the workspace.") => {
  const error = new Error(message);
  error.statusCode = 403;
  error.code = "FEATURE_DISABLED";
  error.featureKey = MOBILE_FEATURE_KEY;
  return error;
};

const assertMobileFeatureEnabled = async () => {
  if (!await featureFlagService.isEnabled(MOBILE_FEATURE_KEY)) {
    throw createDisabledError();
  }
  return true;
};

const appTypeUsesMobile = async (appTypeId) => {
  if (!appTypeId) return false;
  const appType = await selectAppType.get(appTypeId);
  return isMobileAppType(appType?.type);
};

const configurationUsesMobile = async (configurationId) => {
  if (!configurationId) return false;
  const configuration = await selectConfiguration.get(configurationId);
  if (!configuration) return false;
  return hasMobileOperatingSystem(configuration.mobile_os)
    || configurationTargetsUseMobile(configuration.targets)
    || await appTypeUsesMobile(configuration.app_type_id);
};

const testCaseUsesMobile = async (testCaseId) => {
  if (!testCaseId) return false;
  const usage = await selectTestCaseMobileUsage.get(testCaseId);
  return isMobileAppType(usage?.app_type_type) || Boolean(usage?.has_mobile_steps);
};

const suiteUsesMobile = async (suiteId) => {
  if (!suiteId) return false;
  const usage = await selectSuiteMobileUsage.get(suiteId);
  return isMobileAppType(usage?.app_type_type) || Boolean(usage?.has_mobile_steps);
};

const executionUsesMobile = async (input = {}) => {
  if (executionShapeUsesMobile(input)) return true;
  if (await appTypeUsesMobile(input.app_type_id)) return true;
  if (await configurationUsesMobile(input.test_configuration_id)) return true;

  for (const testCaseId of normalizeIds(input.test_case_ids || input.test_case_id)) {
    if (await testCaseUsesMobile(testCaseId)) return true;
  }

  for (const suiteId of normalizeIds(input.suite_ids || input.suite_id)) {
    if (await suiteUsesMobile(suiteId)) return true;
  }

  return false;
};

const assertExecutionMobileFeatureEnabled = async (input = {}) => {
  const usesMobile = await executionUsesMobile(input);
  if (usesMobile) await assertMobileFeatureEnabled();
  return usesMobile;
};

const assertAuthoringMobileFeatureEnabled = async ({ app_type_id, payload } = {}) => {
  const usesMobile = containsMobileStepPayload(payload) || await appTypeUsesMobile(app_type_id);
  if (usesMobile) await assertMobileFeatureEnabled();
  return usesMobile;
};

module.exports = {
  appTypeUsesMobile,
  assertAuthoringMobileFeatureEnabled,
  assertExecutionMobileFeatureEnabled,
  assertMobileFeatureEnabled,
  configurationUsesMobile,
  createDisabledError,
  executionUsesMobile,
  suiteUsesMobile,
  testCaseUsesMobile
};
