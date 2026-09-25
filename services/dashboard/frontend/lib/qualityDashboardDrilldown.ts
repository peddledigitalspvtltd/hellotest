import type { QualityDashboardGadgetResult } from '@hellotest/platform/frontend/src/types';

export type QualityDashboardEvidenceRow = QualityDashboardGadgetResult['rows'][number];

export type QualityDashboardDrilldown = {
  url: string;
  label: string;
  opensRecord: boolean;
  notice?: string;
};

type DrilldownOptions = {
  /** The currently selected project, rather than a project from a stale result. */
  projectId: string;
  row?: QualityDashboardEvidenceRow;
  groupLabel?: string;
  origin?: string;
};

type Destination = { path: string; plural: string; singular: string; recordParam: string };

const bugs: Destination = { path: '/issues', plural: 'defects', singular: 'defect', recordParam: 'issue' };
const stories: Destination = { path: '/stories', plural: 'stories', singular: 'story', recordParam: 'requirement' };
const cases: Destination = { path: '/test-cases', plural: 'test cases', singular: 'test case', recordParam: 'case' };
const runs: Destination = { path: '/executions', plural: 'test runs', singular: 'test run', recordParam: 'execution' };
const suites: Destination = { path: '/design', plural: 'test suites', singular: 'test suite', recordParam: 'suite' };

const destinationsByPath: Record<string, Destination> = {
  '/issues': bugs,
  '/feedback': bugs,
  // The requirements redirect drops search parameters; link to its canonical page.
  '/requirements': stories,
  '/stories': stories,
  '/test-cases': cases,
  '/executions': runs,
  // Suite authoring lives in DesignPage, which consumes the suite parameter.
  '/test-suites': suites,
  '/design': suites
};

const destinationsByRowType: Record<string, Destination> = {
  issue: bugs,
  story: stories,
  'test-case': cases,
  'test-run': runs,
  'test-suite': suites
};

function destinationForMetric(metric: QualityDashboardGadgetResult['gadget']['metric']): Destination {
  if (!metric || ['count', 'openDefects', 'linkedDefects', 'defectTraceability'].includes(metric)) return bugs;
  if (['requirementCoverage', 'coverageGaps', 'stories', 'devStoryCompletion', 'qaStoryCompletion', 'storyTestPassRate', 'storyExecutionCoverage', 'storiesWithOpenDefects'].includes(metric)) return stories;
  if (['testRuns', 'failedRuns', 'completedRuns30d', 'executionCycleHours', 'passRate', 'executionCompletion'].includes(metric)) return runs;
  if (metric === 'testSuites') return suites;
  return cases;
}

/**
 * Builds native BrowserRouter links without changing storage or opening a window.
 * The caller must retain the active project and surface `notice` for list links:
 * native lists do not consume chart labels or dashboard metric/release filters.
 */
export function buildQualityDashboardDrilldown(
  result: QualityDashboardGadgetResult,
  { projectId, row, groupLabel, origin }: DrilldownOptions
): QualityDashboardDrilldown {
  if (!projectId || result.project.id !== projectId) {
    throw new Error('This widget belongs to a different project. Refresh it before opening its evidence.');
  }
  if (result.gadget.data_source === 'jira') {
    throw new Error('Connected work-tracker evidence must open through its connected site.');
  }
  const currentOrigin = origin || (typeof window !== 'undefined' ? window.location.origin : '');
  const base = new URL(currentOrigin);
  if (!['https:', 'http:'].includes(base.protocol)) {
    throw new Error('The dashboard needs an HTTP workspace URL to open evidence.');
  }

  let destination = destinationForMetric(result.gadget.metric);
  if (result.drilldown_target) {
    const target = new URL(result.drilldown_target, base.origin);
    const supported = destinationsByPath[target.pathname];
    if (target.origin !== base.origin || !supported) {
      throw new Error('This widget does not have a supported native evidence destination.');
    }
    destination = supported;
  }

  // Outcome tables contain test-case IDs, not execution IDs. Row type takes
  // precedence over a metric's generic /executions destination.
  const recordDestination = row?.type ? destinationsByRowType[row.type] : undefined;
  if (recordDestination && !row?.id?.trim()) {
    throw new Error('This evidence record is missing its identifier. Refresh the widget and retry.');
  }
  const opensRecord = Boolean(recordDestination);
  if (recordDestination) destination = recordDestination;

  // Use only the origin: dashboard query parameters and hash fragments must not
  // leak into a native page. Every parameter below has a defined purpose.
  const url = new URL(destination.path, base.origin);
  url.searchParams.set('project', projectId);
  if (opensRecord && row) url.searchParams.set(destination.recordParam, row.id);

  let notice: string | undefined;
  if (!opensRecord) {
    const group = groupLabel?.trim();
    notice = `Opens the ${destination.plural} list in the active project and current application scope. Widget filters${group ? `, including the “${group}” chart group,` : ''} are not applied.`;
  } else if (recordDestination === cases && ['passRate', 'executionCompletion'].includes(result.gadget.metric || '')) {
    notice = 'Opens the reusable test case. This widget does not identify a specific run attempt.';
  }

  return {
    url: url.toString(),
    label: opensRecord ? `Open ${destination.singular}` : `Open ${destination.plural} list`,
    opensRecord,
    ...(notice ? { notice } : {})
  };
}
