import { DEFAULT_LOCALIZATION_STRINGS } from "./localization";
export const MAX_LOCALIZATION_BYTES = 512 * 1024;
export function parseLocalizationPack(text: string): Record<string, string> {
  if (new TextEncoder().encode(text).length > MAX_LOCALIZATION_BYTES) throw new Error("Language packs must be smaller than 512 KB.");
  const parsed: unknown = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Use a JSON object containing string keys and text values.");
  const entries = Object.entries(parsed);
  if (entries.length > 2000) throw new Error("A language pack can contain up to 2,000 strings.");
  for (const [key, value] of entries) {
    if (!key.trim() || key.length > 160 || ["__proto__", "constructor", "prototype"].includes(key.trim()) || typeof value !== "string" || value.length > 10000) throw new Error(`Invalid string: ${key.slice(0, 80)}. Use text values and keys of at most 160 characters.`);
    if (key === "meta.direction" && !["ltr", "rtl"].includes(value)) throw new Error("meta.direction must be ltr or rtl.");
    if (key === "meta.language") { try { if (!Intl.getCanonicalLocales(value).length) throw new Error(); } catch { throw new Error("meta.language must be a valid language tag, such as en or es."); } }
    const placeholders = DEFAULT_LOCALIZATION_STRINGS[key]?.match(/\{\w+\}/g) || [];
    if (placeholders.some(token => !value.includes(token))) throw new Error(`Keep the placeholders in ${key}: ${placeholders.join(", ")}`);
  }
  return Object.fromEntries(entries.map(([key, value]) => [key.trim(), value as string]));
}
