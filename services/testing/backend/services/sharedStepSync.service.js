const { normalizeSharedSteps, sharedStepsWithIds, sharedStepsFromReference } = require("../domain/sharedStepDefinition");
const db = require("@hellotest/platform/backend/src/db");
const { randomUUID: uuid } = require("crypto");
const {
  parseJsonValue
} = require("@hellotest/platform/backend/src/utils/testStepAutomation");

const selectSharedStepGroup = db.prepare(`
  SELECT id, app_type_id, name, steps
  FROM shared_step_groups
  WHERE id = ? FOR UPDATE
`);

const selectSharedReferenceSteps = db.prepare(`
  SELECT step.*
  FROM test_steps step
  JOIN test_cases test_case ON test_case.id = step.test_case_id
  JOIN shared_step_groups shared_group ON shared_group.id = step.reusable_group_id AND shared_group.app_type_id = test_case.app_type_id
  WHERE step.reusable_group_id = ?
  ORDER BY step.test_case_id ASC, step.group_id ASC, step.step_order ASC, step.id ASC
`);

const selectSharedReferenceInstance = db.prepare(`
  SELECT *
  FROM test_steps
  WHERE reusable_group_id = ? AND test_case_id = ? AND group_id = ?
  ORDER BY step_order ASC, id ASC
`);

const updateSharedGroupSteps = db.prepare(`
  UPDATE shared_step_groups
  SET steps = ?, updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
`);

const updateReferenceStep = db.prepare(`
  UPDATE test_steps
  SET
    step_order = ?,
    action = ?,
    expected_result = ?,
    step_type = ?,
    automation_code = ?,
    api_request = ?,
    group_name = ?,
    group_kind = 'reusable',
    reusable_group_id = ?
  WHERE id = ?
`);

