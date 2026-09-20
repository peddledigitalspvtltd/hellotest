const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("shared data links and case override policies persist with scope, history and row integrity", {
  skip: process.env.SHARED_STEP_DATA_POSTGRES !== "1", timeout: 120000
}, async context => {
  assert.match(new URL(process.env.DATABASE_URL).pathname, /^\/agent_verify_shared_data_[a-z0-9_]+$/);
  const db = require("../../src/db");
  try {
    assert.equal((await db.prepare("SELECT to_regclass('public.projects') AS name").get()).name, null);
    await db.query(fs.readFileSync(path.resolve(__dirname, "../../../db/schema.sql"), "utf8"));
    await require("../../src/db/bootstrap").ensureRuntimeSchema();
    await db.query(`INSERT INTO roles(id,name) VALUES ('role','Shared data verification');
      INSERT INTO users(id,email,password_hash,name,is_workspace_admin) VALUES ('actor','shared-data@example.test','not-a-login','Shared data verification',TRUE);
      INSERT INTO projects(id,name,created_by) VALUES ('project','Shared data','actor'),('other-project','Other','actor');
      INSERT INTO project_members(id,project_id,user_id,role_id) VALUES ('member','project','actor','role');
      INSERT INTO app_types(id,project_id,name,type) VALUES ('app','project','Web','web'),('other-app','other-project','Other','web'),('sibling-app','project','Sibling','web');`);
    const data = require("../../src/services/testDataSet.service");
    const groups = require("../../src/services/sharedStepGroup.service");
    const cases = require("../../src/services/testCase.service");
    const versions = require("../../src/services/testCaseVersion.service");
    const dataset = await data.createTestDataSet({ project_id: "project", app_type_id: "app", name: "Group data", mode: "table", columns: ["r.user"], rows: [{ "r.user": "first" }, { "r.user": "selected" }] });
    const createGroup = payload => groups.createSharedStepGroup({ app_type_id: "app", name: "Login", steps: [{ action: "Log in @user" }], created_by: "actor", ...payload });
    await assert.rejects(createGroup({ test_data_set_id: dataset.id, test_data_row_index: 1 }), { code: "SHARED_GROUP_SINGLE_ROW_REQUIRED" });
    // Preserve historical multirow selections without permitting new ones.
    const group = await createGroup({});
    await db.prepare("UPDATE shared_step_groups SET test_data_set_id=?, test_data_row_index=1 WHERE id=?").run(dataset.id, group.id);
    const single = await data.createTestDataSet({ project_id: "project", app_type_id: "app", name: "Single group row", mode: "table", columns: ["r.user"], rows: [{ "r.user": "fixed" }] });
    await createGroup({ test_data_set_id: single.id });
    await assert.rejects(data.updateTestDataSet(single.id, { rows: [{ "r.user": "a" }, { "r.user": "b" }] }), { code: "SHARED_GROUP_SINGLE_ROW_REQUIRED" });
    const hydrated = await groups.getSharedStepGroup(group.id);
    assert.equal(hydrated.test_data_row_index, 1);
    assert.equal(hydrated.test_data_set.rows[1]["r.user"], "selected");
    assert.equal((await groups.listSharedStepGroups({ app_type_id: "app" })).find(item => item.id === group.id).test_data_set_id, dataset.id);
    assert.ok((await groups.listSharedStepGroups({ app_type_id: "app" })).every(item => !Object.hasOwn(item, "test_data_set")), "Catalog lists must not repeat full dataset rows for every linked group");

    await context.test("a valid row is required and unrelated edits preserve its link", async () => {
      for (const index of [-1, 0.5, 2, null, "1"]) await assert.rejects(createGroup({ test_data_set_id: dataset.id, test_data_row_index: index }), { statusCode: 400 });
      await groups.updateSharedStepGroup(group.id, { description: "Preserve selection" });
      assert.equal((await groups.getSharedStepGroup(group.id)).test_data_row_index, 1);
      await assert.rejects(groups.updateSharedStepGroup(group.id, { app_type_id: "sibling-app" }), { statusCode: 400 });
      await assert.rejects(data.updateTestDataSet(dataset.id, { rows: [{ "r.user": "too short" }] }), { statusCode: 409, code: "SHARED_GROUP_DATA_ROW_CONFLICT" });
      assert.equal((await data.getTestDataSet(dataset.id)).rows.length, 2);
      await assert.rejects(data.updateTestDataSet(dataset.id, { app_type_id: "sibling-app" }), { statusCode: 409, code: "DATA_SET_SCOPE_CONFLICT" });
      await data.updateTestDataSet(dataset.id, { app_type_id: null });
      assert.equal((await groups.getSharedStepGroup(group.id)).test_data_set.app_type_id, null);
    });

    await context.test("foreign links are rejected and historical invalid links never reveal data", async () => {
      const foreign = await data.createTestDataSet({ project_id: "other-project", app_type_id: "other-app", name: "Foreign private", mode: "table", columns: ["r.user"], rows: [{ "r.user": "foreign private" }] });
      await assert.rejects(createGroup({ test_data_set_id: foreign.id }), { statusCode: 400 });
      const legacy = await createGroup({});
      await db.prepare("UPDATE shared_step_groups SET test_data_set_id=? WHERE id=?").run(foreign.id, legacy.id);
      const result = await groups.getSharedStepGroup(legacy.id);
      assert.equal(result.test_data_set, null);
      assert.equal(result.test_data_set_id, null);
      assert.doesNotMatch(JSON.stringify(result), /Foreign private|foreign private/);
    });

    await context.test("key-value data is one row and secret values remain redacted", async () => {
      const secret = await data.createTestDataSet({ project_id: "project", app_type_id: null, name: "Credentials", mode: "key_value", rows: [{ key: "username", value: "tester" }, { key: "password", value: "do-not-render", is_secret: true }] });
      const secretGroup = await createGroup({ test_data_set_id: secret.id });
      await assert.rejects(createGroup({ test_data_set_id: secret.id, test_data_row_index: 1 }), { statusCode: 400 });
      const result = await groups.getSharedStepGroup(secretGroup.id);
      assert.equal(result.test_data_row_index, 0);
      assert.equal(result.test_data_set.rows[1].value, "");
      assert.equal(result.test_data_set.rows[1].has_stored_value, true);
      assert.doesNotMatch(JSON.stringify(result), /do-not-render/);
      await data.deleteTestDataSet(secret.id);
      assert.equal((await groups.getSharedStepGroup(secretGroup.id)).test_data_set_id, null);
    });

    await context.test("case override flags survive edits, retained versions and schema reapplication", async () => {
      const created = await cases.createTestCase({ app_type_id: "app", title: "Login case", created_by: "actor", test_data_set_ids: [dataset.id], test_data_options: { override_shared_steps: false }, steps: [{ action: "Use @user" }] });
      assert.equal((await cases.getTestCase(created.id)).test_data_options.override_shared_steps, false);
      await cases.updateTestCase(created.id, { description: "Unrelated edit", updated_by: "actor" });
      assert.equal((await cases.getTestCase(created.id)).test_data_options.override_shared_steps, false);
      await cases.updateTestCase(created.id, { test_data_options: { override_shared_steps: true }, updated_by: "actor" });
      assert.equal((await versions.get(created.id, 2)).content.test_data_options.override_shared_steps, false);
      assert.equal((await cases.getTestCase(created.id)).test_data_options.override_shared_steps, true);
      await assert.rejects(cases.updateTestCase(created.id, { test_data_options: { override_shared_steps: "false" } }), { statusCode: 400 });
      const legacy = await cases.createTestCase({ app_type_id: "app", title: "Legacy defaults", created_by: "actor" });
      assert.equal((await cases.getTestCase(legacy.id)).test_data_options.override_shared_steps, false);
      for (const statement of require("../../src/db/sharedStepDataSchema")) await db.query(statement);
      assert.equal((await groups.getSharedStepGroup(group.id)).test_data_row_index, 1);
      await data.deleteTestDataSet(dataset.id);
      assert.equal((await groups.getSharedStepGroup(group.id)).test_data_set_id, null);
      assert.deepEqual((await cases.getTestCase(created.id)).test_data_set_ids, []);
    });

    await context.test("shared rows and independent overrides survive frozen executions and reruns", async subtest => {
      subtest.mock.method(require("../../src/services/opsTelemetry.service"), "emitExecutionHierarchyEvents", async () => undefined);
      const runs = require("../../src/services/execution.service");
      const suites = require("../../src/services/testSuite.service");
      const { resolveParameterLayers } = require("../../src/utils/stepParameterResolution");
      const createData = (name, value) => data.createTestDataSet({project_id:"project",app_type_id:"app",name,mode:"table",columns:["r.user"],rows:[{"r.user":value}]});
      const groupData=await createData("Runtime group", "group");
      const caseData=await createData("Runtime case", "case");
      const suiteData=await createData("Runtime suite", "suite");
      const runData=await createData("Runtime run", "run");
      const shared=await createGroup({name:"Runtime group",test_data_set_id:groupData.id});
      const reusable=await groups.getSharedStepGroup(shared.id);
      const created=await cases.createTestCase({app_type_id:"app",title:"Runtime inheritance",created_by:"actor",test_data_set_ids:[caseData.id],parameter_values:{user:"case default"},test_data_options:{override_shared_steps:false},steps:[{action:"Log in @user",group_kind:"reusable",group_id:shared.id,reusable_group_id:shared.id,group_name:reusable.name}]});
      const suite=await suites.createTestSuite({app_type_id:"app",name:"Runtime suite",created_by:"actor",test_data_set_id:suiteData.id,test_data_options:{override_test_case_data:false,override_shared_steps:false},test_case_ids:[created.id]});
      const input={project_id:"project",app_type_id:"app",created_by:"actor",execution_mode:"manual",suite_ids:[suite.id]};
      const value = run => {const item=run.case_snapshots[0], step=run.step_snapshots[0];return resolveParameterLayers({dataPolicy:item.test_data_options.runtime_policy,caseValues:item.parameter_values,suiteValues:item.suite_parameter_values,dataSet:item.test_data_set_snapshot,sharedValues:step.shared_parameter_values,isSharedStep:true})["r.user"];};
      const protectedRun=await runs.createExecution({...input,name:"Protected data",test_data_set_id:runData.id,test_data_options:{override_test_case_data:false,override_suite_data:false,override_shared_steps:false}});
      let frozen=await runs.getExecution(protectedRun.id,true);
      assert.equal(frozen.case_snapshots.length,1);
      assert.equal(frozen.case_snapshots[0].test_data_set_snapshot.rows.length,1);
      assert.equal(value(frozen),"group");
      const overrideRun=await runs.createExecution({...input,name:"Explicit shared override",test_data_set_id:runData.id,test_data_options:{override_test_case_data:false,override_suite_data:true,override_shared_steps:true}});
      assert.equal(value(await runs.getExecution(overrideRun.id,true)),"run");
      await data.updateTestDataSet(groupData.id,{rows:[{"r.user":"changed group"}]});
      await data.updateTestDataSet(runData.id,{rows:[{"r.user":"changed run"}]});
      assert.equal(value(await runs.getExecution(protectedRun.id,true)),"group");
      const repeated=await runs.rerunExecution(overrideRun.id,{created_by:"actor"});
      frozen=await runs.getExecution(repeated.id,true);
      assert.equal(value(frozen),"run");
      assert.equal(frozen.case_snapshots[0].test_data_set_snapshot.data_scope_policy.version,2);
      assert.equal(frozen.case_snapshots[0].test_data_set_snapshot.parameter_data_layers.case.rows[0]["r.user"],"case");
    });

    await context.test("bulk import retains group dataset selection and case override policy with row traces", async subtest => {
      const artifacts = [];
      subtest.mock.method(require("../../src/services/workspaceTransaction.service"), "createTransactionArtifact", async (_id, artifact) => {
        artifacts.push(artifact); return { id: "verification-artifact" };
      });
      const linkedData = await data.createTestDataSet({ project_id: "project", app_type_id: "app", name: "Import data", mode: "table", columns: ["r.user"], rows: [{ "r.user": "first" }] });
      const imported = await cases.bulkImportTestCases({ app_type_id: "app", created_by: "actor", rows: [{
        title: "Imported shared data", test_data_set_ids: [linkedData.id], test_data_options: { override_shared_steps: false },
        shared_groups: [{ name: "Imported login", test_data_set_id: linkedData.id, test_data_row_index: 0, steps: [{ action: "Log in @user" }] }],
        steps: [{ action: "Log in @user", group_kind: "reusable", group_name: "Imported login" }]
      }] });
      assert.equal(imported.imported, 1, JSON.stringify(imported.errors));
      assert.equal(imported.failed, 0);
      assert.equal((await cases.getTestCase(imported.created[0].id)).test_data_options.override_shared_steps, false);
      const importedGroup = (await groups.listSharedStepGroups({ app_type_id: "app" })).find(item => item.name === "Imported login");
      assert.equal(importedGroup.test_data_set_id, linkedData.id);
      assert.equal(importedGroup.test_data_row_index, 0);
      assert.equal(imported.created[0].row, 1);
      assert.equal(imported.artifact_id, "verification-artifact");
      const batch = require("../../src/services/batchProcess.service");
      subtest.mock.method(batch, "triggerProcessing", () => {});
      const queued = await batch.queueTestCaseExport({ app_type_id: "app", created_by: "actor", test_case_ids: [imported.created[0].id], include_test_data: true, include_shared_groups: true });
      await batch.processQueuedJobs();
      assert.equal((await db.prepare("SELECT status FROM batch_process_jobs WHERE id=?").get(queued.job_id)).status, "completed");
      const csv = artifacts.find(artifact => artifact.mime_type.startsWith("text/csv")).content.replaceAll('""', '"');
      assert.match(csv, /test_data_options,test_data_references,steps,shared_groups/);
      assert.match(csv, /"override_shared_steps":false/);
      assert.match(csv, /"test_data_row_index":0/);
      assert.ok(csv.includes(linkedData.id));
      assert.doesNotMatch(csv, /"r.user":"first"|"r.user":"second"/);
      artifacts.length = 0;
      await batch.queueTestCaseExport({ app_type_id: "app", created_by: "actor", test_case_ids: [imported.created[0].id] });
      await batch.processQueuedJobs();
      assert.ok(!artifacts.find(artifact => artifact.mime_type.startsWith("text/csv")).content.includes(linkedData.id));
    });
  } finally { await require("../../src/obsDb").close(); await db.close(); }
});
