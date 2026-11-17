import type { SetStateAction } from "react";
import type { AutomationStepDraft } from "./automationStepDraft";
import type { AutomationStepOptions } from "./automationStepOptions";
import { collectStepParameters } from "@hellotest/platform/frontend/src/shared/lib/stepParameters";

export type AutomationDraftMaps = {
  steps: Record<string, AutomationStepDraft>;
  options: Record<string, AutomationStepOptions>;
  code: Record<string, string>;
  api: Record<string, string>;
};
export type AutomationRowDraft = { step?: AutomationStepDraft; options?: AutomationStepOptions; code?: string; api?: string; dirty: boolean };
const emptyRow: AutomationRowDraft = Object.freeze({ dirty: false });
const emptyMaps = (): AutomationDraftMaps => ({ steps: {}, options: {}, code: {}, api: {} });
const same = (left: unknown, right: unknown) => left === right || JSON.stringify(left) === JSON.stringify(right);

/** An immutable, case-scoped editor store. Rows observe their own snapshot;
 * workspace admission observes only dirty identities and parameter names.
 * Operations read the latest draft directly, including before a blur event. */
export function createAutomationDraftStore() {
  let maps = emptyMaps(), baseline = emptyMaps(), summary = "", rowSnapshots = new Map<string, AutomationRowDraft>();
  const listeners = new Set<() => void>();
  const summarize = () => {
    const dirty: string[] = [], parameters = new Set<string>();
    const ids = new Set([...Object.keys(baseline.steps), ...Object.values(maps).flatMap(Object.keys)]);
    for (const id of ids) {
      const next: AutomationRowDraft = { step: maps.steps[id], options: maps.options[id], code: maps.code[id], api: maps.api[id], dirty:
        maps.steps[id] !== undefined && !same(maps.steps[id], baseline.steps[id])
        || maps.options[id] !== undefined && !same(maps.options[id], baseline.options[id])
        || maps.code[id] !== undefined && maps.code[id] !== baseline.code[id]
        || maps.api[id] !== undefined && maps.api[id] !== baseline.api[id] };
      const previous = rowSnapshots.get(id);
      if (!previous || !same(previous, next)) rowSnapshots.set(id, Object.freeze(next));
      if (next.dirty) dirty.push(id);
      const draft = next.step || baseline.steps[id];
      for (const parameter of collectStepParameters([{ id, action: [draft?.name, draft?.objectRef, draft?.value].filter(Boolean).join(" "), expected_result: draft?.expected_result || "", automation_code: [next.code ?? baseline.code[id], next.api ?? baseline.api[id]].filter(Boolean).join("\n"), api_request: null }])) parameters.add(parameter.name);
    }
    for (const id of rowSnapshots.keys()) if (!ids.has(id)) rowSnapshots.delete(id);
    summary = JSON.stringify([dirty.sort(), [...parameters].sort()]);
    for (const listener of listeners) listener();
  };
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    row(id: string) { return rowSnapshots.get(id) || emptyRow; },
    summary() { return summary; },
    read<K extends keyof AutomationDraftMaps>(key: K): AutomationDraftMaps[K] { return maps[key]; },
    write<K extends keyof AutomationDraftMaps>(key: K, action: SetStateAction<AutomationDraftMaps[K]>) {
      const next = typeof action === "function" ? action(maps[key]) : action;
      if (same(next, maps[key])) return;
      maps = { ...maps, [key]: next };
      summarize();
    },
    baseline(next: AutomationDraftMaps) {
      if (same(next, baseline)) return;
      baseline = next;
      summarize();
    }
  };
}
export type AutomationDraftStore = ReturnType<typeof createAutomationDraftStore>;
