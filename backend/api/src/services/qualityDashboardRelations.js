// Curated joins operate on one authorized, complete project snapshot. Counts
// identify entities, never relationship rows: many-to-many links do not inflate
// a denominator or allow a foreign project record into a result.
const status = value => String(value || '').trim().toLowerCase().replace(/[ _-]+/g, '_');
const QA_DONE = new Set(['qa_done', 'done', 'closed', 'resolved', 'accepted', 'complete', 'completed']);
const DEV_DONE = new Set([...QA_DONE, 'dev_done', 'qa_ready', 'qa_in_progress', 'qa_blocked']);
const FINAL = new Set(['passed', 'failed', 'blocked', 'skipped', 'aborted', 'cancelled']);
const CLOSED_DEFECT = new Set(['closed', 'resolved', 'done', 'accepted', 'complete', 'completed', 'fixed', 'verified']);
const OPEN = value => !CLOSED_DEFECT.has(status(value));
const unique = values => [...new Set(Array.isArray(values) ? values.filter(Boolean) : [])];
const percentage = (count, total) => total ? Math.round(count * 100 / total) : 0;
const evidenceCache = new WeakMap();

const RELATIONAL_METRICS = {
  stories: 'Distinct stories in the selected project and planning scope.',
  devStoryCompletion: 'Stories in Dev Done, QA In Progress, QA Done or a completed status divided by all scoped stories. Each story counts once.',
  qaStoryCompletion: 'Stories in QA Done or a completed status divided by all scoped stories. Dev Done alone does not count.',
  storyTestPassRate: 'Stories with at least one linked test case and every linked case latest result passed, divided by all scoped stories. This measures test outcomes, not acceptance-criteria approval.',
  storyExecutionCoverage: 'Stories with at least one linked test case and every linked case latest result finalized, divided by all scoped stories. Passed, failed, blocked, N/A, aborted and cancelled count as finalized.',
  storiesWithOpenDefects: 'Distinct stories linked directly, or through their test cases, to at least one unresolved defect.',
  linkedTestCases: 'Distinct test cases linked to a scoped story. Multiple story links count once in the total.',
  unlinkedTestCases: 'Test cases with no valid story link in this project. Links to foreign or deleted stories do not count.',
  unassignedModuleCases: 'Test cases without an explicit module or a module inherited from a linked story.',
  linkedDefects: 'Distinct defects linked to a scoped story, test case or test run, including stored relation tables.',
  defectTraceability: 'Defects linked to a scoped story, test case or test run divided by all scoped defects. With no defects, no traceability gap is present.',
  failedCases: 'Distinct test cases whose latest saved result in the selected planning scope is failed.',
  blockedCases: 'Distinct test cases whose latest saved result in the selected planning scope is blocked.',
  unexecutedCases: 'Test cases without any saved result in the selected planning scope. A pending saved result is evidence of a planned attempt and is not included.'
};

function buildRelationalEvidence(context) {
  if (evidenceCache.has(context)) return evidenceCache.get(context);
  const cases = new Map(context.testCases.map(item => [item.id, item]));
  const stories = new Map(context.requirements.map(item => [item.id, item]));
  const runs = new Set(context.executions.map(item => item.id));
  const latest = new Map(context.results.filter(item => cases.has(item.test_case_id)).map(item => [item.test_case_id, item]));
  const caseStories = new Map();
  for (const story of stories.values()) for (const id of unique(story.test_case_ids)) {
    if (!cases.has(id)) continue;
    if (!caseStories.has(id)) caseStories.set(id, new Set());
    caseStories.get(id).add(story.id);
  }
  const storyDefects = new Map();
  const linkedDefects = context.issues.filter(defect => {
    const linkedStories = new Set(unique(defect.linked_requirement_ids).filter(id => stories.has(id)));
    const linkedCases = unique(defect.linked_test_case_ids).filter(id => cases.has(id));
    for (const id of linkedCases) for (const storyId of caseStories.get(id) || []) linkedStories.add(storyId);
    if (OPEN(defect.status)) for (const id of linkedStories) {
      if (!storyDefects.has(id)) storyDefects.set(id, new Set());
      storyDefects.get(id).add(defect.id);
    }
    return linkedStories.size || linkedCases.length || runs.has(defect.linked_test_run_id);
  });
  const storyRows = [...stories.values()].map(story => {
    const ids = unique(story.test_case_ids).filter(id => cases.has(id));
    return { ...story, linked_case_count: ids.length,
      all_cases_passed: ids.length > 0 && ids.every(id => status(latest.get(id)?.status) === 'passed'),
      all_cases_finalized: ids.length > 0 && ids.every(id => FINAL.has(status(latest.get(id)?.status))),
      open_defect_count: storyDefects.get(story.id)?.size || 0 };
  });
  const caseRows = [...cases.values()].map(item => ({ ...item,
    story_titles: [...caseStories.get(item.id) || []].map(id => `${stories.get(id).display_id || id}: ${stories.get(id).title}`),
    latest_status: latest.get(item.id)?.status || null
  }));
  const records = {
    stories: storyRows, devStoryCompletion: storyRows, qaStoryCompletion: storyRows,
    storyTestPassRate: storyRows, storyExecutionCoverage: storyRows,
    storiesWithOpenDefects: storyRows.filter(item => item.open_defect_count > 0),
    linkedTestCases: caseRows.filter(item => caseStories.has(item.id)),
    unlinkedTestCases: caseRows.filter(item => !(item.requirement_ids || []).length),
    unassignedModuleCases: caseRows.filter(item => !(item.module_ids || []).length),
    linkedDefects, defectTraceability: context.issues,
    failedCases: caseRows.filter(item => status(item.latest_status) === 'failed').map(item => ({ ...item, status: item.latest_status })),
    blockedCases: caseRows.filter(item => status(item.latest_status) === 'blocked').map(item => ({ ...item, status: item.latest_status })),
    unexecutedCases: caseRows.filter(item => !latest.has(item.id))
  };
  const values = Object.fromEntries(Object.entries(records).map(([metric, rows]) => [metric, rows.length]));
  Object.assign(values, {
    devStoryCompletion: percentage(storyRows.filter(item => DEV_DONE.has(status(item.status))).length, storyRows.length),
    qaStoryCompletion: percentage(storyRows.filter(item => QA_DONE.has(status(item.status))).length, storyRows.length),
    storyTestPassRate: percentage(storyRows.filter(item => item.all_cases_passed).length, storyRows.length),
    storyExecutionCoverage: percentage(storyRows.filter(item => item.all_cases_finalized).length, storyRows.length),
    defectTraceability: context.issues.length ? percentage(linkedDefects.length, context.issues.length) : 100
  });
  const evidence = { records, values, linkedDefects, storyRows };
  evidenceCache.set(context, evidence);
  return evidence;
}

module.exports = { RELATIONAL_METRICS, buildRelationalEvidence, QA_DONE, DEV_DONE, status };
