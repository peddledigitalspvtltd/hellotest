// Public, lazily loaded UI entry points owned by this capability.
export const views = {
  AgentActivity: () => import("./components/AgentActivity"),
  McpServersPage: () => import("./pages/McpServersPage"),
  WorkflowConnectionSettings: () => import("./workflows/WorkflowConnectionSettings"),
  AgenticWorkflowsPage: () => import("./pages/AgenticWorkflowsPage"),
};
