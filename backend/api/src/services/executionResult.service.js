const db = require("../db");
const { randomUUID: uuid } = require("crypto");
const { EXECUTION_RESULT_STATUS_VALUES } = require("../domain/catalog");
const { normalizeReferenceList, normalizeStoredReferenceList } = require("../utils/externalReferences");
const { assertExpectedRevision } = require("../utils/revision");
const requirementDefectService = require("./requirementDefect.service");
const testCaseDefectService = require("./testCaseDefect.service");
const { FINAL_CASE_STATUSES, lifecycleError, parseHistory, getExecutionResultDurationMs } = require("../utils/executionCaseLifecycle");
const { invalidateExecutionCache } = require("../utils/executionCache");

const assertMutableRun = (execution) => {
  if (!execution || execution.ended_at || !["queued", "running", "retrying"].includes(execution.status)) {
    throw lifecycleError("Finished runs cannot change case status or timers.", "RUN_FINISHED");
  }
};
const shapeResult = (row) => ({
  ...row,
  duration_ms: row.duration_ms == null ? null : Number(row.duration_ms),
  elapsed_duration_ms: getExecutionResultDurationMs(row),
  lifecycle_history: parseHistory(row.lifecycle_history),
  external_references: normalizeStoredReferenceList(row.external_references),
  defects: normalizeStoredReferenceList(row.defects),
  case_defects: normalizeStoredReferenceList(row.case_defects),
  step_defects: normalizeObject(row.step_defects),
  revision: Number(row.revision || 1)
});

exports.shapeExecutionResult = shapeResult;

const normalizeObject = (value) => {
  if (!value) return {};
  if (typeof value === "string") {
    try { return JSON.parse(value); } catch { return {}; }
  }
  return typeof value === "object" && !Array.isArray(value) ? value : {};
};

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
    AND COALESCE(data_set_iteration_index, -1) = COALESCE(?, -1)
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
    test_data_set_id,
    test_data_set_name,
    data_set_iteration_index,
    data_set_iteration_key,
    data_set_row_snapshot,
    external_references,
    defects,
    executed_by
  } = data;

  if (!EXECUTION_RESULT_STATUS_VALUES.includes(status)) {
    throw new Error("Invalid status");
  }

  // Validate execution
  const execution = await db.prepare(`
    SELECT id, app_type_id, status, trigger, execution_mode, ended_at FROM executions WHERE id = ?
  `).get(execution_id);

  if (!execution) throw new Error("Execution not found");
  if (data.require_explicit_start && status !== "pending") {
    assertMutableRun(execution);
    if (execution.trigger === "manual") throw lifecycleError("Start the case explicitly before recording its result.", "CASE_NOT_STARTED");
  }

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
    (id, execution_id, test_case_id, test_case_title, suite_id, suite_name, app_type_id, status, duration_ms, error, logs, test_data_set_id, test_data_set_name, data_set_iteration_index, data_set_iteration_key, data_set_row_snapshot, external_references, case_defects, defects, executed_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    execution_id,
    test_case_id,
    resolvedTitle,
    resolvedSuiteId,
    resolvedSuiteName,
    app_type_id,
    status,
    duration_ms ?? null,
    error || null,
    logs || null,
    test_data_set_id || null,
    test_data_set_name || null,
    Number.isInteger(data_set_iteration_index) ? data_set_iteration_index : null,
    data_set_iteration_key || null,
    data_set_row_snapshot || null,
    normalizeReferenceList(external_references),
    normalizedDefects,
    normalizedDefects,
    executed_by || null
  );

  await requirementDefectService.syncAutomaticDefectsForTestCase(test_case_id, normalizedDefects);
  await testCaseDefectService.syncAutomaticDefectsForTestCase(test_case_id, normalizedDefects);

  return { id, revision: 1 };
};


