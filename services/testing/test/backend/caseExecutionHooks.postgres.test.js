const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {randomUUID} = require('node:crypto');

test('saved Before / After sources survive direct and suite snapshots, freeze linked automation and regenerate only frozen rerun data', {
  skip:process.env.CASE_HOOKS_POSTGRES !== '1',timeout:120000
},async t=>{
  assert.match(new URL(process.env.DATABASE_URL).pathname,/^\/agent_verify_case_hooks_[a-z0-9_]+$/);
  assert.equal(process.env.DATABASE_URL,process.env.OBS_DATABASE_URL);
  const db=require('@hellotest/platform/backend/src/db'),obs=require('@hellotest/platform/backend/src/obsDb');
  try{
    assert.equal((await db.prepare("SELECT to_regclass('public.projects') AS present").get()).present,null,'Requires an empty task-owned database.');
    await db.query(fs.readFileSync(path.resolve(__dirname,'../../../platform/backend/instance-setup-data/schema-setup/schema.sql'),'utf8'));
    await require('../../../platform/backend/src/db/bootstrap').ensureRuntimeSchema();
    await require('../../../platform/backend/src/obsDb/bootstrap').ensureRuntimeSchema();
    for(let repeat=0;repeat<2;repeat++)for(const sql of require('../../../platform/backend/src/db/caseExecutionHooksSchema'))await db.query(sql);
    assert.equal((await db.prepare("SELECT version FROM runtime_schema_receipts WHERE component='main'").get()).version,require('../../../platform/backend/src/db/schemaReadiness').REQUIRED_SCHEMA_VERSION);
    const project=randomUUID(),app=randomUUID(),actor=randomUUID(),suite=randomUUID(),sourceData=randomUUID(),runData=randomUUID();
    await db.prepare("INSERT INTO users(id,email,password_hash,name,status) VALUES(?,?,'no-login','Hooks fixture','active')").run(actor,`${actor}@example.test`);
    await db.prepare("INSERT INTO projects(id,name) VALUES(?,'Hooks fixture')").run(project);
    await db.prepare("INSERT INTO app_types(id,project_id,name,type) VALUES(?,?,'Fixture web','web')").run(app,project);
    await db.prepare('INSERT INTO project_members(id,project_id,user_id,role_id) VALUES(?,?,?,?)').run(randomUUID(),project,actor,'role-admin');
    await db.prepare("INSERT INTO test_suites(id,app_type_id,name) VALUES(?,?,'Fixture suite')").run(suite,app);
    for(const [id,name,row] of [[sourceData,'Source data',{'t.username':'dataset@example.test','t.region':'source','t.opaque':'private-dataset-value'}],[runData,'Main run data',{'t.username':'wrong-main@example.test','t.region':'main-only'}]])await db.prepare("INSERT INTO test_data_sets(id,project_id,app_type_id,name,mode,columns,rows) VALUES(?,?,?,?,'table',?,?)").run(id,project,app,name,Object.keys(row),[row]);
    const cases=require('../../backend/services/testCase.service'),runs=require('../../backend/services/execution.service');
    const input={app_type_id:app,created_by:actor,automated:'yes',automation_start_url:'https://fixture.example.test/',steps:[{action:'Retained action',expected_result:'Retained outcome',step_type:'web',automation_code:'await page.locator("#fixture").click();'}]};
    const manual=await cases.createTestCase({...input,title:'Source manual',automated:'no',parameter_values:{'t.username':'source@example.test'},test_data_set_ids:[sourceData],steps:[{action:'Sign in',expected_result:'Signed in'}]});
    const setup=await cases.createTestCase({...input,title:'Source automation',manual_test_case_ids:[manual.id],test_data_options:{parameter_overrides:['t.username'],private_parameter_names:['t.opaque']},parameter_values:{'t.username':'override@example.test','t.password':'secret-hook-value','t.id':'{{randomString:12}}'}});
    const cleanup=await cases.createTestCase({...input,title:'Cleanup automation'});
    const references=[{id:'setup',scope:'test',phase:'pre',target_kind:'test',target_id:manual.id},{id:'cleanup',scope:'test',phase:'post',target_kind:'test',target_id:cleanup.id}];
    const owner=await cases.createTestCase({...input,title:'Owner automation',suite_ids:[suite],execution_hooks:references});
    const read=await cases.getTestCase(owner.id);assert.equal(read.execution_hooks.length,2);
    assert.equal(read.execution_hooks[0].target_id,manual.id);assert.equal(read.execution_hooks[1].fail_behavior,'continue');
    const direct=await runs.createExecution({project_id:project,app_type_id:app,test_case_ids:[owner.id],test_data_set_id:runData,created_by:actor});
    const suiteRun=await runs.createExecution({project_id:project,app_type_id:app,suite_ids:[suite],created_by:actor});
    for(const runId of [direct.id,suiteRun.id]){
      const row=await db.prepare('SELECT execution_hooks FROM execution_case_snapshots WHERE execution_id=? AND test_case_id=?').get(runId,owner.id);
      assert.equal(row.execution_hooks.length,2);assert.equal(row.execution_hooks[0].steps[0].test_case_id,setup.id);
      assert.equal(row.execution_hooks[0].steps[0].source_case_parameters['t.username'],'override@example.test');
      assert.equal(row.execution_hooks[0].steps[0].source_case_parameters['t.password'],'secret-hook-value');
      assert.equal(row.execution_hooks[0].steps[0].automation_code,input.steps[0].automation_code);
      const source=row.execution_hooks[0].steps[0].source_case_context;
      assert.equal(source.data_set.rows[0]['t.region'],'source');
      assert.equal(source.data_policy.case.parameter_overrides.includes('t.username'),true);
      const visible=await runs.getExecution(runId);assert.doesNotMatch(JSON.stringify(visible),/secret-hook-value|private-dataset-value/);
    }
    const original=(await db.prepare('SELECT execution_hooks FROM execution_case_snapshots WHERE execution_id=? AND test_case_id=?').get(direct.id,owner.id)).execution_hooks;
    await cases.updateTestCase(setup.id,{parameter_values:{'t.username':'changed@example.test'},updated_by:actor,expected_revision:1});
    await db.prepare("UPDATE executions SET status='completed' WHERE id=?").run(direct.id);
    const rerun=await runs.rerunExecution(direct.id,{created_by:actor});
    const frozen=(await db.prepare('SELECT execution_hooks FROM execution_case_snapshots WHERE execution_id=? AND test_case_id=?').get(rerun.id,owner.id)).execution_hooks;
    assert.equal(frozen[0].steps[0].source_case_parameters['t.username'],'override@example.test');
    assert.equal(frozen[0].steps[0].automation_code,original[0].steps[0].automation_code);
    assert.notEqual(frozen[0].steps[0].source_case_parameters['t.id'],original[0].steps[0].source_case_parameters['t.id']);
    await db.prepare('UPDATE test_data_sets SET rows=? WHERE id=?').run([{'t.region':'first'},{'t.region':'second'}],sourceData);
    const countBefore=(await db.prepare('SELECT count(*)::int AS count FROM executions').get()).count;
    await assert.rejects(runs.createExecution({project_id:project,app_type_id:app,test_case_ids:[owner.id],created_by:actor}),{code:'AUTOMATION_CASE_HOOK_DATA_ROWS_REVIEW_REQUIRED'});
    assert.equal((await db.prepare('SELECT count(*)::int AS count FROM executions').get()).count,countBefore,'Unreviewed setup data cannot leave a partial run.');
    await assert.rejects(cases.updateTestCase(owner.id,{execution_hooks:[{...references[0],target_id:owner.id}],updated_by:actor,expected_revision:1}),{code:'AUTOMATION_CASE_HOOK_CYCLE'});
    await cases.updateTestCase(owner.id,{execution_hooks:[],updated_by:actor,expected_revision:1});
    assert.equal((await cases.getTestCase(owner.id)).execution_hooks.length,0);
    assert.equal((await require('../../backend/services/testCaseVersion.service').get(owner.id,1)).content.execution_hooks.length,2);
  }finally{await Promise.all([db.close(),obs.close()]);}
});
