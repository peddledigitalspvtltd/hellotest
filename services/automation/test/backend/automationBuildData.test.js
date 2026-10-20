const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {createBrowserParameterResolver}=require('../../backend/lib/automationBrowserParameters');

test('one build materializes linked data once for source steps, expected results, model context and browser inputs',()=>{
 const manual=[{id:'manual',title:'Register @t.email',steps:[{id:'manual-one',action:'Enter @t.email and @t.[Full name]',expected_result:'Saved @t.email'}, {id:'manual-two',action:'Check @t.email with @t.password',expected_result:'Account @t.email exists'}]}];
 const before=JSON.stringify(manual);
 const resolver=createBrowserParameterResolver({caseValues:{'t.email':'{{yopmail:signup}}','t.full name':'Alice Example','t.password':'{{randomString:18}}','t.empty':''},steps:manual.flatMap(item=>item.steps)});
 const actual=resolver.resolve('browser_fill',{value:'@t.email'}).value;
 const projected=resolver.projectManualCases(manual);
 assert.match(actual,/^signup-\d{14}-[a-z0-9]{6}@yopmail\.com$/);
 assert.equal(projected[0].title,`Register ${actual}`);
 assert.equal(projected[0].steps[0].action,`Enter ${actual} and Alice Example`);
 assert.equal(projected[0].steps[0].expected_result,`Saved ${actual}`);
 assert.equal(projected[0].steps[1].action,`Check ${actual} with @t.password`);
 assert.equal(resolver.promptValues['t.email'],actual);
 assert.equal(resolver.promptValues['t.password'],'@t.password');
 assert.equal(resolver.resolve('browser_fill',{value:'@t.email'}).value,actual);
 assert.equal(resolver.resolve('browser_fill',{value:'@t.password'}).value.length,18);
 assert.equal(resolver.projectText('Type params["t.email"] or @t.empty; literal alice@example.test'),`Type ${actual} or ; literal alice@example.test`);
 assert.equal(JSON.stringify(manual),before,'manual source templates stay reusable');
 const artifact=resolver.buildData({testCaseId:'automation',steps:manual[0].steps,manualCases:manual});
 assert.equal(artifact.manual_steps[0].manual_step_id,'manual-one');
 assert.equal(artifact.manual_steps[0].action,projected[0].steps[0].action);
 assert.equal(artifact.steps[0].action,projected[0].steps[0].action);
 assert.equal(artifact.parameter_values['t.password'],undefined);
 assert.equal(artifact.parameter_values['t.email'],actual);
 assert.equal(resolver.generatedCaseValues['t.email'],actual);
 assert.equal(resolver.generatedCaseValues['t.full name'],undefined,'static linked defaults stay live');
 assert.equal(resolver.generatedCaseValues['t.password'],undefined,'private generated values never enter raw automation defaults');
 assert.doesNotMatch(JSON.stringify(artifact),new RegExp(resolver.resolve('browser_fill',{value:'@t.password'}).value));
});

test('frozen labels honor dataset and selected runtime overrides, bracket syntax and implicit generator aliases',()=>{
 const resolver=createBrowserParameterResolver({caseValues:{'t.email':'{{yopmail}}','t.full name':'Manual Alice'},environment:{variables:[{key:'r.origin',value:'https://app.test'}]},configuration:{variables:[{key:'t.full name',value:'Configured Alice'}]},dataSet:{mode:'table',rows:[{'t.email':'dataset@example.test'}]},steps:[{id:'one',action:'Open @r.origin with @t.random and @today'}]});
 assert.equal(resolver.projectText('Use @T.[Full name] and @t.email'), 'Use Configured Alice and dataset@example.test');
 assert.equal(resolver.projectText('Use @t.missing'),'Use @t.missing');
 const generated=resolver.resolve('browser_fill',{value:'@t.random'}).value;
 assert.equal(resolver.projectText('Use @t.random twice: @t.random'),`Use ${generated} twice: ${generated}`);
 assert.equal(resolver.generatedCaseValues['t.email'],undefined,'an unused lower-layer generator does not overwrite the selected actual data');
 assert.equal(resolver.generatedCaseValues['t.random'],generated);
 assert.match(resolver.projectText('On @today'),/^On \d{4}-\d{2}-\d{2}$/);
 const context=resolver.projectBuildContext({environment:{id:'env'},configuration:{id:'config'},data_set:{id:'dataset'},linked_manual_cases:[]});
 assert.equal(context.data_set.rows[0]['t.email'],'dataset@example.test');
 assert.equal(context.parameter_data.values['t.email'],'dataset@example.test');
 assert.equal(context.configuration.variables[0].value,'Configured Alice');
 const secret=createBrowserParameterResolver({caseValues:{'t.name':'{{randomString:12}}'},dataSet:{mode:'key_value',rows:[{key:'t.hidden',value:'private-stored-data',is_secret:true}]}});
 assert.equal(secret.projectText('Use @t.hidden'),'Use @t.hidden');
 assert.equal(secret.buildData({testCaseId:'automation'}).parameter_values['t.hidden'],undefined);
});

