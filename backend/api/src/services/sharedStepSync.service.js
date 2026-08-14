const db = require("../db");
const { randomUUID: uuid } = require("crypto");
const {
  normalizeApiRequest,
  normalizeRichText,
  normalizeTestStepType,
  parseJsonValue
} = require("../utils/testStepAutomation");

const selectSharedStepGroup = db.prepare(`
  SELECT id, name, steps
  FROM shared_step_groups
  WHERE id = ?
`);

const selectSharedReferenceSteps = db.prepare(`
  SELECT *
  FROM test_steps
  WHERE reusable_group_id = ?
  ORDER BY test_case_id ASC, group_id ASC, step_order ASC, id ASC
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

const normalizeText = (value) => {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
};

const normalizeSharedSteps = (steps = []) => {
  if (!Array.isArray(steps)) {
    return [];
  }

  return steps
    .map((step, index) => ({
      step_order: Number.isFinite(Number(step?.step_order)) ? Number(step.step_order) : index + 1,
      action: normalizeText(step?.action),
      expected_result: normalizeText(step?.expected_result || step?.expectedResult),
      step_type: normalizeTestStepType(step?.step_type || step?.stepType, "web"),
      automation_code: normalizeRichText(step?.automation_code || step?.automationCode),
      api_request: normalizeApiRequest(step?.api_request || step?.apiRequest)
    }))
    .filter((step) => step.action || step.expected_result || step.automation_code || step.api_request)
    .sort((left, right) => left.step_order - right.step_order)
    .map((step, index) => ({
      ...step,
      step_order: index + 1
    }));
};

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

const syncReferenceInstance = async ({ sharedGroupId, sharedGroupName, instanceSteps, canonicalSteps }) => {
  if (!instanceSteps.length) {
    return;
  }

  const testCaseId = instanceSteps[0].test_case_id;
  const groupId = instanceSteps[0].group_id;
  const startOrder = Number(instanceSteps[0].step_order) || 1;
  const existingCount = instanceSteps.length;
  const lastExistingOrder = Number(instanceSteps[instanceSteps.length - 1]?.step_order) || startOrder;
  const nextStepOrder = lastExistingOrder + 1;
  const nextCount = canonicalSteps.length;
  const overlapCount = Math.min(existingCount, nextCount);
  const stepCountDelta = nextCount - existingCount;

  if (stepCountDelta > 0) {
    await shiftCaseStepOrders.run(stepCountDelta, testCaseId, nextStepOrder);
  }

  for (let index = 0; index < overlapCount; index += 1) {
    const currentStep = instanceSteps[index];
    const nextStep = canonicalSteps[index];

    await updateReferenceStep.run(
      startOrder + index,
      nextStep.action,
      nextStep.expected_result,
      nextStep.step_type || "web",
      nextStep.automation_code,
      nextStep.api_request,
      sharedGroupName,
      sharedGroupId,
      currentStep.id
    );
  }

  if (nextCount > existingCount) {
    for (let index = existingCount; index < nextCount; index += 1) {
      const nextStep = canonicalSteps[index];

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
  } else if (existingCount > nextCount) {
    for (const extraStep of instanceSteps.slice(nextCount)) {
      await deleteReferenceStep.run(extraStep.id);
    }

    await shiftCaseStepOrders.run(stepCountDelta, testCaseId, nextStepOrder);
  }
};

const syncSharedGroupReferencesWithinTransaction = async (sharedGroupId, canonicalSteps, sharedGroupName) => {
  const referenceSteps = await selectSharedReferenceSteps.all(sharedGroupId);
  const referenceInstances = buildReferenceInstances(referenceSteps);

  for (const instance of referenceInstances) {
    await syncReferenceInstance({
      sharedGroupId,
      sharedGroupName,
      instanceSteps: instance.steps,
      canonicalSteps
    });
  }
};

exports.normalizeSharedSteps = normalizeSharedSteps;

exports.syncSharedGroupReferences = async (sharedGroupId) => {
  const sharedGroup = await selectSharedStepGroup.get(sharedGroupId);

  if (!sharedGroup) {
    throw new Error("Shared step group not found");
  }

  const canonicalSteps = normalizeSharedSteps(parseJsonValue(sharedGroup.steps, []));
  const transaction = db.transaction(async () => {
    await syncSharedGroupReferencesWithinTransaction(sharedGroup.id, canonicalSteps, sharedGroup.name);
  });

  await transaction();
  return { updated: true, step_count: canonicalSteps.length };
};

exports.syncSharedGroupFromReference = async (sharedGroupId, testCaseId, groupId) => {
  const sharedGroup = await selectSharedStepGroup.get(sharedGroupId);

  if (!sharedGroup) {
    throw new Error("Shared step group not found");
  }

  const sourceSteps = await selectSharedReferenceInstance.all(sharedGroup.id, testCaseId, groupId);
  const canonicalSteps = normalizeSharedSteps(
    sourceSteps.map((step, index) => ({
      step_order: index + 1,
      action: step.action,
      expected_result: step.expected_result,
      step_type: step.step_type,
      automation_code: step.automation_code,
      api_request: parseJsonValue(step.api_request, null)
    }))
  );

  const transaction = db.transaction(async () => {
    await updateSharedGroupSteps.run(canonicalSteps, sharedGroup.id);
    await syncSharedGroupReferencesWithinTransaction(sharedGroup.id, canonicalSteps, sharedGroup.name);
  });

  await transaction();
  return { updated: true, step_count: canonicalSteps.length };
};

exports.unlinkSharedGroupReferences = async (sharedGroupId) => {
  await unlinkSharedReferenceSteps.run(sharedGroupId);
  return { updated: true };
};
