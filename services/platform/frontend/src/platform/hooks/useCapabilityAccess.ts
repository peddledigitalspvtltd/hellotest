import { useCallback } from "react";
import { useAuth } from "../../auth/AuthContext";
import { hasCapability } from "../lib/capabilityAccess";
import { useCurrentProject } from "./useCurrentProject";
import { useFeatureFlags } from "./useFeatureFlags";

export function useCapabilityAccess(projectId?: string | null) {
  const { session, isLoading: isSessionLoading } = useAuth();
  const [currentProjectId] = useCurrentProject();
  const scopeProjectId = projectId === undefined ? currentProjectId : projectId;
  const flags = useFeatureFlags(Boolean(session));
  const can = useCallback((permission: string, overrideProjectId: string | null | undefined = scopeProjectId) =>
    !isSessionLoading && hasCapability(session, flags.data, permission, overrideProjectId),
  [flags.data, isSessionLoading, scopeProjectId, session]);

  return {
    can,
    snapshot: flags.data,
    isLoading: isSessionLoading || Boolean(session && flags.isPending)
  };
}
