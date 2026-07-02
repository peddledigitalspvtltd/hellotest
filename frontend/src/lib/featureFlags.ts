import type { FeatureFlagSnapshot } from "../types";

const PATH_FEATURE_FLAGS: Record<string, string[]> = {
  "/requirements": ["qaira.manual.requirements"],
  "/test-cases": ["qaira.manual.test_cases"],
  "/shared-steps": ["qaira.manual.suites"],
  "/design": ["qaira.manual.suites"],
  "/automation": ["qaira.automation.workspace"],
  "/object-repository": ["qaira.automation.object_repository"],
  "/agentic-workflows": ["qaira.ai.agentic_workflows"],
  "/executions": ["qaira.manual.runs"],
  "/testops": ["qaira.automation.batch_process"],
  "/ops-telemetry": ["qaira.ops.telemetry"],
  "/traces": ["qaira.ops.telemetry"],
  "/knowledge-repo": ["qaira.ai.knowledge"],
  "/settings": [],
  "/admin-space": [],
  "/people": ["qaira.ops.admin"],
  "/integrations": ["qaira.api.integrations"],
  "/notifications": ["qaira.ops.notifications"],
  "/test-environments": [],
  "/test-configurations": [],
  "/test-data": []
};

export function requiredFeatureFlagsForPath(pathname: string) {
  return PATH_FEATURE_FLAGS[pathname] || [];
}

export function areFeatureFlagsEnabled(snapshot: FeatureFlagSnapshot | null | undefined, keys: readonly string[]) {
  if (!keys.length || !snapshot) {
    return true;
  }

  return keys.every((key) => snapshot.flags[key] !== false);
}
