import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { queryKeys } from "../lib/queryKeys";
import { useCurrentProject } from "./useCurrentProject";

const FEATURE_FLAGS_STALE_TIME_MS = 60 * 1000;

export function useFeatureFlags(enabled = true) {
  const [projectId] = useCurrentProject();
  return useQuery({
    queryKey: queryKeys.featureFlags(projectId),
    queryFn: ({ signal }) => api.featureFlags.snapshot({ signal, fresh: true }),
    // Feature availability is workspace-wide and is needed before the first
    // project exists. Keep the scoped key for existing invalidation callers.
    enabled,
    retry: 1,
    staleTime: FEATURE_FLAGS_STALE_TIME_MS,
    refetchInterval: FEATURE_FLAGS_STALE_TIME_MS,
    refetchIntervalInBackground: false
  });
}
