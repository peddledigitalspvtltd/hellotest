const { sourceFile } = require("./helpers/sourceFile");
const test = require("node:test");
const assert = require("node:assert/strict");
const db = require("../src/db");
const results = require("../../../testing/backend/services/executionResult.service");
const lifecycle = require("../../../testing/backend/services/executionCaseLifecycle.service");
const executions = require("../../../testing/backend/services/execution.service");
const { transitionCaseTimer, getExecutionResultDurationMs } = require("../src/utils/executionCaseLifecycle");

const NOW = Date.parse("2026-09-10T10:00:00Z");
const identity = { execution_id: "run", test_case_id: "case" };
const jsonFields = new Set(["external_references", "defects", "case_defects", "step_defects", "lifecycle_history", "data_set_row_snapshot"]);
const decode = (field, value) => jsonFields.has(field) && typeof value === "string" ? JSON.parse(value) : value;
function database(context, { status = "running", rows = [], dataSet, automated = 'no' } = {}) {
  const state = { run: { id: "run", project_id: "project", app_type_id: "app", status, trigger: "manual", revision: 1 }, rows, writes: [] };
  const snapshot = { execution_id: "run", test_case_id: "case", test_case_title: "Payment case", suite_id: null, automated, ...dataSet };
  context.mock.timers.enable({ apis: ["Date"], now: NOW });
  context.mock.method(executions, "getExecution", async () => ({ ...state.run, case_snapshots: [snapshot] }));
  for (const [name, method] of [["requirementDefect.service", "syncAutomaticDefectsForTestCase"], ["testCaseDefect.service", "syncAutomaticDefectsForTestCase"]]) context.mock.method(require(sourceFile(`${name}`, "services")), method, async () => undefined);
  const query = async statement => {
    const sql = (typeof statement === "string" ? statement : statement.text).replace(/\s+/g, " ").trim();
    const values = statement.values || [];
    let found = [];
    if (/^(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)/.test(sql)) return { rows: [], rowCount: 0 };
    if (/FROM executions/.test(sql)) found = [state.run];
    else if (/FROM execution_case_snapshots/.test(sql)) found = [snapshot];
    else if (/FROM execution_step_snapshots/.test(sql)) found = [{test_case_id:"case",snapshot_step_id:"step",step_type:"web"}];
    else if (/FROM app_types/.test(sql)) found = [{ id: "app" }];
    else if (/FROM users/.test(sql)) found = [{ id: "qa", name: "QA Reviewer", email: "qa@example.test" }];
    else if (/^SELECT .*FROM execution_results/.test(sql)) {
      found = /WHERE id =/.test(sql) ? state.rows.filter(row => row.id === values[0])
        : state.rows.filter(row => row.execution_id === values[0] && (!/test_case_id =/.test(sql) || row.test_case_id === values[1] && (row.data_set_iteration_index ?? null) === (values[2] ?? null)));
      if (/status IN/.test(sql)) found = found.filter(row => ["running", "paused"].includes(row.status));
      found = found.slice().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) || b.id.localeCompare(a.id));
      if (/LIMIT 1/.test(sql)) found = found.slice(0, 1);
    } else if (/^INSERT INTO execution_results/.test(sql)) {
      const columns = sql.match(/execution_results \(([^)]+)\)/)[1].split(/,\s*/);
      state.rows.push({ revision: 1, created_at: new Date().toISOString(), lifecycle_history: [], ...Object.fromEntries(columns.map((column, index) => [column, decode(column, values[index])])) });
      state.writes.push({ sql, values });
    } else if (/^UPDATE execution_results/.test(sql)) {
      const row = state.rows.find(row => row.id === values.at(-1));
      assert.ok(row, `Expected a persisted result for ${sql}`);
      const set = sql.split(" SET ")[1].split(" WHERE ")[0];
      for (const match of set.matchAll(/(\w+) = \$(\d+)/g)) row[match[1]] = decode(match[1], values[Number(match[2]) - 1]);
      for (const match of set.matchAll(/(\w+) = NULL/g)) row[match[1]] = null;
      for (const match of set.matchAll(/(\w+) = '([^']+)'/g)) row[match[1]] = match[2];
      if (/revision = revision \+ 1/.test(set)) row.revision++;
      const ended = set.match(/ended_at = COALESCE\(ended_at, \$(\d+)\)/);
      if (ended) row.ended_at ||= values[Number(ended[1]) - 1];
      state.writes.push({ sql, values });
    } else if (/^UPDATE executions/.test(sql)) {
      state.run.status = values[0]; state.run.ended_at = new Date().toISOString(); state.run.revision = values[1];
      state.writes.push({ sql, values });
    } else throw new Error(`Unhandled fixture SQL: ${sql}`);
    return { rows: found.map(row => ({ ...row })), rowCount: 1 };
  };
  context.mock.method(db.pool, "query", query);
  context.mock.method(db.pool, "connect", async () => ({ query, release() {} }));
  return state;
}

