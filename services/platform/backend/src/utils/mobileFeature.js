const { configurationTargetsUseMobile } = require("./configurationTargets");

const MOBILE_FEATURE_KEY = "hellotest.mobile.appium";

const MOBILE_STEP_TYPES = new Set(["android", "ios"]);
const MOBILE_APP_TYPE_VALUES = new Set(["android", "ios"]);
const MOBILE_INTEGRATION_CONFIG_KEYS = new Set([
  "android_app",
  "appium_server_url",
  "max_android_workers",
  "mobile_access_key",
  "mobile_cloud_provider",
  "mobile_engine_url",
  "mobile_remote_url",
  "mobile_username"
]);

const normalizeToken = (value) => String(value || "").trim().toLowerCase();

const containsMobileToken = (value) => {
  if (typeof value !== "string") return false;
  return value
    .split(/[\s,|/]+/)
    .map(normalizeToken)
    .some((token) => MOBILE_STEP_TYPES.has(token));
};

const isMobileStepType = (value) => containsMobileToken(value);

const isMobileAppType = (value) => MOBILE_APP_TYPE_VALUES.has(normalizeToken(value));

const isMobileRecorderTarget = (value) => {
  const target = normalizeToken(value);
  return target === "mobile" || MOBILE_APP_TYPE_VALUES.has(target) || target === "appium";
};

const hasMobileOperatingSystem = (value) => {
  if (value === null || value === undefined) return false;
  return Boolean(String(value).trim());
};

const containsMobileStepPayload = (value, visited = new Set()) => {
  if (!value || typeof value !== "object") return false;
  if (visited.has(value)) return false;
  visited.add(value);

  if (Array.isArray(value)) {
    return value.some((entry) => containsMobileStepPayload(entry, visited));
  }

  for (const [key, entry] of Object.entries(value)) {
    if ((key === "step_type" || key === "stepType") && isMobileStepType(entry)) {
      return true;
    }

    if (entry && typeof entry === "object" && containsMobileStepPayload(entry, visited)) {
      return true;
    }
  }

  return false;
};

const containsMobileIntegrationConfig = (input = {}) => {
  const type = normalizeToken(input?.type);
  const config = input?.config && typeof input.config === "object" && !Array.isArray(input.config)
    ? input.config
    : input;

  if (!config || typeof config !== "object" || Array.isArray(config)) return false;

  if ([...MOBILE_INTEGRATION_CONFIG_KEYS].some((key) => Object.prototype.hasOwnProperty.call(config, key))) {
    return true;
  }

  if (containsMobileToken(config.execution_scope) || isMobileAppType(config.platform_name || config.platform)) {
    return true;
  }

  return type === "cloudrun"
    && (Object.prototype.hasOwnProperty.call(config, "device_name")
      || Object.prototype.hasOwnProperty.call(config, "platform_version"));
};

const executionShapeUsesMobile = (input = {}) => {
  if (!input || typeof input !== "object") return false;

  const configuration = input.test_configuration?.snapshot
    || input.test_configuration_snapshot
    || input.configuration
    || null;

  return isMobileAppType(input.app_type_kind || input.app_type_type || input.app_type?.type)
    || hasMobileOperatingSystem(input.mobile_os)
    || hasMobileOperatingSystem(configuration?.mobile_os)
    || configurationTargetsUseMobile(configuration?.targets)
    || containsMobileStepPayload(input.step_snapshots || input.steps || input.case_snapshots || []);
};

module.exports = {
  MOBILE_FEATURE_KEY,
  containsMobileIntegrationConfig,
  containsMobileStepPayload,
  executionShapeUsesMobile,
  hasMobileOperatingSystem,
  isMobileAppType,
  isMobileRecorderTarget,
  isMobileStepType
};
