import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import {
  DEFAULT_LOCALIZATION_STRINGS,
  LOCALIZATION_STORAGE_KEY,
  mergeLocalizationStrings,
  type LocalizationStrings
} from "../lib/localization";

type LocalizationContextValue = {
  strings: LocalizationStrings;
  t: (key: string, fallback?: string) => string;
  setWorkspaceStrings: (nextStrings: LocalizationStrings) => void;
};

const LocalizationContext = createContext<LocalizationContextValue>({
  strings: DEFAULT_LOCALIZATION_STRINGS,
  t: (_key, fallback = "") => fallback,
  setWorkspaceStrings: () => undefined
});

const readCachedStrings = () => {
  try {
    const raw = window.localStorage.getItem(LOCALIZATION_STORAGE_KEY);
    return raw ? mergeLocalizationStrings(JSON.parse(raw) as LocalizationStrings) : DEFAULT_LOCALIZATION_STRINGS;
  } catch {
    return DEFAULT_LOCALIZATION_STRINGS;
  }
};

export function LocalizationProvider({ children }: { children: ReactNode }) {
  const [strings, setStrings] = useState<LocalizationStrings>(() => readCachedStrings());

  const setWorkspaceStrings = useCallback((nextStrings: LocalizationStrings) => {
    const merged = mergeLocalizationStrings(nextStrings);
    setStrings(merged);
    window.localStorage.setItem(LOCALIZATION_STORAGE_KEY, JSON.stringify(merged));
  }, []);

  const value = useMemo<LocalizationContextValue>(() => ({
    strings,
    t: (key, fallback) => strings[key] || fallback || key,
    setWorkspaceStrings
  }), [setWorkspaceStrings, strings]);

  return (
    <LocalizationContext.Provider value={value}>
      {children}
    </LocalizationContext.Provider>
  );
}

export function useLocalization() {
  return useContext(LocalizationContext);
}
