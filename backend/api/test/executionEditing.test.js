const test = require("node:test");
const assert = require("node:assert/strict");
const db = require("../src/db");
const execution = require("../src/services/execution.service");

const stubDatabase = (context, resolve = () => []) => {
  const statements = [];
  const query = async (statement) => {
    const sql = typeof statement === "string" ? statement : statement.text;
    const values = statement.values || [];
    statements.push({ sql, values });
    return { rows: await resolve(sql, values), rowCount: 1 };
  };
  context.mock.method(db.pool, "query", query);
  context.mock.method(db.pool, "connect", async () => ({ query, release() {} }));
  return statements;
};
const run = { id: "run-1", project_id: "project-1", app_type_id: "app-1", status: "running", trigger: "manual", revision: 4,
  assigned_to: null, assigned_to_ids: [], start_date: "2026-09-09", end_date: "2026-09-12" };

test("active run edits persist name and partial planning dates atomically with revision protection", async (context) => {
  const writes = stubDatabase(context, (sql) => /SELECT \* FROM executions/.test(sql) ? [run] : []);
  const result = await execution.updateExecution(run.id, { name: "  Release regression  ", start_date: "2026-09-10", release: "R2", expected_revision: 4 });
  assert.deepEqual(result, { updated: true, revision: 5 });
  const update = writes.find((entry) => /UPDATE executions\s+SET name/.test(entry.sql));
  assert.deepEqual(update.values, ["Release regression", "2026-09-10", "2026-09-12", "R2", "run-1"]);
  assert.ok(writes.some((entry) => /UPDATE executions SET revision/.test(entry.sql) && entry.values[0] === 5));
  await assert.rejects(execution.updateExecution(run.id, { name: "Stale edit", expected_revision: 3 }), { statusCode: 409 });
});

test("every terminal run status rejects run and scope assignment edits without writing", async (context) => {
  let status;
  const writes = stubDatabase(context, (sql) => /SELECT \* FROM executions/.test(sql) ? [{ ...run, status }] : []);
  for (status of ["passed", "failed", "blocked", "skipped", "completed", "cancelled", "aborted", "partially_completed"]) {
    await assert.rejects(execution.updateExecution(run.id, { name: "Changed" }), { statusCode: 409, code: "RUN_FINISHED" });
    await assert.rejects(execution.updateExecutionCaseAssignment(run.id, "case-1", { assigned_to_ids: [] }), { statusCode: 409, code: "RUN_FINISHED" });
  }
  assert.equal(writes.filter((entry) => /UPDATE |INSERT |DELETE /.test(entry.sql)).length, 0);
});

test("editing one planning date validates the retained date and active context settings stay locked", async (context) => {
  const writes = stubDatabase(context, (sql) => /SELECT \* FROM executions/.test(sql) ? [run] : []);
  await assert.rejects(execution.updateExecution(run.id, { start_date: "2026-09-13" }), { statusCode: 400 });
  await assert.rejects(execution.updateExecution(run.id, { test_environment_id: "env-2" }), { code: "RUN_CONTEXT_LOCKED", statusCode: 409 });
  await assert.rejects(execution.updateExecution(run.id, { execution_mode: "remote" }), { code: "RUN_CONTEXT_LOCKED", statusCode: 409 });
  assert.equal(writes.filter((entry) => /UPDATE |DELETE /.test(entry.sql)).length, 0);
});

test("queued mode changes persist without starting a run or touching result history", async (context) => {
  const writes = stubDatabase(context, (sql) => /SELECT \* FROM executions/.test(sql) ? [{ ...run, status: "queued" }] : []);
  await execution.updateExecution(run.id, { execution_mode: "local", parallel_enabled: true, parallel_count: 3 });
  const update = writes.find((entry) => /UPDATE executions\s+SET trigger/.test(entry.sql));
  assert.deepEqual(update.values, ["local", "local", true, 3, "run-1"]);
  assert.equal(writes.some((entry) => /SET status|UPDATE execution_results|DELETE FROM execution_results/.test(entry.sql)), false);
});

test("a requeued run retains runtime locks after its first start and dates can clear independently", async (context) => {
  const writes = stubDatabase(context, (sql) => /SELECT \* FROM executions/.test(sql)
    ? [{ ...run, status: "queued", started_at: "2026-09-09T09:00:00Z" }] : []);
  await assert.rejects(execution.updateExecution(run.id, { execution_mode: "remote" }), { code: "RUN_CONTEXT_LOCKED", statusCode: 409 });
  await execution.updateExecution(run.id, { start_date: null });
  const update = writes.find((entry) => /UPDATE executions\s+SET start_date/.test(entry.sql));
  assert.deepEqual(update.values, [null, "2026-09-12", run.id]);
});

