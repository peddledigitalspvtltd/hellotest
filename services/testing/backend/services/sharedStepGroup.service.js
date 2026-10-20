const { sharedStepsWithIds, reconcileSharedStepIds } = require("../domain/sharedStepDefinition");
const { normalizeSharedParameterValues, sharedSensitiveParameterNames, publicSharedParameterValues, mergeSharedParameterValues, referencedSharedParameterNames } = require("../domain/sharedStepParameters");
const { sharedStepImplementationFingerprint } = require("../domain/sharedStepAutomationAccess");
const db = require("@hellotest/platform/backend/src/db");
const { randomUUID: uuid } = require("crypto");
const sharedStepSyncService = require("./sharedStepSync.service");
const displayIdService = require("@hellotest/platform/backend/services/displayId.service");
const mobileFeatureService = require("@hellotest/platform/backend/services/mobileFeature.service");
const { redactTestDataSetRows } = require("./testDataSet.service");
const {
  parseJsonValue
} = require("@hellotest/platform/backend/src/utils/testStepAutomation");

const selectAppType = db.prepare(`
  SELECT id, project_id
  FROM app_types
  WHERE id = ?
`);

const sharedGroupQuery = (includeDataRows = false) => `
  SELECT shared_group.*, ${includeDataRows ? "to_jsonb(data_set)" : `CASE WHEN data_set.id IS NOT NULL THEN jsonb_build_object('id', data_set.id, 'mode', data_set.mode,
    'sensitive_parameter_names', CASE WHEN data_set.mode = 'key_value' THEN
      (SELECT COALESCE(jsonb_agg(secret->>'key'), '[]'::jsonb) FROM jsonb_array_elements(data_set.rows) secret WHERE secret->>'is_secret' = 'true')
      ELSE '[]'::jsonb END) END`} AS test_data_set
  FROM shared_step_groups AS shared_group
  JOIN app_types AS app ON app.id = shared_group.app_type_id
  LEFT JOIN test_data_sets AS data_set ON data_set.id = shared_group.test_data_set_id
    AND data_set.project_id = app.project_id
    AND (data_set.app_type_id IS NULL OR data_set.app_type_id = app.id)
`;
const selectSharedStepGroup = db.prepare(`${sharedGroupQuery(true)} WHERE shared_group.id = ?`);

