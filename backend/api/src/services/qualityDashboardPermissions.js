const requirements = {
  count: ['feedback.view'], openDefects: ['feedback.view'],
  stories: ['requirement.view'], devStoryCompletion: ['requirement.view'], qaStoryCompletion: ['requirement.view'],
  requirementCoverage: ['requirement.view', 'testcase.view'], coverageGaps: ['requirement.view', 'testcase.view'],
  linkedTestCases: ['requirement.view', 'testcase.view'], unlinkedTestCases: ['requirement.view', 'testcase.view'],
  unassignedModuleCases: ['requirement.view', 'testcase.view'], moduleCaseCount: ['requirement.view', 'testcase.view'],
  testCases: ['testcase.view'], testSuites: ['suite.view'],
  automationCoverage: ['testcase.view', 'automation.view', 'automation.analytics.view'],
  testRuns: ['run.view'], failedRuns: ['run.view'], completedRuns30d: ['run.view'], executionCycleHours: ['run.view'],
  passRate: ['testcase.view', 'run.view', 'result.view'], executionCompletion: ['testcase.view', 'run.view', 'result.view'],
  failedCases: ['testcase.view', 'run.view', 'result.view'], blockedCases: ['testcase.view', 'run.view', 'result.view'], unexecutedCases: ['testcase.view', 'run.view', 'result.view'],
  storyTestPassRate: ['requirement.view', 'testcase.view', 'run.view', 'result.view'],
  storyExecutionCoverage: ['requirement.view', 'testcase.view', 'run.view', 'result.view'],
  storiesWithOpenDefects: ['requirement.view', 'testcase.view', 'feedback.view'],
  linkedDefects: ['requirement.view', 'testcase.view', 'run.view', 'feedback.view'],
  defectTraceability: ['requirement.view', 'testcase.view', 'run.view', 'feedback.view'],
  releaseConfidence: ['requirement.view', 'testcase.view', 'run.view', 'result.view', 'feedback.view'],
  evidenceConfidence: ['requirement.view', 'testcase.view', 'run.view', 'result.view', 'feedback.view']
};

// Validation still belongs to the evaluator. Unknown queries receive no data,
// and permission errors never expose the hidden source's records or counts.
module.exports = function dashboardPermissions(gadget = {}) {
  const permissions = new Set(requirements[gadget.metric || 'count'] || []);
  if (gadget.release || ['release', 'fixVersion', 'sprint', 'story', 'module', 'components'].includes(gadget.group_by)) permissions.add('requirement.view');
  return [...permissions];
};