test("start permissions use the actual stored automation mode even when the request says manual", async (context) => {
  const project = require("../src/services/project.service");
  const mobile = require("../src/services/mobileFeature.service");
  const features = require("../src/services/featureFlag.service");
  context.mock.method(project, "getProject", async () => ({}));
  context.mock.method(mobile, "executionUsesMobile", async () => false);
  context.mock.method(features, "getFeatureKeysForPermission", () => []);
  context.mock.method(execution, "getExecution", async () => ({ ...run, status: "queued", trigger: "ci" }));
  const start = context.mock.method(execution, "startExecution", async (_id, options) => {
    assert.equal(options.execution_mode, "remote");
    return { started: true };
  });
  const routes = new Map();
  let allowAutomation = false;
  const permissions = [];
  await require("../src/routes/executions.routes")({
    get() {}, put() {}, delete() {}, post: (path, handler) => routes.set(path, handler),
    authenticate: async () => undefined,
    requirePermission: (permission) => async () => {
      permissions.push(permission);
      if (permission === "automation.run.remote" && !allowAutomation) throw Object.assign(new Error("Remote automation is not permitted"), { statusCode: 403 });
    }
  });
  const request = { params: { id: run.id }, user: { id: "user-1" }, body: { execution_mode: "manual" } };
  await assert.rejects(routes.get("/executions/:id/start")(request), { statusCode: 403 });
  assert.equal(start.mock.callCount(), 0);
  allowAutomation = true;
  await routes.get("/executions/:id/start")(request);
  assert.equal(start.mock.callCount(), 1);
  assert.ok(permissions.includes("automation.run.remote"));
});

test("run membership validates app scope and preserves cases with recorded history", async (context) => {
  let wrongApp = true;
  const writes = stubDatabase(context, (sql) => {
    if (/SELECT \* FROM executions/.test(sql)) return [run];
    if (/FROM test_suites\s+WHERE id/.test(sql)) return [{ id: "suite-2", name: "Selected", app_type_id: wrongApp ? "other-app" : "app-1" }];
    if (/FROM execution_case_snapshots/.test(sql)) return [{ test_case_id: "case-1", suite_id: "suite-1", test_case_title: "Keep history" }];
    if (/FROM execution_suites/.test(sql)) return [{ suite_id: "suite-1", suite_name: "Previous" }];
    if (/FROM suite_test_cases\s+JOIN test_cases/.test(sql)) return [{ test_case_id: "case-2", test_case_title: "New case" }];
    if (/SELECT test_case_id FROM execution_results/.test(sql)) return [{ test_case_id: "case-1" }];
    return [];
  });
  await assert.rejects(execution.updateExecution(run.id, { suite_ids: ["suite-2"], test_case_ids: [] }), { statusCode: 400 });
  wrongApp = false;
  await assert.rejects(execution.updateExecution(run.id, { suite_ids: ["suite-2"], test_case_ids: [] }), { statusCode: 409, code: "RUN_CASE_HAS_HISTORY" });
  assert.equal(writes.filter((entry) => /UPDATE |INSERT |DELETE /.test(entry.sql)).length, 0);
});

test("adding a suite snapshots only new cases and retains existing case and step history", async (context) => {
  const writes = stubDatabase(context, (sql, values) => {
    if (/WITH RECURSIVE selected/.test(sql)) return values.map(id => ({ id, app_type_id: "app-1" }));
    if (/SELECT \* FROM executions/.test(sql)) return [run];
    if (/FROM test_suites\s+WHERE id/.test(sql)) return [{ id: values[0], name: values[0], app_type_id: "app-1" }];
    if (/FROM execution_case_snapshots/.test(sql)) return [{ test_case_id: "case-1", suite_id: "suite-1", test_case_title: "Original title" }];
    if (/FROM execution_suites/.test(sql)) return [{ suite_id: "suite-1", suite_name: "Original suite" }];
    if (/FROM suite_test_cases\s+JOIN test_cases/.test(sql)) return [{ test_case_id: values[0] === "suite-1" ? "case-1" : "case-2", test_case_title: "Current authoring title" }];
    return [];
  });
  await execution.updateExecution(run.id, { suite_ids: ["suite-1", "suite-2"], test_case_ids: [] });
  const inserts = writes.filter((entry) => /INSERT INTO execution_case_snapshots/.test(entry.sql));
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0].values[1], "case-2");
  assert.equal(writes.some((entry) => /DELETE FROM execution_(case|step)_snapshots|DELETE FROM execution_results/.test(entry.sql)), false);
});

