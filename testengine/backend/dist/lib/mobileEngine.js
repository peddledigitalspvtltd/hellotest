const MOBILE_ENGINE_URL = String(process.env.MOBILE_ENGINE_URL || "").trim().replace(/\/+$/, "");
const appendPath = (base, path) => `${base}${path.startsWith("/") ? path : `/${path}`}`;
export function isMobileEngineConfigured() {
    return Boolean(MOBILE_ENGINE_URL);
}
export async function executeAndroidSteps(envelope, steps) {
    if (!MOBILE_ENGINE_URL) {
        throw new Error("MOBILE_ENGINE_URL is not configured for Android execution.");
    }
    const response = await fetch(appendPath(MOBILE_ENGINE_URL, "/api/v1/mobile/execute"), {
        method: "POST",
        headers: {
            "content-type": "application/json"
        },
        body: JSON.stringify({
            provider: envelope.mobile_engine?.active || "local-appium",
            appium_server_url: envelope.mobile_engine?.appium_server_url || undefined,
            device_name: envelope.mobile_engine?.device_name || undefined,
            platform_version: envelope.mobile_engine?.platform_version || undefined,
            app: envelope.mobile_engine?.app || undefined,
            config: envelope.mobile_engine || {},
            steps
        })
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
        throw new Error(payload && "message" in payload ? String(payload.message || "") : `Mobile Engine returned ${response.status}`);
    }
    return payload || { status: "blocked", results: [] };
}