test("active time excludes pause gaps, repeated actions are idempotent, and resume accumulates", () => {
  const running = transitionCaseTimer(null, "start", "qa", NOW);
  assert.equal(getExecutionResultDurationMs(running, NOW + 5000), 5000);
  const paused = transitionCaseTimer(running, "pause", "qa", NOW + 5000);
  assert.equal(paused.duration_ms, 5000);
  assert.equal(getExecutionResultDurationMs(paused, NOW + 60000), 5000);
  assert.equal(transitionCaseTimer(paused, "pause", "qa", NOW + 60000).unchanged, true);
  const resumed = transitionCaseTimer(paused, "resume", "qa", NOW + 60000);
  assert.equal(getExecutionResultDurationMs(resumed, NOW + 63000), 8000);
  assert.equal(transitionCaseTimer(resumed, "start", "qa", NOW + 65000).timer_started_at, resumed.timer_started_at);
  assert.throws(() => transitionCaseTimer(null, "pass", "qa", NOW), { code: "CASE_NOT_STARTED" });
});

test("evidence ensure does not start a timer, including on finished runs", async context => {
  const state = database(context, { status: "completed" });
  const initial = await lifecycle.ensureExecutionCaseResult(identity, "qa");
  assert.equal(initial.status, "pending");
  assert.equal(initial.duration_ms, 0);
  assert.equal(initial.started_at, null);
  assert.equal(initial.timer_started_at, null);
  assert.deepEqual(initial.lifecycle_history, []);
  const writes = state.writes.length;
  assert.equal((await lifecycle.ensureExecutionCaseResult(identity, "qa")).id, initial.id);
  assert.equal(state.writes.length, writes, "Read/ensure of an existing case never writes lifecycle state");
  await assert.rejects(lifecycle.transitionExecutionCase({ ...identity, action: "start" }, "qa"), { code: "RUN_FINISHED" });
});

test('automatic cases reject every manual timer and outcome transition before a result exists', async context => {
  const state = database(context, { automated: 'yes' });
  for (const action of ['start', 'pause', 'resume', 'pass', 'fail', 'block', 'skip', 'abort', 'reset']) {
    await assert.rejects(lifecycle.transitionExecutionCase({ ...identity, action }, 'qa'), { code: 'AUTOMATED_CASE_ENGINE_OWNED' });
  }
  assert.equal(state.writes.length, 0);
  assert.equal((await lifecycle.ensureExecutionCaseResult(identity, 'qa')).status, 'pending', 'Evidence attachment can still obtain a stable result identity.');
});

test('manual result APIs cannot override engine-owned statuses or logs', async context => {
  const state = database(context, { automated: 'yes' });
  state.run.trigger = 'ci';
  await assert.rejects(results.createExecutionResult({ ...identity,app_type_id:'app',status:'passed',require_explicit_start:true }),{code:'AUTOMATED_CASE_ENGINE_OWNED'});
  const pending = await lifecycle.ensureExecutionCaseResult(identity,'qa');
  for (const patch of [{status:'passed'},{logs:'{"stepStatuses":{"step":"passed"}}'},{duration_ms:999}]) {
    await assert.rejects(results.updateExecutionResult(pending.id,{...patch,require_explicit_start:true}),{code:'AUTOMATED_CASE_ENGINE_OWNED'});
  }
});

