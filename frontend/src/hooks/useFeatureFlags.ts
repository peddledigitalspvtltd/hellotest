import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { queryKeys } from "../lib/queryKeys";

const FEATURE_FLAGS_STALE_TIME_MS = 60 * 1000;

export function useFeatureFlags(enabled = true) {
  return useQuery({
    queryKey: queryKeys.featureFlags(),
    queryFn: ({ signal }) => api.featureFlags.snapshot({ signal, fresh: true }),
    // The endpoint returns workspace-wide policy. A project change must not
    // discard this snapshot and unmount the current page while it reloads.
    enabled,
    retry: 1,
    staleTime: FEATURE_FLAGS_STALE_TIME_MS,
    refetchInterval: FEATURE_FLAGS_STALE_TIME_MS,
    refetchOnWindowFocus: "always",
    refetchIntervalInBackground: false
  });
}
