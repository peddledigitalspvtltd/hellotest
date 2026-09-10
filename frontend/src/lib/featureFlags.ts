import type { FeatureFlagSnapshot } from "../types";
import { normalizeAccessPath } from "./permissions";

const PATH_FEATURE_FLAGS: Record<string, string[]> = {
  "/": ["hellotest.analytics.dashboards"],
  "/projects": ["hellotest.ops.projects"],
  "/requirements": ["hellotest.manual.requirements"],
  "/backlog": ["hellotest.manual.requirements"],
  "/stories": ["hellotest.manual.requirements"],
  "/sprints": ["hellotest.manual.requirements"],
  "/releases": ["hellotest.manual.requirements"],
  "/test-cases": ["hellotest.manual.test_cases"],
  "/shared-steps": ["hellotest.manual.suites"],
  "/design": ["hellotest.manual.suites"],
  "/test-plans": ["hellotest.manual.plans"],
  "/quality-gates": ["hellotest.manual.quality_gates"],
  "/automation": ["hellotest.automation.workspace"],
  "/local-playwright": ["hellotest.automation.workspace"],
  "/automation-assets": ["hellotest.automation.workspace", "hellotest.automation.assets"],
  "/object-repository": ["hellotest.automation.workspace", "hellotest.automation.object_repository"],
  "/agentic-workflows": ["hellotest.ai.agentic_workflows"],
  "/executions": ["hellotest.manual.runs"],
  "/testops": ["hellotest.automation.batch_process", "hellotest.ops.background_jobs"],
  "/ops-telemetry": ["hellotest.ops.telemetry"],
  "/traces": ["hellotest.ops.telemetry"],
  "/knowledge-repo": ["hellotest.ai.knowledge"],
  "/issues": ["hellotest.manual.bugs"],
  "/feedback": ["hellotest.manual.bugs"],
  "/settings": ["hellotest.ops.settings"],
  "/admin-space": [],
  "/people": ["hellotest.ops.admin"],
  "/integrations": ["hellotest.api.integrations"],
  "/notifications": ["hellotest.ops.notifications"],
  "/test-environments": ["hellotest.manual.environments"],
  "/test-configurations": ["hellotest.manual.environments"],
  "/test-data": ["hellotest.manual.test_data"],
  "/ai/quality-insights": ["hellotest.ai.quality_insights"]
};

export function requiredFeatureFlagsForPath(pathname: string) {
  return PATH_FEATURE_FLAGS[normalizeAccessPath(pathname)] || [];
}

export function areFeatureFlagsEnabled(snapshot: FeatureFlagSnapshot | null | undefined, keys: readonly string[]) {
  if (!keys.length) {
    return true;
  }

  // Protected capabilities fail closed while the snapshot is loading or
  // unavailable. This prevents a disabled control from flashing into view.
  if (!snapshot?.flags || typeof snapshot.flags !== "object" || Array.isArray(snapshot.flags)) {
    return false;
  }

  return keys.every((key) => snapshot.flags[key] === true);
}

/** Send only deliberate edits, so another administrator's unrelated edits survive. */
export function createFeatureFlagPatch(current: Record<string, boolean>, draft: Record<string, boolean>) {
  return Object.fromEntries(Object.entries(draft).filter(([key, value]) =>
    Object.prototype.hasOwnProperty.call(current, key) && typeof value === "boolean" && current[key] !== value
  ));
}

export function effectiveFeatureFlags(localFlags: Record<string, boolean>, dependencies: Record<string, string[]> = {}) {
  return Object.fromEntries(Object.entries(localFlags).map(([key, enabled]) => [key,
    enabled === true && (dependencies[key] || []).every((dependency) => localFlags[dependency] === true)
  ]));
}