test("manual lifecycle persists elapsed segments and actor history across requests and resets", async context => {
  const state = database(context);
  const started = await lifecycle.transitionExecutionCase({ ...identity, action: "start" }, "qa");
  context.mock.timers.tick(2500);
  const live = await results.getExecutionResult(started.id);
  assert.equal(live.elapsed_duration_ms, 2500);
  assert.equal(live.duration_ms, 0);
  const paused = await lifecycle.transitionExecutionCase({ ...identity, action: "pause", expected_revision: 1 }, "qa");
  assert.equal(paused.duration_ms, 2500);
  assert.equal(paused.lifecycle_history.at(-1).actor_name, "QA Reviewer");
  context.mock.timers.tick(60000);
  const repeated = await lifecycle.transitionExecutionCase({ ...identity, action: "pause", expected_revision: 1 }, "qa");
  assert.equal(repeated.revision, paused.revision);
  await assert.rejects(lifecycle.transitionExecutionCase({ ...identity, action: "resume", expected_revision: 1 }, "qa"), { statusCode: 409 });
  await lifecycle.transitionExecutionCase({ ...identity, action: "resume", expected_revision: paused.revision }, "qa");
  context.mock.timers.tick(1500);
  const reset = await lifecycle.transitionExecutionCase({ ...identity, action: "reset" }, "qa");
  assert.notEqual(reset.id, started.id);
  assert.equal(reset.status, "pending");
  assert.equal(reset.duration_ms, 0);
  const previous = state.rows.find(row => row.id === started.id);
  assert.equal(previous.duration_ms, 4000);
  assert.equal(previous.status, "aborted");
  assert.equal(previous.timer_started_at, null);
  assert.equal(reset.lifecycle_history[0].previous_result_id, previous.id);
  assert.equal((await lifecycle.transitionExecutionCase({ ...identity, action: "reset" }, "qa")).id, reset.id);
  assert.equal(state.rows.length, 2, "A retry cannot create duplicate reset attempts");
});

test("frozen dataset identity isolates timers and rejects mismatched or out-of-scope rows", async context => {
  const state = database(context, { dataSet: { test_data_set_id: "data", test_data_set_snapshot: { id: "data", mode: "table", rows: [{ email: "one" }, { email: "two" }] } } });
  const first = await lifecycle.transitionExecutionCase({ ...identity, action: "start", data_set_iteration_index: 0 }, "qa");
  const second = await lifecycle.ensureExecutionCaseResult({ ...identity, data_set_iteration_key: "data:2" }, "qa");
  assert.notEqual(first.id, second.id);
  assert.equal(second.status, "pending");
  assert.deepEqual(second.data_set_row_snapshot, { email: "two" });
  await assert.rejects(lifecycle.transitionExecutionCase({ ...identity, action: "start", data_set_iteration_index: 0, data_set_iteration_key: "data:2" }, "qa"), { code: "CASE_ITERATION_MISMATCH" });
  await assert.rejects(lifecycle.transitionExecutionCase({ ...identity, action: "start", data_set_iteration_index: 2 }, "qa"), { statusCode: 400 });
  await assert.rejects(lifecycle.transitionExecutionCase({ ...identity, test_case_id: "outside", action: "start" }, "qa"), { code: "CASE_NOT_IN_RUN" });
  assert.equal(state.rows.length, 2);
});

