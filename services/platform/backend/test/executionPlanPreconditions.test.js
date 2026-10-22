const test=require('node:test');
const assert=require('node:assert/strict');
const {createPreconditions}=require('../../../testing/backend/services/executionPlanPreconditions.service');
function fixture(){
 const state={revision:1,action:'Submit checkout',locked:[],definition:{case:{id:'case-a',title:'Checkout'},steps:[{id:'step-a',action:'Submit checkout'}]}};
 const store={prepare:sql=>({all:async()=>{
  if(sql.includes('FOR UPDATE')){state.locked.push('case');return[{id:'case-a'}];}
  if(sql.includes('FOR SHARE')){state.locked.push('steps');return[{id:'step-a'}];}
  return[{id:'case-a',title:'Checkout',revision:state.revision,definition:state.definition}];
 }})};
 return {state,service:createPreconditions(store),input:{projectId:'project-a',appTypeId:'app-a',caseIds:['case-a']}};
}
test('reviewed execution source revisions include exact stored steps and keep source locks until caller commit',async()=>{
 const f=fixture(),expected=await f.service.capture({...f.input,lock:true});
 assert.equal(expected[0].revision,1);assert.match(expected[0].content_hash,/^[a-f0-9]{64}$/);assert.deepEqual(f.state.locked,['case','steps']);
 assert.ok(!JSON.stringify(expected).includes('Submit checkout'),'Preconditions expose digests and titles, not source data');
 await f.service.verify({...f.input,expected});
 f.state.definition.steps[0].action='Submit a changed request';
 await assert.rejects(f.service.verify({...f.input,expected}),{code:'EXECUTION_PLAN_STALE',statusCode:409});
});
test('changed history revisions and incomplete/forged preconditions fail closed',async()=>{
 const f=fixture(),expected=await f.service.capture(f.input);f.state.revision++;
 await assert.rejects(f.service.verify({...f.input,expected}),{code:'EXECUTION_PLAN_STALE'});
 for(const input of [undefined,[],[{...expected[0],test_case_id:'foreign'}],[{...expected[0],content_hash:'not-a-hash'}]])await assert.rejects(f.service.verify({...f.input,expected:input}),{code:'EXECUTION_PLAN_STALE'});
 await assert.rejects(f.service.capture({...f.input,caseIds:Array(51).fill('case-a')}),{code:'EXECUTION_PLAN_INVALID'});
});
