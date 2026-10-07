import { WORKSPACE_CAPABILITIES } from "./workspaceCapabilities";

const RECENT_LIMIT = 6;
const knownIds = new Set(WORKSPACE_CAPABILITIES.map(item => item.id));

export function recentCapabilityKey(userId?: string, projectId?: string) {
  return `hellotest.workspace.recent.v1:${encodeURIComponent(userId || "guest")}:${encodeURIComponent(projectId || "workspace")}`;
}

/** Save identifiers only; current permissions and policy are checked when displaying them. */
export function normalizeRecentCapabilities(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id): id is string => typeof id === "string" && knownIds.has(id)))].slice(0, RECENT_LIMIT);
}

export function readRecentCapabilities(key: string): string[] {
  try {
    return normalizeRecentCapabilities(JSON.parse(localStorage.getItem(key) || "null"));
  } catch {
    return [];
  }
}

export function recordRecentCapability(key: string, id: string) {
  if (!knownIds.has(id)) return;
  try {
    localStorage.setItem(key, JSON.stringify(normalizeRecentCapabilities([id, ...readRecentCapabilities(key)])));
  } catch {
    // Discovery remains available when browser storage is disabled or full.
  }
}

export function capabilityForDestination(pathname: string, search: string) {
  const params = new URLSearchParams(search);
  const view = params.get("view") || (pathname === "/agentic-workflows" ? params.get("surface") : null);
  return WORKSPACE_CAPABILITIES.find(item => {
    const [path, params] = item.to.split("?");
    if (path !== pathname) return false;
    const itemView = new URLSearchParams(params).get("view");
    return itemView === view || (!view && (item.id === "analytics" || item.id === "quality-agents" || item.id === "runs")) || !itemView;
  });
}
