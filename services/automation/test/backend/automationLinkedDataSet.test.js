const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
function fixture({own=false,manual=true,dataAllowed=true,caseAllowed=true,foreign=false}={}){
 const reads=[],module={exports:{}},local=require('node:module').createRequire(require.resolve('../../backend/lib/automationBrowserParameters'));
 const dataset=id=>({id,name:id,mode:'key_value',rows:[{key:'t.email',value:'{{yopmail:linked}}'},{key:'t.name',value:'Linked Reader'},{key:'t.secret_alias',value:'protected-dataset-value',is_secret:true}]});
 new Function('require','module',fs.readFileSync(require.resolve('../../backend/lib/automationBrowserParameters'),'utf8'))(id=>{
  if(id.endsWith('/db'))return {prepare:sql=>({
   all:async(...args)=>{
    if(sql.includes('FROM test_suites suite JOIN app_types app')){assert.deepEqual(args,['app','project',null,'automation']);return [];}
    reads.push({sql,args});assert.match(sql,/FROM test_cases target/);const selected=own?'own':manual&&args[0]?'manual':null;
    return selected?[{...dataset(selected),id:foreign?null:selected,test_case_id:'automation',test_data_set_id:selected,mapping_source:own?'test_case':'linked_manual'}]:[];},
   get:async(...args)=>{reads.push({sql,args});assert.match(sql,/FROM test_data_sets/);assert.deepEqual(args.slice(1),['project','app']);return foreign?null:dataset(args[0]);}
  })};
  if(id.endsWith('optionalEvidenceAccess.service'))return {getOptionalEvidenceAccess:async()=>({'data.view':dataAllowed,'testcase.view':caseAllowed})};
  return local(id);
 },module);
 return {...module.exports,reads};
}
const input={testCase:{id:'automation',app_type_id:'app',automated:'yes'},projectId:'project',userId:'author',caseValues:{'t.email':'manual-default@example.test'}};
test('an existing linked automation case inherits the primary manual dataset with one frozen value and scoped reads',async()=>{
 const f=fixture(),resolver=await f.loadBrowserParameterResolver(input);
 const email=resolver.resolve('browser_fill',{value:'@t.email'}).value;
 assert.match(email,/^linked-.*@yopmail\.com$/);
 assert.equal(resolver.projectText('Enter @t.name at @t.email'),`Enter Linked Reader at ${email}`);
 assert.equal(resolver.resolve('browser_fill',{value:'@t.email'}).value,email);
 assert.equal(resolver.buildData({testCaseId:'automation'}).parameter_values['t.email'],email);
 assert.equal(resolver.publicParameterValues['t.secret_alias'],undefined);
 assert.ok(resolver.required_permissions.includes('testcase.view'));
 assert.match(f.reads[0].sql,/source\.app_type_id = target\.app_type_id/);
 assert.match(f.reads[0].sql,/link\.is_primary DESC/);
 assert.deepEqual(f.reads[0].args,[true,['automation'],'project','project','app','app']);
 assert.equal(resolver.projectBuildContext({linked_manual_cases:[]}).data_set.id,'manual');
 resolver.registerStepReferences([{action:'Enter @t.random'}]);assert.ok(resolver.availableParameterNames.includes('t.random'),'Loader must retain live getters for references added after flow planning.');
});
test('explicit and automation datasets take precedence over linked defaults',async()=>{
 const explicit=fixture({own:true}),first=await explicit.loadBrowserParameterResolver({...input,test_data_set_id:'selected'});
 assert.equal(explicit.reads.length,1);assert.equal(first.projectBuildContext({}).data_set.id,'selected');
 const own=fixture({own:true}),second=await own.loadBrowserParameterResolver(input);
 assert.equal(own.reads.length,2);assert.equal(second.projectBuildContext({}).data_set.id,'own');
 assert.equal(own.reads[0].args[0],true);assert.equal(second.required_permissions.includes('testcase.view'),false,'an own mapping does not require linked manual access');
});
test('linked data is never read without current case/data access and application scope is checked again',async()=>{
 const denied=fixture({dataAllowed:false}),resolver=await denied.loadBrowserParameterResolver(input);
 assert.equal(denied.reads.length,0);resolver.registerStepReferences([{action:'Enter @t.random'}]);assert.deepEqual(resolver.publicParameterValues,{});
 const noCase=fixture({caseAllowed:false}),limited=await noCase.loadBrowserParameterResolver(input);
 assert.equal(noCase.reads.length,1);assert.equal(limited.projectBuildContext({}).data_set,undefined);
 const foreign=fixture({foreign:true});await assert.rejects(foreign.loadBrowserParameterResolver(input),error=>error.statusCode===404);
});
test('relationship provenance does not change the source fingerprint for the same actual dataset resource',async()=>{
 const inherited=await fixture().loadBrowserParameterResolver({...input,materialize:false});
 const selected=await fixture().loadBrowserParameterResolver({...input,test_data_set_id:'manual',materialize:false});
 assert.equal(inherited.inputSourceKey,selected.inputSourceKey,'manual inheritance and an explicit mapping of the same resource share the exact source receipt');
 assert.doesNotMatch(inherited.inputSourceKey,/mapping_source|source_test_case_id|test_case_id/);
});
