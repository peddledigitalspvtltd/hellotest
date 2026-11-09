const invalid = (message) => Object.assign(new Error(message), { code: 'AUTOMATION_RECORDER_CASE_CHANGED', statusCode: 409 });
const { recorderPlanFingerprint: snapshot } = require('../lib/automationRecorderPlan');
const { inferAutomationStepType } = require('@hellotest/platform/backend/src/utils/testStepAutomation');

/** A full web recording replaces the web plan, including copied manual prose.
 * Reuse row identities where possible, keep other runtimes, and commit every
 * replacement/removal together. Shared definitions are never edited by import. */
async function persistWebRecorderPlan({ caseId, candidates, expectedSteps }, { transaction, lockCase, readSteps, updateStep, createStep, deleteStep, reorderStep, updateCaseReadiness }) {
  if (!candidates.length) return [];
  return transaction(async () => {
    if (!await lockCase(caseId)) throw invalid('The recorder case no longer exists. Existing instructions were retained.');
    const steps = await readSteps(caseId);
    if (snapshot(steps) !== snapshot(expectedSteps)) throw invalid('The case changed while preparing this recording. Refresh the plan before saving. Existing instructions were retained.');
    const webSteps = steps.filter(step => inferAutomationStepType(step) === 'web');
    const firstWebIndex = steps.findIndex(step => webSteps.includes(step));
    const retained = steps.filter(step => !webSteps.includes(step));
    const insertionIndex = firstWebIndex < 0 ? retained.length : firstWebIndex;
    const plan = [...retained.slice(0, insertionIndex), ...candidates.map((candidate, index) => ({ candidate, existing: webSteps[index] })), ...retained.slice(insertionIndex)];
    const applied = [], orderedIds = [];
    for (let index = 0; index < plan.length; index++) {
      const entry = plan[index], stepOrder = index + 1;
      if (!entry.candidate) {
        orderedIds.push(entry.id);
        continue;
      }
      const { candidate, existing } = entry;
      const input = { step_order: stepOrder, action: candidate.action, expected_result: candidate.expected_result || '', step_type: 'web',
        automation_code: candidate.automation_code, api_request: null, group_id: null, group_name: null, group_kind: null, reusable_group_id: null };
      let stepId = existing?.id;
      if (stepId) await updateStep(stepId, input, { syncSharedGroup: false });
      else {
        const created = await createStep({ test_case_id: caseId, ...input }, { syncSharedGroup: false });
        if (!created?.id) throw new Error('The recorded step could not be saved. Existing instructions were retained.');
        stepId = created.id;
      }
      orderedIds.push(stepId);
      applied.push({ step_id: stepId, ...input, operation: existing ? 'updated' : 'created', mapping_source: 'recorded',
        source_action_index: candidate.source_action_index, source_action_indexes: [candidate.source_action_index],
        keywords: [candidate.keyword].filter(Boolean), has_code: true, has_api_request: false });
    }
    for (const step of webSteps.slice(candidates.length)) await deleteStep(step.id, { syncSharedGroup: false });
    for (const [index, id] of orderedIds.entries()) await reorderStep(id, index + 1);
    if (updateCaseReadiness) await updateCaseReadiness(caseId);
    return applied;
  });
}

/** A selected section keeps its specification and row identity. Its complete
 * recorded program and optimistic plan guard share the same write boundary. */
async function persistWebRecorderSection({ caseId, targetStepId, candidates, automationCode, expectedSteps }, { transaction, lockCase, readSteps, updateStep }) {
  if (!candidates.length || !automationCode) return [];
  return transaction(async () => {
    if (!await lockCase(caseId)) throw invalid('The recorder case no longer exists. Existing instructions were retained.');
    const steps = await readSteps(caseId);
    if (snapshot(steps) !== snapshot(expectedSteps)) throw invalid('The case changed while preparing this recording. Existing instructions were retained.');
    const step = steps.find(row => row.id === targetStepId);
    if (!step || inferAutomationStepType(step) !== 'web') throw Object.assign(new Error('The selected Web recorder section no longer exists. Existing instructions were retained.'), { code: 'AUTOMATION_RECORDER_TARGET_CHANGED', statusCode: 409 });
    await updateStep(step.id, { step_type: 'web', automation_code: automationCode, api_request: null }, { syncSharedGroup: false });
    return [{ step_id: step.id, step_order: step.step_order, step_type: 'web', action: step.action || '', expected_result: step.expected_result || '',
      automation_code: automationCode, operation: 'updated', mapping_source: 'selected_section', source_action_index: candidates[0]?.source_action_index ?? null,
      source_action_indexes: candidates.map(candidate => candidate.source_action_index), keywords: [...new Set(candidates.map(candidate => candidate.keyword).filter(Boolean))],
      has_code: true, has_api_request: false }];
  });
}

module.exports = { persistWebRecorderPlan, persistWebRecorderSection };
