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
  runTrend: widget('testRuns', 'Run activity', 'line', 'blue', 'createdWeek'),
  stories: widget('stories', 'Total Stories'),
  devCompletion: widget('devStoryCompletion', 'Dev Story Completion'),
  qaCompletion: widget('qaStoryCompletion', 'QA Story Completion', 'metric', 'green'),
  storyTestPass: widget('storyTestPassRate', 'Stories With All Tests Passed', 'metric', 'green'),
  storyExecution: widget('storyExecutionCoverage', 'Story Testing Completion', 'donut', 'teal'),
  storyDefects: widget('storiesWithOpenDefects', 'Stories With Open Defects', 'table', 'red'),
  testsByStory: widget('linkedTestCases', 'Tests By Story', 'bar', 'purple', 'story'),
  unlinkedTests: widget('unlinkedTestCases', 'Tests Without Stories', 'table', 'orange'),
  moduleGaps: widget('unassignedModuleCases', 'Tests Without Modules', 'metric', 'orange'),
  defectTraceability: widget('defectTraceability', 'Defect Traceability', 'donut', 'teal'),
  linkedDefects: widget('linkedDefects', 'Linked Defect List', 'table', 'red'),
  failedCases: widget('failedCases', 'Latest Failed Cases', 'table', 'red'),
  blockedCases: widget('blockedCases', 'Latest Blocked Cases', 'metric', 'orange'),
  unexecutedCases: widget('unexecutedCases', 'Tests Without Run Evidence', 'metric', 'slate'),
  storiesBySprint: widget('stories', 'Stories By Sprint', 'column', 'blue', 'sprint'),
  storiesByRelease: widget('stories', 'Stories By Release', 'column', 'purple', 'release'),
  defectArrivals: widget('count', 'Defect Arrivals', 'area', 'red', 'createdMonth'),
  storyFlow: widget('stories', 'Story Status Distribution', 'stacked-bar', 'teal')
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
  },
  traceability: {
    name: 'Story Test Traceability', description: 'Follow stories through linked tests, execution outcomes, modules and defects.',
    widgets: ['storyCoverage', 'storyTestPass', 'moduleGaps', 'unexecutedCases', 'storyExecution', 'testsByStory', 'storyDefects', 'unlinkedTests']
  },
  delivery: {
    name: 'Delivery Progress', description: 'Separate development completion from QA completion and inspect sprint and release scope.',
    widgets: ['stories', 'devCompletion', 'qaCompletion', 'storyTestPass', 'storiesBySprint', 'storiesByRelease', 'storyFlow', 'storyDefects']
  },
  triage: {
    name: 'Defect And Test Triage', description: 'Review failing cases, linked defects, traceability gaps and defect arrivals.',
    widgets: ['openDefects', 'blockedCases', 'unexecutedCases', 'moduleGaps', 'defectTraceability', 'defectArrivals', 'failedCases', 'linkedDefects']
  }
};
module.exports = Object.fromEntries(Object.entries(templates).map(([id, template]) => [id, { ...template, gadgets: template.widgets.map((key) => widgets[key]) }]));
