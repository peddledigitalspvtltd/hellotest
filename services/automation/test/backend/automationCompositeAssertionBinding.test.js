const test=require('node:test');
const assert=require('node:assert/strict');
const {createBrowserParameterResolver}=require('../../backend/lib/automationBrowserParameters');
const {compileRecordedProgram}=require('../../backend/lib/automationRecordedProgram');
const {deriveProgramTools}=require('../../backend/lib/automationProgramTools');
const {prepareVerificationSections}=require('../../backend/lib/automationVerificationSections');
const request=(value='Saved @t.item_name',assertion='text')=>({name:'browser_assert',arguments:{assertion,locator:'#status',value}});
const resolverFor=(values={})=>createBrowserParameterResolver({caseValues:{'t.item_name':'Build Fixture',...values},materialize:false});

test('a recorded composite status oracle retains its scoped reference through compilation and verification',()=>{
 const resolver=resolverFor({'t.unrelated':'Build Fixture'}),bound=request();
 assert.equal(resolver.resolve(bound.name,bound.arguments).value,'Saved Build Fixture');
 assert.equal(resolver.requiresDataAccess(bound.name,bound.arguments),true);
 const source=compileRecordedProgram([bound]).source;
 assert.match(source,/"Saved " \+ String\(params\["t.item_name"\]\)/);assert.doesNotMatch(source,/Build Fixture/);
 assert.deepEqual(deriveProgramTools({payload:{steps:[{step_id:'save',automation_code:source}]},execution:{required:true,step_id:'save'}}),[bound]);
 const prepared=prepareVerificationSections([{id:'save',step_type:'web',automation_code:source}],resolver);
 assert.equal(prepared.parameters['t.item_name'],'Build Fixture');assert.equal(prepared.parameters['t.unrelated'],undefined);
});

test('composite text contracts roundtrip every supported matcher without rescanning inserted values',()=>{
 for(const assertion of ['text','text_contains','text_content','text_content_contains','title','title_normalized']){
  const resolver=resolverFor({'t.item.name':'literal @t.other','t.other':'WRONG','s.region':'West'});
  const bound=request('Saved @t.[item.name] in @s.region',assertion);if(assertion.startsWith('title'))delete bound.arguments.locator;
  assert.equal(resolver.resolve(bound.name,bound.arguments).value,'Saved literal @t.other in West');
  const source=compileRecordedProgram([bound]).source;
  assert.deepEqual(deriveProgramTools({payload:{steps:[{step_id:'save',automation_code:source}]},execution:{required:true,step_id:'save'}}),[bound],assertion);
  const prepared=prepareVerificationSections([{id:'save',step_type:'web',automation_code:source}],resolver);
  assert.deepEqual({...prepared.parameters},{'t.item.name':'literal @t.other','s.region':'West'});
 }
});

test('missing or invalid composite references fail before browser interaction and parser rejects executable substitutions',()=>{
 const resolver=resolverFor();
 assert.throws(()=>resolver.resolve('browser_assert',request('Saved @t.missing').arguments),{code:'AUTOMATION_PARAMETER_MISSING'});
 assert.throws(()=>resolver.resolve('browser_assert',request('Saved @t.').arguments),{code:'AUTOMATION_PARAMETER_INVALID'});
 assert.throws(()=>resolver.resolve('browser_assert',request('Saved @t.item_name in @s.').arguments),{code:'AUTOMATION_PARAMETER_INVALID'});
 assert.equal(compileRecordedProgram([request('Saved @t.item_name in @s.')]),null);
 const source=compileRecordedProgram([request('Saved @t.item_name')]).source;
 for(const changed of [source.replace('String(params["t.item_name"])','String(process.env.SECRET)'),source.replace('String(params["t.item_name"])','String(params[dynamicKey])'),source.replace('.trim()', '.trim().toUpperCase()')]){
  assert.equal(deriveProgramTools({payload:{steps:[{step_id:'save',automation_code:changed}]},execution:{required:true,step_id:'save'}}),null);
 }
});
