const test=require('node:test');
const assert=require('node:assert/strict');
const {createBrowserParameterResolver}=require('../../backend/lib/automationBrowserParameters');
const {compileRecordedProgram}=require('../../backend/lib/automationRecordedProgram');
const {resolveLinkedManualParameters}=require('@hellotest/platform/backend/src/utils/linkedManualParameters');
const {resolveParameterLayers}=require('@hellotest/platform/backend/src/utils/stepParameterResolution');
const {normalizeDataOptions}=require('@hellotest/platform/backend/src/utils/scopedTestData');

const step=(action,expected_result='The field contains the configured value.')=>({id:'entry',action,expected_result});

test('linked legacy input inherits the exact manual default and is compiled as a scoped reusable binding',()=>{
 const defaults=resolveLinkedManualParameters({id:'automation',parameter_values:{}},[{id:'manual',is_primary:true,parameter_values:{name:'Inherited Person'}}]);
 const source=[step('Enter @name')];
 const resolver=createBrowserParameterResolver({caseValues:defaults.effective_parameter_values,steps:source,defaultMissingInputs:true});
 assert.deepEqual(resolver.referencedParameterNames(source),['t.name']);
 assert.deepEqual(resolver.defaultedCaseValues,{});
 assert.equal(resolver.projectText('Enter @name'),'Enter Inherited Person');
 const request=resolver.canonicalArguments('browser_fill',{locator:'#name',value:'@name'});
 assert.equal(request.value,'@t.name');assert.equal(resolver.resolve('browser_fill',request).value,'Inherited Person');
 const compiled=compileRecordedProgram([{name:'browser_fill',arguments:request},{name:'browser_assert',arguments:{assertion:'value',...request}}]).source;
 assert.match(compiled,/fill\("@t\.name"\)/);assert.match(compiled,/toHaveValue\("@t\.name"\)/);
 assert.doesNotMatch(compiled,/Inherited Person|"@name"/);
});

test('preview exposes missing names while a build binds authored unset values to empty exactly once',()=>{
 const source=[step('Enter @name, @t.email and @r.password'),{id:'old',action:'Inspect the page',automation_code:'await page.fill("#old", params["r.legacy"])'}];
 const preview=createBrowserParameterResolver({steps:source,materialize:false});
 assert.deepEqual(preview.buildData({steps:source.map(({action,expected_result})=>({action,expected_result}))}).missing_parameter_references,['r.name','r.password','t.email']);
 const build=createBrowserParameterResolver({steps:source,defaultMissingInputs:true});
 assert.deepEqual(build.defaultedCaseValues,{'r.name':'','r.password':'','t.email':''});
 assert.equal(build.resolve('browser_fill',{value:'@name'}).value,'');
 assert.equal(build.resolve('browser_fill',{value:'@r.password'}).value,'');
 assert.equal(build.exportParameterValues['r.password'],'','standalone input preserves a private-name blank');
 assert.ok(build.availableParameterNames.includes('r.name'));
 assert.ok(!build.availableParameterNames.includes('r.legacy'));
 assert.ok(build.privateParameterNames.includes('r.password'));
 assert.throws(()=>build.resolve('browser_fill',{value:'@r.invented'}),{code:'AUTOMATION_PARAMETER_MISSING'});
});

