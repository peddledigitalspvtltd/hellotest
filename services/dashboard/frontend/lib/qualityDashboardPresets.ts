import type { QualityDashboard, QualityDashboardGadget } from '@hellotest/platform/frontend/src/types';

export type DashboardWidgetPreset = {
  id: string; label: string; description: string; category: 'Release' | 'Product' | 'Execution' | 'Coverage' | 'Relationships';
  gadget: QualityDashboardGadget;
  automation?: boolean;
};
const native = (id: string, label: string, description: string, category: DashboardWidgetPreset['category'], metric: QualityDashboardGadget['metric'], type: QualityDashboardGadget['type'] = 'metric', accent: QualityDashboardGadget['accent'] = 'blue', group_by: QualityDashboardGadget['group_by'] = 'status'): DashboardWidgetPreset => ({
  id, label, description, category, gadget: { id, title: label, data_source: 'hellotest', jql: '', metric, type, accent, group_by }
});
export const QUALITY_WIDGET_LIBRARY: DashboardWidgetPreset[] = [
  native('release-confidence', 'Release confidence', 'A combined signal from coverage, execution and open risk.', 'Release', 'releaseConfidence'),
  native('evidence-confidence', 'Evidence confidence', 'How much saved execution evidence supports a release review.', 'Release', 'evidenceConfidence', 'metric', 'teal'),
  native('open-defects', 'Open defects', 'Unresolved defects that need attention.', 'Product', 'openDefects', 'metric', 'red'),
  native('defect-priority', 'Defects by priority', 'See where unresolved defect risk is concentrated.', 'Product', 'openDefects', 'bar', 'orange', 'priority'),
  native('defect-owners', 'Defects by owner', 'Distribute triage and follow up on unassigned defects.', 'Product', 'openDefects', 'bar', 'orange', 'assignee'),
  native('defect-list', 'Open defect list', 'The underlying defects for the next triage conversation.', 'Product', 'openDefects', 'table', 'red'),
  native('story-coverage', 'Story coverage', 'The share of stories linked to reusable test cases.', 'Coverage', 'requirementCoverage', 'metric', 'green'),
  native('coverage-gaps', 'Coverage gaps', 'Stories that still have no linked test cases.', 'Coverage', 'coverageGaps', 'metric', 'orange'),
  native('uncovered-stories', 'Stories needing tests', 'A concrete list of stories missing test coverage.', 'Coverage', 'coverageGaps', 'table', 'orange'),
  native('coverage-breakdown', 'Story coverage breakdown', 'Compare covered and uncovered story scope.', 'Coverage', 'requirementCoverage', 'donut', 'green'),
  { ...native('automation-coverage', 'Automation coverage', 'Reusable cases with saved automation coverage.', 'Coverage', 'automationCoverage', 'metric', 'purple'), automation: true },
  native('pass-rate', 'Case pass rate', 'Passing outcomes among the latest passed, failed or blocked case results.', 'Execution', 'passRate', 'metric', 'green'),
  native('execution-completion', 'Execution completion', 'Finalized cases across the planned run scope.', 'Execution', 'executionCompletion', 'metric', 'blue'),
  native('execution-flow', 'Run status', 'See the distribution of saved run outcomes.', 'Execution', 'testRuns', 'donut'),
  native('failed-runs', 'Failed runs', 'Runs whose saved outcomes need investigation.', 'Execution', 'failedRuns', 'metric', 'red'),
  native('failed-run-list', 'Runs needing investigation', 'Open the failed runs behind the headline count.', 'Execution', 'failedRuns', 'table', 'red'),
  native('throughput', 'Completed runs · 30 days', 'Recent completed run volume.', 'Execution', 'completedRuns30d', 'metric', 'teal'),
  native('cycle-time', 'Run cycle time', 'Average elapsed time from run start to finish.', 'Execution', 'executionCycleHours', 'metric', 'teal'),
  native('run-trend', 'Run activity', 'Run creation over time, grouped by week.', 'Execution', 'testRuns', 'line', 'blue', 'createdWeek'),
  native('test-cases', 'Test cases', 'Reusable test cases in this project.', 'Coverage', 'testCases'),
  native('test-suites', 'Test suites', 'Saved suites available for repeatable runs.', 'Coverage', 'testSuites', 'metric', 'purple'),
  native('module-distribution', 'Tests by module', 'The distribution of reusable tests across modules.', 'Coverage', 'moduleCaseCount', 'bar', 'purple', 'module'),
  native('test-growth', 'Test library growth', 'Test cases created each month.', 'Coverage', 'testCases', 'line', 'teal', 'createdMonth'),
  native('story-count', 'Total Stories', 'Every story in the selected project or release, counted once.', 'Product', 'stories'),
  native('dev-completion', 'Dev Story Completion', 'Dev Done, QA In Progress and completed stories as a share of all stories.', 'Release', 'devStoryCompletion', 'metric', 'blue'),
  native('qa-completion', 'QA Story Completion', 'QA Done and completed stories as a share of all stories.', 'Release', 'qaStoryCompletion', 'metric', 'green'),
  native('story-test-pass', 'Stories With All Tests Passed', 'Every linked test must have a passing latest result; uncovered stories remain in the denominator.', 'Relationships', 'storyTestPassRate', 'metric', 'green'),
  native('story-execution', 'Story Testing Completion', 'Stories whose linked tests all have finalized latest outcomes.', 'Relationships', 'storyExecutionCoverage', 'donut', 'teal'),
  native('story-defects', 'Stories With Open Defects', 'Open defects linked directly to a story or through its test cases.', 'Relationships', 'storiesWithOpenDefects', 'table', 'red'),
  native('tests-by-story', 'Tests By Story', 'Test cases joined to linked stories; shared tests appear in each story.', 'Relationships', 'linkedTestCases', 'bar', 'purple', 'story'),
  native('unlinked-tests', 'Tests Without Stories', 'Reusable tests without a valid story relationship in this project.', 'Relationships', 'unlinkedTestCases', 'table', 'orange'),
  native('tests-without-module', 'Tests Without Modules', 'Tests missing an explicit or story-inherited module.', 'Relationships', 'unassignedModuleCases', 'metric', 'orange'),
  native('defect-traceability', 'Defect Traceability', 'Defects linked to stories, tests or runs, including relation tables.', 'Relationships', 'defectTraceability', 'donut', 'teal'),
  native('linked-defects', 'Linked Defect List', 'Inspect defects connected to the selected delivery scope.', 'Relationships', 'linkedDefects', 'table', 'red'),
  native('failed-cases', 'Latest Failed Cases', 'Tests whose latest saved execution result failed.', 'Execution', 'failedCases', 'table', 'red'),
  native('blocked-cases', 'Latest Blocked Cases', 'Tests whose latest saved execution result is blocked.', 'Execution', 'blockedCases', 'metric', 'orange'),
  native('unexecuted-cases', 'Tests Without Run Evidence', 'Tests without a saved result in the selected scope.', 'Execution', 'unexecutedCases', 'metric', 'slate'),
  native('stories-by-sprint', 'Stories By Sprint', 'Compare story scope using the current linked sprint.', 'Product', 'stories', 'column', 'blue', 'sprint'),
  native('stories-by-release', 'Stories By Release', 'Compare native release membership, including inherited sprint stories.', 'Release', 'stories', 'column', 'purple', 'release'),
  native('defect-arrivals', 'Defect Arrivals', 'All recorded defects by creation month, including subsequently resolved defects.', 'Product', 'count', 'area', 'red', 'createdMonth'),
  native('story-flow', 'Story Status Distribution', 'Compare development and QA workflow states.', 'Product', 'stories', 'stacked-bar', 'teal')
];

