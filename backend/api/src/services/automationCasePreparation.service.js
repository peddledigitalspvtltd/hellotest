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

exports.prepareAutomationTarget = async ({ testCaseId, createdBy, targetStepId, aiGenerated = false } = {}) => {
  const source = await testCaseService.getTestCase(testCaseId);
  if (source.automated === "yes") {
    if (targetStepId && !(await selectSteps.all(source.id)).some(step => step.id === targetStepId)) throw Object.assign(new Error("The selected recorder target step does not belong to this test case."), { statusCode: 400 });
    return { test_case_id: source.id, source_test_case_id: null, target_step_id: targetStepId || null };
  }
  const sourceSteps = await selectSteps.all(source.id);
  const sourceStepIndex = targetStepId ? sourceSteps.findIndex((step) => step.id === targetStepId) : -1;
  if (targetStepId && sourceStepIndex < 0) throw Object.assign(new Error("The selected recorder target step does not belong to this test case."), { statusCode: 400 });
  const existing = await selectPreparedCase.get(source.app_type_id, `automation-builder:${source.id}`);
  const prepared = existing || await testCaseService.createTestCase({
    ...buildAutomationCaseBlueprint({ source, steps: sourceSteps, createdBy }),
    ...(aiGenerated ? {
      ai_generation_source: "interactive",
      ai_generation_review_status: "pending",
      reviewer_id: createdBy,
      review_status: "pending"
    } : {})
  });
  const targetSteps = targetStepId ? await selectSteps.all(prepared.id) : [];
  const sourceStep = sourceSteps[sourceStepIndex];
  const sameStep = step => step.action === sourceStep.action && step.expected_result === sourceStep.expected_result
    && (step.step_type || "web") === (sourceStep.step_type || "web")
    && (step.reusable_group_id || null) === (sourceStep.reusable_group_id || null);
  const matchingTargetSteps = targetStepId ? targetSteps.filter(sameStep) : [];
  const matchingSourceSteps = targetStepId ? sourceSteps.filter(sameStep) : [];
  const sourceOccurrence = targetStepId ? sourceSteps.slice(0, sourceStepIndex).filter(sameStep).length : 0;
  // Step positions can change independently in linked cases. Never substitute
  // an unrelated step just because it occupies the old recorder position.
  const targetStep = targetStepId && matchingSourceSteps.length === matchingTargetSteps.length ? matchingTargetSteps[sourceOccurrence] : null;
  if (targetStepId && !targetStep) throw Object.assign(new Error("The linked automation case no longer has an unambiguous match for this manual step. Restore its step mapping before recording."), { statusCode: 409 });
  await copyModuleMembership.run(prepared.id, source.id);
  return { test_case_id: prepared.id, source_test_case_id: source.id, target_step_id: targetStep?.id || null };
};