// Get Results (with filters)
exports.getExecutionResults = async ({ project_id, execution_id, test_case_id, app_type_id, run_limit, limit, projection }) => {
  // Library history needs status and timing, not potentially megabytes of logs,
  // screenshots, captured response bodies or data-row snapshots per result.
  const summaryColumns = [
    "id", "execution_id", "test_case_id", "test_case_title", "suite_id", "suite_name",
    "app_type_id", "status", "duration_ms", "error", "test_data_set_id", "test_data_set_name",
    "data_set_iteration_index", "data_set_iteration_key", "external_references", "defects",
    "case_defects", "step_defects", "executed_by", "created_at", "started_at",
    "timer_started_at", "ended_at", "revision"
  ];
  const selectedColumns = projection === "summary"
    ? summaryColumns.map(column => `execution_results.${column}`).join(", ")
    : "execution_results.*";

  let query = `
    SELECT ${selectedColumns}
    FROM execution_results
    ${project_id ? "JOIN executions ON executions.id = execution_results.execution_id" : ""}
    WHERE 1=1
  `;
  const params = [];

  if (project_id) {
    query += ` AND executions.project_id = ?`;
    params.push(project_id);
  }

  if (execution_id) {
    query += ` AND execution_results.execution_id = ?`;
    params.push(execution_id);
  }

  if (test_case_id) {
    query += ` AND execution_results.test_case_id = ?`;
    params.push(test_case_id);
  }

  if (app_type_id) {
    query += ` AND execution_results.app_type_id = ?`;
    params.push(app_type_id);
  }

  if (run_limit && !execution_id) {
    const recentRunConditions = [];
    const recentRunParams = [];
    if (project_id) {
      recentRunConditions.push("recent_executions.project_id = ?");
      recentRunParams.push(project_id);
    }
    if (app_type_id) {
      recentRunConditions.push("recent_executions.app_type_id = ?");
      recentRunParams.push(app_type_id);
    }
    query += `
      AND execution_results.execution_id IN (
        SELECT recent_executions.id
        FROM executions recent_executions
        ${recentRunConditions.length ? `WHERE ${recentRunConditions.join(" AND ")}` : ""}
        ORDER BY COALESCE(recent_executions.ended_at, recent_executions.started_at, recent_executions.created_at) DESC
        LIMIT ?
      )
    `;
    params.push(...recentRunParams, run_limit);
  }

  query += ` ORDER BY execution_results.created_at DESC, execution_results.id DESC`;

  if (limit) {
    query += ` LIMIT ?`;
    params.push(limit);
  }

  const rows = await db.prepare(query).all(...params);
  return rows.map(row => projection === "summary"
    ? { ...shapeResult(row), logs: null, detail_complete: false }
    : shapeResult(row));
};


// Get Single Result
exports.getExecutionResult = async (id) => {

  const result = await db.prepare(`
    SELECT * FROM execution_results WHERE id = ?
  `).get(id);

  if (!result) throw new Error("Execution result not found");

  return shapeResult(result);
};

exports.findLatestExecutionResult = async ({ execution_id, test_case_id, data_set_iteration_index }) => {
  if (!execution_id || !test_case_id) {
    return null;
  }

  return getLatestExecutionResultByCase.get(
    execution_id,
    test_case_id,
    Number.isInteger(data_set_iteration_index) ? data_set_iteration_index : null
  ) || null;
};

// Called inside the parent run's completion transaction. Unfinished cases are
// stopped without inferring a pass or deleting their recorded evidence.
exports.stopExecutionCaseTimers = async (executionId, actorId) => {
  const rows = await db.prepare(`SELECT * FROM execution_results WHERE execution_id = ? AND status IN ('running', 'paused') FOR UPDATE`).all(executionId);
  const now = Date.now();
  const at = new Date(now).toISOString();
  const actor = actorId ? await db.prepare(`SELECT id, name, email FROM users WHERE id = ?`).get(actorId) : null;
  for (const row of rows) {
    const duration = getExecutionResultDurationMs(row, now);
    const history = [...parseHistory(row.lifecycle_history), { action: "run_finished", from_status: row.status, to_status: "aborted", actor_id: actorId || null, actor_name: actor?.name || null, actor_email: actor?.email || null, at, duration_ms: duration }];
    await db.prepare(`UPDATE execution_results SET status = 'aborted', duration_ms = ?, timer_started_at = NULL, ended_at = ?, lifecycle_history = ?, revision = revision + 1 WHERE id = ?`).run(duration, at, history, row.id);
  }
};


