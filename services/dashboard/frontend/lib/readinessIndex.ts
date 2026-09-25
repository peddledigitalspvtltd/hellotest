import type { ReleaseReadinessModel } from "./releaseReadiness";

export type ReadinessIndexContext = {
  sourcesAvailable: boolean;
  evidenceComplete: boolean;
  scoped: boolean;
};
export type ReadinessIndexComponent = {
  id: "coverage" | "completion" | "pass-rate" | "defect-containment";
  weight: number;
  value: number | null;
  contribution: number | null;
};
export type ReadinessIndexCap = {
  id: "critical-defects" | "blocked-evidence" | "priority-coverage"
    | "incomplete-evidence" | "unscoped" | "stale-evidence" | "unknown-freshness";
  maximum: number;
};
export type ReadinessIndex = {
  score: number | null;
  rawScore: number | null;
  components: ReadinessIndexComponent[];
  caps: ReadinessIndexCap[];
  provisional: boolean;
};

const knownRate = (value: number | null) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100
    ? value : null;

/**
 * Advisory index, not a probability, source confidence or release approval.
 * Weights and risk caps follow the existing quality analytics index. This
 * release view retains its own run/data-row outcome semantics and withholds
 * an index when a required rate or source is unavailable. The missing-evidence
 * ceiling also applies to partial, unscoped or outdated release evidence.
 */
export function deriveReadinessIndex(
  model: ReleaseReadinessModel,
  context: ReadinessIndexContext,
): ReadinessIndex {
  const incomplete = !context.evidenceComplete || !model.evidenceComplete;
  const unknownFreshness = model.ageDays === null;
  const stale = model.ageDays !== null && model.ageDays > 14;
  const provisional = !context.sourcesAvailable || incomplete || !context.scoped || unknownFreshness || stale;
  const containment = model.issues.length
    ? Math.round((model.issues.length - model.openIssues.length) / model.issues.length * 100)
    : 100;
  const components: ReadinessIndexComponent[] = [
    { id: "coverage", weight: 25, value: model.metrics.coverage },
    { id: "completion", weight: 20, value: model.metrics.completion },
    { id: "pass-rate", weight: 35, value: model.metrics.passRate },
    { id: "defect-containment", weight: 20, value: containment },
  ].map((component) => {
    const value = context.sourcesAvailable ? knownRate(component.value) : null;
    return { ...component, id: component.id as ReadinessIndexComponent["id"], value, contribution: value === null ? null : value * component.weight / 100 };
  });
  const rawScore = components.some((component) => component.value === null)
    ? null
    : Math.round(components.reduce((total, component) => total + (component.contribution || 0), 0));
  const caps: ReadinessIndexCap[] = [];
  if (model.metrics.openCriticalBugCount > 0) caps.push({ id: "critical-defects", maximum: 39 });
  if (model.metrics.blockedCount > 0) caps.push({ id: "blocked-evidence", maximum: 59 });
  if (model.metrics.highPriorityUncoveredCount > 0) caps.push({ id: "priority-coverage", maximum: 69 });
  if (incomplete) caps.push({ id: "incomplete-evidence", maximum: 49 });
  if (!context.scoped) caps.push({ id: "unscoped", maximum: 49 });
  if (stale) caps.push({ id: "stale-evidence", maximum: 49 });
  if (unknownFreshness) caps.push({ id: "unknown-freshness", maximum: 49 });
  return {
    score: rawScore === null ? null : Math.min(rawScore, ...caps.map((cap) => cap.maximum)),
    rawScore,
    components,
    caps,
    provisional: provisional || rawScore === null,
  };
}
