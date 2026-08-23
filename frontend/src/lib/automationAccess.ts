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
  featureFlags: FeatureFlagSnapshot | null | undefined
) {
  return hasPermission(session, "automation.code.view")
    && areFeatureFlagsEnabled(featureFlags, AUTOMATION_CODE_FEATURE_FLAGS);
}

export function canEditAutomationCode(
  session: SessionPayload | null,
  featureFlags: FeatureFlagSnapshot | null | undefined
) {
  return canViewAutomationCode(session, featureFlags)
    && hasPermission(session, "automation.build")
    && areFeatureFlagsEnabled(featureFlags, AUTOMATION_BUILD_FEATURE_FLAGS);
}

export function canPreviewAutomationCode(
  session: SessionPayload | null,
  featureFlags: FeatureFlagSnapshot | null | undefined
) {
  return canViewAutomationCode(session, featureFlags)
    && hasPermission(session, "automation.preview")
    && areFeatureFlagsEnabled(featureFlags, AUTOMATION_PREVIEW_FEATURE_FLAGS);
}

export function canGenerateAutomationCode(
  session: SessionPayload | null,
  featureFlags: FeatureFlagSnapshot | null | undefined
) {
  return canEditAutomationCode(session, featureFlags)
    && hasPermission(session, "automation.ai")
    && areFeatureFlagsEnabled(featureFlags, AUTOMATION_AI_FEATURE_FLAGS);
}

export function canRecordAutomationCode(
  session: SessionPayload | null,
  featureFlags: FeatureFlagSnapshot | null | undefined
) {
  return canEditAutomationCode(session, featureFlags)
    && hasPermission(session, "automation.recorder")
    && areFeatureFlagsEnabled(featureFlags, AUTOMATION_RECORDER_FEATURE_FLAGS);
}
