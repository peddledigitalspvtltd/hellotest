// Keep these deterministic previews aligned with the built-in dashboard library.
// Templates require no provider request and never contain inferred project data.
const widget = (metric, title, type = 'metric', accent = 'blue', group_by = 'status') => ({ metric, title, type, accent, group_by });
const widgets = {
  releaseConfidence: widget('releaseConfidence', 'Release confidence'),
  evidenceConfidence: widget('evidenceConfidence', 'Evidence confidence', 'metric', 'teal'),
  storyCoverage: widget('requirementCoverage', 'Story coverage', 'metric', 'green'),
  openDefects: widget('openDefects', 'Open defects', 'metric', 'red'),
  passRate: widget('passRate', 'Case pass rate', 'metric', 'green'),
  runStatus: widget('testRuns', 'Run status', 'donut'),
  defectPriority: widget('openDefects', 'Defects by priority', 'bar', 'orange', 'priority'),
  uncoveredStories: widget('coverageGaps', 'Stories needing tests', 'table', 'orange'),
  coverageGaps: widget('coverageGaps', 'Coverage gaps', 'metric', 'orange'),
  testCases: widget('testCases', 'Test cases'),
  coverageBreakdown: widget('requirementCoverage', 'Story coverage breakdown', 'donut', 'green'),
  defectOwners: widget('openDefects', 'Defects by owner', 'bar', 'orange', 'assignee'),
  testGrowth: widget('testCases', 'Test library growth', 'line', 'teal', 'createdMonth'),
  executionCompletion: widget('executionCompletion', 'Execution completion'),
  throughput: widget('completedRuns30d', 'Completed runs · 30 days', 'metric', 'teal'),
  moduleDistribution: widget('moduleCaseCount', 'Tests by module', 'bar', 'purple', 'module'),
  failedRunList: widget('failedRuns', 'Runs needing investigation', 'table', 'red'),
  runTrend: widget('testRuns', 'Run activity', 'line', 'blue', 'createdWeek')
};
const templates = {
  executive: {
    name: 'Executive overview', description: 'Release confidence, product exposure and the decisions that need attention.',
    widgets: ['releaseConfidence', 'storyCoverage', 'openDefects', 'passRate', 'runStatus', 'defectPriority', 'uncoveredStories']
  },
  product: {
    name: 'Product quality', description: 'Connect story coverage with defect pressure and the growth of reusable tests.',
    widgets: ['storyCoverage', 'coverageGaps', 'openDefects', 'testCases', 'coverageBreakdown', 'defectOwners', 'uncoveredStories', 'testGrowth']
  },
  quality: {
    name: 'QA workspace', description: 'Track execution progress, investigate failures and focus the next testing cycle.',
    widgets: ['executionCompletion', 'passRate', 'throughput', 'evidenceConfidence', 'runStatus', 'moduleDistribution', 'failedRunList', 'runTrend']
  }
};
module.exports = Object.fromEntries(Object.entries(templates).map(([id, template]) => [id, { ...template, gadgets: template.widgets.map((key) => widgets[key]) }]));