// Update Result (only limited fields)
exports.updateExecutionResult = async (id, data) => {
  const transaction = db.transaction(async () => {
    const identity = await db.prepare(`SELECT execution_id FROM execution_results WHERE id = ?`).get(id);
    if (!identity) throw new Error("Execution result not found");
    const execution = await db.prepare(`SELECT * FROM executions WHERE id = ? FOR UPDATE`).get(identity.execution_id);
    const existing = await db.prepare(`SELECT * FROM execution_results WHERE id = ? FOR UPDATE`).get(id);
    if (!existing) throw new Error("Execution result not found");

    const currentRevision = assertExpectedRevision(existing.revision, data.expected_revision, "Execution result");
    const status = data.status || existing.status;

    if (!EXECUTION_RESULT_STATUS_VALUES.includes(status)) {
      throw new Error("Invalid status");
    }
    const changesStatus = status !== existing.status;
    const isManagedTimer = Boolean(existing.started_at || parseHistory(existing.lifecycle_history).length);
    if (changesStatus) {
      assertMutableRun(execution);
      const latest = await exports.findLatestExecutionResult(existing);
      if (latest?.id !== id) throw lifecycleError("Only the latest case attempt can change status.", "CASE_ATTEMPT_CHANGED");
      if (data.require_explicit_start && execution?.trigger === "manual"
        && (!["passed", "failed"].includes(status) || !existing.started_at || existing.status !== "running")) {
        throw lifecycleError("Start or resume the case explicitly before recording its result.", "CASE_NOT_STARTED");
      }
    }
    let duration = isManagedTimer ? Number(existing.duration_ms || 0)
      : data.require_explicit_start && (execution?.trigger === "manual" || execution?.ended_at) ? existing.duration_ms : data.duration_ms ?? existing.duration_ms;
    let timerStartedAt = existing.timer_started_at || null;
    let endedAt = existing.ended_at || null;
    let history = parseHistory(existing.lifecycle_history);
    if (changesStatus && isManagedTimer) {
      const now = Date.now();
      duration = getExecutionResultDurationMs(existing, now);
      timerStartedAt = status === "running" ? new Date(now).toISOString() : null;
      endedAt = FINAL_CASE_STATUSES.has(status) ? new Date(now).toISOString() : null;
      const actorId = data.actor_id || data.executed_by || existing.executed_by;
      const actor = actorId ? await db.prepare(`SELECT id, name, email FROM users WHERE id = ?`).get(actorId) : null;
      history = [...history, { action: "record_result", from_status: existing.status, to_status: status, actor_id: actorId || null, actor_name: actor?.name || null, actor_email: actor?.email || null, at: new Date(now).toISOString(), duration_ms: duration }];
    }

    const persistedStepDefects = Object.values(normalizeObject(existing.step_defects))
      .flatMap((value) => normalizeStoredReferenceList(value));
    const caseDefects = data.defects !== undefined
      ? normalizeReferenceList(data.defects)
      : normalizeStoredReferenceList(existing.case_defects);
    const normalizedDefects = [...new Set([...caseDefects, ...persistedStepDefects])];
    const revision = currentRevision + 1;

    await db.prepare(`
      UPDATE execution_results
      SET status = ?, duration_ms = ?, error = ?, logs = ?, external_references = ?, case_defects = ?, defects = ?, executed_by = ?, revision = ?
      WHERE id = ?
    `).run(
      status,
      duration,
      data.error ?? existing.error,
      data.logs ?? existing.logs,
      data.external_references !== undefined
        ? normalizeReferenceList(data.external_references)
        : normalizeStoredReferenceList(existing.external_references),
      caseDefects,
      normalizedDefects,
      data.executed_by ?? existing.executed_by,
      revision,
      id
    );
    if (isManagedTimer) await db.prepare(`UPDATE execution_results SET timer_started_at = ?, ended_at = ?, lifecycle_history = ? WHERE id = ?`).run(timerStartedAt, endedAt, history, id);

    return {
      updated: true,
      revision,
      execution_id: existing.execution_id,
      test_case_id: existing.test_case_id,
      case_defects: caseDefects,
      defects: normalizedDefects,
      defects_changed: data.defects !== undefined
    };
  });

  const result = await transaction();
  invalidateExecutionCache(result.execution_id);
  if (result.defects_changed) {
    await requirementDefectService.syncAutomaticDefectsForTestCase(result.test_case_id, result.defects);
    await testCaseDefectService.syncAutomaticDefectsForTestCase(result.test_case_id, result.defects);
  }

  return { updated: true, revision: result.revision, case_defects: result.case_defects, defects: result.defects };
};

