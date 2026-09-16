import type { AppType, WorkspaceProjectScope } from "../types";

export type WorkspaceScopeSelection = { projectId: string; appTypeId?: string };

export function availableWorkspaceProjects<T extends WorkspaceProjectScope>(projects: readonly T[]) {
  const ids = new Set<string>();
  return projects.filter((project) => {
    const id = String(project.id || "");
    if (!id || project.has_access === false || ids.has(id)) return false;
    ids.add(id);
    return true;
  });
}

// Defend the visible child scope even when a cache was primed by another caller.
// Loading/refetching a catalog must never select or clear a remembered value.
export function applicationsForWorkspace(projectId: string, data: unknown): AppType[] {
  if (!projectId || !Array.isArray(data)) return [];
  const ids = new Set<string>();
  return data.filter((app): app is AppType => {
    if (!app || typeof app !== "object" || String(app.project_id) !== projectId || !app.id || ids.has(String(app.id))) return false;
    ids.add(String(app.id));
    return true;
  });
}

export function filterWorkspaceOptions<T extends { name: string }>(options: readonly T[], search: string): T[] {
  const normalize = (text: string) => text.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase();
  const term = normalize(search.trim());
  return term ? options.filter((option) => normalize(option.name || "").includes(term)) : [...options];
}

export function workspaceMenuPosition(
  anchor: { left: number; right: number; top: number; bottom: number; width: number },
  viewport: { width: number; height: number; left?: number; top?: number },
  collapsed: boolean
) {
  const gap = 8;
  const edgeLeft = (viewport.left || 0) + gap;
  const edgeTop = (viewport.top || 0) + gap;
  const edgeRight = (viewport.left || 0) + viewport.width - gap;
  const edgeBottom = (viewport.top || 0) + viewport.height - gap;
  const width = Math.min(Math.max(anchor.width, 320), Math.max(0, viewport.width - gap * 2));
  const maxHeight = Math.min(424, Math.max(0, viewport.height - gap * 2));
  const preferredLeft = collapsed ? anchor.right + gap : anchor.left;
  const left = Math.max(edgeLeft, Math.min(preferredLeft, edgeRight - width));
  const below = edgeBottom - anchor.bottom - gap;
  const above = anchor.top - gap - edgeTop;
  const openAbove = !collapsed && below < Math.min(240, maxHeight) && above > below;
  const availableHeight = collapsed ? maxHeight : Math.max(0, openAbove ? above : below);
  const height = Math.min(maxHeight, availableHeight);
  const preferredTop = collapsed ? anchor.top : openAbove ? anchor.top - gap - height : anchor.bottom + gap;
  return { left, top: Math.max(edgeTop, Math.min(preferredTop, edgeBottom - height)), width, maxHeight: height };
}