test('review defers implicit generator aliases instead of turning configured generation into blank overrides',()=>{
 const source=[step('Enter @random, @t.yopmail and @r.explicit')];
 const preview=createBrowserParameterResolver({steps:source,materialize:false});
 assert.deepEqual(preview.deferredParameterNames,['r.random','t.yopmail']);
 assert.deepEqual(preview.buildData({steps:source}).missing_parameter_references,['r.explicit']);
 assert.deepEqual(preview.publicParameterValues,{});
 const build=createBrowserParameterResolver({steps:source,defaultMissingInputs:true});
 assert.equal(build.inputSourceKey,preview.inputSourceKey);
 assert.match(build.resolve('browser_fill',{value:'@random'}).value,/^[A-Za-z0-9]{3}$/);
 assert.match(build.resolve('browser_fill',{value:'@t.yopmail'}).value,/@yopmail\.com$/);
 assert.deepEqual(build.defaultedCaseValues,{'r.explicit':''});
 const selected=createBrowserParameterResolver({steps:source,materialize:false,environment:{variables:[{key:'r.random',value:'Configured alias'}]}});
 assert.equal(selected.publicParameterValues['r.random'],'Configured alias');
 assert.deepEqual(selected.deferredParameterNames,['t.yopmail']);
});

test('explicit scopes stay isolated even when a legacy alias and explicit missing run input share a name',()=>{
 const source=[step('Enter @name and @r.name')];
 const resolver=createBrowserParameterResolver({caseValues:{name:'Inherited Person'},steps:source,defaultMissingInputs:true});
 assert.equal(resolver.resolve('browser_fill',{value:'@name'}).value,'Inherited Person');
 assert.equal(resolver.resolve('browser_fill',{value:'@r.name'}).value,'');
 assert.deepEqual(resolver.referencedParameterNames(source),['r.name','t.name']);
 assert.equal(resolver.canonicalArguments('browser_fill',{value:'@name'}).value,'@t.name');
 const explicitEmpty=createBrowserParameterResolver({caseValues:{'r.name':'','t.name':'Do not borrow'}});
 assert.equal(explicitEmpty.resolve('browser_fill',{value:'@name'}).value,'');
});

test('reviewed edits and empty overrides beat selected defaults without exposing or copying inherited secrets',()=>{
 const source=[step('Enter @name and @t.password')];
 const options={caseValues:{name:'Manual Person',password:'inherited-private-value'},configuration:{id:'config',variables:[{key:'t.name',value:'Configuration Person'}]},steps:source};
 const resolver=createBrowserParameterResolver({...options,buildParameterValues:{'t.name':'Reviewed Person','t.password':''},defaultMissingInputs:true});
 assert.equal(resolver.resolve('browser_fill',{value:'@name'}).value,'Reviewed Person');
 assert.equal(resolver.resolve('browser_fill',{value:'@t.password'}).value,'');
 assert.deepEqual(resolver.reviewedCaseValues,{'t.name':'Reviewed Person','t.password':''});
 assert.doesNotMatch(JSON.stringify(resolver.buildData({steps:source})),/inherited-private-value/);
 assert.doesNotMatch(resolver.projectPrivateText('Previous input: inherited-private-value'),/inherited-private-value/,'editing a secret cannot declassify linked source prose');
 assert.deepEqual(resolver.defaultedCaseValues,{});
 assert.equal(resolver.inputSourceKey,createBrowserParameterResolver({...options,materialize:false}).inputSourceKey);
 const changed=createBrowserParameterResolver({...options,configuration:{id:'config',variables:[{key:'t.name',value:'Changed after review'}]}});
 assert.notEqual(resolver.inputSourceKey,changed.inputSourceKey);
});

test('known empty and bracketed private inputs retain exact data and parameter provenance',()=>{
 const source=[step('Enter @[Display name] and @t.[Access token]')];
 const resolver=createBrowserParameterResolver({caseValues:{'t.Display name':'Literal @r.other','t.Access token':'private-configured-token'},steps:source,defaultMissingInputs:true});
 assert.equal(resolver.canonicalArguments('browser_fill',{value:'@[Display name]'}).value,'@t.[display name]');
 assert.equal(resolver.resolve('browser_fill',{value:'@[Display name]'}).value,'Literal @r.other');
 assert.equal(resolver.projectText('Enter @[Display name]'),'Enter Literal @r.other');
 assert.deepEqual(resolver.referencedParameterNames(source),['t.access token','t.display name']);
 assert.doesNotMatch(JSON.stringify(resolver.buildData({steps:source})),/private-configured-token/);
 assert.doesNotMatch(JSON.stringify(resolver.exportParameterValues),/private-configured-token/);
});

