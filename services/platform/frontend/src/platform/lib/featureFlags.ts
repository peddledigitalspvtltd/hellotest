import type { FeatureFlagSnapshot } from "../../types";
import { normalizeAccessPath } from "./permissions";
import generatedPolicy from "./featurePolicy.generated.json";

// Compatibility for a flags-only snapshot during a rolling update. The server
// snapshot is authoritative; tests verify this generated fallback stays aligned.
const KNOWN_FEATURE_KEYS = new Set<string>(generatedPolicy.feature_keys);
const FALLBACK_PERMISSION_FEATURES: Record<string, readonly string[]> = generatedPolicy.permission_features;
const FALLBACK_DEPENDENCIES: Record<string, readonly string[]> = generatedPolicy.dependencies;
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value)
  && typeof value === "object" && !Array.isArray(value);

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
  "/mcp-servers": ["hellotest.ai.agentic_workflows"],
  "/agentic-workflows": ["hellotest.ai.agentic_workflows"],
  "/executions": ["hellotest.manual.runs"],
  "/testops": ["hellotest.ops.background_jobs"],
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
  if (!Array.isArray(keys)) return false;
  if (!keys.length) {
    return true;
  }

  // Protected capabilities fail closed while the snapshot is loading or
  // unavailable. This prevents a disabled control from flashing into view.
  if (!snapshot?.flags || typeof snapshot.flags !== "object" || Array.isArray(snapshot.flags)) {
    return false;
  }

  const dependencies = snapshot.dependencies === undefined ? FALLBACK_DEPENDENCIES : snapshot.dependencies;
  if (!isRecord(dependencies)) return false;
  const knownKeys = new Set(KNOWN_FEATURE_KEYS);
  if (Array.isArray(snapshot.groups)) snapshot.groups.forEach(group => {
    if (Array.isArray(group.features)) group.features.forEach(feature => {
      if (typeof feature.key === "string") knownKeys.add(feature.key);
    });
  });
  const resolved = new Map<string, boolean>(), visiting = new Set<string>();
  const available = (key: string): boolean => {
    if (typeof key !== "string" || !knownKeys.has(key) || snapshot.flags[key] !== true) return false;
    if (snapshot.local_flags && Object.prototype.hasOwnProperty.call(snapshot.local_flags, key) && snapshot.local_flags[key] !== true) return false;
    if (resolved.has(key)) return resolved.get(key)!;
    if (visiting.has(key)) return false;
    const parents = Object.prototype.hasOwnProperty.call(dependencies, key) ? dependencies[key] : [];
    if (!Array.isArray(parents)) return false;
    visiting.add(key);
    const enabled = parents.every(parent => typeof parent === "string" && available(parent));
    visiting.delete(key);
    resolved.set(key, enabled);
    return enabled;
  };
  return keys.every(available);
}

export function requiredFeatureFlagsForPermission(snapshot: FeatureFlagSnapshot | null | undefined, permissionCode: string): readonly string[] | null {
  const mapping = snapshot?.permission_features === undefined ? FALLBACK_PERMISSION_FEATURES : snapshot.permission_features;
  if (!isRecord(mapping) || !Object.prototype.hasOwnProperty.call(mapping, permissionCode)) return null;
  const keys = mapping[permissionCode];
  return Array.isArray(keys) && keys.every(key => typeof key === "string") ? keys : null;
}

/** Feature availability is an additional boundary; callers still check the role. */
export function arePermissionFeaturesEnabled(snapshot: FeatureFlagSnapshot | null | undefined, permissionCode: string) {
  if (!isRecord(snapshot?.flags)) return false;
  const keys = requiredFeatureFlagsForPermission(snapshot, permissionCode);
  return keys !== null && areFeatureFlagsEnabled(snapshot, keys);
}

/** Send only deliberate edits, so another administrator's unrelated edits survive. */
export function createFeatureFlagPatch(current: Record<string, boolean>, draft: Record<string, boolean>) {
  return Object.fromEntries(Object.entries(draft).filter(([key, value]) =>
    Object.prototype.hasOwnProperty.call(current, key) && typeof value === "boolean" && current[key] !== value
  ));
}

export function effectiveFeatureFlags(localFlags: Record<string, boolean>, dependencies: Record<string, string[]> = {}) {
  const resolved = new Map<string, boolean>(), visiting = new Set<string>();
  const available = (key: string): boolean => {
    if (typeof key !== "string" || !Object.prototype.hasOwnProperty.call(localFlags, key) || localFlags[key] !== true) return false;
    if (resolved.has(key)) return resolved.get(key)!;
    if (visiting.has(key)) return false;
    const parents = Object.prototype.hasOwnProperty.call(dependencies, key) ? dependencies[key] : [];
    if (!Array.isArray(parents)) return false;
    visiting.add(key);
    const enabled = parents.every(available);
    visiting.delete(key);
    resolved.set(key, enabled);
    return enabled;
  };
  return Object.fromEntries(Object.keys(localFlags).map(key => [key, available(key)]));
}
