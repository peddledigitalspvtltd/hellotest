const db = require("@hellotest/platform/backend/src/db");
const resultService = require("./executionResult.service");
const executionService = require("./execution.service");
const { assertExpectedRevision } = require("@hellotest/platform/backend/src/utils/revision");
const { invalidateExecutionCache } = require("@hellotest/platform/backend/src/utils/executionCache");
const { FINAL_CASE_STATUSES, lifecycleError, parseHistory, getExecutionResultDurationMs, transitionCaseTimer } = require("@hellotest/platform/backend/src/utils/executionCaseLifecycle");
const shapeResult = resultService.shapeExecutionResult;
const assertMutableRun = execution => {
  if (!execution || execution.ended_at || !["queued", "running", "retrying"].includes(execution.status)) {
    throw lifecycleError("Finished runs cannot change case status or timers.", "RUN_FINISHED");
  }
};

async function applyCaseLifecycle(input, actorId, ensureOnly = false) {
  return db.transaction(async () => {
    const execution = await db.prepare(`SELECT * FROM executions WHERE id = ? FOR UPDATE`).get(input.execution_id);
    if (!execution) throw lifecycleError("Execution not found", "EXECUTION_NOT_FOUND", 404);
    if (!ensureOnly) assertMutableRun(execution);
    const frozenExecution = await executionService.getExecution(input.execution_id, true);
    const snapshot = frozenExecution.case_snapshots?.find(row => row.test_case_id === input.test_case_id);
    if (!snapshot) throw lifecycleError("The case is not part of this run's frozen scope.", "CASE_NOT_IN_RUN", 404);
    const keyIndex = typeof input.data_set_iteration_key === "string" ? Number(input.data_set_iteration_key.match(/:(\d+)$/)?.[1]) - 1 : null;
    const requestedIndex = input.data_set_iteration_index ?? (Number.isInteger(keyIndex) && keyIndex >= 0 ? keyIndex : null);
    const iteration = executionService.resolveExecutionCaseDataSetIteration(frozenExecution, snapshot, requestedIndex);
    const metadata = iteration.result_metadata;
    if (input.data_set_iteration_key != null && input.data_set_iteration_key !== metadata.data_set_iteration_key) {
      throw lifecycleError("The requested data row does not match the frozen case iteration.", "CASE_ITERATION_MISMATCH", 400);
    }
    const existing = await db.prepare(`SELECT * FROM execution_results
      WHERE execution_id = ? AND test_case_id = ? AND COALESCE(data_set_iteration_index, -1) = COALESCE(?, -1)
      ORDER BY created_at DESC, id DESC LIMIT 1 FOR UPDATE`).get(input.execution_id, input.test_case_id, metadata.data_set_iteration_index);
    if (ensureOnly && existing) return shapeResult(existing);
    if (!ensureOnly && ["start", "resume"].includes(input.action) && execution.status !== "running") {
      throw lifecycleError("Start the run before starting a case.", "RUN_NOT_STARTED");
    }
    const actor = actorId ? await db.prepare(`SELECT id, name, email FROM users WHERE id = ?`).get(actorId) : null;
    const now = Date.now();
    const transition = ensureOnly ? { status: "pending", duration_ms: 0, started_at: null, timer_started_at: null, ended_at: null, lifecycle_history: [] }
      : transitionCaseTimer(existing, input.action, actor || actorId, now);
    // Retried requests with the same resulting state are harmless, even if the
    // first response was lost and the caller still holds the previous revision.
    if (transition.unchanged) return shapeResult(existing);
    if (existing && input.expected_result_id && input.expected_result_id !== existing.id) {
      throw lifecycleError("A newer case attempt exists. Refresh before changing it.", "CASE_ATTEMPT_CHANGED");
    }
    if (existing && !ensureOnly) assertExpectedRevision(existing.revision, input.expected_revision, "Execution result");
    if (!existing && input.expected_result_id) throw lifecycleError("The selected case attempt no longer exists.", "CASE_ATTEMPT_CHANGED");

    let id = existing?.id;
    if (transition.newAttempt && existing) {
      const closedStatus = FINAL_CASE_STATUSES.has(existing.status) ? existing.status : "aborted";
      const duration = getExecutionResultDurationMs(existing, now);
      const history = [...parseHistory(existing.lifecycle_history), { action: input.action === "reset" ? "reset_attempt" : "restart_attempt", from_status: existing.status, to_status: closedStatus, actor_id: actorId || null, actor_name: actor?.name || null, actor_email: actor?.email || null, at: new Date(now).toISOString(), duration_ms: duration }];
      await db.prepare(`UPDATE execution_results SET status = ?, duration_ms = ?, timer_started_at = NULL, ended_at = COALESCE(ended_at, ?), lifecycle_history = ?, revision = revision + 1 WHERE id = ?`)
        .run(closedStatus, duration, new Date(now).toISOString(), history, existing.id);
    }
    if (!existing || transition.newAttempt) {
      const created = await resultService.createExecutionResult({ execution_id: input.execution_id, test_case_id: input.test_case_id,
        app_type_id: execution.app_type_id, status: transition.status, duration_ms: transition.duration_ms, executed_by: actorId, ...metadata });
      id = created.id;
      // Two attempts created within one millisecond still have a strict order.
      const createdAt = new Date(Math.max(now, (new Date(existing?.created_at || 0).getTime() || 0) + 1)).toISOString();
      await db.prepare(`UPDATE execution_results SET created_at = ? WHERE id = ?`).run(createdAt, id);
    }
    const revision = !existing || transition.newAttempt ? 1 : Number(existing.revision || 1) + 1;
    await db.prepare(`UPDATE execution_results SET status = ?, duration_ms = ?, started_at = ?, timer_started_at = ?, ended_at = ?, lifecycle_history = ?, executed_by = ?, revision = ? WHERE id = ?`)
      .run(transition.status, transition.duration_ms, transition.started_at, transition.timer_started_at, transition.ended_at, transition.lifecycle_history, actorId || existing?.executed_by || null, revision, id);
    return resultService.getExecutionResult(id);
  })();
}

exports.transitionExecutionCase = async (input, actorId) => {
  const result = await applyCaseLifecycle(input, actorId);
  invalidateExecutionCache(input.execution_id);
  return result;
};
exports.ensureExecutionCaseResult = async (input, actorId) => {
  const result = await applyCaseLifecycle(input, actorId, true);
  invalidateExecutionCache(input.execution_id);
  return result;
};

