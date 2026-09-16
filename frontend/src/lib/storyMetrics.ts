import type { Requirement } from '../types';

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
  const openBugHealth = openBugs === null ? null : Math.max(0, 100 - openBugs * 25);
  const readiness = executionComplete && linkedCases > 0 && executed > 0 && openBugHealth !== null ? Math.round(testCoverage * 0.3 + (executed ? passed / executed * 100 : 0) * 0.5 + openBugHealth * 0.2) : null;
  return { linkedCases, totalBugs, openBugs, testCoverage, passRate, automation, bugResolution, readiness, defectDensity: evidence ? totalBugs : null, groomed: evidence?.groomed, specified: evidence?.specified, slipped: evidence?.slipped, completed: evidence?.completed };
}

export function formatStoryPassRate(metric: { total: number; percent: number; complete?: boolean }) {
  return !metric.complete ? '—' : metric.total ? `${metric.percent}%` : 'No runs';
}
