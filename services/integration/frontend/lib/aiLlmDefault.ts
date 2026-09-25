export type AiLlmOption = { id: string; name: string; model?: string | null; is_active?: boolean; type?: string };

export function resolveAiLlmDefault({ preferences, usageKey, projectId, integrations }: {
  preferences?: Record<string, unknown>;
  usageKey: string;
  projectId?: string | null;
  integrations?: readonly AiLlmOption[];
}) {
  const overrides = preferences?.ai_prompt_registry_llm_overrides as Record<string, unknown> | undefined;
  const entries = Array.isArray(preferences?.ai_last_successful_llm) ? preferences.ai_last_successful_llm : [];
  const successes = entries.filter((entry) => entry && typeof entry.integration_id === "string"
    && (entry.project_id || null) === (projectId || null) && Number.isFinite(Date.parse(entry.succeeded_at)))
    .sort((a, b) => Date.parse(b.succeeded_at) - Date.parse(a.succeeded_at));
  const ids = [overrides?.[usageKey], ...successes.filter((entry) => entry.usage_key === usageKey).map((entry) => entry.integration_id), ...successes.map((entry) => entry.integration_id)];
  return ids.find((id): id is string => typeof id === "string" && Boolean(id.trim())
    && (!integrations || integrations.some((item) => item.id === id && item.is_active !== false && (!item.type || item.type === "llm")))) || "";
}
