import { useMemo, useSyncExternalStore } from "react";
import { createAutomationDraftStore } from "../lib/automationDraftStore";

export function useAutomationDraftStore(scope: string) {
  const store = useMemo(createAutomationDraftStore, [scope]);
  useSyncExternalStore(store.subscribe, store.summary, store.summary);
  const setters = useMemo(() => ({
    setStepDrafts: (action: Parameters<typeof store.write<"steps">>[1]) => store.write("steps", action),
    setStepOptionDrafts: (action: Parameters<typeof store.write<"options">>[1]) => store.write("options", action),
    setStepCodeDrafts: (action: Parameters<typeof store.write<"code">>[1]) => store.write("code", action),
    setApiSourceDrafts: (action: Parameters<typeof store.write<"api">>[1]) => store.write("api", action)
  }), [store]);
  return { store, ...setters };
}