test('shipping values materialize while a private PIN retains its trusted binding',()=>{
 const resolver=createBrowserParameterResolver({caseValues:{'t.shipping_address':'12 Example Street','t.pin':'0931'}});
 assert.equal(resolver.projectText('Deliver to @t.shipping_address using @t.pin'),'Deliver to 12 Example Street using @t.pin');
 assert.equal(resolver.promptValues['t.pin'],'@t.pin');
 assert.equal(resolver.resolve('browser_fill',{value:'@t.pin'}).value,'0931');
 assert.equal(resolver.buildData({testCaseId:'automation'}).parameter_values['t.pin'],undefined);
});

test('private model inputs use resolvable scoped references in case, environment, configuration and dataset context',()=>{
 const resolver=createBrowserParameterResolver({
  caseValues:{'t.password':'case-secret','t.repeated':'case-secret','t.api key':'key-secret'},
  environment:{variables:[{key:'environment_login',value:'environment-secret',is_secret:true}]},
  configuration:{variables:[{key:'s.access_code',value:'configuration-secret',is_secret:true}]},
  dataSet:{mode:'key_value',rows:[{key:'dataset_login',value:'dataset-secret',is_secret:true}]}
 });
 const context=resolver.projectBuildContext({environment:{id:'environment'},configuration:{id:'configuration'},data_set:{id:'dataset'}});
 assert.equal(resolver.projectCase({title:'Signup'}).parameter_values['t.password'],'@t.password');
 assert.equal(resolver.promptValues['t.repeated'],'@t.repeated','aliases of a private value remain private');
 assert.equal(resolver.promptValues['t.api key'],'@t.[api key]');
 assert.equal(context.environment.variables[0].value,'@r.environment_login');
 assert.equal(context.configuration.variables[0].value,'@s.access_code');
 assert.equal(context.data_set.rows[0]['r.dataset_login'],'@r.dataset_login');
 for(const [key,reference]of Object.entries(resolver.promptValues)){
  assert.equal(resolver.resolve('browser_fill',{value:reference}).value,({'t.password':'case-secret','t.repeated':'case-secret','t.api key':'key-secret','r.environment_login':'environment-secret','s.access_code':'configuration-secret','r.dataset_login':'dataset-secret'})[key]);
 }
 const encoded=JSON.stringify({context,artifact:resolver.buildData({testCaseId:'automation'})});
 for(const secret of ['case-secret','key-secret','environment-secret','configuration-secret','dataset-secret'])assert.ok(!encoded.includes(secret));
 assert.deepEqual(resolver.publicParameterValues,{});
 assert.deepEqual(resolver.buildData({testCaseId:'automation'}).parameter_values,{});
});

test('privacy masks are rejected as browser data before dispatch with a safe correction to exact references',()=>{
 const resolver=createBrowserParameterResolver({caseValues:{'t.password':'configured-secret-value'}});
 for(const tool of ['browser_fill','browser_select_option','browser_press_key','browser_assert'])for(const value of ['[private parameter reference]','[private parameter value]','[REDACTED]','[REDACTED_SECRET]','[REDACTED_TOKEN]']){
  const field=tool==='browser_press_key'?'key':'value';
  assert.throws(()=>resolver.resolve(tool,{[field]:value}),error=>{
   assert.equal(error.code,'AUTOMATION_PARAMETER_REFERENCE_REQUIRED');
   assert.equal(error.action_outcome,'not_attempted');assert.equal(error.retry_safe,true);
   assert.equal(error.nonRetryable,false);assert.equal(error.retryable,true);
   assert.deepEqual(error.parameter_references,['@t.password']);
   assert.doesNotMatch(error.message,/configured-secret-value/);return true;
  });
 }
 assert.equal(resolver.resolve('browser_fill',{value:resolver.promptValues['t.password']}).value,'configured-secret-value');
 assert.equal(resolver.resolve('browser_assert',{assertion:'value',value:'@t.password'}).value,'configured-secret-value');
});

