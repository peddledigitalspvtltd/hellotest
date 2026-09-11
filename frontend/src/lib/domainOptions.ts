import type { DomainMetadata, DomainOption } from "../types";

const optionsAt = (metadata: DomainMetadata | undefined, field: string): DomainOption[] | undefined => {
  const configured = metadata?.dropdowns?.fields[field];
  if (configured) return configured.options;
  const [domain, name] = field.split(".");
  const source = (metadata as unknown as Record<string, Record<string, unknown>> | undefined)?.[domain]?.[name];
  return Array.isArray(source) ? source as DomainOption[] : undefined;
};

/** Keep stable values intact; inactive options remain visible only on their saved record. */
export function getDomainOptions(metadata: DomainMetadata | undefined, field: string, fallback: readonly DomainOption[] = [], currentValues: readonly string[] = []): DomainOption[] {
  const selected = new Set(currentValues.filter(Boolean));
  const source = optionsAt(metadata, field) ?? fallback;
  const seen = new Set<string>();
  const options: DomainOption[] = [];
  for (const option of source) {
    if (!option || typeof option.value !== "string" || !option.value || seen.has(option.value)) continue;
    seen.add(option.value);
    if (option.active === false && !selected.has(option.value)) continue;
    options.push({ ...option, label: option.label || option.value, ...(option.active === false ? { current: true } : {}) });
  }
  for (const value of selected) if (!seen.has(value)) options.push({ value, label: value, current: true });
  return options;
}

export function getDomainDefault(metadata: DomainMetadata | undefined, field: string, fallback: string): string {
  const value = metadata?.dropdowns?.fields[field]?.default_value;
  return value && getDomainOptions(metadata, field).some(option => option.value === value) ? value : fallback;
}

/** Admin suggestions lead; existing free-text values remain valid without reviving retired suggestions. */
export function getDomainSuggestions(metadata: DomainMetadata | undefined, field: string, observed: readonly string[] = []): DomainOption[] {
  const source = optionsAt(metadata, field) || [];
  const retired = new Set(source.filter(option => option.active === false).map(option => option.value.toLocaleLowerCase()));
  const seen = new Set<string>();
  return [...getDomainOptions(metadata, field), ...observed.map(value => ({ value, label: value }))].filter(option => {
    const key = option.value.trim().toLocaleLowerCase();
    if (!key || retired.has(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** A typed display label can select its unique registered value; other text stays free form. */
export function resolveDomainSuggestionValue(text: string, options: readonly Pick<DomainOption, "value" | "label">[]): string {
  const value = text.trim();
  const key = value.toLocaleLowerCase();
  const exactValue = options.find(option => option.value.toLocaleLowerCase() === key);
  if (exactValue) return exactValue.value;
  const labels = options.filter(option => option.label.toLocaleLowerCase() === key);
  return labels.length === 1 ? labels[0].value : value;
}
