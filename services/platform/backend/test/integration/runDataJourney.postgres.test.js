const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("suite template to CSV data to frozen case-row executions preserves scope and history", { skip: process.env.RUN_DATA_POSTGRES !== "1", timeout: 120000 }, async context => {
  assert.match(new URL(process.env.DATABASE_URL).pathname, /^\/agent_verify_run_data_[a-z0-9_]+$/);
  const db = require("../../src/db");
  try {
    assert.equal((await db.prepare("SELECT to_regclass('public.projects') AS name").get()).name, null);
    await db.query(fs.readFileSync(path.resolve(__dirname, "../../instance-setup-data/schema-setup/schema.sql"), "utf8"));
    await require("../../src/db/bootstrap").ensureRuntimeSchema();
    context.mock.method(require("../../../../trace/backend/services/opsTelemetry.service"), "emitExecutionHierarchyEvents", async () => undefined);
    await db.query(`INSERT INTO roles(id,name) VALUES ('qa-role','Run verification');
      INSERT INTO users(id,email,password_hash,name,is_workspace_admin) VALUES ('actor','run-verification@example.test','not-a-login','Run verification',TRUE);
      INSERT INTO projects(id,name,created_by) VALUES ('project','Run verification','actor'),('other-project','Other project','actor');
      INSERT INTO project_members(id,project_id,user_id,role_id) VALUES ('member','project','actor','qa-role');
      INSERT INTO app_types(id,project_id,name,type) VALUES ('app','project','Web','web'),('other-app','other-project','Other','web');`);
    const data = require("../../../../testing/backend/services/testDataSet.service");
    const suites = require("../../../../testing/backend/services/testSuite.service");
    const runs = require("../../../../testing/backend/services/execution.service");
    const plans = require("../../../../testing/backend/services/runParameterPlan.service");
    const lifecycle = require("../../../../testing/backend/services/executionCaseLifecycle.service");
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
    // Edit manifests contain the stored expanded suite selection. Sending only
    // the original parent intentionally removes its saved child from the run.
    const frozenInput = { ...input, suite_ids: run.suite_ids, execution_id: created.id, test_case_ids: [], test_data_set_id: "" };
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
    const editInput = { ...frozenInput, execution_id: editRun.id, suite_ids: [...run.suite_ids, newSuite.id] };
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

    await context.test("scoped Suite and Run data compose by row, preserve shared inputs, and match the parameter plan", async () => {
      const policy = { override_lower_scopes: false, override_shared_steps: false };
      const createData = (name, rows) => data.createTestDataSet({ project_id: 'project', app_type_id: 'app', name, mode: 'table', columns: [...new Set(rows.flatMap(Object.keys))], rows });
      const caseData = await createData('Scoped case data', [
        { 't.person': 'one', 'r.shared_secret': 'private-one' }, { 't.person': 'two', 'r.shared_secret': 'private-two' }
      ]);
      const selectedSuiteData = await createData('Scoped suite data', [
        { 's.tenant': 'EU', 't.person': 'ignored', 'r.shared_secret': 'ignored' }, { 's.tenant': 'IN', 't.person': 'ignored', 'r.shared_secret': 'ignored' }
      ]);
      const selectedRunData = await createData('Scoped run data', [
        { 'r.build': 'build-one', 's.tenant': 'ignored', 't.person': 'ignored', 'r.shared_secret': 'ignored' },
        { 'r.build': 'build-two', 's.tenant': 'ignored', 't.person': 'ignored', 'r.shared_secret': 'ignored' }
      ]);
      const scopedSuite = await suites.createTestSuite({ app_type_id:'app', name:'Scoped suite', test_data_set_id:selectedSuiteData.id, test_data_options:policy, created_by:'actor' });
      assert.deepEqual((await suites.getTestSuite(scopedSuite.id)).test_data_options, policy);
      await db.prepare("INSERT INTO test_cases(id,app_type_id,suite_id,title) VALUES ('scoped-case','app',?,'Scoped input case')").run(scopedSuite.id);
      await db.prepare("INSERT INTO suite_test_cases(suite_id,test_case_id,sort_order) VALUES (?,'scoped-case',1)").run(scopedSuite.id);
      await db.prepare("INSERT INTO test_case_data_sets(test_case_id,test_data_set_id,sort_order) VALUES ('scoped-case',?,1)").run(caseData.id);
      await db.query("INSERT INTO test_steps(id,test_case_id,step_order,action,step_type,group_kind) VALUES ('scoped-local','scoped-case',1,'Use @t.person for @s.tenant and @r.build','web',NULL),('scoped-shared','scoped-case',2,'Use @r.shared_secret','web','reusable')");
      const scopeInput = {project_id:'project',app_type_id:'app',suite_ids:[scopedSuite.id],test_data_set_id:selectedRunData.id,test_data_options:policy};
      const scopePlan = await plans.buildRunParameterPlan(scopeInput);
      assert.equal(scopePlan.expected_instance_count,2);
      assert.deepEqual(scopePlan.parameters.map(item => item.name),['r.build']);
      const suitePlan = await plans.buildRunParameterPlan({...scopeInput,test_data_set_id:selectedSuiteData.id,data_scope:'suite'});
      assert.equal(suitePlan.expected_instance_count,2);
      assert.deepEqual(suitePlan.parameters.map(item => item.name),['s.tenant']);
      const createdScoped = await runs.createExecution({...scopeInput,name:'Scoped run',created_by:'actor',execution_mode:'manual'});
      let saved = await runs.getExecution(createdScoped.id,true);
      const expected = [
        {'t.person':'one','r.shared_secret':'private-one','s.tenant':'EU','r.build':'build-one'},
        {'t.person':'two','r.shared_secret':'private-two','s.tenant':'IN','r.build':'build-two'}
      ];
      assert.deepEqual(saved.test_data_options,policy);
      assert.deepEqual(saved.case_snapshots[0].test_data_set_snapshot.rows,expected);
      assert.equal(saved.case_snapshots[0].test_data_set_snapshot.rows.length,scopePlan.expected_instance_count);
      for(let index=0; index<2; index++) {
        const resolved=resolveParameterLayers({dataSet:saved.case_snapshots[0].test_data_set_snapshot,rowIndex:index});
        assert.equal(resolved['t.person'],expected[index]['t.person']);
        assert.equal(resolved['r.shared_secret'],expected[index]['r.shared_secret']);
      }
      // Changing a policy before execution recomputes the selected data and the
      // plan uses that same policy even when the dataset ID is unchanged.
      const full={override_lower_scopes:true,override_shared_steps:true};
      const editPlan=await plans.buildRunParameterPlan({...scopeInput,execution_id:createdScoped.id,test_data_options:full});
      await runs.updateExecution(createdScoped.id,{test_data_options:full});
      saved=await runs.getExecution(createdScoped.id,true);
      assert.equal(saved.case_snapshots[0].test_data_set_snapshot.rows[0]['t.person'],'ignored');
      assert.equal(saved.case_snapshots[0].test_data_set_snapshot.rows.length,editPlan.expected_instance_count);
      await runs.updateExecution(createdScoped.id,{test_data_options:policy});
      assert.deepEqual((await runs.getExecution(createdScoped.id,true)).case_snapshots[0].test_data_set_snapshot.rows,expected);
      // Mismatched sources fail before changing an existing run or creating a new one.
      const single=await createData('One run row',[{'r.build':'single'}]);
      await assert.rejects(plans.buildRunParameterPlan({...scopeInput,test_data_set_id:single.id}),error=>error.statusCode===422);
      await assert.rejects(runs.updateExecution(createdScoped.id,{test_data_set_id:single.id}),error=>error.statusCode===422);
      assert.equal((await runs.getExecution(createdScoped.id,true)).test_data_set_id,selectedRunData.id);
      await assert.rejects(runs.createExecution({...scopeInput,test_data_set_id:single.id,name:'Invalid scoped cardinality',created_by:'actor',execution_mode:'manual'}),error=>error.statusCode===422);
      assert.equal((await db.prepare("SELECT COUNT(*)::int AS count FROM executions WHERE name='Invalid scoped cardinality'").get()).count,0);
      // Source edits never replace existing snapshots, including on rerun.
      await data.updateTestDataSet(caseData.id,{rows:[{'t.person':'changed','r.shared_secret':'changed'}]});
      await data.updateTestDataSet(selectedSuiteData.id,{rows:[{'s.tenant':'changed'}]});
      await data.updateTestDataSet(selectedRunData.id,{rows:[{'r.build':'changed'}]});
      assert.deepEqual((await runs.getExecution(createdScoped.id,true)).case_snapshots[0].test_data_set_snapshot.rows,expected);
      const repeatedScoped=await runs.rerunExecution(createdScoped.id,{created_by:'actor'});
      const repeatedData=await runs.getExecution(repeatedScoped.id,true);
      assert.deepEqual(repeatedData.test_data_options,policy);
      assert.deepEqual(repeatedData.case_snapshots[0].test_data_set_snapshot.rows,expected);
      assert.equal((await plans.buildRunParameterPlan({...scopeInput,execution_id:createdScoped.id})).expected_instance_count,2);
      await lifecycle.ensureExecutionCaseResult({execution_id:createdScoped.id,test_case_id:'scoped-case',data_set_iteration_index:0},'actor');
      await assert.rejects(runs.updateExecution(createdScoped.id,{test_data_options:full}),error=>error.statusCode===409&&error.code==='RUN_CONTEXT_LOCKED');
      assert.deepEqual((await runs.getExecution(createdScoped.id,true)).case_snapshots[0].test_data_set_snapshot.rows,expected);
      // Schedule dispatch uses its persisted policy; only external engine launch is stubbed.
      const schedules=require('../../../../testing/backend/services/executionSchedule.service');
      context.mock.method(runs,'startExecution',async()=>({queued:true}));
      const schedule=await schedules.createExecutionSchedule({...scopeInput,name:'Scoped scheduled data',cadence:'once',next_run_at:'2099-09-20T10:00:00Z',created_by:'actor'});
      assert.deepEqual((await schedules.getExecutionSchedule(schedule.id)).test_data_options,policy);
      const scheduledRun=await schedules.runExecutionSchedule(schedule.id,'actor');
      const dispatched=await runs.getExecution(scheduledRun.id,true);
      assert.deepEqual(dispatched.test_data_options,policy);
      assert.deepEqual(dispatched.case_snapshots[0].test_data_set_snapshot.rows,[{'t.person':'changed','r.shared_secret':'changed','s.tenant':'changed','r.build':'changed'}]);
      await schedules.updateExecutionSchedule(schedule.id,{test_data_options:full,name:'Updated scheduled policy'},'actor');
      assert.deepEqual((await schedules.getExecutionSchedule(schedule.id)).test_data_options,full);
    });

    await context.test("Suite templates use the explicit editing context and never inherit an unrelated primary Suite", async () => {
      const createData = (name, column, count) => data.createTestDataSet({project_id:'project',app_type_id:'app',name,mode:'table',columns:[column],rows:Array.from({length:count},(_,index)=>({[column]:String(index)}))});
      const parentData=await createData('Context parent data','s.parent_data',2);
      const currentData=await createData('Context own data','s.own_data',3);
      const unrelatedData=await createData('Unrelated data','s.unrelated_data',7);
      const childData=await createData('Context child data','s.child_data',2);
      const replacementData=await createData('Replacement context data','s.replacement_data',4);
      const scopeParent=await suites.createTestSuite({app_type_id:'app',name:'Context parent',test_data_set_id:parentData.id,parameter_values:{'s.parent_parameter':'parent'},created_by:'actor'});
      const own=await suites.createTestSuite({app_type_id:'app',parent_id:scopeParent.id,name:'Context own',test_data_set_id:currentData.id,parameter_values:{'s.own_parameter':'own'},created_by:'actor'});
      const unrelated=await suites.createTestSuite({app_type_id:'app',name:'Unrelated primary',test_data_set_id:unrelatedData.id,parameter_values:{'s.unrelated_parameter':'unrelated'},created_by:'actor'});
      const child=await suites.createTestSuite({app_type_id:'app',parent_id:own.id,name:'Context child',test_data_set_id:childData.id,created_by:'actor'});
      const foreignSuite=await suites.createTestSuite({app_type_id:'other-app',name:'Foreign context',created_by:'actor'});
      for(const [id,suiteId] of [['context-direct',unrelated.id],['context-child',child.id]]) {
        await db.prepare("INSERT INTO test_cases(id,app_type_id,suite_id,title) VALUES (?,'app',?,'Context case')").run(id,suiteId);
        await db.prepare("INSERT INTO suite_test_cases(suite_id,test_case_id,sort_order) VALUES (?,?,1)").run(suiteId,id);
      }
      const base={project_id:'project',app_type_id:'app',data_scope:'suite',test_case_ids:['context-direct']};
      const draft=await plans.buildRunParameterPlan(base);
      assert.equal(draft.case_count,1); assert.equal(draft.expected_instance_count,1);
      assert.doesNotMatch(JSON.stringify(draft),/unrelated/);
      const edited=await plans.buildRunParameterPlan({...base,suite_context_id:own.id});
      assert.equal(edited.expected_instance_count,3);
      assert.ok(edited.parameters.some(item=>item.name==='s.own_parameter'));
      assert.ok(edited.parameters.some(item=>item.name==='s.parent_parameter'));
      assert.ok(edited.parameters.some(item=>item.name==='s.own_data'));
      assert.doesNotMatch(JSON.stringify(edited),/unrelated/);
      const cleared=await plans.buildRunParameterPlan({...base,suite_context_id:own.id,test_data_set_id:''});
      assert.equal(cleared.expected_instance_count,2,'Clear restores parent inheritance without reviving the cleared own dataset');
      assert.ok(cleared.parameters.some(item=>item.name==='s.parent_data'));
      assert.ok(!cleared.parameters.some(item=>item.name==='s.own_data'));
      const childPlan=await plans.buildRunParameterPlan({...base,suite_context_id:own.id,suite_ids:[child.id],test_data_set_id:replacementData.id});
      assert.equal(childPlan.case_count,2); assert.equal(childPlan.expected_instance_count,6,'The direct case takes four draft rows, the child retains its own two rows');
      assert.ok(childPlan.parameters.some(item=>item.name==='s.child_data'));
      const removed=await plans.buildRunParameterPlan({...base,suite_context_id:own.id,test_case_ids:[]});
      assert.equal(removed.case_count,0,'Suite context alone must never re-add saved membership');
      await assert.rejects(plans.buildRunParameterPlan({...base,suite_context_id:foreignSuite.id}),error=>error.statusCode===404);
      await assert.rejects(plans.buildRunParameterPlan({...base,suite_context_id:own.id,data_scope:'run'}),error=>error.statusCode===400);
      // Applying the same Suite data policy yields the previewed case cardinality.
      await suites.updateTestSuite(own.id,{test_data_set_id:replacementData.id});
      await db.prepare("INSERT INTO suite_test_cases(suite_id,test_case_id,sort_order) VALUES (?,'context-direct',1)").run(own.id);
      const actual=await runs.createExecution({project_id:'project',app_type_id:'app',suite_ids:[own.id],name:'Suite context parity',created_by:'actor',execution_mode:'manual'});
      const frozen=await runs.getExecution(actual.id,true);
      assert.equal(frozen.case_snapshots.reduce((sum,item)=>sum+(item.test_data_set_snapshot?.rows.length||1),0),childPlan.expected_instance_count);
    });

    await context.test("shared group data freezes one chosen row and respects case policy without group collisions", async () => {
      const groups = require('../../../../testing/backend/services/sharedStepGroup.service');
      const createData = (name, rows) => data.createTestDataSet({ project_id:'project', app_type_id:'app', name, mode:'table', columns:['r.login'], rows });
      const groupData = await createData('Shared accounts', [{ 'r.login':'unused-first' }, { 'r.login':'chosen-second' }, { 'r.login':'unused-third' }]);
      const caseData = await createData('Case accounts', [{ 'r.login':'case-first' }, { 'r.login':'case-second' }]);
      const group = await groups.createSharedStepGroup({ app_type_id:'app', name:'Linked accounts', test_data_set_id:groupData.id, test_data_row_index:1, created_by:'actor', steps:[{ action:'Use @login', step_type:'web' }] });
      const second = await groups.createSharedStepGroup({ app_type_id:'app', name:'Other accounts', parameter_values:{login:'other-group'}, created_by:'actor', steps:[{action:'Use @login',step_type:'web'}] });
      await db.prepare("INSERT INTO test_cases(id,app_type_id,title,test_data_options) VALUES ('shared-data-case','app','Shared datasets',?)").run({override_shared_steps:false});
      await db.prepare("INSERT INTO test_case_data_sets(test_case_id,test_data_set_id,sort_order) VALUES ('shared-data-case',?,1)").run(caseData.id);
      for (const [index, linked] of [[1, group.id], [2, second.id], [3, null]]) await db.prepare("INSERT INTO test_steps(id,test_case_id,step_order,action,step_type,group_kind,reusable_group_id) VALUES (?,'shared-data-case',?,'Use @login','web',?,?)").run(`shared-data-step-${index}`,index,linked?'reusable':null,linked);
      const input = {project_id:'project',app_type_id:'app',test_case_ids:['shared-data-case']};
      assert.equal((await plans.buildRunParameterPlan(input)).expected_instance_count,2);
      const created=await runs.createExecution({...input,name:'Protected shared defaults',created_by:'actor',execution_mode:'manual'});
      let frozen=await runs.getExecution(created.id,true);
      const resolved=(run,index,shared=true)=>resolveParameterLayers({ sharedValues:run.step_snapshots[index].shared_parameter_values, isSharedStep:shared, caseValues:run.case_snapshots[0].parameter_values, dataSet:run.case_snapshots[0].test_data_set_snapshot,rowIndex:1 });
      assert.equal(resolved(frozen,0)['r.login'],'chosen-second');
      assert.equal(resolved(frozen,1)['r.login'],'other-group');
      assert.equal(resolved(frozen,2,false)['r.login'],'case-second');
      assert.equal(frozen.case_snapshots[0].test_data_set_snapshot.rows.length,2);
      await groups.updateSharedStepGroup(group.id,{test_data_row_index:2});
      await data.updateTestDataSet(groupData.id,{rows:[{'r.login':'changed-first'},{'r.login':'changed-second'},{'r.login':'changed-third'}]});
      assert.equal(resolved(await runs.getExecution(created.id,true),0)['r.login'],'chosen-second');
      const repeated=await runs.rerunExecution(created.id,{created_by:'actor'});
      assert.equal(resolved(await runs.getExecution(repeated.id,true),0)['r.login'],'chosen-second');
      await db.prepare("UPDATE test_cases SET test_data_options='{}'::jsonb WHERE id='shared-data-case'").run();
      const overridden=await runs.createExecution({...input,name:'Case overrides shared defaults',created_by:'actor',execution_mode:'manual'});
      assert.equal(resolved(await runs.getExecution(overridden.id,true),0)['r.login'],'case-second');
      const secrets=await data.createTestDataSet({project_id:'project',app_type_id:'app',name:'Shared secrets',mode:'key_value',rows:[{key:'login',value:'PRIVATE_SHARED_SECRET',is_secret:true}]});
      await groups.updateSharedStepGroup(group.id,{test_data_set_id:secrets.id,test_data_row_index:0});
      await db.prepare("DELETE FROM test_case_data_sets WHERE test_case_id='shared-data-case'").run();
      const secretRun=await runs.createExecution({...input,name:'Secret group default',created_by:'actor',execution_mode:'manual'});
      const publicRun=await runs.getExecution(secretRun.id,true);
      assert.doesNotMatch(JSON.stringify(publicRun),/PRIVATE_SHARED_SECRET/);
      assert.deepEqual(publicRun.step_snapshots[0].shared_parameter_sensitive_names,['r.login']);
      const stored=await db.prepare('SELECT shared_parameter_values FROM execution_step_snapshots WHERE execution_id=? ORDER BY step_order').get(secretRun.id);
      assert.equal(stored.shared_parameter_values['r.login'],'PRIVATE_SHARED_SECRET');
      assert.equal((await plans.buildRunParameterPlan(input)).expected_instance_count,1);
    });

    await context.test("a failed Suite or Schedule policy write rolls back the entire save", async () => {
      await db.query(`CREATE FUNCTION reject_policy_test_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.name LIKE 'Policy rollback%' AND NEW.test_data_options->>'override_lower_scopes'='false' THEN RAISE EXCEPTION 'Injected policy write failure'; END IF;
        RETURN NEW; END $$;
        CREATE TRIGGER reject_suite_policy_test BEFORE UPDATE ON test_suites FOR EACH ROW EXECUTE FUNCTION reject_policy_test_write();
        CREATE TRIGGER reject_schedule_policy_test BEFORE UPDATE ON execution_schedules FOR EACH ROW EXECUTE FUNCTION reject_policy_test_write();`);
      const options={override_lower_scopes:false};
      await assert.rejects(suites.createTestSuite({app_type_id:'app',name:'Policy rollback suite',test_data_options:options,created_by:'actor'}),/Injected policy/);
      assert.equal((await db.prepare("SELECT COUNT(*)::int AS count FROM test_suites WHERE name='Policy rollback suite'").get()).count,0);
      const schedules=require('../../../../testing/backend/services/executionSchedule.service');
      const base={project_id:'project',app_type_id:'app',test_case_ids:['case-1'],cadence:'once',next_run_at:'2099-09-20T10:00:00Z',created_by:'actor'};
      await assert.rejects(schedules.createExecutionSchedule({...base,name:'Policy rollback schedule',test_data_options:options}),/Injected policy/);
      assert.equal((await db.prepare("SELECT COUNT(*)::int AS count FROM execution_schedules WHERE name='Policy rollback schedule'").get()).count,0);
      const schedule=await schedules.createExecutionSchedule({...base,name:'Original schedule'});
      await assert.rejects(schedules.updateExecutionSchedule(schedule.id,{name:'Policy rollback update',test_data_options:options},'actor'),/Injected policy/);
      assert.equal((await schedules.getExecutionSchedule(schedule.id)).name,'Original schedule');
      await db.query('DROP TRIGGER reject_suite_policy_test ON test_suites; DROP TRIGGER reject_schedule_policy_test ON execution_schedules; DROP FUNCTION reject_policy_test_write()');
    });
  } finally { await db.close(); }
});
