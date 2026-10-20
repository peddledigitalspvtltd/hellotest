const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
test('section paste is atomic, application-scoped, and preserves complete reusable group references',{skip:process.env.AUTOMATION_COPY_POSTGRES!=='1'},async()=>{
 assert.match(new URL(process.env.DATABASE_URL).pathname,/^\/agent_verify_copy_[a-z0-9_]+$/);
 const db=require('@hellotest/platform/backend/src/db');
 try{
  assert.equal((await db.prepare("SELECT to_regclass('public.projects') AS present").get()).present,null);
  await db.query(fs.readFileSync(path.resolve(__dirname,'../../../platform/backend/instance-setup-data/schema-setup/schema.sql'),'utf8'));
  await require('../../../platform/backend/src/db/bootstrap').ensureRuntimeSchema();
  await db.prepare('INSERT INTO projects(id,name) VALUES (?,?)').run('p','Copy verification');
  for(const id of ['a','other'])await db.prepare('INSERT INTO app_types(id,project_id,name,type) VALUES (?,?,?,?)').run(id,'p',id,'web');
  for(const [id,app] of [['source','a'],['target','a'],['wrong-app','other']])await db.prepare('INSERT INTO test_cases(id,app_type_id,title,automated) VALUES (?,?,?,?)').run(id,app,id,'yes');
  await db.prepare('INSERT INTO shared_step_groups(id,app_type_id,name,steps) VALUES (?,?,?,?)').run('shared','a','Shared',[]);
  for(const [id,order] of [['s1',1],['s2',2]])await db.prepare("INSERT INTO test_steps(id,test_case_id,step_order,action,expected_result,step_type,automation_code,group_id,group_name,group_kind,reusable_group_id) VALUES (?,'source',?,?,'Ready','web',?,'instance','Shared','reusable','shared')").run(id,order,id,'await web.wait(1);');
  const service=require('../../backend/services/testStep.service');
  await service.duplicateTestSteps({test_case_id:'target',source_test_case_id:'source',step_ids:['s1','s2']});
  let copied=await service.getTestSteps({test_case_id:'target'});assert.equal(copied.length,2);assert.notEqual(copied[0].group_id,'instance');assert.equal(copied[0].group_id,copied[1].group_id);assert.equal(copied[0].reusable_group_id,'shared');
  await assert.rejects(service.duplicateTestSteps({test_case_id:'target',source_test_case_id:'source',step_ids:['s1']}),/complete group/);
  await assert.rejects(service.duplicateTestSteps({test_case_id:'target',source_test_case_id:'source',step_ids:['s1'],as_standalone:true,insert_after_step_id:copied[0].id}),/complete group/);
  await assert.rejects(service.duplicateTestSteps({test_case_id:'wrong-app',source_test_case_id:'source',step_ids:['s1','s2']}),/application/);
  await assert.rejects(service.duplicateTestSteps({test_case_id:'target',source_test_case_id:'source',step_ids:['s1','missing']}),/source case/);
  assert.equal((await service.getTestSteps({test_case_id:'target'})).length,2);
  await service.duplicateTestSteps({test_case_id:'target',source_test_case_id:'source',step_ids:['s1'],as_standalone:true,insert_after_step_id:copied[1].id});
  copied=await service.getTestSteps({test_case_id:'target'});assert.equal(copied.length,3);assert.equal(copied[2].group_id,null);assert.equal(copied[2].reusable_group_id,null);assert.deepEqual(copied.map(step=>step.step_order),[1,2,3]);
  assert.equal((await service.getTestSteps({test_case_id:'source'})).length,2);
 }finally{await db.close();}
});
