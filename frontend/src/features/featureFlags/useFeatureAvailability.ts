import { useCallback, useEffect, useState } from "react";
import { useFeatureFlags } from "../../hooks/useFeatureFlags";
import { api } from "../../lib/api";

export function useFeatureAvailability(enabled = true) {
  const featureFlagsQuery = useFeatureFlags(enabled);
  const featureFlags = featureFlagsQuery.data;
  const refetchFeatureFlags = featureFlagsQuery.refetch;
  const [drafts, setDrafts] = useState<Record<string, boolean>>({});
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (featureFlags?.local_flags) {
      setDrafts(featureFlags.local_flags);
    }
  }, [featureFlags]);

  const setFeatureEnabled = useCallback((featureKey: string, isEnabled: boolean) => {
    setDrafts((current) => ({
      ...current,
      [featureKey]: isEnabled
    }));
  }, []);

  const save = useCallback(async () => {
    setIsSaving(true);

    try {
      const response = await api.featureFlags.update(drafts);
      setDrafts(response.local_flags);
      await refetchFeatureFlags();
      return response;
    } finally {
      setIsSaving(false);
    }
  }, [drafts, refetchFeatureFlags]);

  return {
    drafts,
    featureFlags,
    isLoading: featureFlagsQuery.isLoading,
    isSaving,
    save,
    setFeatureEnabled
  };
}