test("adding an unrelated case preserves deleted saved selections and changed authoring membership", async (context) => {
  const stored = { ...run, direct_test_case_ids: ["deleted-direct-case"] };
  const snapshots = [
    { execution_id: run.id, test_case_id: "original-suite-case", suite_id: "saved-suite", test_case_title: "Frozen title" },
    { execution_id: run.id, test_case_id: "deleted-direct-case", suite_id: null, test_case_title: "Deleted authoring case" }
  ];
  const writes = stubDatabase(context, (sql, values) => {
    if (/SELECT \* FROM executions/.test(sql)) return [stored];
    if (/FROM execution_case_snapshots/.test(sql)) return snapshots;
    if (/FROM execution_suites/.test(sql)) return [{ suite_id: "saved-suite", suite_name: "Deleted saved suite" }];
    if (/FROM test_suites\s+WHERE id/.test(sql)) throw new Error("Retained saved suites must not require an authoring record.");
    if (/FROM test_cases\s+LEFT JOIN LATERAL/.test(sql)) {
      assert.equal(values[0], "new-case", "Existing independent pins retain their snapshot even after authoring deletion.");
      return [{ test_case_id: "new-case", test_case_title: "New case", app_type_id: "app-1" }];
    }
    if (/FROM suite_test_cases\s+JOIN test_cases/.test(sql)) return [{ test_case_id: "later-authoring-addition", test_case_title: "Added after run creation" }];
    // The original case is no longer in current authoring membership.
    return [];
  });
  await execution.updateExecution(run.id, { test_case_ids: ["deleted-direct-case", "new-case"] });
  assert.deepEqual(writes.filter((entry) => /INSERT INTO execution_case_snapshots/.test(entry.sql)).map((entry) => entry.values[1]), ["new-case"]);
  assert.equal(writes.some((entry) => /DELETE FROM execution_(case|step)_snapshots/.test(entry.sql)), false);
  assert.equal(writes.some((entry) => /UPDATE execution_case_snapshots\s+SET (test_case_title|parameter_values)/.test(entry.sql)), false);
});

test("an explicitly pinned case overlapping a suite survives suite removal and readback", async (context) => {
  const stored = { ...run, direct_test_case_ids: ["case-1"] };
  let suites = [{ execution_id: run.id, suite_id: "suite-1", suite_name: "Suite" }];
  const snapshot = { execution_id: run.id, test_case_id: "case-1", suite_id: "suite-1", test_case_title: "Pinned case" };
  const writes = stubDatabase(context, (sql, values) => {
    if (/SELECT\s+\*\s+FROM executions/.test(sql)) return [stored];
    if (/WITH run_cases/.test(sql)) return [];
    if (/FROM execution_case_snapshots/.test(sql)) return [snapshot];
    if (/FROM execution_suites/.test(sql) && !/DELETE /.test(sql)) return suites;
    if (/FROM test_cases\s+LEFT JOIN LATERAL/.test(sql)) return [{ ...snapshot, app_type_id: "app-1" }];
    if (/FROM suite_test_cases\s+JOIN test_suites/.test(sql)) return [{ suite_id: "suite-1", suite_name: "Suite" }];
    if (/DELETE FROM execution_suites/.test(sql)) suites = [];
    if (/UPDATE executions\s+SET direct_test_case_ids/.test(sql)) stored.direct_test_case_ids = values[0];
    return [];
  });
  stored.direct_test_case_ids = null;
  const legacy = await execution.getExecution(run.id, true);
  assert.deepEqual(legacy.direct_test_case_ids, [], "NULL legacy rows retain the original derived scope.");
  stored.direct_test_case_ids = ["case-1"];
  const before = await execution.getExecution(run.id, true);
  assert.deepEqual(before.direct_test_case_ids, ["case-1"]);
  assert.deepEqual(before.suite_ids, ["suite-1"]);
  await execution.updateExecution(run.id, { suite_ids: [] });
  const after = await execution.getExecution(run.id, true);
  assert.deepEqual(after.suite_ids, []);
  assert.deepEqual(after.direct_test_case_ids, ["case-1"]);
  assert.deepEqual(after.test_case_ids, ["case-1"]);
  assert.equal(writes.some((entry) => /DELETE FROM execution_(case|step)_snapshots/.test(entry.sql)), false);
});