test('explicitly configured literal privacy labels remain valid data and non-private cases keep ordinary literal behavior',()=>{
 const resolver=createBrowserParameterResolver({caseValues:{'t.password':'real-secret','t.mask_scenario':'[private parameter reference]','t.mask_secret':'[REDACTED_SECRET]'}});
 for(const value of ['[private parameter reference]','[REDACTED_SECRET]'])assert.equal(resolver.resolve('browser_fill',{value}).value,value);
 assert.equal(resolver.resolve('browser_fill',{value:'@t.mask_scenario'}).value,'[private parameter reference]');
 const explicitSecret=createBrowserParameterResolver({caseValues:{'t.password':'[private parameter value]'}});
 assert.equal(explicitSecret.resolve('browser_fill',{value:'[private parameter value]'}).value,'[private parameter value]');
 assert.equal(explicitSecret.resolve('browser_fill',{value:'@t.password'}).value,'[private parameter value]');
 const publicOnly=createBrowserParameterResolver({caseValues:{'t.name':'Example'}});
 assert.equal(publicOnly.resolve('browser_fill',{value:'[private parameter reference]'}).value,'[private parameter reference]');
});

test('preview projects static linked values without generating random data or revealing private literals',()=>{
 const resolver=createBrowserParameterResolver({materialize:false,caseValues:{'t.email':'{{yopmail:signup}}','t.name':'Reader','t.password':'hidden-password-value'}});
 const projected=resolver.projectManualCases([{id:'manual',steps:[{id:'m',action:'Enter @t.name with @t.email and hidden-password-value using @t.password',expected_result:'Saved @t.name'}]}]);
 assert.equal(projected[0].steps[0].action,'Enter Reader with @t.email and [private parameter value] using @t.password');
 assert.equal(projected[0].steps[0].expected_result,'Saved Reader');
 assert.deepEqual(resolver.publicParameterValues,{'t.name':'Reader'});
 assert.deepEqual(resolver.deferredParameterNames,['t.email']);
 assert.deepEqual(resolver.generatedCaseValues,{});
 resolver.registerStepReferences([{action:'Use @t.random'}]);
 assert.equal(resolver.publicParameterValues['t.random'],undefined,'Preview reads never materialize a future build generator.');
 assert.doesNotMatch(JSON.stringify(resolver.buildData({testCaseId:'automation'})),/hidden-password-value|yopmail:signup/);
});

test('newly planned references join the same frozen map without regenerating configured or existing implicit values',()=>{
 const resolver=createBrowserParameterResolver({caseValues:{'t.email':'{{yopmail:build}}'}});
 const original=resolver.resolve('browser_fill',{value:'@t.email'}).value;
 resolver.registerStepReferences([{action:'Enter @t.random and @today with @t.email'}]);
 const generated=resolver.resolve('browser_fill',{value:'@t.random'}).value;
 resolver.registerStepReferences([{action:'Enter @t.random again with @t.email'}]);
 assert.equal(resolver.resolve('browser_fill',{value:'@t.email'}).value,original);
 assert.equal(resolver.resolve('browser_fill',{value:'@t.random'}).value,generated);
 assert.equal(resolver.projectText('Enter @t.random twice: @t.random'),`Enter ${generated} twice: ${generated}`);
 assert.equal(resolver.publicParameterValues['t.random'],generated);
 assert.equal(resolver.generatedCaseValues['t.random'],generated);
 assert.ok(resolver.availableParameterNames.includes('t.random'));
 const artifact=resolver.buildData({testCaseId:'automation',steps:[{id:'new',action:'Enter @t.random with @t.email'}]});
 assert.equal(artifact.steps[0].action,`Enter ${generated} with ${original}`);
 assert.equal(artifact.parameter_values['t.random'],generated);
});