const relationshipPaths: Partial<Record<NonNullable<QualityDashboardGadget['metric']>, string>> = {
  storyTestPassRate: 'Stories → Linked Tests → Latest Results',
  storyExecutionCoverage: 'Stories → Linked Tests → Latest Results',
  storiesWithOpenDefects: 'Stories → Linked Tests → Defects',
  linkedTestCases: 'Stories → Linked Tests', unlinkedTestCases: 'Tests → Story Relationships',
  unassignedModuleCases: 'Tests → Stories → Modules', moduleCaseCount: 'Tests → Stories → Modules',
  linkedDefects: 'Defects → Stories, Tests And Runs', defectTraceability: 'Defects → Stories, Tests And Runs',
  failedCases: 'Tests → Latest Results', blockedCases: 'Tests → Latest Results', unexecutedCases: 'Tests → Run Evidence',
  stories: 'Releases → Sprints → Stories', devStoryCompletion: 'Releases → Sprints → Story Status', qaStoryCompletion: 'Releases → Sprints → Story Status',
  requirementCoverage: 'Stories → Linked Tests', coverageGaps: 'Stories → Linked Tests'
};
const queryLabels: Partial<Record<NonNullable<QualityDashboardGadget['metric']>, string>> = {
  count: 'All Defects', stories: 'Total Stories', linkedTestCases: 'Linked Test Cases',
  openDefects: 'Open Defects', requirementCoverage: 'Story Coverage', coverageGaps: 'Stories Without Tests',
  testRuns: 'Test Runs', testCases: 'Test Cases', failedRuns: 'Failed Runs'
};
/** Each query selects a supported, project-scoped metric; no raw query text is executed. */
export const QUALITY_QUERY_LIBRARY = [...new Map(QUALITY_WIDGET_LIBRARY.map(widget => [widget.gadget.metric!, {
  metric: widget.gadget.metric!, label: queryLabels[widget.gadget.metric!] || widget.label,
  description: widget.description, category: widget.category, automation: widget.automation,
  relationship: relationshipPaths[widget.gadget.metric!] || 'Saved Project Evidence'
}])).values()];

