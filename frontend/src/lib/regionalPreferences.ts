export type RegionalPreferences = {
  language: "workspace" | "en" | "es";
  locale: string;
  timeZone: string;
  hourCycle: "auto" | "h12" | "h23";
};
export const DEFAULT_REGIONAL_PREFERENCES: RegionalPreferences = { language: "workspace", locale: "auto", timeZone: "auto", hourCycle: "auto" };
export function normalizeRegionalPreferences(value: unknown): RegionalPreferences {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  let locale = "auto";
  let timeZone = "auto";
  try {
    if (typeof input.locale === "string" && input.locale !== "auto" && Intl.DateTimeFormat.supportedLocalesOf([input.locale]).length) locale = Intl.getCanonicalLocales(input.locale)[0];
  } catch { /* Corrupt or unsupported preferences fall back to the browser. */ }
  try {
    if (typeof input.timeZone === "string" && input.timeZone !== "auto") timeZone = new Intl.DateTimeFormat("en", { timeZone: input.timeZone }).resolvedOptions().timeZone;
  } catch { /* Invalid IANA zone. */ }
  return { language: input.language === "en" || input.language === "es" ? input.language : "workspace", locale, timeZone, hourCycle: input.hourCycle === "h12" || input.hourCycle === "h23" ? input.hourCycle : "auto" };
}
export function createRegionalFormatters(preferences: RegionalPreferences) {
  const locale = preferences.locale === "auto" ? undefined : preferences.locale;
  const dateOptions: Intl.DateTimeFormatOptions = {
    ...(preferences.timeZone === "auto" ? {} : { timeZone: preferences.timeZone }),
    ...(preferences.hourCycle === "auto" ? {} : { hourCycle: preferences.hourCycle })
  };
  // Reused within a provider, bounded by the small set of options callers use.
  const dates = new Map<string, Intl.DateTimeFormat>();
  const numbers = new Map<string, Intl.NumberFormat>();
  return {
    formatDate(value: string | number | Date | null | undefined, options: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" }) {
      if (value == null || value === "") return "—";
      const dateOnly = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
      const date = value instanceof Date ? value : new Date(dateOnly ? `${value}T12:00:00Z` : value);
      if (!Number.isFinite(date.getTime()) || (dateOnly && date.toISOString().slice(0, 10) !== value)) return "—";
      // Calendar dates must not shift when the viewer changes time zones.
      const resolved = dateOnly ? { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" } as Intl.DateTimeFormatOptions : { ...dateOptions, ...options };
      const key = JSON.stringify(resolved);
      if (!dates.has(key)) { if (dates.size >= 32) dates.clear(); dates.set(key, new Intl.DateTimeFormat(locale, resolved)); }
      return dates.get(key)!.format(date);
    },
    formatNumber(value: number, options?: Intl.NumberFormatOptions) {
      if (!Number.isFinite(value)) return "—";
      const key = JSON.stringify(options || {});
      if (!numbers.has(key)) { if (numbers.size >= 32) numbers.clear(); numbers.set(key, new Intl.NumberFormat(locale, options)); }
      return numbers.get(key)!.format(value);
    }
  };
}
export function interpolateTranslation(message: string, values?: Record<string, string | number>) {
  return message.replace(/\{([\w]+)\}/g, (original, key: string) => values && Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : original);
}