test("step result save stops a managed timer, notes cannot start it or overwrite elapsed time", async context => {
  database(context);
  const pending = await lifecycle.ensureExecutionCaseResult(identity, "qa");
  await results.updateExecutionResult(pending.id, { logs: "notes only", duration_ms: 99999, require_explicit_start: true });
  assert.equal((await results.getExecutionResult(pending.id)).duration_ms, 0);
  await assert.rejects(results.updateExecutionResult(pending.id, { status: "passed", require_explicit_start: true }), { code: "CASE_NOT_STARTED" });
  const started = await lifecycle.transitionExecutionCase({ ...identity, action: "start" }, "qa");
  context.mock.timers.tick(2000);
  await results.updateExecutionResult(started.id, { status: "passed", duration_ms: 99999, require_explicit_start: true, actor_id: "qa" });
  const passed = await results.getExecutionResult(started.id);
  assert.equal(passed.duration_ms, 2000);
  assert.equal(passed.timer_started_at, null);
  assert.equal(passed.lifecycle_history.at(-1).to_status, "passed");
  context.mock.timers.tick(4000);
  assert.equal((await results.getExecutionResult(started.id)).elapsed_duration_ms, 2000);
});

test("run duration retains all attempt time while status uses the latest attempt", () => {
  const metrics = executions.summarizeExecutionMetrics([{ test_case_id: "case" }], [
    { id: "old", test_case_id: "case", status: "aborted", duration_ms: 4000, created_at: "2026-09-10T10:00:00Z" },
    { id: "new", test_case_id: "case", status: "paused", duration_ms: 1500, created_at: "2026-09-10T10:01:00Z" }
  ]);
  assert.equal(metrics.paused_cases, 1);
  assert.equal(metrics.aborted_cases, 0);
  assert.equal(metrics.duration_ms, 5500);
});

test("legacy data-row keys cannot keep an older attempt current when the iteration index matches", () => {
  const metrics = executions.summarizeExecutionMetrics([{ test_case_id: "case" }], [
    { id: "old", test_case_id: "case", status: "failed", data_set_iteration_index: 0, data_set_iteration_key: "data:0", created_at: "2026-09-10T10:00:00Z" },
    { id: "reset", test_case_id: "case", status: "pending", data_set_iteration_index: 0, data_set_iteration_key: "data:1", created_at: "2026-09-10T11:00:00Z" }
  ]);
  assert.equal(metrics.pending_cases, 1);
  assert.equal(metrics.failed_cases, 0);
});

test("manual API/web steps cannot bypass an explicit started and running case", async context => {
  const state = database(context);
  context.mock.method(executions, "getExecution", async () => ({ ...state.run,
    case_snapshots: [{ test_case_id: "case", test_case_title: "Payment case" }],
    step_snapshots: [{ test_case_id: "case", snapshot_step_id: "step", step_type: "web" }]
  }));
  await assert.rejects(executions.runExecutionApiStep("run", "case", "step", { executed_by: "qa" }), { code: "CASE_NOT_STARTED" });
  await lifecycle.transitionExecutionCase({ ...identity, action: "start" }, "qa");
  await lifecycle.transitionExecutionCase({ ...identity, action: "pause" }, "qa");
  await assert.rejects(executions.runExecutionApiStep("run", "case", "step", { executed_by: "qa" }), { code: "CASE_NOT_STARTED" });
});

test("run completion freezes active timers and later evidence updates preserve time and status", async context => {
  const state = database(context);
  context.mock.method(require("../../../trace/backend/services/opsTelemetry.service"), "emitExecutionHierarchyEvents", async () => undefined);
  const started = await lifecycle.transitionExecutionCase({ ...identity, action: "start" }, "qa");
  context.mock.timers.tick(4500);
  await executions.completeExecution("run", "completed", { completed_by: "qa" });
  assert.equal(state.run.status, "partially_completed");
  assert.equal(state.rows[0].status, "aborted");
  assert.equal(state.rows[0].duration_ms, 4500);
  assert.equal(state.rows[0].timer_started_at, null);
  context.mock.timers.tick(30000);
  await results.updateExecutionResult(started.id, { logs: "Evidence added after completion", duration_ms: 99999, require_explicit_start: true });
  const preserved = await results.getExecutionResult(started.id);
  assert.equal(preserved.elapsed_duration_ms, 4500);
  assert.equal(preserved.status, "aborted");
  for (const action of ["start", "pause", "resume", "abort", "block", "skip", "reset", "pass", "fail"]) {
    await assert.rejects(lifecycle.transitionExecutionCase({ ...identity, action }, "qa"), { code: "RUN_FINISHED" });
  }
  await assert.rejects(results.updateExecutionResult(started.id, { status: "passed", require_explicit_start: true }), { code: "RUN_FINISHED" });
});