test('manual empty defaults remain explicit while a filled linked source still wins a blank source',()=>{
 const sources=[{id:'primary',is_primary:true,parameter_values:{name:'',password:''}},{id:'secondary',parameter_values:{name:'Secondary Person'}}];
 const resolved=resolveLinkedManualParameters({id:'automation'},sources);
 assert.deepEqual(resolved.effective_parameter_values,{'t.name':'Secondary Person','t.password':''});
 assert.equal(resolved.parameter_sources['t.password'].test_case_id,'primary');
 const resolver=createBrowserParameterResolver({caseValues:resolved.effective_parameter_values,steps:[step('Use @password')],defaultMissingInputs:true});
 assert.deepEqual(resolver.defaultedCaseValues,{});
 assert.equal(resolver.resolve('browser_fill',{value:'@password'}).value,'');
 assert.equal(resolver.canonicalArguments('browser_fill',{value:'@password'}).value,'@t.password');
});

test('reviewed case input priority survives runtime sources while explicit run input, captures and shared protection stay intact',()=>{
 const common={caseValues:{'t.name':'Reviewed Person','r.empty':''},configurationVariables:[{key:'t.name',value:'Configuration Person'},{key:'r.empty',value:'configuration default'}],
  dataSet:{parameter_data_layers:{case:{rows:[{'t.name':'Dataset Person','r.empty':'dataset default'}]}}},
  dataPolicy:{version:2,case:normalizeDataOptions({parameter_overrides:['@t.name','r.empty']}),run:normalizeDataOptions({})}};
 assert.deepEqual(resolveParameterLayers(common),{'t.name':'Reviewed Person','r.empty':''});
 assert.equal(resolveParameterLayers({...common,runValues:{'t.name':'Explicit Run'}})['t.name'],'Explicit Run');
 assert.equal(resolveParameterLayers({...common,capturedValues:{'t.name':'Captured'}})['t.name'],'Captured');
 assert.equal(resolveParameterLayers({...common,isSharedStep:true,sharedValues:{'t.name':'Protected Shared'},dataPolicy:{...common.dataPolicy,case:normalizeDataOptions({parameter_overrides:['t.name'],override_shared_steps:false}),run:normalizeDataOptions({override_shared_steps:false})}})['t.name'],'Protected Shared');
 assert.deepEqual(normalizeDataOptions({parameter_overrides:['@t.Name','t.name','r.empty']}).parameter_overrides,['r.empty','t.name']);
 assert.throws(()=>normalizeDataOptions({parameter_overrides:'t.name'}),error=>error.statusCode===400);
});

test('flow-planned missing references become empty without silently generating another case',()=>{
 const resolver=createBrowserParameterResolver({defaultMissingInputs:true,steps:[]});
 resolver.registerStepReferences([step('Enter @r.additional and @t.password')]);
 assert.equal(resolver.resolve('browser_fill',{value:'@r.additional'}).value,'');
 assert.equal(resolver.resolve('browser_fill',{value:'@t.password'}).value,'');
 assert.deepEqual(resolver.defaultedCaseValues,{'r.additional':'','t.password':''});
 assert.deepEqual(resolver.buildData({steps:[]}).missing_parameter_references,[]);
});

test('standalone source never retains an ambiguous unscoped whole-value reference',()=>{
 const compiled=compileRecordedProgram([{name:'browser_fill',arguments:{locator:'#name',value:'@[Display name]'}},{name:'browser_assert',arguments:{assertion:'value',locator:'#name',value:'@name'}}]).source;
 assert.match(compiled,/fill\("@r\.\[display name\]"\)/);assert.match(compiled,/toHaveValue\("@r\.name"\)/);
});
