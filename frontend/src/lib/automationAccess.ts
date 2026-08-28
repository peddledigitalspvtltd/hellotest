import type { FeatureFlagSnapshot, SessionPayload } from "../types";
import { areFeatureFlagsEnabled } from "./featureFlags";
import { hasPermission } from "./permissions";

export const AUTOMATION_CODE_FEATURE_FLAGS = [
  "hellotest.automation.workspace",
  "hellotest.automation.step_code"
] as const;

export const AUTOMATION_BUILD_FEATURE_FLAGS = [
  "hellotest.automation.workspace",
  "hellotest.automation.builder",
  "hellotest.automation.step_code"
] as const;

export const AUTOMATION_PREVIEW_FEATURE_FLAGS = [
  "hellotest.automation.workspace",
  "hellotest.automation.preview",
  "hellotest.automation.step_code"
] as const;

export const AUTOMATION_AI_FEATURE_FLAGS = [
  "hellotest.automation.workspace",
  "hellotest.ai.automation"
] as const;

export const AUTOMATION_RECORDER_FEATURE_FLAGS = [
  "hellotest.automation.workspace",
  "hellotest.automation.step_recording"
] as const;

export function canViewAutomationCode(
  session: SessionPayload | null,
  featureFlags: FeatureFlagSnapshot | null | undefined,
  projectId?: string | null
) {
  return hasPermission(session, "automation.code.view", projectId)
    && areFeatureFlagsEnabled(featureFlags, AUTOMATION_CODE_FEATURE_FLAGS);
}

export function canEditAutomationCode(
  session: SessionPayload | null,
  featureFlags: FeatureFlagSnapshot | null | undefined,
  projectId?: string | null
) {
  return canViewAutomationCode(session, featureFlags, projectId)
    && hasPermission(session, "automation.build", projectId)
    && areFeatureFlagsEnabled(featureFlags, AUTOMATION_BUILD_FEATURE_FLAGS);
}

export function canPreviewAutomationCode(
  session: SessionPayload | null,
  featureFlags: FeatureFlagSnapshot | null | undefined,
  projectId?: string | null
) {
  return canViewAutomationCode(session, featureFlags, projectId)
    && hasPermission(session, "automation.preview", projectId)
    && areFeatureFlagsEnabled(featureFlags, AUTOMATION_PREVIEW_FEATURE_FLAGS);
}

export function canGenerateAutomationCode(
  session: SessionPayload | null,
  featureFlags: FeatureFlagSnapshot | null | undefined,
  projectId?: string | null
) {
  return canEditAutomationCode(session, featureFlags, projectId)
    && hasPermission(session, "automation.ai", projectId)
    && areFeatureFlagsEnabled(featureFlags, AUTOMATION_AI_FEATURE_FLAGS);
}

export function canRecordAutomationCode(
  session: SessionPayload | null,
  featureFlags: FeatureFlagSnapshot | null | undefined,
  projectId?: string | null
) {
  return canEditAutomationCode(session, featureFlags, projectId)
    && hasPermission(session, "automation.recorder", projectId)
    && areFeatureFlagsEnabled(featureFlags, AUTOMATION_RECORDER_FEATURE_FLAGS);
}