const insertReferenceStep = db.prepare(`
  INSERT INTO test_steps (
    id,
    test_case_id,
    step_order,
    action,
    expected_result,
    step_type,
    automation_code,
    api_request,
    group_id,
    group_name,
    group_kind,
    reusable_group_id
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const deleteReferenceStep = db.prepare(`
  DELETE FROM test_steps
  WHERE id = ?
`);

const shiftCaseStepOrders = db.prepare(`
  UPDATE test_steps
  SET step_order = step_order + ?
  WHERE test_case_id = ? AND step_order >= ?
`);

const unlinkSharedReferenceSteps = db.prepare(`
  UPDATE test_steps
  SET
    group_kind = CASE WHEN group_id IS NULL THEN NULL ELSE 'local' END,
    reusable_group_id = NULL
  WHERE reusable_group_id = ?
`);



const buildReferenceInstances = (rows = []) =>
  rows.reduce((instances, row) => {
    if (!row?.test_case_id || !row?.group_id) {
      return instances;
    }

    const key = `${row.test_case_id}::${row.group_id}`;
    const existingInstance = instances.find((instance) => instance.key === key);

    if (existingInstance) {
      existingInstance.steps.push(row);
      return instances;
    }

    instances.push({
      key,
      test_case_id: row.test_case_id,
      group_id: row.group_id,
      steps: [row]
    });
    return instances;
  }, []);

const syncReferenceInstance = async ({ sharedGroupId, sharedGroupName, instanceSteps, canonicalSteps, previousSteps }) => {
  if (!instanceSteps.length) {
    return;
  }

  const testCaseId = instanceSteps[0].test_case_id;
  if (instanceSteps.some((step, index) => index > 0 && Number(step.step_order) !== Number(instanceSteps[index - 1].step_order) + 1)) {
    throw Object.assign(new Error("A linked Shared Section Group is split by other sections. Restore a continuous section group before updating its shared definition."), { statusCode: 409, code: "SHARED_GROUP_REFERENCE_SPLIT" });
  }
  const groupId = instanceSteps[0].group_id;
  const startOrder = Number(instanceSteps[0].step_order) || 1;
  const existingCount = instanceSteps.length;
  const lastExistingOrder = Number(instanceSteps[instanceSteps.length - 1]?.step_order) || startOrder;
  const nextStepOrder = lastExistingOrder + 1;
  const nextCount = canonicalSteps.length;
  const stepCountDelta = nextCount - existingCount;
  const existingBySection = new Map(previousSteps.map((step, index) => [step.id, instanceSteps[index]]));
  const retainedIds = new Set();

  if (stepCountDelta > 0) {
    await shiftCaseStepOrders.run(stepCountDelta, testCaseId, nextStepOrder);
  }

  for (const [index, nextStep] of canonicalSteps.entries()) {
    const currentStep = existingBySection.get(nextStep.id);
    if (currentStep) {
      retainedIds.add(currentStep.id);
      await updateReferenceStep.run(
        startOrder + index, nextStep.action, nextStep.expected_result,
        nextStep.step_type || "web", nextStep.automation_code, nextStep.api_request,
        sharedGroupName, sharedGroupId, currentStep.id
      );
    } else {
      await insertReferenceStep.run(
        uuid(),
        testCaseId,
        startOrder + index,
        nextStep.action,
        nextStep.expected_result,
        nextStep.step_type || "web",
        nextStep.automation_code,
        nextStep.api_request,
        groupId,
        sharedGroupName,
        "reusable",
        sharedGroupId
      );
    }
  }
  for (const extraStep of instanceSteps.filter(step => !retainedIds.has(step.id))) await deleteReferenceStep.run(extraStep.id);

  if (stepCountDelta < 0) {
    await shiftCaseStepOrders.run(stepCountDelta, testCaseId, nextStepOrder);
  }
};

const syncSharedGroupReferencesWithinTransaction = async (sharedGroupId, canonicalSteps, sharedGroupName, previousSteps, sourceInstance) => {
  const referenceSteps = await selectSharedReferenceSteps.all(sharedGroupId);
  const referenceInstances = buildReferenceInstances(referenceSteps);

  for (const instance of referenceInstances) {
    // The source instance is already the desired definition. Rewriting it by
    // positional correspondence would discard its stable case-section IDs.
    if (sourceInstance && instance.test_case_id === sourceInstance.testCaseId && instance.group_id === sourceInstance.groupId) continue;
    // Earlier instances in the same case may have shifted this one's order.
    // Read its current rows before applying the next size/order change.
    const instanceSteps = await selectSharedReferenceInstance.all(sharedGroupId, instance.test_case_id, instance.group_id);
    await syncReferenceInstance({
      sharedGroupId,
      sharedGroupName,
      instanceSteps,
      canonicalSteps,
      previousSteps
    });
  }
};

exports.normalizeSharedSteps = normalizeSharedSteps;

exports.syncSharedGroupReferences = async (sharedGroupId, options = {}) => {
  const transaction = db.transaction(async () => {
    const sharedGroup = await selectSharedStepGroup.get(sharedGroupId);

    if (!sharedGroup) {
      throw new Error("Shared Step Group not found");
    }

    const canonicalSteps = sharedStepsWithIds(parseJsonValue(sharedGroup.steps, []), sharedGroup.id);
    const previousSteps = sharedStepsWithIds(options.previousSteps || canonicalSteps, sharedGroup.id);
    await syncSharedGroupReferencesWithinTransaction(sharedGroup.id, canonicalSteps, sharedGroup.name, previousSteps);
    return { updated: true, step_count: canonicalSteps.length };
  });

  return transaction();
};

exports.syncSharedGroupFromReference = async (sharedGroupId, testCaseId, groupId, options = {}) => db.transaction(async () => {
  const sharedGroup = await selectSharedStepGroup.get(sharedGroupId);

  if (!sharedGroup) {
    throw new Error("Shared Step Group not found");
  }

  const sourceCase = await db.prepare("SELECT id, app_type_id FROM test_cases WHERE id = ?").get(testCaseId);
  if (!sourceCase || sourceCase.app_type_id !== sharedGroup.app_type_id) {
    throw Object.assign(new Error("A Shared Section Group reference must belong to the same application."), { statusCode: 409, code: "SHARED_GROUP_REFERENCE_SCOPE" });
  }

  const sourceSteps = await selectSharedReferenceInstance.all(sharedGroup.id, testCaseId, groupId);
  if (sourceSteps.some((step, index) => index > 0 && Number(step.step_order) !== Number(sourceSteps[index - 1].step_order) + 1)) {
    throw Object.assign(new Error("Keep the Shared Section Group continuous before saving its definition."), { statusCode: 409, code: "SHARED_GROUP_REFERENCE_SPLIT" });
  }
  const previousSteps = sharedStepsWithIds(parseJsonValue(sharedGroup.steps, []), sharedGroup.id);
  const canonicalSteps = sharedStepsFromReference(
    sourceSteps.map((step, index) => ({
      id: step.id,
      step_order: index + 1,
      action: step.action,
      expected_result: step.expected_result,
      step_type: step.step_type,
      automation_code: step.automation_code,
      api_request: parseJsonValue(step.api_request, null)
    })), previousSteps, sharedGroup.id, options.previousReferenceSteps
  );

  await updateSharedGroupSteps.run(canonicalSteps, sharedGroup.id);
  await syncSharedGroupReferencesWithinTransaction(sharedGroup.id, canonicalSteps, sharedGroup.name, previousSteps, { testCaseId, groupId });
  return { updated: true, step_count: canonicalSteps.length };
})();

exports.unlinkSharedGroupReferences = async (sharedGroupId) => {
  await unlinkSharedReferenceSteps.run(sharedGroupId);
  return { updated: true };
};
