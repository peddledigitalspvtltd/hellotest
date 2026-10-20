const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
test('standalone AT identities and linked coverage retain genuine source evidence',{skip:process.env.AUTOMATION_IDENTITY_POSTGRES!=='1',timeout:120000},async()=>{
 assert.match(new URL(process.env.DATABASE_URL).pathname,/^\/agent_verify_automation_[a-z0-9_]+$/);assert.equal(process.env.DATABASE_URL,process.env.OBS_DATABASE_URL);
 const db=require('@hellotest/platform/backend/src/db'),obs=require('@hellotest/platform/backend/src/obsDb');
 try{
  if(!(await db.prepare("SELECT to_regclass('public.projects') AS present").get()).present){
    await db.query(fs.readFileSync(path.resolve(__dirname,'../../../platform/backend/instance-setup-data/schema-setup/schema.sql'),'utf8'));
    await require('../../../platform/backend/src/db/bootstrap').ensureRuntimeSchema();
  } else assert.ok(await db.prepare("SELECT id FROM projects WHERE name='Disposable automation identity' LIMIT 1").get(),'Only an owned fixture database can be reused.');
  const cases=require('../../backend/services/testCase.service'),results=require('../../backend/services/executionResult.service'),catalog=require('../../backend/services/testCaseCatalog.service');
  const userId=randomUUID(),projectId=randomUUID(),appId=randomUUID();
  await db.prepare("INSERT INTO users(id,email,password_hash,name,is_workspace_admin,status) VALUES(?,?,?,'Identity fixture',TRUE,'active')").run(userId,`identity-${userId}@example.test`,'not-a-login');
  await db.prepare('INSERT INTO projects(id,name,created_by) VALUES(?,?,?)').run(projectId,'Disposable automation identity',userId);
  const role=await db.prepare('SELECT id FROM roles LIMIT 1').get();
  await db.prepare('INSERT INTO project_members(id,project_id,user_id,role_id) VALUES(?,?,?,?)').run(randomUUID(),projectId,userId,role.id);
  await db.prepare("INSERT INTO app_types(id,project_id,name,type) VALUES(?,?,?,'web')").run(appId,projectId,'Browser');
  const create=input=>cases.createTestCase({app_type_id:appId,title:'Standalone case',created_by:userId,steps:[{action:'Confirm readiness',expected_result:'Ready is visible',step_type:'web'}],...input});
  const manual=await create({automated:'no'});assert.match(manual.display_id,/^TC_/);
  const generated=await Promise.all(Array.from({length:6},(_,i)=>create({title:`Automation ${i}`,automated:'yes',manual_test_case_ids:[manual.id]})));
  assert.equal(new Set(generated.map(item=>item.display_id)).size,6);assert.ok(generated.every(item=>/^AT_/.test(item.display_id)));
  const automation=generated[0];
  assert.equal((await cases.getTestCase(manual.id)).automated,'no');
  assert.ok((await cases.getTestCase(manual.id)).automation_test_case_ids.includes(automation.id));
  assert.equal((await catalog.listPage({app_type_id:appId,manual_test_case_id:manual.id,automated:'yes'})).items.length,6);
  const linkedAt=(await db.prepare('SELECT created_at FROM automation_case_links WHERE automation_test_case_id=? AND manual_test_case_id=?').get(automation.id,manual.id)).created_at;
  await cases.updateTestCase(automation.id,{manual_test_case_ids:[manual.id],updated_by:userId});
  assert.equal(String((await db.prepare('SELECT created_at FROM automation_case_links WHERE automation_test_case_id=? AND manual_test_case_id=?').get(automation.id,manual.id)).created_at),String(linkedAt));
  const suite=await require('../../backend/services/testSuite.service').createTestSuite({app_type_id:appId,name:'Mixed identity suite',test_case_ids:[manual.id,automation.id],created_by:userId});
  assert.equal((await db.prepare('SELECT test_case_id FROM suite_test_cases WHERE suite_id=?').all(suite.id)).length,2);

  await assert.rejects(cases.updateTestCase(manual.id,{automated:'yes',updated_by:userId}),error=>error.code==='TEST_CASE_IDENTITY_IMMUTABLE');
  await assert.rejects(create({automated:'yes',manual_test_case_ids:[automation.id]}),/only to manual/);
  const otherApp=randomUUID(),foreignManual=randomUUID();
  await db.prepare("INSERT INTO app_types(id,project_id,name,type) VALUES(?,?,?,'web')").run(otherApp,projectId,'Other application');
  await db.prepare("INSERT INTO test_cases(id,app_type_id,title,automated) VALUES(?,?,?,'no')").run(foreignManual,otherApp,'Foreign case');
  await assert.rejects(create({automated:'yes',manual_test_case_ids:[foreignManual]}),/same application/);
  await assert.rejects(cases.updateTestCase(manual.id,{app_type_id:otherApp,suite_ids:[],updated_by:userId}),error=>error.code==='AUTOMATION_LINK_SCOPE_CHANGED');
  await assert.rejects(db.prepare("UPDATE test_cases SET automated='yes' WHERE id=?").run(manual.id),error=>error.code==='23514');

  const legacy=randomUUID(),nullLegacy=randomUUID(),legacyReference=`TC_${Date.now()}`;await db.query('ALTER TABLE test_cases DISABLE TRIGGER test_case_identity_preserved');
  try{await db.prepare("INSERT INTO test_cases(id,display_id,app_type_id,title,automated) VALUES(?,?,?,?,'yes')").run(legacy,legacyReference,appId,'Legacy automation');await db.prepare("INSERT INTO test_cases(id,app_type_id,title,automated) VALUES(?,?,?,'yes')").run(nullLegacy,appId,'Null legacy automation');}finally{await db.query('ALTER TABLE test_cases ENABLE TRIGGER test_case_identity_preserved');}
  for(const statement of require('../../../platform/backend/src/db/automationCaseIdentitySchema'))await db.query(statement);
  const migrated=await cases.getTestCase(legacy);assert.match(migrated.display_id,/^AT_/);assert.ok(migrated.legacy_display_ids.includes(legacyReference));assert.equal((await cases.getTestCase(legacyReference)).id,legacy);
  assert.match((await cases.getTestCase(nullLegacy)).display_id,/^AT_/);
  const laterManual=await create({automated:'no'});assert.notEqual(laterManual.display_id,legacyReference);assert.ok(BigInt(laterManual.display_id.slice(3))>BigInt(legacyReference.slice(3)));
  const savedIdentity=migrated.display_id;for(const statement of require('../../../platform/backend/src/db/automationCaseIdentitySchema'))await db.query(statement);assert.equal((await cases.getTestCase(legacy)).display_id,savedIdentity);

  const run=randomUUID(),step=randomUUID();
  await db.prepare("INSERT INTO executions(id,project_id,app_type_id,name,trigger,status) VALUES(?,?,?,'Mixed run','ci','running')").run(run,projectId,appId);
  for(const item of [manual,automation])await db.prepare('INSERT INTO execution_case_snapshots(execution_id,test_case_id,test_case_title) VALUES(?,?,?)').run(run,item.id,item.id);
  await db.prepare("INSERT INTO execution_step_snapshots(execution_id,test_case_id,snapshot_step_id,step_order,action,step_type) VALUES(?,?,?,1,'Confirm readiness','web')").run(run,automation.id,step);
  const human=await results.createExecutionResult({execution_id:run,test_case_id:manual.id,app_type_id:appId,status:'pending',logs:JSON.stringify({stepNotes:{manual:'Untouched manual placeholder'}})});
  const source=await results.upsertExecutionResult({execution_id:run,test_case_id:automation.id,app_type_id:appId,status:'passed',logs:JSON.stringify({stepStatuses:{[step]:'passed'}})});
  const projected=(await results.getExecutionResults({execution_id:run})).find(row=>row.test_case_id===manual.id);assert.equal(projected.derived,true);assert.equal(projected.status,'passed');assert.equal(projected.source_result_id,source.id);assert.equal(projected.logs,null);
  assert.equal((await results.getExecutionResult(projected.id)).read_only,true);
  await assert.rejects(results.updateExecutionResult(projected.id,{status:'failed'}),error=>error.code==='LINKED_RESULT_READ_ONLY');
  await assert.rejects(results.deleteExecutionResult(projected.id),error=>error.code==='LINKED_RESULT_READ_ONLY');
  const raw=await db.prepare('SELECT status,logs FROM execution_results WHERE id=?').get(human.id);assert.equal(raw.status,'pending');assert.equal(JSON.parse(raw.logs).stepNotes.manual,'Untouched manual placeholder');
  assert.equal((await catalog.listPage({app_type_id:appId,exclude_automated:true,include_execution:true})).items.find(row=>row.id===manual.id).latest_result.status,'passed');
  const history=await require('../../backend/services/executionHistory.service').list({projectId,testCaseId:manual.id});assert.ok(history.some(row=>row.derived&&row.source_result_id===source.id));
  await require('../../../automation/backend/services/testEngineDispatch.service').settleExecutionIfComplete(run);
  assert.equal((await db.prepare('SELECT status FROM executions WHERE id=?').get(run)).status,'completed');

  const makeRun=async(ids,{rows=0}={})=>{
    const id=randomUUID();await db.prepare("INSERT INTO executions(id,project_id,app_type_id,name,trigger,status) VALUES(?,?,?,'Coverage edge fixture','ci','running')").run(id,projectId,appId);
    for(const caseId of [manual.id,...ids])await db.prepare('INSERT INTO execution_case_snapshots(execution_id,test_case_id,test_case_title,test_data_set_snapshot) VALUES(?,?,?,?)').run(id,caseId,caseId,rows&&caseId!==manual.id?{mode:'table',rows:Array.from({length:rows},(_,i)=>({'t.row':String(i)}))}:null);
    await results.createExecutionResult({execution_id:id,test_case_id:manual.id,app_type_id:appId,status:'pending'});
    return id;
  };
  const record=(execution_id,test_case_id,status,iteration)=>results.upsertExecutionResult({execution_id,test_case_id,app_type_id:appId,status,...(iteration===undefined?{}:{data_set_iteration_index:iteration})});
  const receipt=async id=>(await results.getExecutionResults({execution_id:id})).find(row=>row.test_case_id===manual.id);
  const multi=await makeRun([automation.id,generated[1].id]);
  await record(multi,automation.id,'failed');await record(multi,generated[1].id,'passed');
  const multiReceipt=await receipt(multi);assert.equal(multiReceipt.status,'failed');assert.equal(multiReceipt.source_results.length,2);assert.equal(multiReceipt.duration_ms,null);
  await require('../../../automation/backend/services/testEngineDispatch.service').settleExecutionIfComplete(multi);
  assert.equal((await db.prepare('SELECT status FROM executions WHERE id=?').get(multi)).status,'failed');
  const timestamp=(await db.prepare('SELECT updated_at FROM execution_results WHERE id=?').get(source.id)).updated_at;
  await results.updateExecutionResult(source.id,{error:'Added review note',logs:'{"note":"Evidence annotation only"}'});
  assert.equal(String((await db.prepare('SELECT updated_at FROM execution_results WHERE id=?').get(source.id)).updated_at),String(timestamp));
  assert.equal((await catalog.listPage({app_type_id:appId,exclude_automated:true,include_execution:true})).items.find(row=>row.id===manual.id).latest_result.status,'failed');
  const incomplete=await makeRun([automation.id,generated[1].id]);await record(incomplete,automation.id,'passed');assert.equal((await receipt(incomplete)).status,'pending');
  const dataRun=await makeRun([automation.id],{rows:2});await record(dataRun,automation.id,'passed',0);assert.equal((await receipt(dataRun)).status,'pending');
  await record(dataRun,automation.id,'failed',1);assert.equal((await receipt(dataRun)).status,'failed');
  const humanRun=await makeRun([automation.id]);await record(humanRun,automation.id,'passed');await record(humanRun,manual.id,'running');
  assert.notEqual((await receipt(humanRun)).derived,true);assert.equal((await receipt(humanRun)).status,'running');
  await require('../../../automation/backend/services/testEngineDispatch.service').settleExecutionIfComplete(humanRun);
  assert.equal((await db.prepare('SELECT status FROM executions WHERE id=?').get(humanRun)).status,'running');

  await db.prepare('DELETE FROM automation_case_links WHERE automation_test_case_id=? AND manual_test_case_id=?').run(automation.id,manual.id);
  assert.equal((await results.getExecutionResults({test_case_id:manual.id,execution_id:run})).some(row=>row.derived),false);
  await assert.rejects(results.getExecutionResult(projected.id),error=>error.statusCode===404);
 }finally{await obs.close();await db.close();}
});