test("failed-only reruns preserve only the explicit pins included in the rerun scope", async (context) => {
  const mobile = require("../src/services/mobileFeature.service");
  context.mock.method(mobile, "assertExecutionMobileFeatureEnabled", async () => undefined);
  context.mock.method(execution, "getExecution", async () => ({ ...run, status: "completed", direct_test_case_ids: ["case-1", "case-2"],
    case_snapshots: ["case-1", "case-2"].map((test_case_id) => ({ test_case_id, test_case_title: test_case_id, suite_id: "suite-1" })),
    suite_snapshots: [{ id: "suite-1", name: "Suite" }], step_snapshots: [] }));
  const writes = stubDatabase(context, (sql) => {
    if (/FROM execution_results/.test(sql)) return [{ test_case_id: "case-1", status: "failed" }, { test_case_id: "case-2", status: "passed" }];
    if (/FROM users|FROM project_members/.test(sql)) return [{ id: "user-1" }];
    return [];
  });
  await execution.rerunExecution(run.id, { failed_only: true, created_by: "user-1" });
  const insert = writes.find((entry) => /INSERT INTO executions\s*\(/.test(entry.sql));
  const columns = insert.sql.match(/INSERT INTO executions\s*\(([^)]+)\)/)[1].split(",").map((column) => column.trim());
  assert.equal(columns.length - 2, insert.values.length, "Trigger and status are the two literal values.");
  assert.deepEqual(JSON.parse(insert.values[columns.indexOf("direct_test_case_ids") - 2]), ["case-1"]);
});

test("run metrics deduplicate actual defects and all story links while reducing latest case iterations", () => {
  const result = (id, test_case_id, status, date, extra = {}) => ({ id, test_case_id, status, created_at: new Date(date), ...extra });
  const metrics = execution.summarizeExecutionMetrics([
    { test_case_id: "case-1" }, { test_case_id: "case-2" }, { test_case_id: "case-3" },
    { test_case_id: "case-4", test_data_set_snapshot: { rows: [{}, {}] } },
    { test_case_id: "case-5", test_data_set_snapshot: { mode: "key_value", rows: [{}, {}] } }
  ], [
    result("1", "case-1", "failed", "2026-09-01", { defects: ["bug-1"], step_defects: { step1: ["bug-1", "bug-2"] }, data_set_iteration_index: 0 }),
    result("2", "case-1", "passed", "2026-09-02", { data_set_iteration_index: 1 }),
    result("3", "case-2", "failed", "2026-09-01", { case_defects: ["bug-3"] }),
    result("4", "case-2", "passed", "2026-09-02", { defects: ["bug-1"] }),
    result("5", "case-4", "passed", "2026-09-02", { data_set_iteration_index: 0 }),
    result("6", "case-5", "passed", "2026-09-02", { data_set_iteration_index: 0 })
  ], [
    { test_case_id: "case-1", requirement_id: "story-1" }, { test_case_id: "case-1", requirement_id: "story-2" },
    { test_case_id: "case-2", requirement_id: "story-2" }, { test_case_id: "case-2", requirement_id: "story-3" },
    { test_case_id: "case-3", requirement_id: "story-3" }, { test_case_id: "case-4", requirement_id: "story-4" },
    { test_case_id: "outside-run", requirement_id: "story-5" }
  ]);
  assert.deepEqual(metrics, { total_cases: 5, passed_cases: 2, failed_cases: 1, blocked_cases: 0, running_cases: 0,
    pending_cases: 2, paused_cases: 0, aborted_cases: 0, skipped_cases: 0, duration_ms: 0, defect_count: 3, story_count: 4, failed_story_count: 2 });
});

test("changing the run assignee cascades through inherited scopes and preserves explicit overrides", async context => {
  const stored = { ...run, assigned_to: "old-owner", assigned_to_ids: ["old-owner"], suite_assignments: { suite: ["suite-owner"] }, module_assignments: { module: ["module-owner"] }, case_assignments: { explicit: ["case-owner"] } };
  const snapshots = [{ test_case_id: "direct" }, { test_case_id: "suite-case", suite_id: "suite" }, { test_case_id: "module-case", suite_id: "suite", module_id: "module" }, { test_case_id: "explicit", suite_id: "suite", module_id: "module" }];
  const writes = stubDatabase(context, (sql, values) => {
    if (/SELECT \* FROM executions/.test(sql)) return [stored];
    if (/FROM execution_case_snapshots/.test(sql)) return snapshots;
    if (/FROM users/.test(sql)) return [{ id: values[0], name: "New owner" }];
    if (/FROM project_members/.test(sql)) return [{ id: "membership" }];
    return [];
  });
  await execution.updateExecution(run.id, { assigned_to_ids: ["new-owner"] });
  const assignments = writes.filter(entry => /UPDATE execution_case_snapshots/.test(entry.sql)).map(entry => ({ caseId: entry.values[4], ids: JSON.parse(entry.values[1]), source: entry.values[2] }));
  assert.deepEqual(assignments, [
    { caseId: "direct", ids: ["new-owner"], source: "run" }, { caseId: "suite-case", ids: ["suite-owner"], source: "suite" },
    { caseId: "module-case", ids: ["module-owner"], source: "module" }, { caseId: "explicit", ids: ["case-owner"], source: "case" }
  ]);
});
