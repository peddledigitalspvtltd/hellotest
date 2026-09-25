// Public, lazily loaded UI entry points owned by this capability.
export const views = {
  AdminSpacePage: () => import("./pages/AdminSpacePage"),
  AuthPage: () => import("./pages/AuthPage"),
  NotificationsPage: () => import("./pages/NotificationsPage"),
  PeoplePage: () => import("./pages/PeoplePage"),
  ProjectsPage: () => import("./pages/ProjectsPage"),
  SettingsPage: () => import("./pages/SettingsPage"),
};
