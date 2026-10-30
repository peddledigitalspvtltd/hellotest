import { randomUUID } from "node:crypto";
import { requestEngineService } from "./engineHttpClient.js";
import type { EngineRunEnvelope, EngineRunStep } from "../contracts/hellotest.js";
import { buildInitialContext, toParameterValuesRecord } from "./runtimeContext.js";
import {
  buildMobileEngineRequestHeaders,
  resolveMobileEngineClientSecurity
} from "./mobileEngineSecurity.js";

export type MobileExecutionResult = {
  status: "passed" | "failed" | "blocked";
  results: Array<{
    step_id: string;
    status: "passed" | "failed" | "blocked";
    note?: string;
    captures?: Record<string, string>;
    duration_ms?: number;
    evidence?: { dataUrl: string; fileName: string; mimeType: string } | null;
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

export async function executeMobileSteps(
  envelope: EngineRunEnvelope,
  steps: EngineRunStep[],
  capturedValues: Record<string, string> = {},
  executionSessionKey?: string
) {
  const configuration = resolveMobileEngineClientSecurity();
  if (!configuration.ready || !configuration.baseUrl) {
    throw new Error(configuration.reason || "Mobile Engine is not configured for native execution.");
  }

  const platform = steps[0]?.step_type;
  if (!steps.length || !["android", "ios"].includes(platform) || steps.some((step) => step.step_type !== platform)) throw new Error("A mobile execution block must contain one native platform.");
  const mobileSnapshot: Partial<NonNullable<EngineRunEnvelope["mobile_engine"]>> = envelope.mobile_engine || {};
  const {platforms,...common}=mobileSnapshot;
  const target=platforms?.[platform as "android"|"ios"];
  if(platforms&&!target)throw new Error(`The ${platform} execution block has no matching frozen mobile target.`);
  if((target?.platform_name&&target.platform_name!==platform)||(!platforms&&common.platform_name&&common.platform_name!==platform))throw new Error(`The ${platform} execution block does not match its frozen mobile target.`);
  const mobileOptions={...common,...target,platform_name:platform};
  const payload = await requestEngineService<MobileExecutionResult>({
    url: appendPath(configuration.baseUrl, "/api/v1/mobile/execute"),
    service: "Mobile Engine",
    timeoutMs: Math.min(900_000, Math.max(1000, (envelope.run_timeout_seconds || 300) * 1000)),
    init: {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...buildMobileEngineRequestHeaders(configuration)
      },
      body: JSON.stringify({
        execution_session_key: executionSessionKey,
        platform_name: platform,
        artifact_policy: envelope.artifact_policy,
        provider: mobileOptions.active || "local-appium",
        appium_server_url: mobileOptions.appium_server_url || undefined,
        device_name: mobileOptions.device_name || undefined,
        platform_version: mobileOptions.platform_version || undefined,
        app: mobileOptions.app || undefined,
        config: mobileOptions,
        object_repository: envelope.object_repository || [],
        parameter_values: toParameterValuesRecord(buildInitialContext(envelope, capturedValues)),
        steps: steps.map(step => ({ ...step, parameter_values: toParameterValuesRecord(buildInitialContext(envelope, capturedValues, step)) }))
      })
    }
  });
  if (!payload || !["passed", "failed", "blocked"].includes(payload.status) || !Array.isArray(payload.results)) throw new Error("Mobile Engine returned an invalid execution result contract.");
  const expectedIds = new Set(steps.map((step) => step.id));
  const seen = new Set<string>();
  for (const result of payload.results) {
    if (!result || !expectedIds.has(result.step_id) || seen.has(result.step_id) || !["passed", "failed", "blocked"].includes(result.status)) throw new Error("Mobile Engine returned invalid or duplicate step results.");
    seen.add(result.step_id);
  }
  return payload;
}

// Compatibility export for existing engine clients.
export const executeAndroidSteps = executeMobileSteps;

/** Preserve native app state across API prerequisites, shared groups and teardown. */
export function createMobileRunSession(envelope: EngineRunEnvelope, onCleanupError: (error: unknown) => void = () => {}) {
  const keys = new Map<string, string>();
  return {
    async run(steps: EngineRunStep[], captures: Record<string, string> = {}) {
      const platform = steps[0]?.step_type;
      if (!platform) throw new Error("Mobile steps are required");
      if (!keys.has(platform)) keys.set(platform, randomUUID());
      return executeMobileSteps(envelope, steps, captures, keys.get(platform));
    },
    async close() {
      const configuration = resolveMobileEngineClientSecurity();
      if (configuration.ready && configuration.baseUrl) {
        const results = await Promise.allSettled([...keys.values()].map((key) => requestEngineService({
          url: `${configuration.baseUrl}/api/v1/mobile/execution-sessions/${key}`,
          service: "Mobile Engine session cleanup",
          timeoutMs: 10_000,
          responseType: "none",
          init: { method: "DELETE", headers: buildMobileEngineRequestHeaders(configuration) }
        })));
        for (const result of results) if (result.status === "rejected") {
          try { onCleanupError(result.reason); } catch { /* Diagnostics cannot replace execution results. */ }
        }
      }
      keys.clear();
    }
  };
}
