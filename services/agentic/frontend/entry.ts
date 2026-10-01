// Public, lazily loaded UI entry points owned by this capability.
export const views = {
  WorkflowConnectionSettings: () => import("./workflows/WorkflowConnectionSettings"),
  AgenticWorkflowsPage: () => import("./pages/AgenticWorkflowsPage"),
};
