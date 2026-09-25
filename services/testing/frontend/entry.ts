// Public, lazily loaded UI entry points owned by this capability.
export const views = {
  DesignPage: () => import("./pages/DesignPage"),
  ExecutionsPage: () => import("./pages/ExecutionsPage"),
  IssuesPage: () => import("./pages/IssuesPage"),
  SharedStepsPage: () => import("./pages/SharedStepsPage"),
  TestCasesPage: () => import("./pages/TestCasesPage"),
  TestEnvironmentPage: () => import("./pages/TestEnvironmentPage"),
  ReportBugModal: () => import("./components/ReportBugModal"),
  LinkedDefectsPanel: () => import("./components/LinkedDefectsPanel"),
};
