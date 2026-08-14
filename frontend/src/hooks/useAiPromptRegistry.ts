import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import {
  AI_METRIC_CRITERIA_OVERRIDES_KEY,
  AI_PROMPT_LLM_OVERRIDES_KEY,
  AI_PROMPT_OVERRIDES_KEY,
  normalizeAiMetricCriteriaOverrides,
  normalizeAiPromptLlmOverrides,
  normalizeAiPromptOverrides,
  resolveAiMetricCriteriaValue,
  resolveAiPromptRegistryValue,
  type AiMetricCriteriaOverrides,
  type AiPromptLlmOverrides,
  type AiPromptOverrides
} from "../lib/aiPromptRegistry";
import { isRovoIntegrationId } from "../lib/rovo";

export function useAiPromptRegistry(enabled = true) {
  const query = useQuery({
    queryKey: ["settings", "workspace-preferences", "ai-prompts"],
    queryFn: api.settings.getWorkspacePreferences,
    enabled
  });

  const overrides = useMemo<AiPromptOverrides>(
    () => normalizeAiPromptOverrides(query.data?.preferences?.[AI_PROMPT_OVERRIDES_KEY]),
    [query.data]
  );
  const llmOverrides = useMemo<AiPromptLlmOverrides>(
    () => normalizeAiPromptLlmOverrides(query.data?.preferences?.[AI_PROMPT_LLM_OVERRIDES_KEY]),
    [query.data]
  );
  const metricCriteriaOverrides = useMemo<AiMetricCriteriaOverrides>(
    () => normalizeAiMetricCriteriaOverrides(query.data?.preferences?.[AI_METRIC_CRITERIA_OVERRIDES_KEY]),
    [query.data]
  );

  const getPrompt = useCallback(
    (key: string) => resolveAiPromptRegistryValue(key, overrides),
    [overrides]
  );
  const getLlmIntegrationId = useCallback(
    (key: string) => isRovoIntegrationId(llmOverrides[key]) ? "" : llmOverrides[key] || "",
    [llmOverrides]
  );
  const getMetricCriteria = useCallback(
    (key: string) => resolveAiMetricCriteriaValue(key, metricCriteriaOverrides),
    [metricCriteriaOverrides]
  );

  return {
    getPrompt,
    getLlmIntegrationId,
    getMetricCriteria,
    metricCriteriaOverrides,
    overrides,
    llmOverrides,
    query
  };
}
