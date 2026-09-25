// Public, lazily loaded UI entry points owned by this capability.
export const views = {
  ReleasesPage: () => import("./pages/ReleasesPage"),
  RequirementsPage: () => import("./pages/RequirementsPage"),
};
