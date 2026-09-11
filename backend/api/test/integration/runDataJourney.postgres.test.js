const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("suite template to CSV data to frozen case-row executions preserves scope and history", { skip: process.env.RUN_DATA_POSTGRES !== "1", timeout: 120000 }, async context => {
  assert.match(new URL(process.env.DATABASE_URL).pathname, /^\/agent_verify_run_data_[a-z0-9_]+$/);
  const db = require("../../src/db");
  try {
    assert.equal((await db.prepare("SELECT to_regclass('public.projects') AS name").get()).name, null);
    await db.query(fs.readFileSync(path.resolve(__dirname, "../../../db/schema.sql"), "utf8"));
    await require("../../src/db/bootstrap").ensureRuntimeSchema();
    context.mock.method(require("../../src/services/opsTelemetry.service"), "emitExecutionHierarchyEvents", async () => undefined);
    await db.query(`INSERT INTO roles(id,name) VALUES ('qa-role','Run verification');
      INSERT INTO users(id,email,password_hash,name,is_workspace_admin) VALUES ('actor','run-verification@example.test','not-a-login','Run verification',TRUE);
      INSERT INTO projects(id,name,created_by) VALUES ('project','Run verification','actor'),('other-project','Other project','actor');
      INSERT INTO project_members(id,project_id,user_id,role_id) VALUES ('member','project','actor','qa-role');
      INSERT INTO app_types(id,project_id,name,type) VALUES ('app','project','Web','web'),('other-app','other-project','Other','web');`);
    const data = require("../../src/services/testDataSet.service");
    const suites = require("../../src/services/testSuite.service");
    const runs = require("../../src/services/execution.service");
    const plans = require("../../src/services/runParameterPlan.service");
    const lifecycle = require("../../src/services/executionCaseLifecycle.service");
    const { resolveParameterLayers } = require("../../src/utils/stepParameterResolution");
    const suiteData = await data.createTestDataSet({ project_id: "project", app_type_id: "app", name: "Suite customers", mode: "table", columns: ["r.email", "s.tenant", "t.expected"], rows: [
      { "r.email": "one@example.test", "s.tenant": "row-tenant", "t.expected": "" }, { "r.email": "two@example.test", "s.tenant": "second", "t.expected": "approved" }
    ] });
    const parent = await suites.createTestSuite({ app_type_id: "app", name: "Parent", description: "Saved suite description", test_data_set_id: suiteData.id, parameter_values: { "s.tenant": "parent", "t.expected": "default" }, created_by: "actor" });
    const child = await suites.createTestSuite({ app_type_id: "app", name: "Child", parent_id: parent.id, parameter_values: { "s.child": "child" }, created_by: "actor" });
    assert.equal((await suites.getTestSuite(parent.id)).description, "Saved suite description");
    const foreign = await data.createTestDataSet({ project_id: "other-project", app_type_id: "other-app", name: "Other data", mode: "table", columns: ["x"], rows: [{ x: "other" }] });
    await assert.rejects(suites.updateTestSuite(child.id, { test_data_set_id: foreign.id }), error => error.statusCode === 400);
    for (const [index, suiteId] of [[1, parent.id], [2, child.id]]) {
      await db.prepare("INSERT INTO test_cases(id,app_type_id,suite_id,title,parameter_values,authoring_mode) VALUES (?, 'app', ?, ?, ?, 'gherkin')")
        .run(`case-${index}`, suiteId, `Customer ${index} @email`, { "t.expected": "case default" });
      await db.prepare("INSERT INTO suite_test_cases(suite_id,test_case_id,sort_order) VALUES (?, ?, 1)").run(suiteId, `case-${index}`);
      await db.prepare("INSERT INTO test_steps(id,test_case_id,step_order,action,expected_result,step_type) VALUES (?, ?, 1, ?, ?, 'web')")
        .run(`step-${index}`, `case-${index}`, "Given @email for @s.tenant", "Then @t.expected is visible");
    }
    const input = { project_id: "project", app_type_id: "app", suite_ids: [parent.id] };
    const plan = await plans.buildRunParameterPlan(input);
    assert.equal(plan.case_count, 2); assert.equal(plan.suite_count, 2); assert.equal(plan.expected_instance_count, 4);
    assert.deepEqual(plan.parameters.map(item => item.name), ["r.email", "s.child", "s.tenant", "t.expected"]);
    assert.doesNotMatch(JSON.stringify(plan), /one@example|row-tenant|case default|Saved suite description/);
    await db.prepare("UPDATE test_steps SET action = 'Given @email for @s.tenant and @frozen_step_only' WHERE id = 'step-2'").run();
    await db.prepare("UPDATE test_cases SET title = 'Frozen title @frozen_title_only', parameter_values = ? WHERE id = 'case-2'")
      .run({ "t.expected": "case default", "t.frozen_saved": "PRIVATE_FROZEN_VALUE" });
    await suites.updateTestSuite(parent.id, { parameter_values: { "s.tenant": "parent", "t.expected": "default", "s.frozen_suite": "PRIVATE_SUITE_VALUE" } });
    const created = await runs.createExecution({ ...input, name: "Inherited data run", created_by: "actor", execution_mode: "manual", start_date: "2026-09-10", end_date: "2026-09-12" });
    let run = await runs.getExecution(created.id, true);
    assert.equal(run.parameter_scope_default, "r");
    assert.equal(run.case_snapshots.length, 2);
    assert.ok(run.case_snapshots.every(row => row.data_set_source === "suite" && row.test_data_set_snapshot.rows.length === 2));
    assert.ok(run.case_snapshots.every(row => row.assigned_to_ids.includes("actor")));
    for (const row of run.case_snapshots) {
      const values = resolveParameterLayers({ caseValues: row.parameter_values, suiteValues: row.suite_parameter_values, dataSet: row.test_data_set_snapshot });
      assert.equal(values["r.email"], "one@example.test"); assert.equal(values["s.tenant"], "row-tenant"); assert.equal(values["t.expected"], "");
    }
    // Authoring changes cannot replace frozen data or steps after run creation.
    await data.updateTestDataSet(suiteData.id, { rows: [{ "r.email": "changed", "s.tenant": "changed", "t.expected": "changed" }] });
    await db.prepare("UPDATE test_steps SET action='Changed after freezing' WHERE id='step-2'").run();
    run = await runs.getExecution(created.id, true);
    assert.equal(run.case_snapshots[0].test_data_set_snapshot.rows.length, 2);
    assert.ok(run.step_snapshots.every(step => step.action.startsWith("Given")));
    // Edit manifests mirror updateExecution: retained scope stays frozen even
    // after authored steps, titles, suite parameters, membership and data change.
    await db.prepare("UPDATE test_steps SET action = 'Given @live_step_only' WHERE id = 'step-2'").run();
    await db.prepare("UPDATE test_cases SET title = 'Live title @live_title_only', parameter_values = ? WHERE id = 'case-2'")
      .run({ "t.live_saved": "PRIVATE_LIVE_VALUE" });
    await suites.updateTestSuite(parent.id, { parameter_values: { "s.live_suite": "PRIVATE_LIVE_SUITE" } });
    await db.prepare("INSERT INTO test_cases(id,app_type_id,suite_id,title) VALUES ('live-member', 'app', ?, 'New membership @new_member_only')").run(parent.id);
    await db.prepare("INSERT INTO suite_test_cases(suite_id,test_case_id,sort_order) VALUES (?, 'live-member', 2)").run(parent.id);
    const frozenInput = { ...input, execution_id: created.id, test_case_ids: [], test_data_set_id: "" };
    const frozenPlan = await plans.buildRunParameterPlan(frozenInput);
    assert.equal(frozenPlan.case_count, 2); assert.equal(frozenPlan.expected_instance_count, 4);
    for (const name of ["r.frozen_step_only", "r.frozen_title_only", "t.frozen_saved", "s.frozen_suite"]) assert.ok(frozenPlan.parameters.some(item => item.name === name), name);
    assert.doesNotMatch(JSON.stringify(frozenPlan), /live_step_only|live_title_only|live_saved|live_suite|new_member_only|PRIVATE_|one@example/);
    await assert.rejects(plans.buildRunParameterPlan({ ...frozenInput, project_id: 'other-project', app_type_id: 'other-app' }), error => error.statusCode === 404);
    const newSuite = await suites.createTestSuite({ app_type_id: "app", name: "Added scope", parameter_values: { "s.added": "PRIVATE_ADDED" }, created_by: "actor" });
    await db.prepare("INSERT INTO test_cases(id,app_type_id,suite_id,title) VALUES ('new-scope', 'app', ?, 'Current scope @new_scope_title')").run(newSuite.id);
    await db.prepare("INSERT INTO suite_test_cases(suite_id,test_case_id,sort_order) VALUES (?, 'new-scope', 1)").run(newSuite.id);
    await db.prepare("INSERT INTO test_steps(id,test_case_id,step_order,action,step_type) VALUES ('new-step', 'new-scope', 1, 'Use @new_scope_input', 'web')").run();
    const editRun = await runs.rerunExecution(created.id, { created_by: "actor" });
    const editInput = { ...frozenInput, execution_id: editRun.id, suite_ids: [parent.id, newSuite.id] };
    const editPlan = await plans.buildRunParameterPlan(editInput);
    assert.equal(editPlan.case_count, 3); assert.equal(editPlan.expected_instance_count, 5);
    for (const name of ['r.frozen_step_only', 's.frozen_suite', 'r.new_scope_input', 'r.new_scope_title', 's.added']) assert.ok(editPlan.parameters.some(item => item.name === name), name);
    assert.doesNotMatch(JSON.stringify(editPlan), /live_step_only|live_title_only|new_member_only|PRIVATE_/);
    await runs.updateExecution(editRun.id, { suite_ids: editInput.suite_ids, test_case_ids: [] });
    let edited = await runs.getExecution(editRun.id, true);
    assert.equal(edited.case_snapshots.length, editPlan.case_count);
    assert.equal(edited.case_snapshots.reduce((sum, item) => sum + (item.test_data_set_snapshot?.rows.length || 1), 0), editPlan.expected_instance_count);
    assert.equal(edited.step_snapshots.find(item => item.test_case_id === 'case-2').action, 'Given @email for @s.tenant and @frozen_step_only');
    const editData = await data.createTestDataSet({ project_id: 'project', app_type_id: 'app', name: 'Edit override', mode: 'table', columns: ['r.override_input'], rows: [{ 'r.override_input': 'PRIVATE_ROW_1' }, { 'r.override_input': 'PRIVATE_ROW_2' }, { 'r.override_input': 'PRIVATE_ROW_3' }] });
    const overridePlan = await plans.buildRunParameterPlan({ ...editInput, test_data_set_id: editData.id });
    assert.equal(overridePlan.expected_instance_count, 9);
    await runs.updateExecution(editRun.id, { test_data_set_id: editData.id });
    await data.updateTestDataSet(editData.id, { rows: [{ 'r.override_input': 'Changed current source' }] });
    assert.equal((await plans.buildRunParameterPlan({ ...editInput, test_data_set_id: editData.id })).expected_instance_count, 9, 'unchanged resource IDs retain frozen row counts');
    assert.equal((await plans.buildRunParameterPlan({ execution_id: editRun.id, project_id: 'project', app_type_id: 'app' })).expected_instance_count, 9, 'omitted resources preserve the frozen selection');
    const clearPlan = await plans.buildRunParameterPlan({ ...editInput, test_data_set_id: '' });
    assert.equal(clearPlan.expected_instance_count, 3, 'explicit clear restores current suite/case data, as edit does');
    await runs.updateExecution(editRun.id, { test_data_set_id: '' });
    edited = await runs.getExecution(editRun.id, true);
    assert.equal(edited.case_snapshots.reduce((sum, item) => sum + (item.test_data_set_snapshot?.rows.length || 1), 0), clearPlan.expected_instance_count);
    // Historical corrupt cross-scope links must not become a manifest count or
    // a new run's frozen data, even though the old FK allows the association.
    await db.prepare("INSERT INTO test_cases(id,app_type_id,title) VALUES ('corrupt-link', 'app', 'Unlinked data case')").run();
    await db.prepare("INSERT INTO test_case_data_sets(test_case_id,test_data_set_id,sort_order) VALUES ('corrupt-link', ?, 1)").run(foreign.id);
    const corruptPlan = await plans.buildRunParameterPlan({ project_id: 'project', app_type_id: 'app', test_case_ids: ['corrupt-link'] });
    assert.equal(corruptPlan.expected_instance_count, 1); assert.equal(corruptPlan.parameters.length, 0);
    const corruptRun = await runs.createExecution({ project_id: 'project', app_type_id: 'app', test_case_ids: ['corrupt-link'], name: 'Historical link isolation', created_by: 'actor', execution_mode: 'manual' });
    assert.equal((await runs.getExecution(corruptRun.id, true)).case_snapshots[0].test_data_set_snapshot, null);
    const resultIds = [];
    for (const row of run.case_snapshots) for (let index = 0; index < 2; index++) {
      resultIds.push((await lifecycle.ensureExecutionCaseResult({ execution_id: created.id, test_case_id: row.test_case_id, data_set_iteration_index: index }, "actor")).id);
    }
    assert.equal(new Set(resultIds).size, 4);
    assert.equal((await lifecycle.ensureExecutionCaseResult({ execution_id: created.id, test_case_id: "case-1", data_set_iteration_index: 0 }, "actor")).id, resultIds[0]);
    await assert.rejects(lifecycle.ensureExecutionCaseResult({ execution_id: created.id, test_case_id: "case-1", data_set_iteration_index: 2 }, "actor"), /outside the frozen/);
    await runs.startExecution(created.id, { initiated_by: "actor", skip_testengine_dispatch: true });
    const instance = { execution_id: created.id, test_case_id: "case-1", data_set_iteration_index: 0 };
    let outcome = await lifecycle.transitionExecutionCase({ ...instance, action: "start" }, "actor");
    await db.prepare("UPDATE execution_results SET timer_started_at=clock_timestamp()-interval '2 seconds' WHERE id=?").run(outcome.id);
    outcome = await lifecycle.transitionExecutionCase({ ...instance, action: "pause", expected_revision: outcome.revision }, "actor");
    assert.equal(outcome.status, "paused"); assert.ok(outcome.duration_ms >= 1900);
    assert.equal((await lifecycle.ensureExecutionCaseResult({ ...instance, data_set_iteration_index: 1 }, "actor")).status, "pending", "The second data row has an independent clock and status");
    outcome = await lifecycle.transitionExecutionCase({ ...instance, action: "resume", expected_revision: outcome.revision }, "actor");
    outcome = await lifecycle.transitionExecutionCase({ ...instance, action: "fail", expected_revision: outcome.revision }, "actor");
    assert.equal(outcome.status, "failed"); assert.equal(outcome.timer_started_at, null);
    assert.ok((await runs.getExecution(created.id, true)).duration_ms >= 1900, "Run duration accumulates case activity");
    const override = await data.createTestDataSet({ project_id: "project", app_type_id: "app", name: "Run override", mode: "table", columns: ["email", "t.expected"], rows: [{ email: "run@example.test", "t.expected": "run expected" }] });
    const overridden = await runs.createExecution({ ...input, name: "Run override", test_data_set_id: override.id, created_by: "actor", execution_mode: "manual" });
    const second = await runs.getExecution(overridden.id, true);
    assert.ok(second.case_snapshots.every(row => row.data_set_source === "run" && row.test_data_set_snapshot.rows.length === 1));
    assert.equal((await plans.buildRunParameterPlan({ ...input, test_data_set_id: override.id })).expected_instance_count, 3);
    const rerun = await runs.rerunExecution(created.id, { created_by: "actor" });
    const repeated = await runs.getExecution(rerun.id, true);
    assert.ok(repeated.case_snapshots.every(row => row.data_set_source === "suite" && row.test_data_set_snapshot.rows.length === 2));
    assert.equal(repeated.parameter_scope_default, "r");
    await db.prepare("UPDATE executions SET parameter_scope_default='t' WHERE id=?").run(overridden.id);
    const legacy = await runs.getExecution(overridden.id, true);
    assert.equal(legacy.step_snapshots.find(step => step.test_case_id === "case-1").action, "Given @t.email for @s.tenant");
    assert.deepEqual(legacy.case_snapshots[0].test_data_set_snapshot.columns, ["t.email", "t.expected"]);
    await db.prepare("UPDATE executions SET status='completed',ended_at=CURRENT_TIMESTAMP WHERE id=?").run(created.id);
    await assert.rejects(runs.updateExecution(created.id, { name: "Invalid finished edit" }), /finished/i);
  } finally { await db.close(); }
});
