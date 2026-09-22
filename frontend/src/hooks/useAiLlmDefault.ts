import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { api } from "../lib/api";
import { resolveAiLlmDefault, type AiLlmOption } from "../lib/aiLlmDefault";

export function useAiLlmDefault({ usageKey, projectId, integrations, enabled = true }: {
  usageKey: string;
  projectId?: string | null;
  integrations?: readonly AiLlmOption[];
  enabled?: boolean;
}) {
  const query = useQuery({
    queryKey: ["settings", "workspace-preferences", "ai-prompts"],
    queryFn: api.settings.getWorkspacePreferences,
    enabled,
    refetchOnMount: "always"
  });
  // A reopened dialog may have cached the previous successful provider. Wait
  // for its refresh before materializing that preference into an explicit ID.
  return query.isFetching ? "" : resolveAiLlmDefault({ preferences: query.data?.preferences, usageKey, projectId, integrations });
}

export function useAiLlmAutoSelection({ integrations, value, onChange, defaultIntegrationId, disabled, scopeKey }: {
  integrations: readonly AiLlmOption[];
  value: string;
  onChange?: (id: string) => void;
  defaultIntegrationId: string;
  disabled?: boolean;
  scopeKey?: string;
}) {
  const userSelected = useRef(false);
  const active = integrations.filter((item) => item.is_active !== false && (!item.type || item.type === "llm"));
  const defaultId = active.some((item) => item.id === defaultIntegrationId) ? defaultIntegrationId : active.length === 1 ? active[0].id : "";
  useEffect(() => { userSelected.current = false; }, [scopeKey]);
  useEffect(() => {
    if (!value && !disabled && !userSelected.current && defaultId) onChange?.(defaultId);
  }, [defaultId, disabled, onChange, value]);
  return (id: string) => { userSelected.current = true; onChange?.(id); };
}
