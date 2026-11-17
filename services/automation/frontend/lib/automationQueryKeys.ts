/** Keep invalidation prefixes stable across case, repository and activity surfaces. */
export const automationQueryKeys = {
  cases: (appTypeId: string) => ["test-cases", "automation-workspace", appTypeId] as const,
  caseDetail: (projectId: string, id: string) => ["test-case-detail", projectId || "unselected", id] as const,
  steps: (id: string) => ["test-steps", "automation-workspace", id] as const,
  repository: (projectId: string, appTypeId: string) => ["automation-learning-cache", "automation-workspace", projectId, appTypeId] as const,
  activity: (projectId: string, appTypeId: string, caseId?: string, transactionId?: string) => ["automation-agent-activity", projectId, appTypeId, caseId, transactionId] as const,
  activityHistory: (projectId: string, appTypeId: string, caseId?: string) => ["automation-agent-history", projectId, appTypeId, caseId] as const,
  activityRecord: (scope: string, id: string) => ["automation-agent-record", scope, id] as const
};
