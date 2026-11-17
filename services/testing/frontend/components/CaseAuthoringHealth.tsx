import { QualityMetricStrip } from "@hellotest/dashboard/frontend/components/QualityMetricStrip";

/** Saved case health is separate from the authoring form and its save guard. */
export function CaseAuthoringHealth({ metrics, suggestions, behaviorUnits, gherkin, defects, onReview }: {
  metrics: { authoring: number; stepCompleteness: number; passRate: number | null; finalizedRuns: number; passedRuns: number };
  suggestions: string[]; behaviorUnits: number; gherkin: boolean; defects: number; onReview: () => void;
}) {
  return <QualityMetricStrip ariaLabel="Saved test case authoring and execution health" className="test-case-health-strip" metrics={[
    { label: "Authoring completeness", criteriaKey: "metric.test.authoring_completeness", value: `${metrics.authoring}%`,
      detail: suggestions.length ? `${suggestions.length} authored design gaps: ${suggestions[0]}` : "Authored design fields present",
      progress: metrics.authoring, tone: "neutral", onClick: onReview },
    { label: gherkin ? "Scenario completeness" : "Step completeness", value: behaviorUnits ? `${metrics.stepCompleteness}%` : "—",
      detail: behaviorUnits ? `${Math.round(metrics.stepCompleteness / 100 * behaviorUnits)} of ${behaviorUnits} complete action/outcome pairs` : "No authored behavior",
      methodology: "Complete action and expected-result pairs ÷ authored behavior units × 100. Unit: percent; population: this saved case's authored steps or scenarios.",
      progress: behaviorUnits ? metrics.stepCompleteness : null, tone: "neutral" },
    { label: "Recent outcome pass rate", criteriaKey: "metric.library.recent_pass_rate", value: metrics.passRate === null ? "—" : `${metrics.passRate}%`,
      detail: metrics.finalizedRuns ? `${metrics.passedRuns} of ${metrics.finalizedRuns} finalized recorded outcomes passed` : "No finalized runs", tone: "neutral" },
    { label: "Linked defects", value: defects, detail: `${defects} distinct linked Defects`, methodology: "Distinct Defect identities linked to this saved case. Unit: Defects.", tone: defects ? "danger" : "neutral" }
  ]} />;
}
