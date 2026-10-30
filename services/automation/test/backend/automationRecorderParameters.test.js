const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {createBrowserParameterResolver}=require('../../backend/lib/automationBrowserParameters');
const {bindRecorderParameterCandidates:bind,recorderPromptProjector}=require('../../backend/lib/automationRecorderParameters');

function recorder(){
  const file=path.resolve(__dirname,'../../backend/services/aiAutomationBuilder.service.js');
  const database={prepare:()=>({all:async()=>[],get:async()=>null,run:async()=>({changes:1})})};
  const sandbox={module:{exports:{}},exports:{},process,URL,Buffer,setTimeout,clearTimeout,console,require:id=>{
    if(id.endsWith('/db')||id.endsWith('/obsDb'))return database;
    if(id==='crypto')return require('node:crypto');
    if(id.endsWith('/testStepAutomation'))return require('../../../platform/backend/src/utils/testStepAutomation');
    if(id.endsWith('/automationBrowserParameters'))return require('../../backend/lib/automationBrowserParameters');
    return {};
  }};
  vm.runInNewContext(fs.readFileSync(file,'utf8')+'\nmodule.exports={buildRecorderStepCandidate,normalizeCapturedActions,inferRecorderFillValue,recorderParameterHint};',sandbox,{filename:file});
  return sandbox.module.exports;
}
const host=recorder();
const action=(index,type,value,locator='#field')=>({index,type,value,locator});
const source=(id,action)=>({id,step_order:1,action,expected_result:'The form remains correct'});
const prepare=(actions,step,resolver)=>{
  const candidates=actions.map((action,index)=>host.buildRecorderStepCandidate(action,index+1,null));
  return bind({actions,candidates,mappings:step?[{step,candidates}]:[],resolver,rebuildCandidate:(action,order)=>host.buildRecorderStepCandidate(action,order,null)});
};

test('host-recorded fills and selections rebuild from unique original scoped references and remain dynamic after edits',()=>{
  const actions=[action(1,'fill','public@example.test','#email'),action(2,'select','West','#region')];
  const resolver=createBrowserParameterResolver({caseValues:{'t.account.email':'public@example.test'},suiteValues:{region:'West'}});
  const before=JSON.stringify(actions);
  const result=prepare(actions,source('entry','Enter @t.[account.email] and select @s.region'),resolver);
  assert.match(result.candidates[0].automation_code,/fill\("@t\.\[account\.email\]"\)/);
  assert.match(result.candidates[1].automation_code,/selectOption\("@s\.region"\)/);
  assert.doesNotMatch(JSON.stringify(result.candidates),/public@example\.test|selectOption\("West"\)/);
  assert.equal(JSON.stringify(actions),before,'binding cannot alter captured evidence');
  const updated=createBrowserParameterResolver({caseValues:{'t.account.email':'changed@example.test'},suiteValues:{region:'East'}});
  assert.equal(updated.resolve('browser_fill',{value:result.candidates[0].keyword_arguments[1]}).value,'changed@example.test');
  assert.equal(updated.resolve('browser_select_option',{value:result.candidates[1].keyword_arguments[1]}).value,'East');
});

test('matching original private names are preserved without guessing password or saving private literal data',()=>{
  const secret='Local-private-fixture';
  const result=prepare([action(1,'fill',secret,'#password')],source('credential','Fill @r.login_secret'),createBrowserParameterResolver({caseValues:{'r.login_secret':secret}}));
  assert.match(result.candidates[0].automation_code,/@r\.login_secret/);
  assert.doesNotMatch(JSON.stringify(result),/Local-private-fixture|@t\.password/);
  assert.equal(host.recorderParameterHint({value:'@r.login_secret'}),'@r.login_secret');
  assert.equal(host.recorderParameterHint({value:secret}),null,'repository metadata never stores recorded values as parameter hints');
});

test('unrelated equal values cannot supply recording provenance and ambiguous private data stops before plan writes',()=>{
  const resolver=createBrowserParameterResolver({caseValues:{'t.unrelated':'Same','t.secret_a':'Private','t.secret_b':'Private'}});
  const publicResult=prepare([action(1,'fill','Same')],source('plain','Enter a literal label'),resolver);
  assert.doesNotMatch(publicResult.candidates[0].automation_code,/@t\.unrelated/);
  assert.throws(()=>prepare([action(1,'fill','Private','#password')],source('ambiguous','Fill @t.secret_a and @t.secret_b'),resolver),error=>error.code==='AUTOMATION_RECORDER_PRIVATE_INPUT_REQUIRED'&&!JSON.stringify(error).includes('Private'));
  assert.throws(()=>prepare([action(1,'fill','Unknown-private-fixture','#password')],null,resolver),{code:'AUTOMATION_RECORDER_PRIVATE_INPUT_REQUIRED'});
});

test('recording preserves whitespace and explicit blanks instead of inventing missing parameter names',()=>{
  const normalized=host.normalizeCapturedActions([action(1,'fill','  Person  '),action(2,'fill','')]);
  assert.equal(normalized[0].value,'  Person  ');assert.equal(normalized[1].value,'');
  assert.equal(host.inferRecorderFillValue({locator:'#email',value:''}),'');
  assert.equal(host.inferRecorderFillValue({locator:'#password',value:'  exact  '}),'  exact  ');
  const result=prepare([action(1,'fill','','#password')],source('blank','Enter @t.password'),createBrowserParameterResolver({caseValues:{'t.password':''}}));
  assert.match(result.candidates[0].automation_code,/@t\.password/);
  const literal=prepare([action(1,'fill','')],null,createBrowserParameterResolver());
  assert.match(literal.candidates[0].automation_code,/fill\(""\)/);assert.doesNotMatch(literal.candidates[0].automation_code,/@t\.value/);
});

