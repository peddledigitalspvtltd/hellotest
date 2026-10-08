const test=require('node:test');const assert=require('node:assert/strict');
const db=require('@hellotest/platform/backend/src/db');
const suites=require('../../backend/services/testSuite.service');
const mappings=require('../../backend/services/suiteTestCase.service');
const local=require('../../backend/services/localRunSuite.service');
test.after(()=>db.close());
test('unassigned local cases share one default suite while existing assignments and project boundaries are preserved',async t=>{
 let suite=null,creates=0;const assigned=new Map(),calls=[];
 t.mock.method(db,'transaction',fn=>async()=>fn());
 t.mock.method(db,'prepare',sql=>({get:async(...args)=>{
  if(sql.includes('FROM app_types'))return {id:'app',project_id:'project'};
  if(sql.includes('FROM test_cases'))return {id:args[0],app_type_id:args[0]==='foreign'?'other':'app'};
  if(sql.includes('FROM suite_test_cases'))return assigned.get(args[0]);
  if(sql.includes('FROM test_suites'))return suite;
  throw Error('Unexpected scope query');
 }}));
 t.mock.method(suites,'createTestSuite',async input=>{creates++;suite={id:'default',name:input.name};return suite;});
 t.mock.method(mappings,'replaceMappingsForSuite',async(id,ids,options)=>{calls.push({id,ids,options});ids.forEach(id=>assigned.set(id,suite));});
 const input={projectId:'project',appTypeId:'app',createdBy:'user'};
 assert.equal((await local.ensure({...input,testCaseId:'first'})).name,'Default Local Runs');
 assert.equal((await local.ensure({...input,testCaseId:'second'})).id,'default');assert.equal(creates,1);assert.equal(calls.length,2);assert.equal(calls.every(c=>c.options.append),true);
 assert.equal((await local.ensure({...input,testCaseId:'first'})).id,'default');assert.equal(calls.length,2);
 assigned.set('existing',{id:'suite-existing',name:'Regression'});assert.equal((await local.ensure({...input,testCaseId:'existing'})).id,'suite-existing');assert.equal(calls.length,2);
 await assert.rejects(local.ensure({...input,projectId:'other',testCaseId:'first'}),e=>e.statusCode===403);
 await assert.rejects(local.ensure({...input,testCaseId:'foreign'}),e=>e.statusCode===403);
});
