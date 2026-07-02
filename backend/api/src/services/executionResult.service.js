const db = require("../db");
const { v4: uuid } = require("uuid");
const { EXECUTION_RESULT_STATUS_VALUES } = require("../domain/catalog");
const { normalizeReferenceList, normalizeStoredReferenceList } = require("../utils/externalReferences");
const requirementDefectService = require("./requirementDefect.service");
const testCaseDefectService = require("./testCaseDefect.service");

const getPrimarySuiteForTestCase = db.prepare(`
  SELECT test_suites.id, test_suites.name
  FROM suite_test_cases
  JOIN test_suites ON test_suites.id = suite_test_cases.suite_id
  WHERE suite_test_cases.test_case_id = ?
  ORDER BY suite_test_cases.sort_order ASC
  LIMIT 1
`);

const getExecutionCaseSnapshot = db.prepare(`
  SELECT test_case_id, test_case_title, suite_id, suite_name
  FROM execution_case_snapshots
  WHERE execution_id = ? AND test_case_id = ?
`);

const getLatestExecutionResultByCase = db.prepare(`
  SELECT *
  FROM execution_results
  WHERE execution_id = ? AND test_case_id = ?
  ORDER BY created_at DESC, id DESC
  LIMIT 1
`);

// Create Result
exports.createExecutionResult = async (data) => {

  const {
    execution_id,
    test_case_id,
    app_type_id,
    status,
    duration_ms,
    error,
    logs,
    external_references,
    defects,
    executed_by
  } = data;

  if (!EXECUTION_RESULT_STATUS_VALUES.includes(status)) {
    throw new Error("Invalid status");
  }

  // Validate execution
  const execution = await db.prepare(`
    SELECT id, app_type_id FROM executions WHERE id = ?
  `).get(execution_id);

  if (!execution) throw new Error("Execution not found");

  const snapshotCase = await getExecutionCaseSnapshot.get(execution_id, test_case_id);

  // Validate app type
  const appType = await db.prepare(`
    SELECT id FROM app_types WHERE id = ?
  `).get(app_type_id);

  if (!appType) throw new Error("App type not found");
  if (execution.app_type_id && execution.app_type_id !== app_type_id) {
    throw new Error("App type does not match the execution scope");
  }

  let resolvedTitle = null;
  let resolvedSuiteId = null;
  let resolvedSuiteName = null;

  if (snapshotCase) {
    resolvedTitle = snapshotCase.test_case_title;
    resolvedSuiteId = snapshotCase.suite_id || null;
    resolvedSuiteName = snapshotCase.suite_name || null;
  } else {
    // Backward compatibility for executions created before snapshotting support.
    const testCase = await db.prepare(`
      SELECT id, title, suite_id
      FROM test_cases
      WHERE id = ?
    `).get(test_case_id);

    if (!testCase) throw new Error("Test case not found");

    const suiteSnapshot = await getPrimarySuiteForTestCase.get(test_case_id);
    resolvedTitle = testCase.title;
    resolvedSuiteId = suiteSnapshot?.id || testCase.suite_id || null;
    resolvedSuiteName = suiteSnapshot?.name || null;
  }

  // Optional: Validate user
  if (executed_by) {
    const user = await db.prepare(`
      SELECT id FROM users WHERE id = ?
    `).get(executed_by);

    if (!user) throw new Error("Invalid user");
  }

  const id = uuid();
  const normalizedDefects = normalizeReferenceList(defects);

  await db.prepare(`
    INSERT INTO execution_results
    (id, execution_id, test_case_id, test_case_title, suite_id, suite_name, app_type_id, status, duration_ms, error, logs, external_references, defects, executed_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    execution_id,
    test_case_id,
    resolvedTitle,
    resolvedSuiteId,
    resolvedSuiteName,
    app_type_id,
    status,
    duration_ms || null,
    error || null,
    logs || null,
    normalizeReferenceList(external_references),
    normalizedDefects,
    executed_by || null
  );

  await requirementDefectService.syncAutomaticDefectsForTestCase(test_case_id, normalizedDefects);
  await testCaseDefectService.syncAutomaticDefectsForTestCase(test_case_id, normalizedDefects);

  return { id };
};


// Get Results (with filters)
exports.getExecutionResults = async ({ execution_id, test_case_id, app_type_id }) => {

  let query = `SELECT * FROM execution_results WHERE 1=1`;
  const params = [];

  if (execution_id) {
    query += ` AND execution_id = ?`;
    params.push(execution_id);
  }

  if (test_case_id) {
    query += ` AND test_case_id = ?`;
    params.push(test_case_id);
  }

  if (app_type_id) {
    query += ` AND app_type_id = ?`;
    params.push(app_type_id);
  }

  query += ` ORDER BY created_at DESC`;

  const rows = await db.prepare(query).all(...params);
  return rows.map((row) => ({
    ...row,
    external_references: normalizeStoredReferenceList(row.external_references),
    defects: normalizeStoredReferenceList(row.defects)
  }));
};


// Get Single Result
exports.getExecutionResult = async (id) => {

  const result = await db.prepare(`
    SELECT * FROM execution_results WHERE id = ?
  `).get(id);

  if (!result) throw new Error("Execution result not found");

  return {
    ...result,
    external_references: normalizeStoredReferenceList(result.external_references),
    defects: normalizeStoredReferenceList(result.defects)
  };
};

exports.findLatestExecutionResult = async ({ execution_id, test_case_id }) => {
  if (!execution_id || !test_case_id) {
    return null;
  }

  return getLatestExecutionResultByCase.get(execution_id, test_case_id) || null;
};


// Update Result (only limited fields)
exports.updateExecutionResult = async (id, data) => {

  const existing = await exports.getExecutionResult(id);

  const status = data.status || existing.status;

  if (!EXECUTION_RESULT_STATUS_VALUES.includes(status)) {
    throw new Error("Invalid status");
  }

  const normalizedDefects = data.defects !== undefined
    ? normalizeReferenceList(data.defects)
    : normalizeStoredReferenceList(existing.defects);

  await db.prepare(`
    UPDATE execution_results
    SET status = ?, duration_ms = ?, error = ?, logs = ?, external_references = ?, defects = ?, executed_by = ?
    WHERE id = ?
  `).run(
    status,
    data.duration_ms ?? existing.duration_ms,
    data.error ?? existing.error,
    data.logs ?? existing.logs,
    data.external_references !== undefined
      ? normalizeReferenceList(data.external_references)
      : normalizeStoredReferenceList(existing.external_references),
    normalizedDefects,
    data.executed_by ?? existing.executed_by,
    id
  );

  if (data.defects !== undefined) {
    await requirementDefectService.syncAutomaticDefectsForTestCase(existing.test_case_id, normalizedDefects);
    await testCaseDefectService.syncAutomaticDefectsForTestCase(existing.test_case_id, normalizedDefects);
  }

  return { updated: true };
};

exports.upsertExecutionResult = async (data) => {
  const existing = await exports.findLatestExecutionResult({
    execution_id: data.execution_id,
    test_case_id: data.test_case_id
  });

  if (existing) {
    await exports.updateExecutionResult(existing.id, {
      status: data.status,
      duration_ms: data.duration_ms,
      error: data.error,
      logs: data.logs,
      external_references: data.external_references,
      defects: data.defects,
      executed_by: data.executed_by
    });

    return exports.getExecutionResult(existing.id);
  }

  const created = await exports.createExecutionResult(data);
  return exports.getExecutionResult(created.id);
};


// Delete Result
exports.deleteExecutionResult = async (id) => {

  await exports.getExecutionResult(id);

  await db.prepare(`
    DELETE FROM execution_results WHERE id = ?
  `).run(id);

  return { deleted: true };
};
