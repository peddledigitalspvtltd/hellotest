import type { IntegrationType } from "@hellotest/platform/frontend/src/types";

export type IntegrationConnectionInput = {
  integration_id?: string;
  type: IntegrationType;
  base_url?: string;
  api_key?: string;
  model?: string;
  username?: string;
  project_key?: string;
  config?: Record<string, unknown>;
};
export type IntegrationConnectionStatus = "passed" | "warning" | "failed";
export type IntegrationConnectionResult = {
  ok: boolean;
  type: IntegrationType;
  status: IntegrationConnectionStatus;
  summary: string;
  latency_ms: number;
  checked_at: string;
  checks: Array<{ id: string; label: string; status: IntegrationConnectionStatus; detail: string }>;
  next_step?: string;
};

const MASKED_SECRET = /^(?:\*|•|●){6,}$/;
const omitMasked = (value: unknown): unknown => {
  if (typeof value === "string" && MASKED_SECRET.test(value.trim())) return undefined;
  if (Array.isArray(value)) return value.map(omitMasked);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
    const clean = omitMasked(item);
    return clean === undefined ? [] : [[key, clean]];
  }));
  return value;
};

export function buildIntegrationConnectionInput(payload: IntegrationConnectionInput, saved?: { id: string; type: IntegrationType }, pristine = false): IntegrationConnectionInput {
  if (saved && saved.type === payload.type && pristine) return { integration_id: saved.id, type: saved.type };
  const { type, base_url, api_key, model, username, project_key, config } = payload;
  return omitMasked({ ...(saved?.type === type ? { integration_id: saved.id } : {}), type, base_url, api_key, model, username, project_key, config }) as IntegrationConnectionInput;
}

export const integrationConnectionHint: Record<IntegrationType, string> = {
  llm: "Sends a small request to the selected model; provider quota may be used.",
  email: "Checks SMTP connection and authentication. No email is sent.",
  google_auth: "Checks Google OAuth setup. End-user sign-in still requires the browser flow.",
  google_drive: "Checks Drive and configured folder access without uploading files.",
  github: "Checks account and repository access without creating commits.",
  jira: "Checks work-tracker and project access without changing work items.",
  testengine: "Checks runtime health and capabilities without starting a run.",
  "local-desktop": "Checks the desktop bridge without starting a run.",
  cloudrun: "Checks the configured cloud provider without starting a test session.",
  ops: "Checks the configured telemetry service and its available endpoints."
};
