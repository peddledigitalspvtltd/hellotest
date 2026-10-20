const test=require('node:test'),assert=require('node:assert/strict');
const {createBrowserParameterResolver}=require('../../backend/lib/automationBrowserParameters');
const {missingBuildInputs,assertBuildInputs,assertCurrentBuildInputs}=require('../../backend/lib/automationBuildInputPreflight');
test('missing authored static inputs are identified before browser/generation work without inventing values',()=>{
 const steps=[{id:'entry',action:'Open signup'},{id:'data',action:'Enter @t.name and @t.email',expected_result:'Name @t.name shown'}];
 const resolver=createBrowserParameterResolver({caseValues:{'t.email':'known@example.test'},steps});
 assert.deepEqual(missingBuildInputs(steps,resolver).map(row=>({id:row.step_id,keys:row.required_parameters})),[{id:'data',keys:['t.name']}]);
 assert.throws(()=>assertBuildInputs(steps,resolver),error=>error.code==='AUTOMATION_DEPENDENCY_MISSING'&&error.active_step_id==='data'&&error.generation_provider_requests===0&&error.browser_actions===0);
});
test('configured empty values remain valid and old generated source or run captures do not create static blockers',()=>{
 const steps=[{id:'input',action:'Enter @t.name',automation_code:'await page.fill("#old","@t.obsolete");'},{id:'capture',action:'Check @r.generated-code'}];
 const resolver=createBrowserParameterResolver({caseValues:{'t.name':''},steps});
 assert.doesNotThrow(()=>assertBuildInputs(steps,resolver));
});
test('an active unresolved unscoped input stops before model/browser work instead of permitting invented literals',()=>{
 const resolver=createBrowserParameterResolver({caseValues:{}});
 assert.throws(()=>assertCurrentBuildInputs({stepId:'name',parameterReferences:['r.name']},resolver),error=>{
  assert.equal(error.code,'AUTOMATION_DEPENDENCY_MISSING');
  assert.equal(error.active_step_id,'name');
  assert.deepEqual(error.blocked_steps[0].required_parameters,['r.name']);
  assert.equal(error.current_step_generation_provider_requests,0);
  assert.equal(error.current_step_browser_actions,0);
  assert.match(error.message,/@r\.name/);
  return true;
 });
});
test('future captures do not block the current section and an already bound runtime capture remains usable',()=>{
 const resolver=createBrowserParameterResolver({caseValues:{'r.name':'Configured Name','r.code':'123456'}});
 assert.doesNotThrow(()=>assertCurrentBuildInputs({stepId:'entry',parameterReferences:[]},resolver));
 assert.doesNotThrow(()=>assertCurrentBuildInputs({stepId:'name',parameterReferences:['r.name']},resolver));
 assert.doesNotThrow(()=>assertCurrentBuildInputs({stepId:'verification',parameterReferences:['r.code']},resolver));
 assert.throws(()=>assertCurrentBuildInputs({stepId:'later',parameterReferences:['r.future-capture']},resolver),{code:'AUTOMATION_DEPENDENCY_MISSING'});
});
test('configured empty and private inputs are bindings and diagnostics disclose only missing names',()=>{
 const resolver=createBrowserParameterResolver({caseValues:{'r.name':'','r.password':'configured-private-value'}});
 assert.doesNotThrow(()=>assertCurrentBuildInputs({stepId:'negative',parameterReferences:['r.name','r.password']},resolver));
 assert.throws(()=>assertCurrentBuildInputs({stepId:'missing',parameterReferences:['r.name','r.password','r.email']},resolver),error=>{
  assert.deepEqual(error.blocked_steps[0].required_parameters,['r.email']);
  assert.doesNotMatch(JSON.stringify(error),/configured-private-value/);
  return true;
 });
});
