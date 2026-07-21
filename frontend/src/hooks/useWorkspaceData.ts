import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { queryKeys } from "../lib/queryKeys";

export function useWorkspaceData(projectId?: string) {
  const users = useQuery({ queryKey: queryKeys.users(), queryFn: api.users.list });
  const roles = useQuery({ queryKey: queryKeys.roles(), queryFn: api.roles.list });
  const projects = useQuery({ queryKey: queryKeys.projects(), queryFn: api.projects.list });
  const projectMembers = useQuery({ queryKey: queryKeys.projectMembers(), queryFn: () => api.projectMembers.list() });
  const appTypes = useQuery({ queryKey: queryKeys.appTypesAll(), queryFn: () => api.appTypes.list() });
  const requirements = useQuery({ queryKey: [...queryKeys.requirements(), projectId || "all"], queryFn: () => api.requirements.list(projectId ? { project_id: projectId } : undefined) });
  const issues = useQuery({ queryKey: [...queryKeys.issues(), projectId || "all"], queryFn: () => api.issues.list(projectId ? { project_id: projectId } : undefined) });
  const testSuites = useQuery({ queryKey: queryKeys.testSuites(), queryFn: () => api.testSuites.list() });
  const testCases = useQuery({ queryKey: queryKeys.testCases(), queryFn: () => api.testCases.list() });
  const testSteps = useQuery({ queryKey: queryKeys.testSteps(), queryFn: () => api.testSteps.list() });
  const executions = useQuery({ queryKey: [...queryKeys.executions(), projectId || "all"], queryFn: () => api.executions.list(projectId ? { project_id: projectId } : undefined) });
  const executionResults = useQuery({ queryKey: queryKeys.executionResults(), queryFn: () => api.executionResults.list() });

  return {
    users,
    roles,
    projects,
    projectMembers,
    appTypes,
    requirements,
    issues,
    testSuites,
    testCases,
    testSteps,
    executions,
    executionResults
  };
}