test('known private literals are removed from projected labels while numeric secrets do not damage parameter references',()=>{
 const resolver=createBrowserParameterResolver({caseValues:{'t.pin':'1','t.password':'private-supplied-value','t.public1':'Visible'}});
 const artifact=resolver.buildData({testCaseId:'automation',steps:[{id:'one',action:'Enter private-supplied-value with @t.password then @t.public1',expected_result:'Use @t.pin'}]});
 assert.equal(artifact.steps[0].action,'Enter [private parameter value] with @t.password then Visible');
 assert.equal(artifact.steps[0].expected_result,'Use @t.pin');
 assert.doesNotMatch(JSON.stringify(artifact),/private-supplied-value/);
 assert.ok(artifact.private_parameter_references.includes('t.pin'));
});

test('protected build data distinguishes referenced missing values from filled, empty and private linked inputs',()=>{
 const resolver=createBrowserParameterResolver({caseValues:{'r.name':'Filled','r.empty':'','t.password':'private-value'}});
 const input={testCaseId:'automation',steps:[{id:'one',action:'Enter @name with @r.empty',expected_result:'Saved params["t.password"]'}],
  manualCases:[{id:'manual',steps:[{id:'m1',action:'Enter @mobile and params["t.email"]',expected_result:'Account saved'}]}]};
 const before=JSON.stringify(input),artifact=resolver.buildData(input);
 assert.deepEqual(artifact.parameter_references,['r.empty','r.mobile','r.name','t.email','t.password']);
 assert.deepEqual(artifact.missing_parameter_references,['r.mobile','t.email']);
 assert.deepEqual(artifact.private_parameter_references,['t.password']);
 assert.equal(artifact.steps[0].action,'Enter Filled with ');
 assert.equal(artifact.manual_steps[0].action,'Enter @mobile and params["t.email"]');
 assert.equal(JSON.stringify(input),before);
 assert.doesNotMatch(JSON.stringify(artifact),/private-value/);
});

function snapshotFixture(){
 let access=true,revision=3;
 const updates=[],permissions=[],module={exports:{}};
 const cases={getTestCase:async()=>({id:'automation',revision}),updateTestCase:async(id,payload,options)=>{updates.push({id,payload,options});if(payload.expected_revision!==revision)throw Object.assign(new Error('Changed after generation'),{statusCode:409,code:'REVISION_CONFLICT'});revision++;}};
 new Function('require','module',fs.readFileSync(require.resolve('../../backend/lib/automationBuildDataSnapshot'),'utf8'))(id=>id.endsWith('optionalEvidenceAccess.service')?{getOptionalEvidenceAccess:async(user,project,codes)=>{assert.equal(user.id,'builder');assert.equal(project,'project');permissions.push(codes);return Object.fromEntries(codes.map(code=>[code,access]));}}:id.endsWith('testCase.service')?cases:id.endsWith('scopedTestData')?require('../../../platform/backend/src/utils/scopedTestData'):require('../../../platform/backend/src/utils/linkedManualParameters'),module);
 return {...module.exports,updates,permissions,setAccess:value=>{access=value;},advanceRevision:()=>{revision++;}};
}

test('generated public defaults save through versioned case updates, preserving explicit values and revision checks',async()=>{
 const fixture=snapshotFixture(),input={testCase:{id:'automation',parameter_values:{'t.explicit':'kept','t.email':'{{yopmail}}'}},projectId:'project',userId:'builder'};
 const snapshot=await fixture.prepareBuildDataSnapshot({...input,generatedValues:{'t.email':'frozen@example.test'}});
 assert.equal(snapshot.expected_revision,3);
 await fixture.persistBuildDataSnapshot({...input,snapshot});
 assert.deepEqual(fixture.updates[0],{id:'automation',payload:{parameter_values:{'t.explicit':'kept','t.email':'frozen@example.test'},expected_revision:3,updated_by:'builder'},options:{syncSharedGroups:false}});
 assert.deepEqual(fixture.permissions,[['testcase.update','data.view'],['testcase.update','data.view']]);
 const stale=await fixture.prepareBuildDataSnapshot({...input,generatedValues:{'t.email':'new@example.test'}});
 fixture.advanceRevision();
 await assert.rejects(fixture.persistBuildDataSnapshot({...input,snapshot:stale}),error=>error.code==='REVISION_CONFLICT');
});

