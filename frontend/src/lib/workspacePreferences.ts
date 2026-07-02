export type WorkspaceTheme = "light" | "dark";
export type SidebarMode = "expanded" | "collapsed";

export type WorkspacePreferenceUpdate = {
  sidebarMode?: SidebarMode;
  theme?: WorkspaceTheme;
};

export const preferenceStorageKeys = {
  autoExport: "app_auto_export",
  projectAutomationSettings: "qaira.project_automation_settings",
  sidebarCollapsed: "sidebar_collapsed",
  theme: "app_theme"
} as const;

export const PREFERENCES_UPDATED_EVENT = "qaira:preferences-updated";

export function readWorkspaceTheme(): WorkspaceTheme {
  if (typeof window === "undefined") {
    return "light";
  }

  const stored = window.localStorage.getItem(preferenceStorageKeys.theme);
  if (stored === "dark" || stored === "light") {
    return stored;
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function writeWorkspaceTheme(theme: WorkspaceTheme) {
  document.documentElement.dataset.theme = theme;
  window.localStorage.setItem(preferenceStorageKeys.theme, theme);
}

export function readSidebarMode(): SidebarMode {
  if (typeof window === "undefined") {
    return "collapsed";
  }

  return window.localStorage.getItem(preferenceStorageKeys.sidebarCollapsed) === "false"
    ? "expanded"
    : "collapsed";
}

export function writeSidebarMode(sidebarMode: SidebarMode) {
  document.documentElement.dataset.sidebar = sidebarMode;
  window.localStorage.setItem(preferenceStorageKeys.sidebarCollapsed, String(sidebarMode === "collapsed"));
}

export function emitWorkspacePreferenceUpdate(detail: WorkspacePreferenceUpdate) {
  window.dispatchEvent(new CustomEvent(PREFERENCES_UPDATED_EVENT, { detail }));
}
