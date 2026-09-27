const { normalizeSharedSteps } = require("../domain/sharedStepDefinition");
const db = require("@hellotest/platform/backend/src/db");
const { randomUUID: uuid } = require("crypto");
const sharedStepSyncService = require("./sharedStepSync.service");
const apiRequestExecutionService = require("@hellotest/automation/backend/services/apiRequestExecution.service");
const mobileFeatureService = require("@hellotest/platform/backend/services/mobileFeature.service");
const { containsMobileStepPayload } = require("@hellotest/platform/backend/src/utils/mobileFeature");
const {
  normalizeApiRequest,
  normalizeRichText,
  normalizeTestStepType,
  parseJsonValue
} = require("@hellotest/platform/backend/src/utils/testStepAutomation");

const selectTestCase = db.prepare(`
  SELECT id, app_type_id
  FROM test_cases
  WHERE id = ?
`);

const selectSharedStepGroup = db.prepare(`
  SELECT id, app_type_id, name, steps
  FROM shared_step_groups
  WHERE id = ?
`);

const selectStep = db.prepare(`
  SELECT *
  FROM test_steps
  WHERE id = ?
`);

const selectStepsForCase = db.prepare(`
  SELECT *
  FROM test_steps
  WHERE test_case_id = ?
  ORDER BY step_order ASC, id ASC
`);

