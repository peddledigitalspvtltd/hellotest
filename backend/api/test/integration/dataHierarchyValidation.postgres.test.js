const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("dataset selection validates complete suite scope and atomically rejects incompatible suite/run saves", { skip: process.env.RUN_DATA_POSTGRES !== "1", timeout: 120000 }, async context => {
  assert.match(new URL(process.env.DATABASE_URL).pathname, /^\/agent_verify_run_data_[a-z0-9_]+$/);
  const db = require("../../src/db");
  try {
    assert.equal((await db.prepare("SELECT to_regclass('public.projects') AS name").get()).name, null);
    await db.query(fs.readFileSync(path.resolve(__dirname, "../../../db/schema.sql"), "utf8"));
    await require("../../src/db/bootstrap").ensureRuntimeSchema();
    context.mock.method(require("../../src/services/opsTelemetry.service"), "emitExecutionHierarchyEvents", async () => undefined);
    await db.query(`INSERT INTO roles(id,name) VALUES ('qa-role','Verification');
      INSERT INTO users(id,email,password_hash,name,is_workspace_admin) VALUES ('actor','data-validation@example.test','not-a-login','Verification',TRUE);
      INSERT INTO projects(id,name,created_by) VALUES ('project','Verification','actor');
      INSERT INTO project_members(id,project_id,user_id,role_id) VALUES ('member','project','actor','qa-role');
      INSERT INTO app_types(id,project_id,name,type) VALUES ('app','project','Web','web');
      INSERT INTO test_cases(id,app_type_id,title,parameter_values) VALUES
        ('case','app','Customer', '{"t.email":"case@example.test","r.case_owned":"case default"}'),
        ('child-case','app','Child', '{}');
      INSERT INTO shared_step_groups(id,app_type_id,name,steps,parameter_values) VALUES
        ('group','app','Sign in','[]','{"r.group_token":"PRIVATE_DEFAULT"}');
      INSERT INTO test_steps(id,test_case_id,step_order,action,expected_result,step_type,reusable_group_id,group_kind) VALUES
        ('case-step','case',1,'Use @t.email with @s.tenant and @r.build','Read @r.case_owned','web',NULL,NULL),
        ('shared-step','case',2,'Sign in @r.group_token','Ready','web','group','reusable'),
        ('child-step','child-case',1,'Use @t.child','Ready','web',NULL,NULL);`);
    const data = require("../../src/services/testDataSet.service");
    const suites = require("../../src/services/testSuite.service");
    const runs = require("../../src/services/execution.service");
    const plans = require("../../src/services/runParameterPlan.service");
    const createData = async (name, columns) => data.createTestDataSet({ project_id: "project", app_type_id: "app", name,
      mode: "table", columns, rows: [Object.fromEntries(columns.map(key => [key, `${key} sample`]))] });
    const fullColumns = ["t.email", "s.tenant", "r.build", "r.case_owned", "r.group_token", "t.child"];
    const full = await createData("Complete data", fullColumns);
    const incomplete = await createData("Incomplete data", ["r.build"]);
    const base = { project_id: "project", app_type_id: "app", test_case_ids: ["case"], test_data_set_id: incomplete.id };
    const preview = await plans.buildRunParameterPlan(base);
    assert.equal(preview.data_set_validation.valid, false);
    assert.deepEqual(preview.data_set_validation.missing_parameters, ["r.case_owned", "r.group_token", "s.tenant", "t.email"]);
    assert.doesNotMatch(JSON.stringify(preview), /PRIVATE_DEFAULT|case@example/);
    const locked = await plans.buildRunParameterPlan({ ...base, test_data_options: {
      override_test_case_data: false, override_suite_data: false, override_shared_steps: false
    } });
    assert.deepEqual(locked.parameters.map(item => item.name), ["r.build"]);
    assert.equal(locked.data_set_validation.valid, true);
    await db.prepare("UPDATE test_steps SET action='Use @t.email with @s.tenant and @r.build plus @r.group_token' WHERE id='case-step'").run();
    const ordinaryAndShared = await plans.buildRunParameterPlan({ ...base, test_data_options: {
      override_test_case_data: false, override_suite_data: false, override_shared_steps: false
    } });
    assert.deepEqual(ordinaryAndShared.data_set_validation.missing_parameters, ["r.group_token"], "locking shared data must not hide the same input in ordinary steps");
    await db.prepare("UPDATE test_steps SET action='Use @t.email with @s.tenant and @r.build' WHERE id='case-step'").run();

    await assert.rejects(suites.createTestSuite({ app_type_id: "app", name: "Rejected suite", test_case_ids: ["case"], test_data_set_id: incomplete.id }),
      { statusCode: 422, code: "TEST_DATA_MISSING_PARAMETERS" });
    assert.equal((await db.prepare("SELECT count(*)::int AS total FROM test_suites WHERE name='Rejected suite'").get()).total, 0);
    const parent = await suites.createTestSuite({ app_type_id: "app", name: "Parent", test_case_ids: ["case"], test_data_set_id: full.id,
      parameter_values: { "s.tenant": "suite" }, created_by: "actor" });
    const child = await suites.createTestSuite({ app_type_id: "app", name: "Child", parent_id: parent.id, test_case_ids: ["child-case"], created_by: "actor" });
    assert.equal((await db.prepare("SELECT count(*)::int AS total FROM suite_test_cases WHERE suite_id=?").get(parent.id)).total, 1);
    const scope = await plans.buildRunParameterPlan({ project_id: "project", app_type_id: "app", suite_ids: [parent.id], test_data_set_id: incomplete.id });
    assert.equal(scope.case_count, 2);
    assert.ok(scope.suite_ids.includes(child.id));
    assert.ok(scope.data_set_validation.missing_parameters.includes("t.child"));
    const before = await suites.getTestSuite(parent.id);
    await assert.rejects(suites.updateTestSuite(parent.id, { name: "Must not persist", test_data_set_id: incomplete.id, test_case_ids: ["child-case"] }),
      { statusCode: 422, code: "TEST_DATA_MISSING_PARAMETERS" });
    assert.equal((await suites.getTestSuite(parent.id)).name, "Parent");
    assert.equal((await suites.getTestSuite(parent.id)).revision, before.revision);
    assert.deepEqual((await db.prepare("SELECT test_case_id FROM suite_test_cases WHERE suite_id=?").all(parent.id)).map(row => row.test_case_id), ["case"]);
    await suites.updateTestSuite(parent.id, { test_data_set_id: full.id, test_case_ids: ["case", "child-case"] });
    assert.equal((await db.prepare("SELECT count(*)::int AS total FROM suite_test_cases WHERE suite_id=?").get(parent.id)).total, 2);

    const runInput = { project_id: "project", app_type_id: "app", suite_ids: [parent.id], created_by: "actor", execution_mode: "manual",
      name: "Rejected run", test_data_set_id: incomplete.id, start_date: "2026-09-20", end_date: "2026-09-22" };
    await assert.rejects(runs.createExecution(runInput), { statusCode: 422, code: "TEST_DATA_MISSING_PARAMETERS" });
    assert.equal((await db.prepare("SELECT count(*)::int AS total FROM executions WHERE name='Rejected run'").get()).total, 0);
    const created = await runs.createExecution({ ...runInput, name: "Validated run", test_data_set_id: full.id });
    const saved = await runs.getExecution(created.id, true);
    assert.equal(saved.case_snapshots.length, 2);
    await assert.rejects(runs.updateExecution(created.id, { name: "Must not persist", test_data_set_id: incomplete.id }),
      { statusCode: 422, code: "TEST_DATA_MISSING_PARAMETERS" });
    assert.equal((await runs.getExecution(created.id)).name, "Validated run");
    // Retained snapshots supply validation after authoring changes or deletion.
    await db.prepare("UPDATE test_steps SET action='Use @r.new_authoring_parameter' WHERE id='case-step'").run();
    const frozen = await plans.buildRunParameterPlan({ project_id: "project", app_type_id: "app", execution_id: created.id });
    assert.equal(frozen.data_set_validation.valid, true);
    assert.ok(!frozen.parameters.some(item => item.name === "r.new_authoring_parameter"));
  } finally { await db.close(); }
});
