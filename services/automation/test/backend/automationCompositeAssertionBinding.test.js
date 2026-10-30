const test=require('node:test');
const assert=require('node:assert/strict');
const {createBrowserParameterResolver}=require('../../backend/lib/automationBrowserParameters');
const {buildAutomationParameterBindings}=require('../../backend/lib/automationParameterBindings');
const {createAutomationInputParameterBinding}=require('../../backend/lib/automationInputParameterBinding');
const {compileRecordedProgram}=require('../../backend/lib/automationRecordedProgram');
const {deriveProgramTools}=require('../../backend/lib/automationProgramTools');
const {prepareVerificationSections}=require('../../backend/lib/automationVerificationSections');
const page={tool:'browser_snapshot',result:{content:[{type:'text',text:JSON.stringify({source:'playwright',elements:[{tag:'div',locators_validated:true,locator_candidates:['#status']}]})}]}};
const request=(value='Saved Build Fixture',assertion='text')=>({name:'browser_assert',arguments:{assertion,locator:'#status',value}});
function fixture({expected='The status message displays Saved @t.item_name.',values={'t.item_name':'Build Fixture','t.unrelated':'Build Fixture'},privateNames=[]}={}){
 const obligations=[{id:'save',source:'section',action:'Fill @t.item_name in Item name.',expected_result:expected}];
 const resolver=createBrowserParameterResolver({caseValues:{'t.item_name':'Build Fixture',...values},materialize:false,privateParameterNames:privateNames});
 const bindings=buildAutomationParameterBindings({obligations,referencedParameterNames:resolver.referencedParameterNames});
 return {resolver,policy:createAutomationInputParameterBinding({stepId:'save',obligations,bindings,parameterValues:resolver.promptValues,privateParameterNames:resolver.privateParameterNames})};
}

test('a composite status oracle retains only its unique original expected-result reference span',()=>{
 const {resolver,policy}=fixture(),original=request(),bound=policy.canonicalize(original,{snapshot:page});
 assert.equal(bound.arguments.value,'Saved @t.item_name');assert.equal(original.arguments.value,'Saved Build Fixture');
 assert.equal(resolver.resolve(bound.name,bound.arguments).value,'Saved Build Fixture');
 assert.equal(resolver.requiresDataAccess(bound.name,bound.arguments),true);
 const source=compileRecordedProgram([bound]).source;
 assert.match(source,/"Saved " \+ String\(params\["t.item_name"\]\)/);assert.doesNotMatch(source,/Build Fixture/);
 assert.deepEqual(deriveProgramTools({payload:{steps:[{step_id:'save',automation_code:source}]},execution:{required:true,step_id:'save'}}),[bound]);
 const prepared=prepareVerificationSections([{id:'save',step_type:'web',automation_code:source}],resolver);
 assert.equal(prepared.parameters['t.item_name'],'Build Fixture');assert.equal(prepared.parameters['t.unrelated'],undefined);
});

test('only original expected text authorizes templates; literal, ambiguous, private and unobserved matches remain exact',()=>{
 for(const expected of ['The status message displays Saved Build Fixture.','Saved @t.item_name and Saved @t.other.','Saved @t.item_name and Saved Build Fixture.','The page is saved.']){
  const {policy}=fixture({expected,values:{'t.item_name':'Build Fixture','t.other':'Build Fixture'}}),operation=request();
  assert.equal(policy.canonicalize(operation,{snapshot:page}),operation);
 }
 for(const state of [fixture({privateNames:['t.item_name']}),fixture()]){
  const operation=request();assert.equal(state.policy.canonicalize(operation,{snapshot:null}),operation);
 }
 const partial=request('Saved Build');assert.equal(fixture().policy.canonicalize(partial,{snapshot:page}),partial,'a partial frozen value cannot become a reference');
});

test('composite text contracts roundtrip every supported matcher without rescanning inserted values',()=>{
 for(const assertion of ['text','text_contains','text_content','text_content_contains','title','title_normalized']){
  const state=fixture({expected:'The message is Saved @t.[item.name] in @s.region.',values:{'t.item.name':'literal @t.other','t.other':'WRONG','s.region':'West'}});
  const operation=request('Saved literal @t.other in West',assertion);if(assertion.startsWith('title'))delete operation.arguments.locator;
  const bound=state.policy.canonicalize(operation,{snapshot:page});assert.equal(bound.arguments.value,'Saved @t.[item.name] in @s.region');
  assert.equal(state.resolver.resolve(bound.name,bound.arguments).value,'Saved literal @t.other in West');
  const source=compileRecordedProgram([bound]).source;
  assert.deepEqual(deriveProgramTools({payload:{steps:[{step_id:'save',automation_code:source}]},execution:{required:true,step_id:'save'}}),[bound],assertion);
  const prepared=prepareVerificationSections([{id:'save',step_type:'web',automation_code:source}],state.resolver);
  assert.deepEqual({...prepared.parameters},{'t.item.name':'literal @t.other','s.region':'West'});
 }
});

test('missing or invalid composite references fail before browser interaction and parser rejects executable substitutions',()=>{
 const {resolver}=fixture();
 assert.throws(()=>resolver.resolve('browser_assert',request('Saved @t.missing').arguments),{code:'AUTOMATION_PARAMETER_MISSING'});
 assert.throws(()=>resolver.resolve('browser_assert',request('Saved @t.').arguments),{code:'AUTOMATION_PARAMETER_INVALID'});
 assert.throws(()=>resolver.resolve('browser_assert',request('Saved @t.item_name in @s.').arguments),{code:'AUTOMATION_PARAMETER_INVALID'});
 assert.equal(compileRecordedProgram([request('Saved @t.item_name in @s.')]),null);
 const source=compileRecordedProgram([request('Saved @t.item_name')]).source;
 for(const changed of [source.replace('String(params["t.item_name"])','String(process.env.SECRET)'),source.replace('String(params["t.item_name"])','String(params[dynamicKey])'),source.replace('.trim()', '.trim().toUpperCase()')]){
  assert.equal(deriveProgramTools({payload:{steps:[{step_id:'save',automation_code:changed}]},execution:{required:true,step_id:'save'}}),null);
 }
});