/** Keep every category's count when the visual has room for a bounded legend. */
export function compactDashboardSeries(series: Array<{ label: string; value: number }>, limit = 8) {
  if (series.length <= limit) return series;
  const visible = series.slice(0, Math.max(limit - 1, 0));
  const remaining = series.slice(visible.length);
  return [...visible, { label: `Other Groups (${remaining.length})`, value: remaining.reduce((sum, item) => sum + item.value, 0) }];
}

export const QUALITY_DASHBOARD_PRESETS = [
  { id: 'executive', label: 'Executive', name: 'Executive overview', description: 'Release confidence, product exposure and the decisions that need attention.', widgets: ['release-confidence', 'story-coverage', 'open-defects', 'pass-rate', 'execution-flow', 'defect-priority', 'uncovered-stories'] },
  { id: 'product', label: 'Product', name: 'Product quality', description: 'Connect story coverage with defect pressure and the growth of reusable tests.', widgets: ['story-coverage', 'coverage-gaps', 'open-defects', 'test-cases', 'coverage-breakdown', 'defect-owners', 'uncovered-stories', 'test-growth'] },
  { id: 'quality', label: 'QA', name: 'QA workspace', description: 'Track execution progress, investigate failures and focus the next testing cycle.', widgets: ['execution-completion', 'pass-rate', 'throughput', 'evidence-confidence', 'execution-flow', 'module-distribution', 'failed-run-list', 'run-trend'] },
  { id: 'traceability', label: 'Traceability', name: 'Story Test Traceability', description: 'Follow stories through linked tests, execution outcomes, modules and defects.', widgets: ['story-coverage', 'story-test-pass', 'tests-without-module', 'unexecuted-cases', 'story-execution', 'tests-by-story', 'story-defects', 'unlinked-tests'] },
  { id: 'delivery', label: 'Delivery', name: 'Delivery Progress', description: 'Separate development completion from QA completion and inspect sprint and release scope.', widgets: ['story-count', 'dev-completion', 'qa-completion', 'story-test-pass', 'stories-by-sprint', 'stories-by-release', 'story-flow', 'story-defects'] },
  { id: 'triage', label: 'Triage', name: 'Defect And Test Triage', description: 'Review failing cases, linked defects, traceability gaps and defect arrivals.', widgets: ['open-defects', 'blocked-cases', 'unexecuted-cases', 'tests-without-module', 'defect-traceability', 'defect-arrivals', 'failed-cases', 'linked-defects'] }
] as const;

export type QualityDashboardPresetId = typeof QUALITY_DASHBOARD_PRESETS[number]['id'];
export function createDashboardPreset(projectId: string, presetId: QualityDashboardPresetId): QualityDashboard {
  const preset = QUALITY_DASHBOARD_PRESETS.find(item => item.id === presetId)!;
  return { id: `preset:${preset.id}`, project_id: projectId, name: preset.name, description: preset.description, layout: 'two-column',
    gadgets: preset.widgets.map(id => ({ ...QUALITY_WIDGET_LIBRARY.find(item => item.id === id)!.gadget, id: `${preset.id}:${id}` })) };
}
/** Display-only changes and ordering never invalidate the evaluated widget data. */
export function dashboardQueryGadgets(gadgets: QualityDashboardGadget[]) {
  return gadgets.map(({ id, data_source, jql, release, type, metric, group_by }) => ({ id, data_source: data_source || 'jira', title: '', jql, release, type, metric, group_by }))
    .sort((left, right) => left.id.localeCompare(right.id));
}
export function moveDashboardWidget(gadgets: QualityDashboardGadget[], id: string, target: number) {
  const index = gadgets.findIndex(item => item.id === id);
  if (index < 0 || target < 0 || target >= gadgets.length || index === target) return gadgets;
  const next = [...gadgets];
  const [widget] = next.splice(index, 1); next.splice(target, 0, widget);
  return next;
}
