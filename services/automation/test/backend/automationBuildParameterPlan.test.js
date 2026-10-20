const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {buildParameterValues,parameterPlanKey,assertParameterPlanKey}=require('../../backend/lib/automationBuildParameterPlan');
const {createBrowserParameterResolver}=require('../../backend/lib/automationBrowserParameters');

test('reviewed build values preserve exact namespaces and intentional blanks without accepting ambiguous aliases',()=>{
 assert.deepEqual(buildParameterValues({'@T.Name':'Reader','r.optional':'','@s.region':'East',unscoped:'Run input'}),{'t.name':'Reader','r.optional':'','s.region':'East','r.unscoped':'Run input'});
 for(const value of [[],{'r.name':{}},{'r.name':null},{'r.name':'A','@R.Name':'B'},Object.fromEntries(Array.from({length:257},(_,i)=>[`r.input${i}`,'']))])assert.throws(()=>buildParameterValues(value),{code:'AUTOMATION_BUILD_PARAMETERS_INVALID'});
});
test('opaque reviewed receipts bind private source revisions and exact original goals without exposing values',()=>{
 const input={testCase:{id:'case',app_type_id:'app',project_id:'project',parameter_values:{'r.secret':'private-source'}},steps:[{id:'one',step_order:1,action:'Enter @r.name',expected_result:'Saved'}],manualCases:[],parameterSourceKey:'private-link-receipt',inputSourceKey:'private-environment-receipt'};
 const key=parameterPlanKey(input);assert.match(key,/^[a-f0-9]{64}$/);assert.doesNotMatch(key,/private/);
 assert.equal(key,parameterPlanKey({...input,testCase:{parameter_values:{'r.secret':'private-source'},project_id:'project',app_type_id:'app',id:'case'}}));
 assert.doesNotThrow(()=>assertParameterPlanKey(key,key));
 for(const changed of [{...input,inputSourceKey:'new-private-environment'},{...input,steps:[{...input.steps[0],expected_result:'Different goal'}]},{...input,parameterSourceKey:'new-private-manual'}])assert.throws(()=>assertParameterPlanKey(key,parameterPlanKey(changed)),error=>error.code==='AUTOMATION_PARAMETER_PLAN_CHANGED'&&error.generation_provider_requests===0&&error.browser_actions===0);
});
function fixture(){
 let allowed=true,caseAccess=true,linked=false,parameterReads=0,caseValues={'t.name':'Linked Reader','t.password':'private-value'},environment={id:'env',variables:[{key:'r.origin',value:'https://app.test'}]},target=null,reads=0;
 const section={id:'step',step_order:1,step_type:'web',action:'Enter @t.name and @r.missing using @t.password',expected_result:'Value shown'};
 const testCase={id:'automation',automated:'yes',app_type_id:'app',project_id:'project',parameter_values:{},test_data_options:{}};
 const module={exports:{}};
 const local=require('node:module').createRequire(require.resolve('../../backend/services/automationBuildParameterPlan.service'));
 new Function('require','module',fs.readFileSync(require.resolve('../../backend/services/automationBuildParameterPlan.service'),'utf8'))(id=>{
  if(id.endsWith('/db'))return {prepare:sql=>({all:async()=>{reads++;return[section];},get:async(id)=>{reads++;return sql.includes('FROM automation_case_links')?(linked?{manual_test_case_id:'manual'}:null):sql.includes('source_idempotency_key')?target:id==='manual'?{...testCase,id:'manual',automated:'no'}:testCase;}})};
  if(id.endsWith('optionalEvidenceAccess.service'))return{getOptionalEvidenceAccess:async()=>({'automation.build':true,'data.view':allowed,'testcase.view':caseAccess})};
  if(id.endsWith('/automationBuildContext'))return{loadAutomationManualContext:async()=>[],loadAutomationParameterContext:async()=>{parameterReads++;return{runtime_parameter_values:allowed?caseValues:{},source_key:allowed?JSON.stringify(caseValues):null};}};
  if(id.endsWith('/automationBrowserParameters'))return{referencedParameterNames:require('../../backend/lib/automationBrowserParameters').referencedParameterNames,loadBrowserParameterResolver:async input=>{
   assert.equal(input.materialize,false);assert.equal(input.defaultMissingInputs,undefined);
   return createBrowserParameterResolver({...input,caseOptions:input.testCase.test_data_options,environment:allowed?environment:null});
  }};
  return local(id);
 },module);
 return {...module.exports,testCase,section,setAllowed:value=>allowed=value,setCaseAccess:value=>caseAccess=value,setLinked:value=>linked=value,setCaseValues:value=>caseValues=value,setEnvironment:value=>environment=value,setTarget:value=>target=value,get reads(){return reads;},get parameterReads(){return parameterReads;}};
}
test('parameter review uses authorized effective sources, leaves missing blank decisions to the user, and invalidates changed private sources',async()=>{
 const f=fixture(),input={testCase:f.testCase,userId:'author',test_environment_id:'env'};
 const plan=await f.load(input);
 assert.equal(plan.parameter_values['t.name'],'Linked Reader');assert.equal(plan.parameter_values['t.password'],undefined);
 assert.deepEqual(plan.missing_parameter_references,['r.missing']);assert.ok(plan.private_parameter_references.includes('t.password'));
 assert.doesNotMatch(JSON.stringify(plan),/private-value|private-environment|source_key|inputSourceKey/);
 const edited=await f.load({...input,parameter_values:{'r.missing':''},expectedKey:plan.parameter_plan_key});
 assert.equal(edited.parameter_plan_key,plan.parameter_plan_key,'explicit edits do not alter the reviewed source receipt');
 f.setCaseValues({'t.name':'Linked Reader','t.password':'changed-private'});
 await assert.rejects(f.load({...input,expectedKey:plan.parameter_plan_key}),{code:'AUTOMATION_PARAMETER_PLAN_CHANGED'});
});
test('parameter review checks data access before reading linked data and a manual selection previews its existing automation target',async()=>{
 const f=fixture();f.setAllowed(false);
 await assert.rejects(f.load({testCase:f.testCase,userId:'author'}),error=>error.statusCode===403&&error.code==='AUTOMATION_BUILD_DATA_ACCESS_REQUIRED');assert.equal(f.reads,1,'only authorized source goals are read, not parameter values');
 f.setAllowed(true);f.setTarget(f.testCase);
 const plan=await f.load({testCase:{...f.testCase,id:'manual',automated:'no'},userId:'author'});
 assert.equal(plan.test_case_id,'manual');assert.equal(plan.resolved_test_case_id,'automation');
});
test('a case without authored references preserves parameter-free build access without test-data permission',async()=>{
 const f=fixture();f.setAllowed(false);f.section.action='Open the app';f.section.expected_result='App is visible';
 const plan=await f.load({testCase:f.testCase,userId:'author'});
 assert.equal(plan.test_case_id,'automation');assert.deepEqual(plan.parameter_references,[]);assert.deepEqual(plan.missing_parameter_references,[]);
});
test('a new manual target previews the same inherited source fingerprint that its normalized automation clone consumes',async()=>{
 const f=fixture();f.testCase.test_data_options={parameter_overrides:['t.name']};
 const manual={...f.testCase,id:'manual',automated:'no'};
 const state=await f.loadState({testCase:manual,userId:'author'});
 const {parameter_overrides:sourcePriority,...options}=require('../../../platform/backend/src/utils/automationCaseBlueprint').buildAutomationCaseBlueprint({source:manual,steps:[]}).test_data_options;
 const actual=createBrowserParameterResolver({caseValues:{'t.name':'Linked Reader','t.password':'private-value'},environment:{id:'env',variables:[{key:'r.origin',value:'https://app.test'}]},caseOptions:options,materialize:true,defaultMissingInputs:true,steps:[f.section]});
 assert.equal(state.inputSourceKey,actual.inputSourceKey);
 assert.equal(actual.defaultedCaseValues['r.missing'],'');
 assert.equal(state.plan.resolved_test_case_id,'manual');assert.deepEqual(state.plan.missing_parameter_references,['r.missing']);
});
test('inaccessible linked defaults are permission failures rather than empty input defaults',async()=>{
 const f=fixture();f.setCaseAccess(false);f.setLinked(true);
 await assert.rejects(f.load({testCase:f.testCase,userId:'author'}),error=>error.statusCode===403&&error.code==='AUTOMATION_LINKED_PARAMETER_ACCESS_REQUIRED');
 assert.equal(f.parameterReads,0);
 f.setLinked(false);assert.equal((await f.load({testCase:f.testCase,userId:'author'})).test_case_id,'automation','unlinked authorized own data remains usable');
});
test('blank manual defaults and their private empty bindings survive the real inheritance-to-clone fingerprint contract',()=>{
 const inheritance=require('../../../platform/backend/src/utils/linkedManualParameters');
 const manual={id:'manual',app_type_id:'app',automated:'no',parameter_values:{name:'','t.password':''}};
 const blueprint=require('../../../platform/backend/src/utils/automationCaseBlueprint').buildAutomationCaseBlueprint({source:manual,steps:[]});
 const values=inheritance.resolveLinkedManualParameters(manual).effective_parameter_values;
 const inherited=inheritance.resolveLinkedManualParameters({...blueprint,id:'clone'},[{manual_test_case_id:manual.id,is_primary:true,parameter_values:manual.parameter_values}]).effective_parameter_values;
 assert.deepEqual(inherited,values);assert.deepEqual(inherited,{'t.name':'','t.password':''});
 const steps=[{id:'input',action:'Enter @name and @t.password',expected_result:'Inputs remain empty'}];
 const plan=createBrowserParameterResolver({caseValues:values,caseOptions:blueprint.test_data_options,steps,materialize:false});
 const build=createBrowserParameterResolver({caseValues:inherited,caseOptions:blueprint.test_data_options,steps,defaultMissingInputs:true});
 assert.equal(build.inputSourceKey,plan.inputSourceKey);assert.deepEqual(build.defaultedCaseValues,{});
 assert.deepEqual(build.exportParameterValues,{'t.name':'','t.password':''});assert.equal(plan.publicParameterValues['t.password'],undefined);
 assert.equal(build.resolve('browser_fill',build.canonicalArguments('browser_fill',{value:'@name'})).value,'');
});
test('authored inherited empty bindings invite review without reporting unrelated configured blanks or exposing private values',async()=>{
 const f=fixture();f.setCaseValues({'t.name':'','t.password':'','r.unused':''});f.setEnvironment({id:'env',variables:[{key:'r.environment-empty',value:''}]});
 const plan=await f.load({testCase:f.testCase,userId:'author'});
 assert.deepEqual(plan.empty_parameter_references,['t.name','t.password']);assert.deepEqual(plan.missing_parameter_references,['r.missing']);
 assert.equal(plan.parameter_values['t.name'],'');assert.equal(plan.parameter_values['t.password'],undefined);assert.ok(plan.private_parameter_references.includes('t.password'));
 assert.equal(plan.empty_parameter_references.includes('r.unused'),false);assert.equal(plan.empty_parameter_references.includes('r.environment-empty'),false);
});
