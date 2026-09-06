const db = require("../db");
const testCaseService = require("./testCase.service");
const { buildAutomationCaseBlueprint } = require("../utils/automationCaseBlueprint");

const selectSteps = db.prepare("SELECT * FROM test_steps WHERE test_case_id = ? ORDER BY step_order ASC, id ASC");
const selectPreparedCase = db.prepare("SELECT id FROM test_cases WHERE app_type_id = ? AND source_idempotency_key = ? AND automated = 'yes'");
const copyModuleMembership = db.prepare(`
  INSERT INTO test_case_module_cases (module_id, test_case_id, sort_order)
  SELECT source.module_id, ?, (
    SELECT COALESCE(MAX(existing.sort_order), 0) + 1
    FROM test_case_module_cases existing WHERE existing.module_id = source.module_id
  )
  FROM test_case_module_cases source WHERE source.test_case_id = ?
  ON CONFLICT DO NOTHING
`);

exports.prepareAutomationTarget = async ({ testCaseId, createdBy, targetStepId } = {}) => {
  const source = await testCaseService.getTestCase(testCaseId);
  if (source.automated === "yes") return { test_case_id: source.id, source_test_case_id: null, target_step_id: targetStepId || null };
  const sourceSteps = await selectSteps.all(source.id);
  const sourceStepIndex = targetStepId ? sourceSteps.findIndex((step) => step.id === targetStepId) : -1;
  if (targetStepId && sourceStepIndex < 0) throw new Error("The selected recorder target step does not belong to this test case.");
  const existing = await selectPreparedCase.get(source.app_type_id, `automation-builder:${source.id}`);
  const prepared = existing || await testCaseService.createTestCase(buildAutomationCaseBlueprint({ source, steps: sourceSteps, createdBy }));
  await copyModuleMembership.run(prepared.id, source.id);
  const targetSteps = targetStepId ? await selectSteps.all(prepared.id) : [];
  const sourceStep = sourceSteps[sourceStepIndex];
  const matchingTargetSteps = targetStepId ? targetSteps.filter((step) => step.action === sourceStep.action && step.expected_result === sourceStep.expected_result) : [];
  const sourceOccurrence = targetStepId ? sourceSteps.slice(0, sourceStepIndex).filter((step) => step.action === sourceStep.action && step.expected_result === sourceStep.expected_result).length : 0;
  const targetStep = targetStepId ? matchingTargetSteps[sourceOccurrence] || targetSteps[sourceStepIndex] : null;
  if (targetStepId && !targetStep) throw new Error("The linked automation case no longer contains this manual step. Restore its step mapping before recording.");
  return { test_case_id: prepared.id, source_test_case_id: source.id, target_step_id: targetStep?.id || null };
};
