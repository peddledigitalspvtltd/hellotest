import metricCatalog from "@hellotest/platform/shared/metricCatalog.json";
import promptDefaults from "@hellotest/platform/shared/aiPromptDefaults.json";
export type AiPromptRegistryItem = {
  key: string;
  label: string;
  value: string;
  surface: string;
  maxLength?: number;
};

export const AI_PROMPT_OVERRIDES_KEY = "ai_prompt_registry_overrides";
export const AI_PROMPT_LLM_OVERRIDES_KEY = "ai_prompt_registry_llm_overrides";
export const AI_METRIC_CRITERIA_OVERRIDES_KEY = "ai_metric_criteria_overrides";
export const AI_METRIC_FORMULA_VALUES_KEY = "ai_metric_formula_values";

export const AI_PROMPT_REGISTRY: AiPromptRegistryItem[] = promptDefaults;

export type AiPromptOverrides = Record<string, string>;
export type AiPromptLlmOverrides = Record<string, string>;
export type AiMetricCriteriaOverrides = Record<string, string>;
export type AiMetricFormulaValues = Record<string, Record<string, number>>;

export type AiMetricFormulaParameter = {
  defaultValue: number;
  help: string;
  key: string;
  label: string;
  max: number;
  min: number;
  step?: number;
  suffix?: string;
};

export type AiMetricCriteriaRegistryItem = {
  aliases: string[];
  criteria: string;
  formula: string;
  key: string;
  label: string;
  parameters?: AiMetricFormulaParameter[];
  surface: string;
};

export const AI_METRIC_CRITERIA_REGISTRY: AiMetricCriteriaRegistryItem[] = metricCatalog;

export function normalizeAiPromptOverrides(input: unknown): AiPromptOverrides {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(input as Record<string, unknown>)
      .filter(([key, value]) => typeof key === "string" && key.trim() && typeof value === "string")
      .map(([key, value]) => [key.trim(), String(value)])
  );
}

export function normalizeAiPromptLlmOverrides(input: unknown): AiPromptLlmOverrides {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(input as Record<string, unknown>)
      .filter(([key, value]) => typeof key === "string" && key.trim() && typeof value === "string" && value.trim())
      .map(([key, value]) => [key.trim(), String(value).trim()])
  );
}

export function normalizeAiMetricCriteriaOverrides(input: unknown): AiMetricCriteriaOverrides {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  return Object.fromEntries(
    Object.entries(input as Record<string, unknown>)
      .filter(([key, value]) => typeof key === "string" && key.trim() && typeof value === "string")
      .map(([key, value]) => [key.trim(), String(value).trim().slice(0, 4_000)])
  );
}

export function normalizeAiMetricFormulaValues(input: unknown): AiMetricFormulaValues {
  const source = input && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};

  return Object.fromEntries(
    AI_METRIC_CRITERIA_REGISTRY
      .filter((metric) => metric.parameters?.length)
      .map((metric) => {
        const supplied = source[metric.key] && typeof source[metric.key] === "object" && !Array.isArray(source[metric.key])
          ? source[metric.key] as Record<string, unknown>
          : {};
        return [metric.key, Object.fromEntries((metric.parameters || []).map((parameter) => {
          const parsed = Number(supplied[parameter.key]);
          const bounded = Number.isFinite(parsed)
            ? Math.max(parameter.min, Math.min(parameter.max, parsed))
            : parameter.defaultValue;
          return [parameter.key, bounded];
        }))];
      })
  );
}

export function resolveAiPromptRegistryValue(key: string, overrides?: AiPromptOverrides) {
  const override = overrides?.[key]?.trim();
  const registryItem = AI_PROMPT_REGISTRY.find((item) => item.key === key);

  return override && (!registryItem?.maxLength || override.length <= registryItem.maxLength)
    ? override
    : registryItem?.value || "";
}

export function resolveAiMetricCriteriaValue(key: string, overrides?: AiMetricCriteriaOverrides) {
  const item = AI_METRIC_CRITERIA_REGISTRY.find((candidate) => candidate.key === key);
  return overrides?.[key]?.trim() || item?.criteria || "";
}

export function findAiMetricCriteriaByLabel(label: string) {
  const normalized = label.trim().toLowerCase();
  return AI_METRIC_CRITERIA_REGISTRY.find((item) =>
    item.key.toLowerCase() === normalized
    || item.label.toLowerCase() === normalized
    || item.aliases.some((alias) => normalized.includes(alias) || alias.includes(normalized))
  ) || null;
}
