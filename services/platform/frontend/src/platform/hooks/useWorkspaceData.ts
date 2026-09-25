import { useEffect, useRef } from "react";
import { CancelledError, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { asArray } from "../../shared/lib/collectionGuards";
import { queryKeys } from "../lib/queryKeys";
import { useCurrentProject } from "./useCurrentProject";
import { useCapabilityAccess } from "./useCapabilityAccess";
import { optionalQueryView } from "../../shared/lib/optionalQueryView";

type WorkspaceResource =
  | "users"
  | "roles"
  | "projects"
  | "projectMembers"
  | "appTypes"
  | "requirements"
  | "issues"
  | "testSuites"
  | "testCases"
  | "executions"
  | "executionResults";

type WorkspaceDataOptions = Partial<Record<WorkspaceResource, boolean>> & {
  projectId?: string | null;
  issuesProjection?: "summary" | "detail";
  testCasesProjection?: "summary" | "detail";
};

const WORKSPACE_QUERY_STALE_TIME_MS = 30_000;
const WORKSPACE_SUMMARY_PAGE_SIZE = 100;

const WORKSPACE_RESOURCE_PERMISSIONS: Record<WorkspaceResource, string> = {
  users: "user.view",
  roles: "role.view",
  projects: "project.view",
  projectMembers: "project_member.view",
  appTypes: "app_type.view",
  requirements: "requirement.view",
  issues: "feedback.view",
  testSuites: "suite.view",
  testCases: "testcase.view",
  executions: "run.view",
  executionResults: "result.view"
};

export function useWorkspaceResource<TItem>(
  queryKey: QueryKey,
  read: (signal: AbortSignal) => Promise<TItem[]>,
  available: boolean,
  requested: boolean
) {
  const queryClient = useQueryClient();
  const availableRef = useRef(available);
  availableRef.current = available;
  const queryKeyRef = useRef(queryKey);
  queryKeyRef.current = queryKey;
  const key = JSON.stringify(queryKey);
  const query = useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      // A queued retry can outlive the render that disabled the capability.
      if (!availableRef.current) throw new CancelledError({ silent: true, revert: true });
      return asArray(await read(signal));
    },
    enabled: available && requested,
    staleTime: WORKSPACE_QUERY_STALE_TIME_MS,
    retry: (failureCount, error) => availableRef.current && failureCount < 1
      && ![401, 403].includes(Number((error as { status?: number })?.status))
  });

  useEffect(() => {
    if (!available) {
      // This follows permission/feature availability, not a particular panel's
      // visibility, so another authorized observer is not cancelled on close.
      void queryClient.cancelQueries({ queryKey: queryKeyRef.current, exact: true });
    }
  }, [available, key, queryClient]);

  return optionalQueryView(query, available && requested);
}

export function useWorkspaceData(options: WorkspaceDataOptions = {}) {
  const [currentProjectId] = useCurrentProject();
  const projectId = options.projectId === undefined ? currentProjectId : options.projectId || "";
  const { can } = useCapabilityAccess(projectId);
  const requested = (resource: WorkspaceResource) => options[resource] !== false;
  const available = (resource: WorkspaceResource) => {
    const needsProject = !["users", "roles", "projects"].includes(resource);
    return (!needsProject || Boolean(projectId))
      && can(WORKSPACE_RESOURCE_PERMISSIONS[resource], needsProject ? projectId : null);
  };
  const users = useWorkspaceResource(queryKeys.users(projectId), signal => api.users.list({ signal }), available("users"), requested("users"));
  const roles = useWorkspaceResource(queryKeys.roles(projectId), signal => api.roles.list({ signal }), available("roles"), requested("roles"));
  const projects = useWorkspaceResource(queryKeys.projects(), signal => api.projects.list({ signal }), available("projects"), requested("projects"));
  const projectMembers = useWorkspaceResource(queryKeys.projectMembers(projectId), signal => api.projectMembers.list({ project_id: projectId }, { signal }), available("projectMembers"), requested("projectMembers"));
  const appTypes = useWorkspaceResource(queryKeys.appTypes(projectId), signal => api.appTypes.list({ project_id: projectId }, { signal }), available("appTypes"), requested("appTypes"));
  const requirements = useWorkspaceResource(queryKeys.requirements(projectId), signal => api.requirements.list({
    project_id: projectId,
    page_size: WORKSPACE_SUMMARY_PAGE_SIZE,
    projection: "summary"
  }, { signal }), available("requirements"), requested("requirements"));
  const issuesProjection = options.issuesProjection || "detail";
  const issues = useWorkspaceResource([...queryKeys.issues(projectId), issuesProjection], signal => api.issues.list({
    project_id: projectId,
    page_size: WORKSPACE_SUMMARY_PAGE_SIZE,
    projection: issuesProjection
  }, { signal }), available("issues"), requested("issues"));
  const testSuites = useWorkspaceResource(queryKeys.testSuites(projectId), signal => api.testSuites.list({ project_id: projectId }, { signal }), available("testSuites"), requested("testSuites"));
  const testCasesProjection = options.testCasesProjection || "detail";
  const testCases = useWorkspaceResource([...queryKeys.testCases(projectId), testCasesProjection], signal => api.testCases.list({
    project_id: projectId,
    projection: testCasesProjection,
    page_size: WORKSPACE_SUMMARY_PAGE_SIZE
  }, { signal }), available("testCases"), requested("testCases"));
  const executions = useWorkspaceResource(queryKeys.executions(projectId), signal => api.executions.list({ project_id: projectId }, { signal }), available("executions"), requested("executions"));
  const executionResults = useWorkspaceResource(queryKeys.executionResults(projectId), signal => api.executionResults.list({ project_id: projectId, limit: 5000 }, { signal }), available("executionResults"), requested("executionResults"));

  return { users, roles, projects, projectMembers, appTypes, requirements, issues, testSuites, testCases, executions, executionResults };
}
