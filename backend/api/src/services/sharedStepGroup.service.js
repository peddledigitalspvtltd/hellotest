const db = require("../db");
const { randomUUID: uuid } = require("crypto");
const sharedStepSyncService = require("./sharedStepSync.service");
const displayIdService = require("./displayId.service");
const {
  normalizeApiRequest,
  normalizeRichText,
  normalizeTestStepType,
  parseJsonValue
} = require("../utils/testStepAutomation");

const selectAppType = db.prepare(`
  SELECT id, project_id
  FROM app_types
  WHERE id = ?
`);

const selectSharedStepGroup = db.prepare(`
  SELECT *
  FROM shared_step_groups
  WHERE id = ?
`);

const insertSharedStepGroup = db.prepare(`
  INSERT INTO shared_step_groups (id, display_id, app_type_id, name, description, steps, parameter_values, created_by, updated_by)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const updateSharedStepGroup = db.prepare(`
  UPDATE shared_step_groups
  SET app_type_id = ?, name = ?, description = ?, steps = ?, parameter_values = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
`);

const deleteSharedStepGroup = db.prepare(`
  DELETE FROM shared_step_groups
  WHERE id = ?
`);

const selectSharedStepGroupUsageRows = db.prepare(`
  SELECT
    ts.reusable_group_id AS shared_step_group_id,
    tc.id AS test_case_id,
    tc.title AS test_case_title,
    tc.status AS test_case_status,
    COUNT(*) AS referenced_step_count
  FROM test_steps ts
  JOIN test_cases tc ON tc.id = ts.test_case_id
  WHERE ts.reusable_group_id IS NOT NULL
  GROUP BY ts.reusable_group_id, tc.id, tc.title, tc.status
  ORDER BY LOWER(COALESCE(tc.title, '')) ASC, tc.title ASC, tc.id ASC
`);

const normalizeText = (value) => {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
};

const normalizeSteps = (steps = []) => {
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

const normalizeParameterValues = (values = {}) => {
  if (!values || typeof values !== "object" || Array.isArray(values)) {
    return {};
  }

  return Object.entries(values).reduce((next, [key, value]) => {
    const normalizedKey = normalizeText(key);

    if (!normalizedKey) {
      return next;
    }

    next[normalizedKey] = value === null || value === undefined ? "" : String(value);
    return next;
  }, {});
};

const buildUsageMap = (rows = []) => {
  return rows.reduce((map, row) => {
    map[row.shared_step_group_id] = map[row.shared_step_group_id] || [];
    map[row.shared_step_group_id].push({
      id: row.test_case_id,
      title: row.test_case_title,
      status: row.test_case_status,
      referenced_step_count: Number(row.referenced_step_count) || 0
    });
    return map;
  }, {});
};

const hydrateSharedStepGroup = (group, usageMap = {}) => {
  if (!group) {
    return group;
  }

  const steps = normalizeSteps(parseJsonValue(group.steps, []));
  const parameterValues = normalizeParameterValues(parseJsonValue(group.parameter_values, {}));
  const usedTestCases = usageMap[group.id] || [];

  return {
    ...group,
    steps,
    parameter_values: parameterValues,
    step_count: steps.length,
    usage_count: usedTestCases.length,
    used_test_cases: usedTestCases
  };
};

const ensureAppTypeExists = async (appTypeId) => {
  const resolvedAppTypeId = normalizeText(appTypeId);

  if (!resolvedAppTypeId) {
    throw new Error("app_type_id is required");
  }

  const appType = await selectAppType.get(resolvedAppTypeId);

  if (!appType) {
    throw new Error("App type not found");
  }

  return appType;
};

exports.listSharedStepGroups = async ({ app_type_id } = {}) => {
  const resolvedAppTypeId = normalizeText(app_type_id);
  let query = `
    SELECT *
    FROM shared_step_groups
    WHERE 1 = 1
  `;
  const params = [];

  if (resolvedAppTypeId) {
    query += ` AND app_type_id = ?`;
    params.push(resolvedAppTypeId);
  }

  query += ` ORDER BY updated_at DESC, name ASC`;

  const rows = await db.prepare(query).all(...params);
  const usageRows = await selectSharedStepGroupUsageRows.all();
  const usageMap = buildUsageMap(usageRows);
  return rows.map((row) => hydrateSharedStepGroup(row, usageMap));
};

exports.getSharedStepGroup = async (id) => {
  const group = await selectSharedStepGroup.get(id);

  if (!group) {
    throw new Error("Shared step group not found");
  }

  const usageRows = await selectSharedStepGroupUsageRows.all();
  const usageMap = buildUsageMap(usageRows);
  return hydrateSharedStepGroup(group, usageMap);
};

exports.createSharedStepGroup = async ({ app_type_id, name, description, steps = [], parameter_values = {}, created_by }) => {
  const appType = await ensureAppTypeExists(app_type_id);
  const resolvedName = normalizeText(name);

  if (!resolvedName) {
    throw new Error("Shared step group name is required");
  }

  const id = uuid();
  const display_id = await displayIdService.createDisplayId("shared_step_group");
  const normalizedSteps = normalizeSteps(steps);

  await insertSharedStepGroup.run(
    id,
    display_id,
    appType.id,
    resolvedName,
    normalizeText(description),
    normalizedSteps,
    normalizeParameterValues(parameter_values),
    normalizeText(created_by),
    normalizeText(created_by)
  );

  return { id };
};

exports.updateSharedStepGroup = async (id, data = {}) => {
  const existing = await exports.getSharedStepGroup(id);
  const resolvedAppType = await ensureAppTypeExists(data.app_type_id || existing.app_type_id);
  const resolvedName = normalizeText(data.name) || existing.name;

  if (!resolvedName) {
    throw new Error("Shared step group name is required");
  }

  await updateSharedStepGroup.run(
    resolvedAppType.id,
    resolvedName,
    data.description !== undefined ? normalizeText(data.description) : existing.description,
    data.steps !== undefined ? normalizeSteps(data.steps) : existing.steps,
    data.parameter_values !== undefined ? normalizeParameterValues(data.parameter_values) : existing.parameter_values,
    normalizeText(data.updated_by) || existing.updated_by || existing.created_by || null,
    id
  );

  await sharedStepSyncService.syncSharedGroupReferences(id);

  return { updated: true };
};

exports.deleteSharedStepGroup = async (id) => {
  await exports.getSharedStepGroup(id);
  await sharedStepSyncService.unlinkSharedGroupReferences(id);
  await deleteSharedStepGroup.run(id);
  return { deleted: true };
};
