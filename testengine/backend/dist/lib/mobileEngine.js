import { buildInitialContext, toParameterValuesRecord } from "./runtimeContext.js";
import { buildMobileEngineRequestHeaders, resolveMobileEngineClientSecurity } from "./mobileEngineSecurity.js";
const appendPath = (base, path) => `${base}${path.startsWith("/") ? path : `/${path}`}`;
export function isMobileEngineConfigured() {
    return resolveMobileEngineClientSecurity().ready;
}
export function getMobileEngineConfigurationError() {
    const configuration = resolveMobileEngineClientSecurity();
    return configuration.ready ? null : configuration.reason;
}
export async function executeAndroidSteps(envelope, steps, capturedValues = {}) {
    const configuration = resolveMobileEngineClientSecurity();
    if (!configuration.ready || !configuration.baseUrl) {
        throw new Error(configuration.reason || "Mobile Engine is not configured for Android execution.");
    }
    const response = await fetch(appendPath(configuration.baseUrl, "/api/v1/mobile/execute"), {
        method: "POST",
        headers: {
            "content-type": "application/json",
            ...buildMobileEngineRequestHeaders(configuration)
        },
        body: JSON.stringify({
            provider: envelope.mobile_engine?.active || "local-appium",
            appium_server_url: envelope.mobile_engine?.appium_server_url || undefined,
            device_name: envelope.mobile_engine?.device_name || undefined,
            platform_version: envelope.mobile_engine?.platform_version || undefined,
            app: envelope.mobile_engine?.app || undefined,
            config: envelope.mobile_engine || {},
            object_repository: envelope.object_repository || [],
            parameter_values: toParameterValuesRecord(buildInitialContext(envelope, capturedValues)),
            steps
        })
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
        throw new Error(payload && "message" in payload ? String(payload.message || "") : `Mobile Engine returned ${response.status}`);
    }
    return payload || { status: "blocked", results: [] };
}
