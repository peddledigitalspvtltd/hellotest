import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { queryKeys } from "../lib/queryKeys";

export function useWorkspaceData() {
  const users = useQuery({ queryKey: queryKeys.users(), queryFn: api.users.list });
  const roles = useQuery({ queryKey: queryKeys.roles(), queryFn: api.roles.list });
  const projects = useQuery({ queryKey: queryKeys.projects(), queryFn: api.projects.list });
  const projectMembers = useQuery({ queryKey: queryKeys.projectMembers(), queryFn: () => api.projectMembers.list() });
  const appTypes = useQuery({ queryKey: queryKeys.appTypesAll(), queryFn: () => api.appTypes.list() });
  const requirements = useQuery({ queryKey: queryKeys.requirements(), queryFn: () => api.requirements.list() });
  const issues = useQuery({ queryKey: queryKeys.issues(), queryFn: () => api.issues.list() });
  const testSuites = useQuery({ queryKey: queryKeys.testSuites(), queryFn: () => api.testSuites.list() });
  const testCases = useQuery({ queryKey: queryKeys.testCases(), queryFn: () => api.testCases.list() });
  const testSteps = useQuery({ queryKey: queryKeys.testSteps(), queryFn: () => api.testSteps.list() });
  const executions = useQuery({ queryKey: queryKeys.executions(), queryFn: () => api.executions.list() });
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
