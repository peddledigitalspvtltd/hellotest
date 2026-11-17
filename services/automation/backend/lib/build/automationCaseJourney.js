const issued = new WeakMap();
const invalid = () => Object.assign(new Error('The case journey must match the current authored section and authorized case snapshot.'), { code: 'AUTOMATION_CASE_JOURNEY_INVALID', statusCode: 422, nonRetryable: true });
const excerpt = (value, limit) => ({ text: value.slice(0, limit), ...(value.length > limit ? { truncated: true } : {}) });

/** A compact map of intent and ordering, not an execution grant. Complete
 * section text stays in this host snapshot and can be selected by exact ID. */
function createAutomationCaseJourney({ testCase, steps, activeStepId, completedStepIds = [], projectText } = {}) {
  if (!testCase || !Array.isArray(steps) || !steps.length || steps.length > 500 || typeof projectText !== 'function') throw invalid();
  const ids = new Set();
  const text = value => { const result = projectText(String(value ?? ''), { preserveReferences: true }); if (typeof result !== 'string') throw invalid(); return result; };
  const rows = steps.map((step, index) => {
    if (typeof step?.id !== 'string' || !step.id || step.id.length > 200 || ids.has(step.id)) throw invalid();
    ids.add(step.id);
    return Object.freeze({ step_id: step.id, position: index + 1, step_type: step.step_type || 'web', action: text(step.action), expected_result: text(step.expected_result) });
  });
  const position = rows.findIndex(row => row.step_id === activeStepId);
  if (position < 0 || !Array.isArray(completedStepIds) || completedStepIds.some(id => !ids.has(id) || rows.findIndex(row => row.step_id === id) >= position)) throw invalid();
  const completed = new Set(completedStepIds);
  const stateFor = (row, index) => index === position ? 'current' : completed.has(row.step_id)
    ? row.step_type === 'web' ? 'browser_confirmed_and_saved_this_build' : 'saved_source_unverified_this_build'
    : index < position ? 'earlier_unconfirmed_this_build' : 'future';
  const intent = { title: text(testCase.title), description: text(testCase.description), preconditions: text(testCase.preconditions) };
  const selected = new Set([0, rows.length - 1, position]);
  for (let i = Math.max(0, position - 3); i <= Math.min(rows.length - 1, position + 3); i++) selected.add(i);
  const context = { intent: { title: excerpt(intent.title, 300), description: excerpt(intent.description, 600), preconditions: excerpt(intent.preconditions, 500) },
    active_step_id: activeStepId, active_position: position + 1, total_steps: rows.length,
    steps: [...selected].sort((a, b) => a - b).map(index => ({ ...rows[index], action: excerpt(rows[index].action, 140), expected_result: excerpt(rows[index].expected_result, 160),
      state: stateFor(rows[index], index) })),
    omitted_step_count: rows.length - selected.size,
    policy: 'Intent and order are context. Only current obligations are actionable. Prior source is not a current run pass. Diagnose a missing UI prerequisite before repeating checks; never execute a later authored action early or invent data/outcomes.' };
  const value = Object.freeze({
    context: () => structuredClone(context),
    index: () => rows.map(row => ({ step_id: row.step_id, position: row.position })),
    select: stepIds => {
      if (!Array.isArray(stepIds) || !stepIds.length || stepIds.length > 8 || new Set(stepIds).size !== stepIds.length || stepIds.some(id => !ids.has(id))) throw invalid();
      return stepIds.map(id => structuredClone(rows.find(row => row.step_id === id)));
    }
  });
  issued.set(value, { activeStepId, rows:rows.map((row,index)=>({...row,state:stateFor(row,index)})), position, intent });
  return value;
}

function automationJourneyRequirements(journey, stepId) {
  const state = issued.get(journey);
  if (!state || state.activeStepId !== stepId) throw invalid();
  return structuredClone({ intent: state.intent, current: state.rows[state.position], previous: state.rows.slice(0, state.position), future: state.rows.slice(state.position + 1) });
}

module.exports = { createAutomationCaseJourney, automationJourneyRequirements };
