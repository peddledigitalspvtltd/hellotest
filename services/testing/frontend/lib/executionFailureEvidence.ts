import { assessRunEvidenceReadiness, type AiAssuranceAssessment } from "@hellotest/ai/frontend/lib/aiAssurance";
import { runStoryCounts } from "./runCatalog";
import type { ExecutionEvidenceReceipt } from "./executionRunSummary";

export function executionFailureReferenceRows<T extends { id: string; title: string }>(execution: ExecutionEvidenceReceipt | null, cases: T[]) {
  const byId = new Map(cases.map(testCase => [testCase.id, testCase]));
  return (execution?.failure_evidence?.instances || []).flatMap(instance => {
    const testCase = byId.get(instance.test_case_id);
    return testCase ? [{ testCase, status: instance.status, error: instance.error,
      defects: instance.defects.map(defect => defect.display_id || defect.id),
      references: instance.external_references, instanceKey: instance.instance_key,
      iterationIndex: instance.data_set_iteration_index, resultId: instance.result_id, coverage: instance.coverage }] : [];
  });
}

export function executionFailureReferenceStats(execution: ExecutionEvidenceReceipt | null) {
  const evidence = execution?.failure_evidence;
  return {
    availability: evidence?.availability || "unavailable",
    defectCount: evidence?.defect_count ?? null,
    referenceCount: evidence?.external_reference_count ?? null,
    capturedReferenceCount: evidence?.known_reference_count || 0,
    failedCaseCount: evidence?.failed_instance_count ?? null,
    ambiguousInstanceCount: evidence?.ambiguous_instance_count || 0
  };
}

export function executionFailureReferenceContext(execution: ExecutionEvidenceReceipt | null) {
  const evidence = executionFailureReferenceStats(execution);
  if (evidence.availability === "unavailable") return "reference evidence unavailable";
  const known = evidence.availability === "partial"
    ? evidence.capturedReferenceCount ? `${evidence.capturedReferenceCount} accessible external references; defect scope unavailable`
      : "defect reference evidence unavailable; no external references captured in accessible results"
    : `${evidence.capturedReferenceCount} known references are bounded to this run`;
  return known + (evidence.ambiguousInstanceCount ? "; exact instance coverage unknown for case-level links" : "");
}

export type ExecutionRunEvidenceAssessment = AiAssuranceAssessment & { scoreDisplay?: string };

export function executionFailureRiskLines<T extends { id: string; title: string }>(execution: ExecutionEvidenceReceipt | null, cases: T[]) {
  if (!execution?.failure_evidence || execution.failure_evidence.availability === "unavailable") {
    return ["- Failure reference evidence is unavailable; no absence of failures or references can be inferred."];
  }
  const rows = executionFailureReferenceRows(execution, cases);
  if (!rows.length) return ["- No failed or blocked instances are recorded in the latest frozen run evidence."];
  return rows.slice(0, 8).map(row => `- ${row.testCase.title}${row.iterationIndex !== null ? ` · Data row ${row.iterationIndex + 1}` : ""}: ${row.status}${row.defects.length ? `, defects ${row.defects.join(", ")}` : ""}${row.references.length ? `, references ${row.references.join(", ")}` : ""}${row.coverage === "ambiguous" ? ", exact row/attempt reference coverage unknown" : row.coverage === "unavailable" ? ", defect reference coverage unavailable" : ""}${row.error ? `, note ${row.error}` : ""}.`);
}

export function assessExecutionRunEvidence(execution: ExecutionEvidenceReceipt | null, fallback: {
  totalCaseCount: number; touchedCaseCount: number; linkedRequirementCount: number;
  failedCount: number; blockedCount: number;
}) {
  const summary = execution?.instance_summary;
  const references = executionFailureReferenceStats(execution);
  const assessment = assessRunEvidenceReadiness({
    totalCaseCount: summary?.total ?? fallback.totalCaseCount,
    touchedCaseCount: summary ? summary.passed + summary.failed + summary.blocked + summary.skipped + summary.aborted : fallback.touchedCaseCount,
    linkedRequirementCount: execution?.frozen_scope_evidence?.availability === "available"
      ? execution.frozen_scope_evidence.total_stories
      : execution ? runStoryCounts(execution, { totalRequirements: fallback.linkedRequirementCount, failedRequirementCount: 0 }).total : fallback.linkedRequirementCount,
    failedCount: summary?.failed ?? fallback.failedCount,
    blockedCount: summary?.blocked ?? fallback.blockedCount,
    referenceCount: references.capturedReferenceCount,
    referenceAvailability: references.availability,
    ambiguousReferenceCount: references.ambiguousInstanceCount
  });
  return { ...assessment, scoreDisplay: references.availability === "unavailable" ? "Unavailable"
    : references.availability === "partial" ? "Partial evidence" : `${assessment.score}%` };
}
