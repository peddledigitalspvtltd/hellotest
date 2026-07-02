import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { queryKeys } from "../lib/queryKeys";

const FEATURE_FLAGS_STALE_TIME_MS = 60 * 1000;

export function useFeatureFlags(enabled = true) {
  return useQuery({
    queryKey: queryKeys.featureFlags(),
    queryFn: api.featureFlags.snapshot,
    enabled,
    retry: 1,
    staleTime: FEATURE_FLAGS_STALE_TIME_MS
  });
}
