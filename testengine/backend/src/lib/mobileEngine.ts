import type { EngineRunEnvelope, EngineRunStep } from "../contracts/hellotest.js";
import { buildInitialContext, toParameterValuesRecord } from "./runtimeContext.js";
import {
  buildMobileEngineRequestHeaders,
  resolveMobileEngineClientSecurity
} from "./mobileEngineSecurity.js";

type MobileExecutionResult = {
  status: "passed" | "failed" | "blocked";
  results: Array<{
    step_id: string;
    status: "passed" | "failed" | "blocked";
    note?: string;
    captures?: Record<string, string>;
  }>;
};

const appendPath = (base: string, path: string) => `${base}${path.startsWith("/") ? path : `/${path}`}`;

export function isMobileEngineConfigured() {
  return resolveMobileEngineClientSecurity().ready;
}

export function getMobileEngineConfigurationError() {
  const configuration = resolveMobileEngineClientSecurity();
  return configuration.ready ? null : configuration.reason;
}

export async function executeAndroidSteps(
  envelope: EngineRunEnvelope,
  steps: EngineRunStep[],
  capturedValues: Record<string, string> = {}
) {
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

  const payload = await response.json().catch(() => null) as MobileExecutionResult | null;

  if (!response.ok) {
    throw new Error(payload && "message" in payload ? String((payload as { message?: unknown }).message || "") : `Mobile Engine returned ${response.status}`);
  }

  return payload || { status: "blocked" as const, results: [] };
}