exports.linkStepDefects = async (id, { step_id, defect_ids = [], expected_revision } = {}) => {
  const transaction = db.transaction(async () => {
    const existing = await db.prepare(`SELECT * FROM execution_results WHERE id = ? FOR UPDATE`).get(id);
    if (!existing) throw new Error("Execution result not found");
    const currentRevision = assertExpectedRevision(existing.revision, expected_revision, "Execution result");

    const step = await db.prepare(`
      SELECT snapshot_step_id
      FROM execution_step_snapshots
      WHERE execution_id = ? AND test_case_id = ? AND snapshot_step_id = ?
    `).get(existing.execution_id, existing.test_case_id, step_id);
    if (!step) throw Object.assign(new Error("The selected step is not part of this execution result"), { statusCode: 409 });

    const execution = await db.prepare(`SELECT project_id FROM executions WHERE id = ?`).get(existing.execution_id);
    const ids = [...new Set((Array.isArray(defect_ids) ? defect_ids : []).map((value) => String(value || "").trim()).filter(Boolean))];
    if (ids.length > 50) throw Object.assign(new Error("A result step can link at most 50 Defects"), { statusCode: 413 });
    if (ids.length) {
      const placeholders = ids.map(() => "?").join(",");
      const defects = await db.prepare(`SELECT id FROM feedback WHERE project_id = ? AND id IN (${placeholders})`).all(execution.project_id, ...ids);
      if (defects.length !== ids.length) throw Object.assign(new Error("Every linked defect must belong to this run's project"), { statusCode: 409 });
    }

    const previousStepDefects = normalizeObject(existing.step_defects);
    const caseDefects = normalizeStoredReferenceList(existing.case_defects);
    const stepDefects = { ...previousStepDefects, [step_id]: ids };
    if (!ids.length) delete stepDefects[step_id];
    const allDefects = [...new Set([
      ...caseDefects,
      ...Object.values(stepDefects).flatMap((value) => normalizeStoredReferenceList(value))
    ])];
    const revision = currentRevision + 1;
    await db.prepare(`UPDATE execution_results SET step_defects = ?, defects = ?, revision = ? WHERE id = ?`).run(stepDefects, allDefects, revision, id);

    return {
      revision,
      test_case_id: existing.test_case_id,
      defects: allDefects,
      step_defects: stepDefects
    };
  });

  const result = await transaction();
  await requirementDefectService.syncAutomaticDefectsForTestCase(result.test_case_id, result.defects);
  await testCaseDefectService.syncAutomaticDefectsForTestCase(result.test_case_id, result.defects);
  return { updated: true, revision: result.revision, defects: result.defects, step_defects: result.step_defects };
};

exports.upsertExecutionResult = async (data) => {
  const existing = await exports.findLatestExecutionResult({
    execution_id: data.execution_id,
    test_case_id: data.test_case_id,
    data_set_iteration_index: data.data_set_iteration_index
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

  const existing = await exports.getExecutionResult(id);

  await db.prepare(`
    DELETE FROM execution_results WHERE id = ?
  `).run(id);

  await requirementDefectService.syncAutomaticDefectsForTestCase(existing.test_case_id);
  await testCaseDefectService.syncAutomaticDefectsForTestCase(existing.test_case_id);

  return { deleted: true };
};