const insertSharedStepGroup = db.prepare(`
  INSERT INTO shared_step_groups (id, display_id, app_type_id, name, description, authoring_mode, gherkin_document, steps, parameter_values, test_data_set_id, test_data_row_index, created_by, updated_by)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const updateSharedStepGroup = db.prepare(`
  UPDATE shared_step_groups
  SET app_type_id = ?, name = ?, description = ?, authoring_mode = ?, gherkin_document = ?, steps = ?, parameter_values = ?, test_data_set_id = ?, test_data_row_index = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
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
  JOIN shared_step_groups sg ON sg.id = ts.reusable_group_id AND sg.app_type_id = tc.app_type_id
  WHERE sg.id IN (SELECT jsonb_array_elements_text(?::jsonb))
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

const normalizeAuthoringMode = (value) => value === "gherkin" ? "gherkin" : "structured";


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

const hydrateSharedStepGroup = (group, usageMap = {}, includeDataRows = true) => {
  if (!group) {
    return group;
  }

  const steps = sharedStepsWithIds(parseJsonValue(group.steps, []), group.id);
  const parameterValues = normalizeSharedParameterValues(parseJsonValue(group.parameter_values, {}));
  const usedTestCases = usageMap[group.id] || [];
  const dataSet = parseJsonValue(group.test_data_set, null);
  const sensitiveNames = sharedSensitiveParameterNames(dataSet, parameterValues);

  const { test_data_set, ...metadata } = group;
  return {
    ...metadata,
    authoring_mode: normalizeAuthoringMode(group.authoring_mode),
    gherkin_document: typeof group.gherkin_document === "string" ? group.gherkin_document : null,
    steps,
    parameter_values: publicSharedParameterValues(parameterValues, sensitiveNames),
    parameter_sensitive_names: sensitiveNames,
    test_data_set_id: dataSet?.id || null,
    test_data_row_index: dataSet ? Number(group.test_data_row_index) || 0 : 0,
    ...(includeDataRows ? { test_data_set: dataSet ? {
      ...dataSet,
      columns: parseJsonValue(dataSet.columns, []),
      rows: redactTestDataSetRows(dataSet.mode, dataSet.rows)
    } : null } : {}),
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

const validateDataSetLink = async (appType, dataSetId, rowIndex = 0, allowLegacySelection = false) => {
  if (!Number.isSafeInteger(rowIndex) || rowIndex < 0) {
    throw Object.assign(new Error("Test Data row index must be a non-negative integer."), { statusCode: 400 });
  }
  const id = normalizeText(dataSetId);
  if (!id) return { id: null, rowIndex: 0, dataSet: null };
  // Serialize against dataset edits so its scope and selected row cannot change
  // between validation and saving this link.
  const dataSet = await db.prepare("SELECT * FROM test_data_sets WHERE id = ? FOR SHARE").get(id);
  if (!dataSet) throw Object.assign(new Error("Test Data Set not found."), { statusCode: 404 });
  if (dataSet.project_id !== appType.project_id || (dataSet.app_type_id && dataSet.app_type_id !== appType.id)) {
    throw Object.assign(new Error("Test Data Set must belong to the Shared Step Group project and application."), { statusCode: 400 });
  }
  const rows = parseJsonValue(dataSet.rows, []);
  const rowCount = rows.length ? (dataSet.mode === "key_value" ? 1 : rows.length) : 0;
  if (rowCount !== 1 && !allowLegacySelection) {
    throw Object.assign(new Error("Shared Step Groups require a data set with exactly one row."), { statusCode: 400, code: "SHARED_GROUP_SINGLE_ROW_REQUIRED" });
  }
  if (rowIndex >= rowCount) {
    throw Object.assign(new Error("Select an available Test Data row. Shared Step Groups use exactly one row."), { statusCode: 400 });
  }
  return { id, rowIndex, dataSet };
};

exports.listSharedStepGroups = async ({ app_type_id, project_id } = {}) => {
  const resolvedAppTypeId = normalizeText(app_type_id);
  let query = `${sharedGroupQuery()} WHERE 1 = 1`;
  const params = [];

  if (resolvedAppTypeId) {
    query += ` AND shared_group.app_type_id = ?`;
    params.push(resolvedAppTypeId);
  }

  if (project_id) {
    query += ` AND app.project_id = ?`;
    params.push(project_id);
  }

  query += ` ORDER BY shared_group.updated_at DESC, shared_group.name ASC`;

  const rows = await db.prepare(query).all(...params);
  const usageRows = await selectSharedStepGroupUsageRows.all(JSON.stringify(rows.map(row => row.id)));
  const usageMap = buildUsageMap(usageRows);
  return rows.map((row) => hydrateSharedStepGroup(row, usageMap, false));
};

exports.getSharedStepGroup = async (id) => {
  const group = await selectSharedStepGroup.get(id);

  if (!group) {
    throw new Error("Shared Step Group not found");
  }

  const usageRows = await selectSharedStepGroupUsageRows.all(JSON.stringify([id]));
  const usageMap = buildUsageMap(usageRows);
  return hydrateSharedStepGroup(group, usageMap);
};

exports.createSharedStepGroup = async ({ app_type_id, name, description, authoring_mode, gherkin_document, steps = [], parameter_values = {}, test_data_set_id, test_data_row_index = 0, created_by }) => db.transaction(async () => {
  const appType = await ensureAppTypeExists(app_type_id);
  await mobileFeatureService.assertAuthoringMobileFeatureEnabled({ app_type_id: appType.id, payload: steps });
  const resolvedName = normalizeText(name);

  if (!resolvedName) {
    throw new Error("Shared Step Group name is required");
  }

  const id = uuid();
  const display_id = await displayIdService.createDisplayId("shared_step_group");
  const normalizedSteps = reconcileSharedStepIds(steps, [], id);
  const dataLink = await validateDataSetLink(appType, test_data_set_id, test_data_row_index);

  await insertSharedStepGroup.run(
    id,
    display_id,
    appType.id,
    resolvedName,
    normalizeText(description),
    normalizeAuthoringMode(authoring_mode),
    normalizeText(gherkin_document),
    normalizedSteps,
    normalizeSharedParameterValues(parameter_values),
    dataLink.id,
    dataLink.rowIndex,
    normalizeText(created_by),
    normalizeText(created_by)
  );

  return { id };
})();

exports.updateSharedStepGroup = async (id, data = {}, options = {}) => db.transaction(async () => {
  // Serialize definition edits and reference synchronization against insertion
  // and other group saves. No linked case observes half of a reordered group.
  await db.prepare("SELECT id FROM shared_step_groups WHERE id = ? FOR UPDATE").get(id);
  const existing = await exports.getSharedStepGroup(id);
  const stored = await selectSharedStepGroup.get(id);
  if (options.expectedImplementationFingerprint !== undefined && options.expectedImplementationFingerprint !== sharedStepImplementationFingerprint(existing.steps)) {
    throw Object.assign(new Error("The Shared Section Group instructions changed while this save was being authorized. Refresh the group and retry to keep the latest instructions."), { statusCode: 409, code: "SHARED_SECTION_SOURCE_CONFLICT" });
  }
  const resolvedAppType = await ensureAppTypeExists(data.app_type_id || existing.app_type_id);
  if (resolvedAppType.id !== existing.app_type_id && existing.usage_count > 0) {
    throw Object.assign(new Error("Unlink this Shared Section Group from its test cases before moving it to another application."), { statusCode: 409, code: "SHARED_GROUP_SCOPE_REFERENCED" });
  }
  await mobileFeatureService.assertAuthoringMobileFeatureEnabled({
    app_type_id: resolvedAppType.id,
    payload: data.steps !== undefined ? data.steps : existing.steps
  });
  const resolvedName = normalizeText(data.name) || existing.name;

  if (!resolvedName) {
    throw new Error("Shared Step Group name is required");
  }

  const dataSetId = data.test_data_set_id === undefined ? existing.test_data_set_id : data.test_data_set_id;
  const rowIndex = data.test_data_row_index === undefined
    ? (dataSetId === existing.test_data_set_id ? existing.test_data_row_index : 0)
    : data.test_data_row_index;
  const dataLink = await validateDataSetLink(resolvedAppType, dataSetId, rowIndex, dataSetId === existing.test_data_set_id && rowIndex === existing.test_data_row_index);
  const nextSteps = data.steps !== undefined ? reconcileSharedStepIds(data.steps, existing.steps, id) : existing.steps;
  const authoringMode = data.authoring_mode !== undefined ? normalizeAuthoringMode(data.authoring_mode) : normalizeAuthoringMode(existing.authoring_mode);
  const gherkinDocument = data.gherkin_document !== undefined ? normalizeText(data.gherkin_document) : existing.gherkin_document;
  const parameterValues = mergeSharedParameterValues({ values: data.parameter_values,
    previousValues: parseJsonValue(stored.parameter_values, {}),
    previousSensitiveNames: existing.parameter_sensitive_names,
    nextSensitiveNames: sharedSensitiveParameterNames(dataLink.dataSet, { ...parseJsonValue(stored.parameter_values, {}), ...data.parameter_values }),
    referencedNames: data.steps !== undefined && data.parameter_values !== undefined
      ? referencedSharedParameterNames({ steps: nextSteps, authoring_mode: authoringMode, gherkin_document: gherkinDocument }) : undefined
  });

  await updateSharedStepGroup.run(
    resolvedAppType.id,
    resolvedName,
    data.description !== undefined ? normalizeText(data.description) : existing.description,
    authoringMode,
    gherkinDocument,
    nextSteps,
    parameterValues,
    dataLink.id,
    dataLink.rowIndex,
    normalizeText(data.updated_by) || existing.updated_by || existing.created_by || null,
    id
  );

  await sharedStepSyncService.syncSharedGroupReferences(id, { previousSteps: existing.steps });

  return { updated: true };
})();

exports.deleteSharedStepGroup = async (id) => db.transaction(async () => {
  await db.prepare("SELECT id FROM shared_step_groups WHERE id = ? FOR UPDATE").get(id);
  await exports.getSharedStepGroup(id);
  await sharedStepSyncService.unlinkSharedGroupReferences(id);
  await deleteSharedStepGroup.run(id);
  return { deleted: true };
})();