test('freezing an inherited public generator preserves its chosen manual override priority for later sections and normal runs',async()=>{
 const linked=require('../../../platform/backend/src/utils/linkedManualParameters');
 const {resolveParameterLayers}=require('../../../platform/backend/src/utils/stepParameterResolution');
 const target={id:'automation',automated:'yes',parameter_values:{},test_data_options:{}};
 const sources=[{manual_test_case_id:'manual',is_primary:true,parameter_values:{'t.order_id':'{{randomString:10}}','r.reviewed_empty':'','r.opaque_input':'{{randomString:12}}'},test_data_options:{parameter_overrides:['t.order_id','r.reviewed_empty','r.opaque_input'],private_parameter_names:['r.opaque_input']}}];
 const before=structuredClone({target,sources});
 const inherited=linked.resolveLinkedManualParameters(target,sources);
 const dataSet={mode:'table',rows:[{'t.order_id':'DATASET_ORDER','r.reviewed_empty':'DATASET_EMAIL','t.unreviewed':'DATASET_OTHER','r.opaque_input':'DATASET_SECRET'}]};
 const first=createBrowserParameterResolver({caseValues:inherited.effective_parameter_values,privateParameterNames:inherited.private_parameter_names,caseOptions:linked.effectiveLinkedDataOptions(target,inherited),dataSet});
 const frozenId=first.resolve('browser_fill',{value:'@t.order_id'}).value;
 const fixture=snapshotFixture(),input={testCase:target,projectId:'project',userId:'builder'};
 const snapshot=await fixture.prepareBuildDataSnapshot({...input,generatedValues:{...first.generatedCaseValues,'t.unreviewed':'unreviewed-generated'},defaultedValues:{'r.missing':''},authoredValues:{'r.reviewed_empty':''},privateNames:first.privateParameterNames,parameterOverrides:inherited.effective_parameter_overrides});
 assert.deepEqual(snapshot.generated_priority_parameter_names,['t.order_id']);
 assert.deepEqual(snapshot.reviewed_parameter_names,['r.reviewed_empty']);
 assert.equal(Object.hasOwn(snapshot.values,'r.opaque_input'),false,'private generated values remain in the resolver rather than copied into public case defaults');
 await fixture.persistBuildDataSnapshot({...input,snapshot});
 const saved={...target,...fixture.updates[0].payload};
 assert.deepEqual(saved.test_data_options.parameter_overrides,['r.reviewed_empty','t.order_id']);
 assert.equal(saved.test_data_options.parameter_overrides.includes('r.missing'),false);
 assert.equal(saved.test_data_options.parameter_overrides.includes('t.unreviewed'),false);
 const later=linked.resolveLinkedManualParameters(saved,sources),options=linked.effectiveLinkedDataOptions(saved,later);
 const nextSection=createBrowserParameterResolver({caseValues:later.effective_parameter_values,caseOptions:options,dataSet,materialize:false});
 assert.equal(nextSection.resolve('browser_fill',{value:'@t.order_id'}).value,frozenId);
 assert.equal(nextSection.resolve('browser_fill',{value:'@r.reviewed_empty'}).value,'');
 assert.equal(nextSection.resolve('browser_fill',{value:'@t.unreviewed'}).value,'DATASET_OTHER');
 assert.ok(later.inherited_parameter_overrides.includes('r.opaque_input'),'unmaterialized private generator retains chosen-source priority');
 const privateNext=createBrowserParameterResolver({caseValues:later.effective_parameter_values,privateParameterNames:later.private_parameter_names,caseOptions:options,dataSet});
 assert.notEqual(privateNext.resolve('browser_fill',{value:'@r.opaque_input'}).value,'DATASET_SECRET');
 assert.equal(privateNext.publicParameterValues['r.opaque_input'],undefined);
 assert.equal(privateNext.generatedCaseValues['r.opaque_input'],undefined);
 const normalRun=resolveParameterLayers({caseValues:later.effective_parameter_values,dataSet:{...dataSet,parameter_data_layers:{case:{rows:dataSet.rows}},data_scope_policy:{version:2,case:options,suite:{},run:{}}}});
 assert.equal(normalRun['t.order_id'],frozenId);
 assert.equal(normalRun['r.reviewed_empty'],'');
 assert.equal(normalRun['t.unreviewed'],'DATASET_OTHER');
 assert.equal(normalRun['r.missing'],'');
 assert.deepEqual({target,sources},before);
});