test("explicit block, N/A and abort persist distinct statuses without inventing active time", async context => {
  database(context);
  for (const [action, expected] of [["block", "blocked"], ["skip", "skipped"], ["abort", "aborted"]]) {
    const result = await lifecycle.transitionExecutionCase({ ...identity, action }, "qa");
    assert.equal(result.status, expected);
    assert.equal(result.duration_ms, 0);
    assert.equal(result.started_at, null);
    assert.equal(result.timer_started_at, null);
    assert.equal((await lifecycle.transitionExecutionCase({ ...identity, action }, "qa")).revision, result.revision);
    await lifecycle.transitionExecutionCase({ ...identity, action: "reset" }, "qa");
  }
});

test("completion derives the final verdict from actual results instead of trusting a stale client", async context => {
  const state = database(context);
  context.mock.method(require("../../../trace/backend/services/opsTelemetry.service"), "emitExecutionHierarchyEvents", async () => undefined);
  for (const [caseStatus, expected] of [["pending", "partially_completed"], ["paused", "partially_completed"], ["running", "partially_completed"], ["aborted", "partially_completed"], ["blocked", "blocked"], ["failed", "failed"], ["passed", "completed"], ["skipped", "completed"]]) {
    state.run.status = "running"; state.run.ended_at = null;
    state.rows = [{ id: "result", ...identity, status: caseStatus, duration_ms: 0, revision: 1, created_at: new Date().toISOString() }];
    const completion = await executions.completeExecution("run", "completed", { completed_by: "qa" });
    assert.equal(completion.status, expected, `Case ${caseStatus} cannot be misreported as a successful run`);
    assert.equal(state.run.status, expected);
  }
});

test("an unexecuted data row prevents a successful completed verdict", async context => {
  database(context, { dataSet: { test_data_set_snapshot: { mode: "table", rows: [{ row: "one" }, { row: "two" }] } }, rows: [
    { id: "row-1", ...identity, data_set_iteration_index: 0, status: "passed", duration_ms: 10, revision: 1, created_at: new Date(NOW).toISOString() }
  ] });
  context.mock.method(require("../../../trace/backend/services/opsTelemetry.service"), "emitExecutionHierarchyEvents", async () => undefined);
  const completion = await executions.completeExecution("run", "completed", { completed_by: "qa" });
  assert.equal(completion.status, "partially_completed");
  assert.equal(completion.counts.not_run, 1);
});

test("export summaries retain paused, N/A and unexecuted states and sum earlier attempts", async context => {
  const report = require("../../../testing/backend/services/executionReport.service");
  context.mock.method(executions, "getExecution", async () => ({ id: "run", case_snapshots: [
    { test_case_id: "paused", test_case_title: "Paused" }, { test_case_id: "skipped", test_case_title: "N/A" }, { test_case_id: "pending", test_case_title: "Unexecuted" }
  ], step_snapshots: [] }));
  context.mock.method(results, "getExecutionResults", async () => [
    { test_case_id: "paused", status: "paused", duration_ms: 1000, created_at: "2026-09-10T11:00:00Z" },
    { test_case_id: "paused", status: "aborted", duration_ms: 4000, created_at: "2026-09-10T10:00:00Z" },
    { test_case_id: "skipped", status: "skipped", duration_ms: 0 }
  ]);
  const exported = await report.buildReport("run");
  assert.equal(exported.summary.running, 0);
  assert.equal(exported.summary.paused, 1);
  assert.equal(exported.summary.skipped, 1);
  assert.equal(exported.summary.pending, 1);
  assert.equal(exported.summary.duration_ms, 5000);
});
