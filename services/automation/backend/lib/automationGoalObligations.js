const MAX_MANUAL_OBLIGATIONS = 200;
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const invalid = reason => Object.assign(new Error('The current automation goal could not be pinned to its authorized section and linked manual steps.'), {
  code: 'AUTOMATION_GOAL_OBLIGATIONS_INVALID', statusCode: 422, nonRetryable: true, details: { reason }
});
const id = (value, reason) => {
  if (typeof value !== 'string' || !value.length || value.length > 200 || value.trim() !== value) throw invalid(reason);
  return value;
};
const text = (value, reason) => {
  // A saved optional field may be SQL NULL. Actual strings remain byte exact:
  // compound, negative and non-English requirements are never summarized here.
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw invalid(reason);
  return value;
};
const identity = (caseId, stepId) => JSON.stringify([caseId, stepId]);
const manualGoalId = (caseId, stepId) => {
  try { return `manual:${encodeURIComponent(caseId)}:${encodeURIComponent(stepId)}`; }
  catch { throw invalid('manual_identity_invalid'); }
};

/** Inputs are host-authorized saved records and host completion feedback.
 * Model assertions, coverage claims and page content cannot add obligations or
 * replace their specification. Every selected manual reference is rejoined to
 * the authorized case/step pair before its text enters the pinned contract. */
function buildAutomationGoalObligations({ section, manualCases = [], activeManualStepIds = [], requiredManualSteps = [] } = {}) {
  if (!isRecord(section)) throw invalid('section_required');
  const sectionId = id(section.id, 'section_id_invalid');
  if (!Array.isArray(manualCases) || !Array.isArray(activeManualStepIds) || !Array.isArray(requiredManualSteps)) throw invalid('goal_sources_invalid');
  const result = [{ id: sectionId, source: 'section', action: text(section.action, 'section_action_invalid'), expected_result: text(section.expected_result, 'section_expected_result_invalid') }];
  const cases = new Set(), byIdentity = new Map(), byStepId = new Map();
  for (const manualCase of manualCases) {
    if (!isRecord(manualCase)) throw invalid('manual_case_invalid');
    const caseId = id(manualCase.id, 'manual_case_id_invalid');
    if (cases.has(caseId)) throw invalid('manual_case_id_duplicate');
    cases.add(caseId);
    if (!Array.isArray(manualCase.steps)) throw invalid('manual_case_steps_invalid');
    for (const step of manualCase.steps) {
      if (!isRecord(step)) throw invalid('manual_step_invalid');
      const stepId = id(step.id, 'manual_step_id_invalid');
      if (step.test_case_id !== undefined && step.test_case_id !== caseId || step.manual_test_case_id !== undefined && step.manual_test_case_id !== caseId) throw invalid('manual_step_case_conflict');
      const key = identity(caseId, stepId);
      if (byIdentity.has(key)) throw invalid('manual_step_id_duplicate');
      const authorized = { id: manualGoalId(caseId, stepId), source: 'manual_step', manual_test_case_id: caseId, manual_step_id: stepId,
        action: text(step.action, 'manual_step_action_invalid'), expected_result: text(step.expected_result, 'manual_step_expected_result_invalid') };
      byIdentity.set(key, authorized);
      const references = byStepId.get(stepId) || [];
      references.push(authorized);
      byStepId.set(stepId, references);
    }
  }
  const selected = new Map();
  const select = authorized => {
    selected.set(identity(authorized.manual_test_case_id, authorized.manual_step_id), authorized);
    if (selected.size > MAX_MANUAL_OBLIGATIONS) throw invalid('manual_obligation_limit_exceeded');
  };
  for (const activeId of activeManualStepIds) {
    const matches = byStepId.get(id(activeId, 'active_manual_step_id_invalid')) || [];
    if (!matches.length) throw invalid('active_manual_step_unknown');
    if (matches.length !== 1) throw invalid('active_manual_step_ambiguous');
    select(matches[0]);
  }
  for (const required of requiredManualSteps) {
    if (!isRecord(required)) throw invalid('required_manual_step_invalid');
    const caseId = id(required.manual_test_case_id, 'required_manual_case_id_invalid');
    const stepId = id(required.manual_step_id, 'required_manual_step_id_invalid');
    const authorized = byIdentity.get(identity(caseId, stepId));
    if (!authorized) throw invalid('required_manual_step_unknown');
    if (!Object.hasOwn(required, 'action') || !Object.hasOwn(required, 'expected_result')) throw invalid('required_manual_specification_missing');
    if (text(required.action, 'required_manual_action_invalid') !== authorized.action || text(required.expected_result, 'required_manual_expected_result_invalid') !== authorized.expected_result) throw invalid('required_manual_specification_conflict');
    select(authorized);
  }
  for (const obligation of selected.values()) {
    if (obligation.id === sectionId) throw invalid('obligation_id_conflict');
    result.push(obligation);
  }
  return result;
}

/** Rejoin projected goal identities to their original authorized specification.
 * Host checks must not interpret words or @tokens inserted by test data as
 * authored requirements. Raw source remains host-only, never page evidence. */
function goalSourceObligations({ section, manualCases = [], obligations } = {}) {
  if (!Array.isArray(obligations) || !obligations.length || !obligations.some(row => row?.source === 'section' && row.id === section?.id)) throw invalid('parameter_goal_required');
  const requiredManualSteps = [];
  for (const row of obligations) {
    if (row?.source === 'section' && row.id === section?.id) continue;
    if (row?.source !== 'manual_step') throw invalid('parameter_goal_source_invalid');
    const source = manualCases.find(item => item.id === row.manual_test_case_id)?.steps?.find(step => step.id === row.manual_step_id);
    if (!source) throw invalid('parameter_goal_source_unknown');
    requiredManualSteps.push({ manual_test_case_id: row.manual_test_case_id, manual_step_id: row.manual_step_id,
      action: source.action ?? '', expected_result: source.expected_result ?? '' });
  }
  return buildAutomationGoalObligations({ section, manualCases, requiredManualSteps });
}

/** Recover bindings from original source only. Already projected goal text may
 * contain literal @tokens inside an inserted public value; those are not grants. */
function goalParameterReferences(options) {
  return require('./automationBrowserParameters').referencedParameterNames(goalSourceObligations(options));
}

module.exports = { buildAutomationGoalObligations, goalParameterReferences, goalSourceObligations };
