import type { QualityDashboard, QualityDashboardGadget } from '../types';

export type DashboardWidgetPreset = {
  id: string; label: string; description: string; category: 'Release' | 'Product' | 'Execution' | 'Coverage';
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
  native('defect-list', 'Open defect list', 'The underlying issues for the next triage conversation.', 'Product', 'openDefects', 'table', 'red'),
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
  native('test-growth', 'Test library growth', 'Test cases created each month.', 'Coverage', 'testCases', 'line', 'teal', 'createdMonth')
];

export const QUALITY_DASHBOARD_PRESETS = [
  { id: 'executive', label: 'Executive', name: 'Executive overview', description: 'Release confidence, product exposure and the decisions that need attention.', widgets: ['release-confidence', 'story-coverage', 'open-defects', 'pass-rate', 'execution-flow', 'defect-priority', 'uncovered-stories'] },
  { id: 'product', label: 'Product', name: 'Product quality', description: 'Connect story coverage with defect pressure and the growth of reusable tests.', widgets: ['story-coverage', 'coverage-gaps', 'open-defects', 'test-cases', 'coverage-breakdown', 'defect-owners', 'uncovered-stories', 'test-growth'] },
  { id: 'quality', label: 'QA', name: 'QA workspace', description: 'Track execution progress, investigate failures and focus the next testing cycle.', widgets: ['execution-completion', 'pass-rate', 'throughput', 'evidence-confidence', 'execution-flow', 'module-distribution', 'failed-run-list', 'run-trend'] }
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