const insertStep = db.prepare(`
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

const updateStep = db.prepare(`
  UPDATE test_steps
  SET
    test_case_id = ?,
    step_order = ?,
    action = ?,
    expected_result = ?,
    step_type = ?,
    automation_code = ?,
    api_request = ?,
    group_id = ?,
    group_name = ?,
    group_kind = ?,
    reusable_group_id = ?
  WHERE id = ?
`);

const deleteStep = db.prepare(`
  DELETE FROM test_steps
  WHERE id = ?
`);

const shiftStepOrdersForward = db.prepare(`
  UPDATE test_steps
  SET step_order = step_order + ?
  WHERE test_case_id = ? AND step_order >= ?
`);

const shiftStepOrdersBackward = db.prepare(`
  UPDATE test_steps
  SET step_order = step_order - 1
  WHERE test_case_id = ? AND step_order > ?
`);

const moveStepsUp = db.prepare(`
  UPDATE test_steps
  SET step_order = step_order + 1
  WHERE test_case_id = ? AND step_order >= ? AND step_order < ?
`);

const moveStepsDown = db.prepare(`
  UPDATE test_steps
  SET step_order = step_order - 1
  WHERE test_case_id = ? AND step_order > ? AND step_order <= ?
`);

const setStepGroup = db.prepare(`
  UPDATE test_steps
  SET group_id = ?, group_name = ?, group_kind = ?, reusable_group_id = ?
  WHERE id = ?
`);

const clearGroupByCase = db.prepare(`
  UPDATE test_steps
  SET group_id = NULL, group_name = NULL, group_kind = NULL, reusable_group_id = NULL
  WHERE test_case_id = ? AND group_id = ?
`);

const updateOrder = db.prepare(`
  UPDATE test_steps
  SET step_order = ?
  WHERE id = ?
`);

const updateStepAutomation = db.prepare(`
  UPDATE test_steps
  SET step_type = ?, automation_code = ?, api_request = ?
  WHERE id = ?
`);

const normalizeText = (value) => {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
};

const normalizeGroupKind = (value) => {
  if (value === "local" || value === "reusable") {
    return value;
  }

  return null;
};

const normalizeStepOrder = (value, fallback = 1) => {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.max(1, Math.trunc(numeric));
};


const ensureTestCase = async (testCaseId) => {
  const testCase = await selectTestCase.get(testCaseId);

  if (!testCase) {
    throw new Error("Test case not found");
  }

  return testCase;
};

const ensureStep = async (id) => {
  const step = await selectStep.get(id);

  if (!step) {
    throw new Error("Test step not found");
  }

  return step;
};

const listStepsForCase = async (testCaseId) => {
  return selectStepsForCase.all(testCaseId);
};

const syncSharedGroupFromStep = async (step) => {
  if (!step?.reusable_group_id || !step?.group_id) {
    return;
  }

  await sharedStepSyncService.syncSharedGroupFromReference(
    step.reusable_group_id,
    step.test_case_id,
    step.group_id
  );
};

const assertMobileStepMutationEnabled = async (testCaseId, payload) => {
  if (containsMobileStepPayload(payload) || await mobileFeatureService.testCaseUsesMobile(testCaseId)) {
    await mobileFeatureService.assertMobileFeatureEnabled();
  }
};

exports.createTestStep = async ({
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
}) => {
  if (!test_case_id || step_order === undefined) {
    throw new Error("Missing required fields");
  }

  await ensureTestCase(test_case_id);
  await assertMobileStepMutationEnabled(test_case_id, { step_type });

  const id = uuid();
  const transaction = db.transaction(async () => {
    const existingSteps = await listStepsForCase(test_case_id);
    const targetOrder = normalizeStepOrder(step_order, existingSteps.length + 1);
    const boundedOrder = Math.min(targetOrder, existingSteps.length + 1);

    await shiftStepOrdersForward.run(1, test_case_id, boundedOrder);
    await insertStep.run(
      id,
      test_case_id,
      boundedOrder,
      normalizeText(action),
      normalizeText(expected_result),
      normalizeTestStepType(step_type, "web"),
      normalizeRichText(automation_code),
      normalizeApiRequest(api_request),
      normalizeText(group_id),
      normalizeText(group_name),
      normalizeGroupKind(group_kind || (group_id ? "local" : null)),
      normalizeText(reusable_group_id)
    );
  });

  await transaction();
  await syncSharedGroupFromStep({
    test_case_id,
    group_id: normalizeText(group_id),
    reusable_group_id: normalizeText(reusable_group_id)
  });
  return { id };
};

exports.createTestSteps = async ({ test_case_id, insertion_index = 0, steps = [] } = {}) => {
  await ensureTestCase(test_case_id);
  if (!Array.isArray(steps) || !steps.length) throw new Error("Select at least one step to insert");
  if (steps.length > 100) throw new Error("Insert at most 100 steps at a time");
  await assertMobileStepMutationEnabled(test_case_id, steps);

  const existingSteps = await listStepsForCase(test_case_id);
  const parsedIndex = Number.parseInt(String(insertion_index), 10);
  const boundedIndex = Math.max(0, Math.min(Number.isFinite(parsedIndex) ? parsedIndex : existingSteps.length, existingSteps.length));
  const firstOrder = boundedIndex + 1;
  const ids = steps.map(() => uuid());

  const transaction = db.transaction(async () => {
    await shiftStepOrdersForward.run(steps.length, test_case_id, firstOrder);
    for (const [index, step] of steps.entries()) {
      await insertStep.run(
        ids[index],
        test_case_id,
        firstOrder + index,
        normalizeText(step.action),
        normalizeText(step.expected_result),
        normalizeTestStepType(step.step_type, "web"),
        normalizeRichText(step.automation_code),
        normalizeApiRequest(step.api_request),
        normalizeText(step.group_id),
        normalizeText(step.group_name),
        normalizeGroupKind(step.group_kind || (step.group_id ? "local" : null)),
        normalizeText(step.reusable_group_id)
      );
    }
  });

  await transaction();
  const sharedGroups = new Map();
  steps.forEach((step) => {
    if (step.reusable_group_id && step.group_id) sharedGroups.set(`${step.reusable_group_id}:${step.group_id}`, step);
  });
  for (const step of sharedGroups.values()) {
    await syncSharedGroupFromStep({ ...step, test_case_id });
  }
  return { ids, created: ids.length };
};

exports.deleteTestSteps = async ({ test_case_id, step_ids = [] } = {}) => {
  await ensureTestCase(test_case_id);
  const ids = [...new Set((Array.isArray(step_ids) ? step_ids : []).map((value) => String(value || "").trim()).filter(Boolean))];
  if (!ids.length) return { deleted: 0 };
  if (ids.length > 200) throw new Error("Delete at most 200 steps at a time");
  const placeholders = ids.map(() => "?").join(",");
  const selected = await db.prepare(`SELECT * FROM test_steps WHERE id IN (${placeholders})`).all(...ids);
  if (selected.length !== ids.length || selected.some((step) => step.test_case_id !== test_case_id)) {
    const error = new Error("Every selected step must belong to the current test case");
    error.statusCode = 409;
    throw error;
  }

  const transaction = db.transaction(async () => {
    await db.prepare(`DELETE FROM test_steps WHERE test_case_id = ? AND id IN (${placeholders})`).run(test_case_id, ...ids);
    const remaining = await listStepsForCase(test_case_id);
    for (const [index, step] of remaining.entries()) {
      if (Number(step.step_order) !== index + 1) await updateOrder.run(index + 1, step.id);
    }
  });
  await transaction();
  const sharedGroups = new Map();
  selected.forEach((step) => {
    if (step.reusable_group_id && step.group_id) sharedGroups.set(`${step.reusable_group_id}:${step.group_id}`, step);
  });
  for (const step of sharedGroups.values()) await syncSharedGroupFromStep(step);
  return { deleted: ids.length };
};

exports.getTestSteps = async ({ test_case_id }) => {
  let query = `SELECT * FROM test_steps WHERE 1=1`;
  const params = [];

  if (test_case_id) {
    query += ` AND test_case_id = ?`;
    params.push(test_case_id);
  }

  query += ` ORDER BY test_case_id ASC, step_order ASC, id ASC`;

  return db.prepare(query).all(...params);
};

exports.getTestStep = async (id) => {
  return ensureStep(id);
};

exports.runApiRequestPreview = async (input) => {
  return apiRequestExecutionService.runApiRequestPreview(input);
};

exports.updateTestStep = async (id, data = {}, options = {}) => {
  const existing = await ensureStep(id);
  const nextTestCaseId = data.test_case_id ?? existing.test_case_id;
  const nextStepOrder = data.step_order !== undefined ? normalizeStepOrder(data.step_order, existing.step_order) : existing.step_order;
  const sourceTestCase = await ensureTestCase(existing.test_case_id);
  const targetTestCase = await ensureTestCase(nextTestCaseId);
  if (sourceTestCase.app_type_id !== targetTestCase.app_type_id) {
    throw new Error("Test Steps can only move between Test Cases in the same app type");
  }
  await assertMobileStepMutationEnabled(existing.test_case_id, [existing, data]);
  if (nextTestCaseId !== existing.test_case_id) {
    await assertMobileStepMutationEnabled(nextTestCaseId, [existing, data]);
  }

  const transaction = db.transaction(async () => {
    if (nextTestCaseId !== existing.test_case_id) {
      const targetSteps = await listStepsForCase(nextTestCaseId);
      const boundedOrder = Math.min(nextStepOrder, targetSteps.length + 1);

      await shiftStepOrdersBackward.run(existing.test_case_id, existing.step_order);
      await shiftStepOrdersForward.run(1, nextTestCaseId, boundedOrder);

      await updateStep.run(
        nextTestCaseId,
        boundedOrder,
        data.action !== undefined ? normalizeText(data.action) : existing.action,
        data.expected_result !== undefined ? normalizeText(data.expected_result) : existing.expected_result,
        data.step_type !== undefined ? normalizeTestStepType(data.step_type, existing.step_type || "web") : existing.step_type,
        data.automation_code !== undefined ? normalizeRichText(data.automation_code) : existing.automation_code,
        data.api_request !== undefined ? normalizeApiRequest(data.api_request) : parseJsonValue(existing.api_request, null),
        data.group_id !== undefined ? normalizeText(data.group_id) : existing.group_id,
        data.group_name !== undefined ? normalizeText(data.group_name) : existing.group_name,
        data.group_kind !== undefined ? normalizeGroupKind(data.group_kind) : existing.group_kind,
        data.reusable_group_id !== undefined ? normalizeText(data.reusable_group_id) : existing.reusable_group_id,
        id
      );
      return;
    }

    if (nextStepOrder < existing.step_order) {
      await moveStepsUp.run(existing.test_case_id, nextStepOrder, existing.step_order);
    } else if (nextStepOrder > existing.step_order) {
      await moveStepsDown.run(existing.test_case_id, existing.step_order, nextStepOrder);
    }

    await updateStep.run(
      nextTestCaseId,
      nextStepOrder,
      data.action !== undefined ? normalizeText(data.action) : existing.action,
      data.expected_result !== undefined ? normalizeText(data.expected_result) : existing.expected_result,
      data.step_type !== undefined ? normalizeTestStepType(data.step_type, existing.step_type || "web") : existing.step_type,
      data.automation_code !== undefined ? normalizeRichText(data.automation_code) : existing.automation_code,
      data.api_request !== undefined ? normalizeApiRequest(data.api_request) : parseJsonValue(existing.api_request, null),
      data.group_id !== undefined ? normalizeText(data.group_id) : existing.group_id,
      data.group_name !== undefined ? normalizeText(data.group_name) : existing.group_name,
      data.group_kind !== undefined ? normalizeGroupKind(data.group_kind) : existing.group_kind,
      data.reusable_group_id !== undefined ? normalizeText(data.reusable_group_id) : existing.reusable_group_id,
      id
    );
  });

  await transaction();
  if (options.syncSharedGroup !== false) await syncSharedGroupFromStep(await ensureStep(id));
  return { updated: true };
};

exports.moveTestStepAutomation = async ({ source_step_id, target_step_id } = {}) => {
  if (!source_step_id || !target_step_id || source_step_id === target_step_id) {
    throw new Error("Choose two different test steps to move automation");
  }

  const source = await ensureStep(source_step_id);
  const target = await ensureStep(target_step_id);

  if (source.test_case_id !== target.test_case_id) {
    throw new Error("Automation can only move between steps in the same test case");
  }
  await assertMobileStepMutationEnabled(source.test_case_id, [source, target]);

  const transaction = db.transaction(async () => {
    await updateStepAutomation.run(
      normalizeTestStepType(target.step_type, "web"),
      normalizeRichText(target.automation_code),
      parseJsonValue(target.api_request, null),
      source.id
    );
    await updateStepAutomation.run(
      normalizeTestStepType(source.step_type, "web"),
      normalizeRichText(source.automation_code),
      parseJsonValue(source.api_request, null),
      target.id
    );
  });

  await transaction();
  await syncSharedGroupFromStep(await ensureStep(source.id));
  await syncSharedGroupFromStep(await ensureStep(target.id));
  return { moved: true, source_step_id, target_step_id };
};

exports.reorderTestSteps = async (testCaseId, stepIds = []) => {
  await ensureTestCase(testCaseId);

  if (!Array.isArray(stepIds) || !stepIds.length) {
    throw new Error("step_ids must be a non-empty array");
  }

  const existingSteps = await listStepsForCase(testCaseId);
  const sharedGroupSyncTargets = existingSteps
    .filter((step) => step.reusable_group_id && step.group_id)
    .reduce((targets, step) => {
      const key = `${step.reusable_group_id}::${step.group_id}`;

      if (targets.some((target) => target.key === key)) {
        return targets;
      }

      const previousSequence = existingSteps
        .filter((item) => item.reusable_group_id === step.reusable_group_id && item.group_id === step.group_id)
        .map((item) => item.id);
      const nextSequence = [...previousSequence].sort((left, right) => stepIds.indexOf(left) - stepIds.indexOf(right));

      if (previousSequence.every((item, index) => item === nextSequence[index])) {
        return targets;
      }

      targets.push({
        key,
        reusable_group_id: step.reusable_group_id,
        test_case_id: step.test_case_id,
        group_id: step.group_id
      });
      return targets;
    }, []);

  if (existingSteps.length !== stepIds.length) {
    throw new Error("step_ids must include every step in the test case");
  }

  const existingIds = existingSteps.map((step) => step.id).sort();
  const proposedIds = [...new Set(stepIds)].sort();

  if (existingIds.length !== proposedIds.length || existingIds.some((item, index) => item !== proposedIds[index])) {
    throw new Error("step_ids must match the steps belonging to the test case");
  }

  const transaction = db.transaction(async () => {
    for (const [index, stepId] of stepIds.entries()) {
      await updateOrder.run(index + 1, stepId);
    }
  });

  await transaction();
  for (const target of sharedGroupSyncTargets) {
    await sharedStepSyncService.syncSharedGroupFromReference(
      target.reusable_group_id,
      target.test_case_id,
      target.group_id
    );
  }
  return { reordered: true };
};

exports.duplicateTestSteps = async ({ test_case_id, step_ids = [], insert_after_step_id }) => {
  if (!test_case_id || !Array.isArray(step_ids) || !step_ids.length) {
    throw new Error("test_case_id and step_ids are required");
  }

  await ensureTestCase(test_case_id);
  const uniqueStepIds = [...new Set(step_ids)];
  const existingSteps = await listStepsForCase(test_case_id);
  const selectedSteps = existingSteps.filter((step) => uniqueStepIds.includes(step.id));

  if (selectedSteps.length !== uniqueStepIds.length) {
    throw new Error("All duplicated steps must belong to the selected test case");
  }
  await assertMobileStepMutationEnabled(test_case_id, selectedSteps);

  const transaction = db.transaction(async () => {
    const insertAfterStep = insert_after_step_id
      ? existingSteps.find((step) => step.id === insert_after_step_id)
      : selectedSteps[selectedSteps.length - 1];

    if (!insertAfterStep) {
      throw new Error("Unable to determine where to duplicate the selected steps");
    }

    const insertionOrder = insertAfterStep.step_order + 1;
    const nextGroupIds = new Map();

    selectedSteps.forEach((step) => {
      if (step.group_id && !nextGroupIds.has(step.group_id)) {
        nextGroupIds.set(step.group_id, uuid());
      }
    });

    await shiftStepOrdersForward.run(selectedSteps.length, test_case_id, insertionOrder);

    for (const [index, step] of selectedSteps.entries()) {
      await insertStep.run(
        uuid(),
        test_case_id,
        insertionOrder + index,
        step.action,
        step.expected_result,
        step.step_type || "web",
        step.automation_code,
        parseJsonValue(step.api_request, null),
        step.group_id ? nextGroupIds.get(step.group_id) : null,
        step.group_name,
        step.group_kind,
        step.reusable_group_id
      );
    }
  });

  await transaction();
  return { duplicated: true };
};

exports.groupTestSteps = async ({ test_case_id, step_ids = [], name, kind = "local", reusable_group_id, group_id }) => {
  if (!test_case_id || !Array.isArray(step_ids) || !step_ids.length) {
    throw new Error("test_case_id and step_ids are required");
  }

  const resolvedName = normalizeText(name);

  if (!resolvedName) {
    throw new Error("Group name is required");
  }

  await ensureTestCase(test_case_id);
  const existingSteps = await listStepsForCase(test_case_id);
  const uniqueStepIds = [...new Set(step_ids)];
  const selectedSteps = existingSteps.filter((step) => uniqueStepIds.includes(step.id));

  if (selectedSteps.length !== uniqueStepIds.length) {
    throw new Error("All grouped steps must belong to the selected test case");
  }

  const isContiguous = selectedSteps.every((step, index) => index === 0 || step.step_order === selectedSteps[index - 1].step_order + 1);

  if (!isContiguous) {
    throw new Error("Select a continuous step range before grouping");
  }

  const groupId = normalizeText(group_id) || uuid();
  const resolvedKind = normalizeGroupKind(kind) || "local";

  const transaction = db.transaction(async () => {
    for (const step of selectedSteps) {
      await setStepGroup.run(groupId, resolvedName, resolvedKind, normalizeText(reusable_group_id), step.id);
    }
  });

  await transaction();
  if (resolvedKind === "reusable" && normalizeText(reusable_group_id)) {
    await sharedStepSyncService.syncSharedGroupFromReference(
      normalizeText(reusable_group_id),
      test_case_id,
      groupId
    );
  }
  return { grouped: true, group_id: groupId };
};

exports.ungroupTestSteps = async ({ test_case_id, group_id }) => {
  if (!test_case_id || !group_id) {
    throw new Error("test_case_id and group_id are required");
  }

  await ensureTestCase(test_case_id);
  await clearGroupByCase.run(test_case_id, group_id);
  return { updated: true };
};

exports.insertSharedStepGroup = async ({ test_case_id, shared_step_group_id, insert_after_step_id }) => {
  if (!test_case_id || !shared_step_group_id) {
    throw new Error("test_case_id and shared_step_group_id are required");
  }

  const testCase = await ensureTestCase(test_case_id);
  const sharedGroup = await selectSharedStepGroup.get(shared_step_group_id);

  if (!sharedGroup) {
    throw new Error("Shared Step Group not found");
  }

  if (testCase.app_type_id && sharedGroup.app_type_id !== testCase.app_type_id) {
    throw new Error("Shared Step Group must belong to the same app type");
  }

  const sharedSteps = normalizeSharedSteps(parseJsonValue(sharedGroup.steps, []));

  if (!sharedSteps.length) {
    throw new Error("Shared Step Group does not contain any steps");
  }
  await assertMobileStepMutationEnabled(test_case_id, sharedSteps);

  const transaction = db.transaction(async () => {
    const existingSteps = await listStepsForCase(test_case_id);
    const insertAfterStep = insert_after_step_id
      ? existingSteps.find((step) => step.id === insert_after_step_id)
      : existingSteps[existingSteps.length - 1];

    if (insert_after_step_id && !insertAfterStep) {
      throw new Error("Insert target step was not found in the selected test case");
    }

    const insertionOrder = insertAfterStep ? insertAfterStep.step_order + 1 : 1;
    const groupInstanceId = uuid();

    await shiftStepOrdersForward.run(sharedSteps.length, test_case_id, insertionOrder);

    for (const [index, step] of sharedSteps.entries()) {
      await insertStep.run(
        uuid(),
        test_case_id,
        insertionOrder + index,
        step.action,
        step.expected_result,
        step.step_type || "web",
        step.automation_code,
        step.api_request || null,
        groupInstanceId,
        sharedGroup.name,
        "reusable",
        sharedGroup.id
      );
    }
  });

  await transaction();
  return { inserted: true };
};

exports.deleteTestStep = async (id) => {
  const step = await ensureStep(id);

  const transaction = db.transaction(async () => {
    await deleteStep.run(id);
    await shiftStepOrdersBackward.run(step.test_case_id, step.step_order);
  });

  await transaction();
  await syncSharedGroupFromStep(step);
  return { deleted: true };
};
