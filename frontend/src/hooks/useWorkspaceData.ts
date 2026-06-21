import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

export function useWorkspaceData() {
  const users = useQuery({ queryKey: ["users"], queryFn: api.users.list });
  const roles = useQuery({ queryKey: ["roles"], queryFn: api.roles.list });
  const projects = useQuery({ queryKey: ["projects"], queryFn: api.projects.list });
  const projectMembers = useQuery({ queryKey: ["project-members"], queryFn: () => api.projectMembers.list() });
  const appTypes = useQuery({ queryKey: ["app-types"], queryFn: () => api.appTypes.list() });
  const requirements = useQuery({ queryKey: ["requirements"], queryFn: () => api.requirements.list() });
  const issues = useQuery({ queryKey: ["issues"], queryFn: () => api.issues.list() });
  const testSuites = useQuery({ queryKey: ["test-suites"], queryFn: () => api.testSuites.list() });
  const testCases = useQuery({ queryKey: ["test-cases"], queryFn: () => api.testCases.list() });
  const testSteps = useQuery({ queryKey: ["test-steps"], queryFn: () => api.testSteps.list() });
  const executions = useQuery({ queryKey: ["executions"], queryFn: () => api.executions.list() });
  const executionResults = useQuery({ queryKey: ["execution-results"], queryFn: () => api.executionResults.list() });

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
