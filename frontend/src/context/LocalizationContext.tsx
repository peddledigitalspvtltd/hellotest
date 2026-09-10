import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { DEFAULT_LOCALIZATION_STRINGS, LOCALIZATION_STORAGE_KEY, mergeLocalizationStrings, type LocalizationStrings } from "../lib/localization";
import { SPANISH_STRINGS } from "../lib/localization.es";
import { createRegionalFormatters, DEFAULT_REGIONAL_PREFERENCES, interpolateTranslation, normalizeRegionalPreferences, type RegionalPreferences } from "../lib/regionalPreferences";

type LocalizationContextValue = ReturnType<typeof createRegionalFormatters> & {
  strings: LocalizationStrings;
  preferences: RegionalPreferences;
  setPreferences: (preferences: RegionalPreferences) => void;
  t: (key: string, fallback?: string, values?: Record<string, string | number>) => string;
  setWorkspaceStrings: (nextStrings: LocalizationStrings) => void;
};
const LocalizationContext = createContext<LocalizationContextValue>({
  ...createRegionalFormatters(DEFAULT_REGIONAL_PREFERENCES),
  strings: DEFAULT_LOCALIZATION_STRINGS, preferences: DEFAULT_REGIONAL_PREFERENCES,
  t: (key, fallback, values) => interpolateTranslation(fallback || DEFAULT_LOCALIZATION_STRINGS[key] || key, values),
  setPreferences: () => undefined, setWorkspaceStrings: () => undefined
});
function readCache(key: string) {
  try { return JSON.parse(window.localStorage.getItem(key) || "null"); } catch { return null; }
}
function writeCache(key: string, value: unknown) {
  try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* Preferences still work for this session when storage is unavailable. */ }
}
export function LocalizationProvider({ children, userId = "guest" }: { children: ReactNode; userId?: string }) {
  const preferenceKey = `hellotest.regional.v1:${userId}`;
  const [workspaceStrings, setStrings] = useState<LocalizationStrings>(() => mergeLocalizationStrings(readCache(LOCALIZATION_STORAGE_KEY)));
  const [preferences, updatePreferences] = useState(() => normalizeRegionalPreferences(readCache(preferenceKey)));
  useEffect(() => {
    updatePreferences(normalizeRegionalPreferences(readCache(preferenceKey)));
    const sync = (event: StorageEvent) => {
      if (event.key === preferenceKey || event.key === null) updatePreferences(normalizeRegionalPreferences(readCache(preferenceKey)));
      if (event.key === LOCALIZATION_STORAGE_KEY || event.key === null) setStrings(mergeLocalizationStrings(readCache(LOCALIZATION_STORAGE_KEY)));
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [preferenceKey]);
  const setPreferences = useCallback((next: RegionalPreferences) => {
    const normalized = normalizeRegionalPreferences(next);
    updatePreferences(normalized); writeCache(preferenceKey, normalized);
  }, [preferenceKey]);
  const setWorkspaceStrings = useCallback((next: LocalizationStrings) => {
    const merged = mergeLocalizationStrings(next);
    setStrings(merged); writeCache(LOCALIZATION_STORAGE_KEY, merged);
  }, []);
  const strings = useMemo(() => preferences.language === "workspace" ? workspaceStrings : preferences.language === "es" ? { ...DEFAULT_LOCALIZATION_STRINGS, ...SPANISH_STRINGS } : DEFAULT_LOCALIZATION_STRINGS, [preferences.language, workspaceStrings]);
  useEffect(() => {
    // Workspace packs can declare their language and direction without changing the legacy flat JSON format.
    const declared = preferences.language === "workspace" ? workspaceStrings["meta.language"] || "en" : preferences.language;
    try { document.documentElement.lang = Intl.getCanonicalLocales(declared)[0] || "en"; } catch { document.documentElement.lang = "en"; }
    document.documentElement.dir = preferences.language === "workspace" && workspaceStrings["meta.direction"] === "rtl" ? "rtl" : "ltr";
  }, [preferences.language, workspaceStrings]);
  const value = useMemo<LocalizationContextValue>(() => ({
    ...createRegionalFormatters(preferences), strings, preferences, setPreferences, setWorkspaceStrings,
    t: (key, fallback, values) => interpolateTranslation(strings[key] || fallback || key, values)
  }), [strings, preferences, setPreferences, setWorkspaceStrings]);
  return <LocalizationContext.Provider value={value}>{children}</LocalizationContext.Provider>;
}
export function useLocalization() { return useContext(LocalizationContext); }
