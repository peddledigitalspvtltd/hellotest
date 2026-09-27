const text = (value) => String(value || "").trim();

export function resolveMobilePlatform(input = {}) {
  const config = input.config || {};
  const explicit = text(input.platform_name || input.platform || config.platform_name || config.platformName || config.mobile_os).toLowerCase();
  const platforms = new Set((input.steps || []).map((step) => step.step_type).filter((type) => type === "android" || type === "ios"));
  if (platforms.size > 1) throw new Error("Android and iOS require separate device sessions.");
  if (explicit && !["android", "ios"].includes(explicit)) throw new Error(`Unsupported mobile platform: ${explicit}`);
  const authored = [...platforms][0];
  if (explicit && authored && explicit !== authored) throw new Error(`The ${authored} plan does not match the ${explicit} device configuration.`);
  return authored || explicit || "android";
}

export function buildCapabilities(input = {}) {
  const platform = resolveMobilePlatform(input);
  const ios = platform === "ios";
  const config = input.config && typeof input.config === "object" ? input.config : {};
  const provider = text(input.provider || process.env.MOBILE_PROVIDER || "local-appium").toLowerCase();
  const prefix = ios ? "IOS" : "ANDROID";
  const deviceName = text(input.device_name || config.device_name || process.env[`${prefix}_DEVICE_NAME`] || (ios ? "iPhone" : "Android Device"));
  const version = text(input.platform_version || config.platform_version || process.env[`${prefix}_PLATFORM_VERSION`]);
  const app = text(input.app || config[`${platform}_app`] || config.app || process.env[`${prefix}_APP`]);
  const udid = text(input.udid || config.udid || process.env[`${prefix}_UDID`]);
  const bundleId = text(config.bundle_id || config.ios_bundle_id || process.env.IOS_BUNDLE_ID);
  const appiumServerUrl = text(input.remote_url || config.remote_url || (provider !== "local-appium" && process.env.MOBILE_REMOTE_URL)
    || input.appium_server_url || config.appium_server_url || process.env.APPIUM_SERVER_URL || "http://host.docker.internal:4723");
  return {
    provider, appiumServerUrl,
    capabilities: {
      ...(config.provider_options && typeof config.provider_options === "object" ? config.provider_options : {}),
      // Provider extensions cannot silently change the authored platform/runtime.
      platformName: ios ? "iOS" : "Android",
      "appium:automationName": ios ? "XCUITest" : "UiAutomator2",
      "appium:deviceName": deviceName,
      ...(version ? { "appium:platformVersion": version } : {}),
      ...(app ? { "appium:app": app } : {}),
      ...(udid ? { "appium:udid": udid } : {}),
      ...(ios && bundleId ? { "appium:bundleId": bundleId } : {}),
      ...(!ios && config.app_package ? { "appium:appPackage": config.app_package } : {}),
      ...(!ios && config.app_activity ? { "appium:appActivity": config.app_activity } : {}),
      "appium:noReset": config.no_reset === undefined ? true : config.no_reset === true || config.no_reset === "true"
    }
  };
}
