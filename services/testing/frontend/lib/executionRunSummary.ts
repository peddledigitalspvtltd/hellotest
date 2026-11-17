import type { Execution, ExecutionResult } from "@hellotest/platform/frontend/src/types";
import { selectLatestExecutionResultInstances } from "./executionResultMetrics";

export type CanonicalInstanceSummary = {
  total: number; passed: number; failed: number; blocked: number; running: number;
  pending: number; paused: number; skipped: number; aborted: number;
  pass_rate: number | null; distinct_cases: number; attempts?: number;
};
export type FrozenStory = { id: string; display_id?: string; title: string; test_case_ids: string[]; failed_test_case_ids?: string[] };
export type FrozenScopeEvidence = {
  availability: "available" | "unavailable"; story_links_frozen?: boolean; story_link_provenance?: "frozen_snapshot" | "legacy_current_links"; total_stories: number;
  impacted_stories: FrozenStory[]; stories: FrozenStory[]; population: "frozen_run_cases";
};
export type ExecutionEvidenceReceipt = Execution & {
  instance_summary?: CanonicalInstanceSummary;
  frozen_scope_evidence?: FrozenScopeEvidence;
  failure_evidence?: FailureEvidence;
};

export type FailureEvidence = {
  availability: "available" | "partial" | "unavailable";
  population: "latest_frozen_failed_or_blocked_instances";
  failed_instance_count: number | null; referenced_instance_count: number | null;
  ambiguous_instance_count: number | null; defect_count: number | null;
  external_reference_count: number | null; reference_count: number | null;
  known_reference_count: number;
  instances: Array<{
    test_case_id: string; result_id: string | null; instance_key: string;
    status: "failed" | "blocked"; data_set_iteration_index: number | null;
    data_set_iteration_key: string | null; error: string; external_references: string[];
    defects: Array<{ id: string; display_id: string | null }>;
    coverage: "referenced" | "unreferenced" | "ambiguous" | "unavailable";
  }>;
};

/** The list receipt owns counts. Historical linked-manual projections are lineage,
 * never additional executed instances. Legacy receipts use only frozen identities. */
export function canonicalRunSummary(execution: ExecutionEvidenceReceipt, results: ExecutionResult[]) {
  if (execution.instance_summary) return execution.instance_summary;
  const ids = new Set(execution.case_snapshots?.map(item => item.test_case_id) || execution.test_case_ids || []);
  const current = selectLatestExecutionResultInstances(results.filter(item => item.execution_id === execution.id && ids.has(item.test_case_id)));
  const count = (status: string) => current.filter(item => item.status === status).length;
  const passed = count("passed"), failed = count("failed"), blocked = count("blocked");
  return { total: current.length, passed, failed, blocked, running: count("running"), paused: count("paused"),
    skipped: count("skipped"), aborted: count("aborted"), pending: count("pending"),
    distinct_cases: new Set(current.map(item => item.test_case_id)).size,
    pass_rate: passed + failed + blocked ? Math.round(passed / (passed + failed + blocked) * 100) : null };
}

export function effectiveDataSummary(execution: Execution) {
  const sources = new Map<string, { name: string; cases: number; rows: number }>();
  for (const snapshot of execution.case_snapshots || []) {
    const data = snapshot.test_data_set_snapshot;
    const id = snapshot.test_data_set_id || data?.id;
    if (!id) continue;
    const entry = sources.get(id) || { name: snapshot.test_data_set_name || data?.name || "Frozen Data Set", cases: 0, rows: data?.mode === "key_value" ? 1 : data?.rows?.length || 1 };
    entry.cases += 1; sources.set(id, entry);
  }
  return Array.from(sources.values());
}