test('generation data permissions are checked before generation and again before save; builds without public generators do not alter data',async()=>{
 const fixture=snapshotFixture(),input={testCase:{id:'automation'},projectId:'project',userId:'builder'};
 assert.equal(await fixture.prepareBuildDataSnapshot({...input,generatedValues:{}}),null);
 await fixture.persistBuildDataSnapshot({...input,snapshot:null});
 assert.equal(fixture.permissions.length,0);assert.equal(fixture.updates.length,0);
 fixture.setAccess(false);
 await assert.rejects(fixture.prepareBuildDataSnapshot({...input,generatedValues:{'t.email':'actual@example.test'}}),error=>error.statusCode===403);
 fixture.setAccess(true);
 const snapshot=await fixture.prepareBuildDataSnapshot({...input,generatedValues:{'t.email':'actual@example.test'}});
 fixture.setAccess(false);
 await assert.rejects(fixture.persistBuildDataSnapshot({...input,snapshot}),error=>error.statusCode===403);
 assert.equal(fixture.updates.length,0,'revoked access never writes a case');
});

test('first-source data snapshot persists reviewed blanks and authored private choices without copying hidden supplying layers',async()=>{
 const fixture=snapshotFixture(),input={testCase:{id:'automation',parameter_values:{'t.keep':'existing'},test_data_options:{override_shared_steps:false,parameter_overrides:['t.keep','r.removed']}},projectId:'project',userId:'builder'};
 const snapshot=await fixture.prepareBuildDataSnapshot({...input,generatedValues:{'t.email':'generated@example.test'},defaultedValues:{'r.missing':'','r.ignored':'not-default'},authoredValues:{'r.password':'authored-private','r.name':''}});
 assert.deepEqual(snapshot.reviewed_parameter_names,['r.password','r.name']);
 await fixture.persistBuildDataSnapshot({...input,snapshot});
 const payload=fixture.updates[0].payload;
 assert.deepEqual(payload.parameter_values,{'t.keep':'existing','t.email':'generated@example.test','r.missing':'','r.password':'authored-private','r.name':''});
 assert.deepEqual(payload.test_data_options.parameter_overrides,['r.name','r.password','t.keep']);
 assert.equal(payload.test_data_options.override_shared_steps,false);
 assert.equal(payload.test_data_options.parameter_overrides.includes('r.missing'),false,'server blank defaults do not shadow later supplying layers');
 assert.equal(payload.parameter_values['r.inherited-secret'],undefined,'unreviewed hidden source values are never supplied to persistence');
});
test('the complete reviewed priority marker budget is checked before generation instead of failing first-source persistence later',async()=>{
 const fixture=snapshotFixture(),own=Object.fromEntries(Array.from({length:256},(_,i)=>[`r.existing${i}`,'stored']));
 const input={testCase:{id:'automation',parameter_values:own,test_data_options:{parameter_overrides:Object.keys(own)}},projectId:'project',userId:'builder',authoredValues:{'r.new':'reviewed'}};
 await assert.rejects(fixture.prepareBuildDataSnapshot(input),{code:'AUTOMATION_BUILD_PARAMETERS_INVALID'});
 assert.equal(fixture.updates.length,0);
});
test('reviewed opaque private values retain name-only privacy after their original selected source is removed',async()=>{
 const fixture=snapshotFixture(),input={testCase:{id:'automation',parameter_values:{'r.previous':'prior-private'},test_data_options:{private_parameter_names:['r.previous','r.removed']}},projectId:'project',userId:'builder'};
 const snapshot=await fixture.prepareBuildDataSnapshot({...input,authoredValues:{'r.mode':'private-from-user'},defaultedValues:{'r.empty':''},privateNames:['r.mode','r.empty','r.hidden-environment-only']});
 assert.deepEqual(snapshot.private_parameter_names,['r.empty','r.mode']);
 await fixture.persistBuildDataSnapshot({...input,snapshot});
 const payload=fixture.updates[0].payload;
 assert.deepEqual(payload.test_data_options.private_parameter_names,['r.empty','r.mode','r.previous']);
 assert.doesNotMatch(JSON.stringify(payload.test_data_options),/private-from-user|prior-private|hidden-environment-only/);
 assert.equal(payload.parameter_values['r.hidden-environment-only'],undefined);
 const later=createBrowserParameterResolver({caseValues:payload.parameter_values,caseOptions:payload.test_data_options});
 assert.equal(later.resolve('browser_fill',{value:'@r.mode'}).value,'private-from-user');
 assert.equal(later.publicParameterValues['r.mode'],undefined);assert.equal(later.exportParameterValues['r.mode'],undefined);
 assert.equal(later.exportParameterValues['r.empty'],'');assert.match(later.projectText('private-from-user'),/private parameter value/);
});