test('recorder model prompts redact configured and unbound private input values without expanding references',()=>{
  const resolver=createBrowserParameterResolver({caseValues:{'r.login_secret':'Configured-private-fixture'}});
  const actions=[action(1,'fill','Unbound-private-fixture','#password'),action(2,'fill','XY','#token')];
  const project=recorderPromptProjector({actions,resolver});
  const result=project(JSON.stringify({actions,description:'Configured-private-fixture',reference:'@r.login_secret',source:'await target.fill("Unbound-private-fixture");'}));
  assert.doesNotMatch(result,/Configured-private-fixture|Unbound-private-fixture|"XY"/);
  assert.match(result,/@r\.login_secret/);assert.match(result,/private recorded input/);
  assert.equal(actions[0].value,'Unbound-private-fixture');
});

test('real recorder finalization resolves selected inputs before mapping and publishes symbolic source without changing case data',async()=>{
  const file=path.resolve(__dirname,'../../backend/services/aiAutomationBuilder.service.js'),sourceText=fs.readFileSync(file,'utf8');
  const body=sourceText.slice(sourceText.indexOf('const finalizeRecorderBuild ='),sourceText.indexOf('exports.buildAutomationForCase ='));
  const testCase={id:'automation',project_id:'project',app_type_id:'web-app',title:'Recorded account',automated:'yes',parameter_values:{'t.email':'public@example.test','r.login_secret':'Private-current-fixture'},test_data_options:{private_parameter_names:['r.login_secret']}};
  const original=structuredClone(testCase),step=source('sign-in','Fill @t.email and @r.login_secret');
  const actions=[action(1,'fill','public@example.test','#email'),action(2,'fill','Private-current-fixture','#password')];
  let artifact,selection,applied;
  const resolver=createBrowserParameterResolver({caseValues:testCase.parameter_values,privateParameterNames:['r.login_secret']});
  const dependencies={
    selectStepsForCase:{all:async()=>[step]},selectCaseWithScope:{get:async()=>({...testCase,automation_status:'ready'})},
    loadAutomationParameterContext:async()=>({runtime_parameter_values:testCase.parameter_values,private_parameter_names:['r.login_secret']}),
    require:id=>id.endsWith('automationBrowserParameters')?{loadBrowserParameterResolver:async input=>{selection=input;return resolver;}}:require('../../backend/lib/automationRecorderParameters'),
    buildRecorderRepositoryModel:async input=>{assert.doesNotMatch(input.projectPrompt(JSON.stringify({actions:input.capturedActions})),/Private-current-fixture/);return {};},
    buildRecorderStepCandidates:items=>items.map((action,index)=>host.buildRecorderStepCandidate(action,index+1,null)),
    buildRecorderStepCandidate:host.buildRecorderStepCandidate,
    appendEvent:async()=>{},MAX_CAPTURED_ACTIONS:180,
    buildAiRecorderMappings:async input=>{assert.doesNotMatch(input.projectPrompt(JSON.stringify(input.stepCandidates)),/Private-current-fixture/);return {mappings:[{step,candidates:input.stepCandidates}]};},
    mergeRecorderMappingGroups:value=>value,buildFallbackRecorderMappings:()=>[],
    applyRecorderSteps:async input=>{applied=input;return input.recorderMappings.map(mapping=>({step_id:mapping.step.id,step_order:1,action:mapping.step.action,expected_result:mapping.step.expected_result,step_type:'web',operation:'updated',automation_code:mapping.candidates.map(candidate=>candidate.automation_code).join('\n')}));},
    persistLearning:async()=>0,markTestCaseAutomationReady:{run:async()=>{}},normalizeText:value=>value,
    workspaceTransactionService:{createTransactionArtifact:async(_id,input)=>{artifact=input.content;return {id:'artifact'};}},
    createArtifactContent:require('../../backend/lib/automationPortableArtifact').createPortableAutomationArtifact,
    listLearningCacheRows:async()=>[],MAX_CACHE_ROWS:40,updateTransaction:async()=>{}
  };
  const finalize=new Function(...Object.keys(dependencies),body+'\nreturn finalizeRecorderBuild;')(...Object.values(dependencies));
  const result=await finalize({testCase,session:{id:'recorder'},createdBy:'author',transactionId:'transaction',capturedActions:actions,capturedNetwork:[],parameterSelection:{test_suite_id:'selected-suite'}});
  assert.equal(selection.test_suite_id,'selected-suite');assert.equal(selection.materialize,false);
  assert.match(applied.recorderMappings[0].candidates[0].automation_code,/@t.email/);assert.match(applied.recorderMappings[0].candidates[1].automation_code,/@r.login_secret/);
  assert.doesNotMatch(artifact,/Private-current-fixture/);assert.match(artifact,/public@example.test/);assert.match(artifact,/@r.login_secret/);
  assert.equal(result.generated_step_count,1);assert.deepEqual(testCase,original,'finishing a recording cannot reset own parameters or their privacy settings');
});
