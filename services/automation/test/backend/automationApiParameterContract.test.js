const test=require('node:test');
const assert=require('node:assert/strict');
const {assertApiParameterBindings,apiParameterBindingContext}=require('../../backend/lib/automationApiParameterContract');
const values={'t.base_url':'https://api.fixture','t.item_name':'Build-time mutable name','r.token':'private fixture token'};
const source={step_order:1,action:'POST @t.base_url/items with @t.item_name',expected_result:'JSON name equals @t.item_name; generated capture @r.future_id is available',api_request:{url:'@t.base_url/items',body:'{"name":"@t.item_name"}',headers:[{key:'Authorization',value:'Bearer @r.token'}]}};
const request=()=>({url:'@t.base_url/items',body:'{"name":"@t.item_name"}',auth:{type:'bearer',credential_reference:'@r.token'},validations:[{kind:'json_path',target:'$.name',expected:'@t.item_name'}]});

test('binding provenance keeps original action/result roles without exposing concrete current values',()=>{
 const context=apiParameterBindingContext(source,values);
 assert.deepEqual(context.action,['@t.base_url','@t.item_name']);assert.deepEqual(context.expected_result,['@t.item_name']);
 assert.deepEqual(context.api_request.url,['@t.base_url']);assert.deepEqual(context.api_request.body,['@t.item_name']);
 assert.doesNotMatch(JSON.stringify(context),/Build-time mutable name|private fixture token|future_id/);
});
test('API expected-result references must survive as assertions even when the request body still binds the same input',()=>{
 const generated=request();generated.validations[0].expected=values['t.item_name'];
 assert.throws(()=>assertApiParameterBindings(source,generated,values),error=>{
   assert.equal(error.code,'AUTOMATION_API_PARAMETER_BINDING_DROPPED');assert.match(error.message,/@t.item_name in expected-result assertions/);assert.ok(!error.message.includes(values['t.item_name']));return true;
 });
 assert.doesNotThrow(()=>assertApiParameterBindings(source,request(),values));
});
test('native URL/body/auth input roles cannot be replaced by literals or moved only into an assertion',()=>{
 for(const field of ['url','body','auth']){
   const generated=request();generated[field]=field==='url'?values['t.base_url']+'/items':field==='body'?'filled literal':{type:'bearer',credential_reference:'literal'};
   assert.throws(()=>assertApiParameterBindings(source,generated,values),{code:'AUTOMATION_API_PARAMETER_BINDING_DROPPED'});
 }
 assert.doesNotThrow(()=>assertApiParameterBindings({...source,expected_result:'JSON id exists; capture @r.new_id'},request(),values),'Deferred response captures are outputs rather than supplied input bindings.');
});
