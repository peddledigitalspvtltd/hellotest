const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {createBrowserParameterResolver}=require('../../backend/lib/automationBrowserParameters');

test('the actual agent case-context endpoint projects linked manual data and defers random values until a build',async()=>{
 const source=fs.readFileSync(require.resolve('../../backend/services/aiAutomationBuilder.service'),'utf8');
 const endpoint=source.slice(source.indexOf('exports.loadAutomationAgentCaseContext ='));
 const testCase={id:'automation',automated:'yes',project_id:'project',app_type_id:'app',title:'Register @t.name',description:'Use @t.email'};
 const manual=[{id:'manual',title:'Manual @t.name',steps:[{id:'m1',action:'Enter @t.name and @t.email with hidden-password',expected_result:'Saved @t.name using @t.password'}]}];
 const sections=[{id:'step',action:'Enter @t.name and @t.email',expected_result:'Saved @t.name'}],before=JSON.stringify({testCase,manual,sections});
 const exported={};let resolverCalls=0;
 new Function('exports','require','selectCaseWithScope','getOptionalEvidenceAccess','loadAutomationParameterContext','loadAutomationManualContext','selectStepsForCase','summarizeStep','safeJson','loadAutomationStoryContext',endpoint)(
  exported,id=>{assert.equal(id,'../lib/automationBrowserParameters');return{loadBrowserParameterResolver:async input=>{
   resolverCalls++;assert.equal(input.materialize,false);assert.equal(input.steps.length,2);
   return createBrowserParameterResolver({...input,caseValues:input.caseValues});
  }};},{get:async()=>testCase},async()=>({'testcase.view':true,'automation.view':true,'automation.code.view':true,'data.view':true}),
  async()=>({runtime_parameter_values:{'t.name':'Reader','t.email':'{{yopmail}}','t.password':'hidden-password'}}),async()=>manual,
  {all:async()=>sections},value=>({...value}),value=>value||[],async()=>({stories:[]})
 );
 const result=await exported.loadAutomationAgentCaseContext({projectId:'project',appTypeId:'app',user:{id:'author'},caseId:'automation'});
 assert.equal(result.linked_manual_cases[0].steps[0].action,'Enter Reader and @t.email with [private parameter value]');
 assert.equal(result.sections[0].expected_result,'Saved Reader');
 assert.deepEqual(result.case.parameter_values,{'t.name':'Reader'});
 assert.deepEqual(result.deferred_parameter_references,['t.email']);
 assert.deepEqual(result.private_parameter_references,['t.password']);
 assert.doesNotMatch(JSON.stringify(result),/hidden-password|\{\{yopmail\}\}/);
 assert.equal(resolverCalls,1);assert.equal(JSON.stringify({testCase,manual,sections}),before);
});
