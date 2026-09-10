export type WorkspaceTheme = "light" | "dark";
export type SidebarMode = "expanded" | "collapsed";

export type WorkspacePreferenceUpdate = {
  sidebarMode?: SidebarMode;
  theme?: WorkspaceTheme;
};

export const preferenceStorageKeys = {
  autoExport: "app_auto_export",
  projectAutomationSettings: "hellotest.project_automation_settings",
  sidebarCollapsed: "sidebar_collapsed",
  theme: "app_theme"
} as const;

export const PREFERENCES_UPDATED_EVENT = "hellotest:preferences-updated";

export function readWorkspaceTheme(): WorkspaceTheme {
  if (typeof window === "undefined") {
    return "light";
  }

  const appliedTheme = document.documentElement.dataset.theme;
  if (appliedTheme === "dark" || appliedTheme === "light") {
    return appliedTheme;
  }

  const storedTheme = window.localStorage.getItem(preferenceStorageKeys.theme);
  if (storedTheme === "dark" || storedTheme === "light") {
    return storedTheme;
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function writeWorkspaceTheme(theme: WorkspaceTheme) {
  if (typeof window === "undefined") {
    return;
  }

  document.documentElement.dataset.theme = theme;
  window.localStorage.setItem(preferenceStorageKeys.theme, theme);
}

export function syncWorkspaceThemeFromJira() {
  const previousTheme = document.documentElement.dataset.theme;
  const nextTheme = readWorkspaceTheme();
  document.documentElement.dataset.theme = nextTheme;
  window.localStorage.setItem(preferenceStorageKeys.theme, nextTheme);

  if (previousTheme !== nextTheme) {
    emitWorkspacePreferenceUpdate({ theme: nextTheme });
  }

  return nextTheme;
}

export function readSidebarMode(): SidebarMode {
  if (typeof window === "undefined") {
    return "collapsed";
  }

  return window.localStorage.getItem(preferenceStorageKeys.sidebarCollapsed) === "true"
    ? "collapsed"
    : "expanded";
}

export function writeSidebarMode(sidebarMode: SidebarMode) {
  document.documentElement.dataset.sidebar = sidebarMode;
  window.localStorage.setItem(preferenceStorageKeys.sidebarCollapsed, String(sidebarMode === "collapsed"));
}

export function emitWorkspacePreferenceUpdate(detail: WorkspacePreferenceUpdate) {
  window.dispatchEvent(new CustomEvent(PREFERENCES_UPDATED_EVENT, { detail }));
}
