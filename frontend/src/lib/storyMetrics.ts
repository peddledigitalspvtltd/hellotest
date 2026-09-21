import type { Requirement } from '../types';
import type { RequirementCatalogMetrics } from './requirementCatalog';

export type StoryCoverageMetric = {
  total: number;
  covered: number;
  percent: number;
  known?: number;
  complete: boolean;
};

const count = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
const percent = (value: number, total: number) => total ? Math.round(value / total * 100) : 0;
const uniqueCount = (values?: string[]) => new Set(values || []).size;

/** Use complete record evidence; suggestion pages and run previews never define metric populations. */
export function deriveStoryMetrics(story?: Requirement | null) {
  const evidence = story?.catalog_metrics;
  const linkedCases = evidence ? count(evidence.linked_cases) : uniqueCount(story?.test_case_ids);
  const totalBugs = evidence ? count(evidence.total_bugs) : uniqueCount(story?.defect_ids || story?.defects?.map((bug) => bug.id));
  const executionComplete = Boolean(evidence?.execution_complete && evidence.executed_cases !== null && evidence.passed_cases !== null);
  const executed = executionComplete ? Math.min(linkedCases, count(evidence?.executed_cases)) : 0;
  const passed = executionComplete ? Math.min(executed, count(evidence?.passed_cases)) : 0;
  const automated = Math.min(linkedCases, count(evidence?.automated_cases));
  const closedBugs = Math.min(totalBugs, count(evidence?.closed_bugs));
  const openBugs = evidence ? Math.min(totalBugs, count(evidence.open_bugs)) : null;
  const testCoverage = linkedCases ? 100 : 0;
  const passRate: StoryCoverageMetric = { total: executed, covered: passed, percent: percent(passed, executed), known: executed, complete: executionComplete };
  const automation: StoryCoverageMetric = { total: linkedCases, covered: automated, percent: percent(automated, linkedCases), known: evidence ? linkedCases : 0, complete: Boolean(evidence && evidence.automation_complete !== false) };
  const bugResolution: StoryCoverageMetric = { total: totalBugs, covered: closedBugs, percent: percent(closedBugs, totalBugs), complete: Boolean(evidence) };
  const readiness = evidence?.readiness?.score ?? null;
  return { linkedCases, totalBugs, openBugs, testCoverage, passRate, automation, bugResolution, readiness, defectDensity: evidence ? totalBugs : null, groomed: evidence?.groomed, specified: evidence?.specified, slipped: evidence?.slipped, completed: evidence?.completed };
}

export function formatStoryPassRate(metric: { total: number; percent: number; complete?: boolean }) {
  return !metric.complete ? '—' : metric.total ? `${metric.percent}%` : 'No runs';
}

export function storyCoverageBreakdown(
  metric: { total: number; covered: number; complete?: boolean } | undefined,
  kind: 'pass' | 'automation'
) {
  if (!metric || metric.complete === false) return undefined;
  const total = count(metric.total);
  const covered = Math.min(total, count(metric.covered));
  return {
    total,
    segments: kind === 'pass'
      ? [
          { key: 'passed', label: 'Passed', count: covered },
          // The catalog provides a finalized total and pass count, without a
          // failed/blocked split. Preserve that distinction in the tooltip.
          { key: 'unknown', label: 'Other finalized outcomes', count: total - covered }
        ]
      : [
          { key: 'covered', label: 'Automated', count: covered },
          { key: 'uncovered', label: 'Not automated', count: total - covered }
        ]
  };
}

export function deriveBacklogPlanningMetrics(metrics:RequirementCatalogMetrics) {
  const growth = metrics.growth;
  const combined = metrics.total ? Math.round(metrics.highPriority / metrics.total * 100) : null;
  const critical = metrics.total && typeof metrics.criticalPriority === 'number' ? Math.round(metrics.criticalPriority / metrics.total * 100) : null;
  const high = metrics.total && typeof metrics.highOnlyPriority === 'number' ? Math.round(metrics.highOnlyPriority / metrics.total * 100) : null;
  return {
    growth:{
      label:'Backlog Growth Rate', value:growth ? `${growth.added}:${growth.departures}` : '—', progress:null,
      tone:!growth || !growth.added && !growth.departures ? 'neutral' as const : growth.added > growth.departures ? 'danger' as const : 'success' as const,
      detail:growth ? `${growth.added} added, ${growth.completed} completed, ${growth.removed} removed; net ${growth.net > 0 ? '+' : ''}${growth.net}. Full project, independent of catalog filters. ${growth.partial ? `Partial UTC month: tracking began ${new Date(growth.tracking_started_at).toLocaleDateString()}; earlier history is unavailable.` : `UTC month from ${new Date(growth.period_start).toLocaleDateString()}.`}` : 'Durable backlog history is unavailable; no historical activity has been inferred from current Stories.',
      methodology:'Monthly additions : (completions + removals). A ratio above 1:1 means backlog demand is growing faster than it leaves. Created, reopened, and returned Stories count as additions. Sprint/Release assignment counts as removal; completed Stories are counted once. Deletions remain in the history.'
    },
    priority:{
      label:'Priority Distribution', value:critical === null || high === null ? '—' : `${combined}%`, progress:combined,
      tone:metrics.total && metrics.highPriority / metrics.total >= 0.6 ? 'danger' as const : critical === null ? 'neutral' as const : (metrics.criticalPriority || 0) / metrics.total < 0.2 ? 'success' as const : 'warning' as const,
      detail:critical === null || high === null ? 'Full-scope P1/P2 priority counts are unavailable.' : `P1 Critical: ${metrics.criticalPriority}/${metrics.total} (${critical}%). P2 High: ${metrics.highOnlyPriority}/${metrics.total} (${high}%). Combined P1/P2: ${combined}%. Includes every matching backlog Story.`,
      methodology:'P1 or P2 Stories ÷ all matching backlog Stories × 100. Healthy when Critical is below 20%; danger when combined P1 + P2 is 60% or more.'
    }
  };
}
