import type { TestDataOptions } from "../types";
import type { Execution } from "../types";
import type { api } from "./api";
import { isRunFinished } from "./runCatalog";

export type RunEditDraft = {
  test_data_options: TestDataOptions;
  name: string; start_date: string; end_date: string;
  release: string; sprint: string; build: string;
  suite_ids: string[]; test_case_ids: string[]; assigned_to_ids: string[];
  test_environment_id: string; test_configuration_id: string; test_data_set_id: string;
  execution_mode: "manual" | "remote" | "local";
  parallel_enabled: boolean; parallel_count: number;
};
export function runEditDraft(run: Execution): RunEditDraft {
  const suiteIds = run.suite_ids || [];
  const legacyDirectIds = run.case_snapshots?.length
    ? run.case_snapshots.filter((item) => !item.suite_id || !suiteIds.includes(item.suite_id)).map((item) => item.test_case_id)
    : suiteIds.length ? [] : run.test_case_ids || [];
  return {
    test_data_options: { override_lower_scopes: run.test_data_options?.override_lower_scopes !== false, override_shared_steps: run.test_data_options?.override_shared_steps !== false },
    name: run.name || "", start_date: run.start_date?.slice(0, 10) || "", end_date: run.end_date?.slice(0, 10) || "",
    release: run.release || "", sprint: run.sprint || "", build: run.build || "",
    suite_ids: [...suiteIds], test_case_ids: [...(run.direct_test_case_ids ?? legacyDirectIds)],
    assigned_to_ids: [...(run.assigned_to_ids || (run.assigned_to ? [run.assigned_to] : []))],
    test_environment_id: run.test_environment?.id || run.test_environment?.snapshot?.id || "", test_configuration_id: run.test_configuration?.id || run.test_configuration?.snapshot?.id || "", test_data_set_id: run.test_data_set?.id || run.test_data_set?.snapshot?.id || "",
    execution_mode: run.run_mode || (run.trigger === "local" ? "local" : run.trigger === "ci" ? "remote" : "manual"),
    parallel_enabled: Boolean(run.parallel_enabled), parallel_count: run.parallel_count || 1
  };
}

export function runEditLocks(run: Execution) {
  const finished = isRunFinished(run);
  const runtimeLocked = finished || run.status !== "queued" || Boolean(run.started_at);
  return { finished, runtimeLocked, scopeLocked: finished || (runtimeLocked && runEditDraft(run).execution_mode !== "manual") };
}

export function retainRunSelections<T extends { id: string }>(options: T[], selectedIds: string[], fallback: (id: string) => T): T[] {
  const available = new Set(options.map((option) => option.id));
  return [...options, ...[...new Set(selectedIds)].filter((id) => !available.has(id)).map(fallback)];
}
export function changedRunFields(initial: RunEditDraft, draft: RunEditDraft): Parameters<typeof api.executions.update>[1] {
  return Object.fromEntries(Object.entries(draft).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(initial[key as keyof RunEditDraft]))
    .map(([key, value]) => [key, ["start_date", "end_date", "test_environment_id", "test_configuration_id", "test_data_set_id"].includes(key) && value === "" ? null : value]));
}
