export const queryKeys = {
  appTypesAll: () => ["app-types"] as const,
  executionResults: () => ["execution-results"] as const,
  executions: () => ["executions"] as const,
  featureFlags: () => ["feature-flags"] as const,
  integrations: {
    all: () => ["integrations"] as const,
    scoped: (...scope: string[]) => ["integrations", ...scope] as const
  },
  issues: () => ["issues"] as const,
  projectMembers: () => ["project-members"] as const,
  projects: () => ["projects"] as const,
  appTypes: (projectId: string) => ["app-types", projectId] as const,
  requirements: () => ["requirements"] as const,
  roles: () => ["roles"] as const,
  settings: {
    apiKeys: () => ["settings", "api-keys"] as const,
    workspacePreferences: () => ["settings", "workspace-preferences"] as const
  },
  testCases: () => ["test-cases"] as const,
  testSteps: () => ["test-steps"] as const,
  testSuites: () => ["test-suites"] as const,
  users: () => ["users"] as const
};
