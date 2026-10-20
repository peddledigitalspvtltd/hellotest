const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const pure=require('../../../platform/backend/src/utils/linkedManualParameters');
const {createBrowserParameterResolver,referenceKey}=require('../../backend/lib/automationBrowserParameters');
const target={id:'automation',automated:'yes',app_type_id:'app',display_id:'AT_24',parameter_values:{'@T.Email':'automation@example.test','t.optional':''}};
const sources=[{manual_test_case_id:'secondary',display_id:'TC_2',parameter_values:{email:'secondary@example.test','t.password':'secondary-secret',blank:'filled'}},{manual_test_case_id:'primary',display_id:'TC_1',is_primary:true,parameter_values:{'t.email':'primary@example.test','t.password':'primary-secret',blank:'','t.id':'{{randomString:10}}','s.region':'suite-region'}}];
test('chosen manual override intent survives inheritance, including blanks, without copying target-owned inputs or promoting another source',()=>{
 const input={id:'automation',automated:'yes',parameter_values:{},test_data_options:{override_shared_sections:false}};
 const linked=[{manual_test_case_id:'primary',is_primary:true,parameter_values:{'r.email':'','t.opaque':'private-manual'},test_data_options:{parameter_overrides:['r.email'],private_parameter_names:['t.opaque']}},{manual_test_case_id:'secondary',parameter_values:{'r.email':'secondary@example.test','s.region':'West'},test_data_options:{parameter_overrides:['r.email','s.region']}}];
 const before=structuredClone({input,linked}),resolved=pure.resolveLinkedManualParameters(input,linked);
 assert.equal(resolved.effective_parameter_values['r.email'],'');
 assert.deepEqual(resolved.inherited_parameter_overrides,['r.email','s.region']);
 assert.deepEqual(resolved.effective_parameter_overrides,['r.email','s.region']);
 assert.equal(resolved.parameter_sources['r.email'].test_case_id,'primary');
 const options=pure.effectiveLinkedDataOptions(input,resolved);
 assert.deepEqual(options.parameter_overrides,['r.email','s.region']);assert.deepEqual(options.private_parameter_names,['t.opaque']);assert.equal(options.override_shared_steps,false);
 const browser=createBrowserParameterResolver({caseValues:resolved.effective_parameter_values,privateParameterNames:resolved.private_parameter_names,caseOptions:options,dataSet:{mode:'table',rows:[{'r.email':'dataset@example.test','s.region':'dataset-region'}]},defaultMissingInputs:true,steps:[{action:'Enter @r.email',expected_result:'@t.opaque accepted'}]});
 assert.equal(browser.resolve('browser_fill',{value:'@r.email'}).value,'');
 assert.equal(browser.resolve('browser_fill',{value:'@s.region'}).value,'West');
 assert.equal(browser.publicParameterValues['t.opaque'],undefined);
 const own=pure.resolveLinkedManualParameters({...input,parameter_values:{'r.email':'unreviewed-own'}},linked);
 assert.deepEqual(own.inherited_parameter_overrides,['s.region']);
 assert.equal(pure.effectiveLinkedDataOptions({...input,parameter_values:{'r.email':'unreviewed-own'}},own).parameter_overrides.includes('r.email'),false);
 const changed=pure.resolveLinkedManualParameters(input,linked.map(row=>row.is_primary?{...row,test_data_options:{...row.test_data_options,parameter_overrides:[]}}:row));
 assert.notEqual(changed.source_key,resolved.source_key,'priority-only edits invalidate immutable build inputs');
 assert.doesNotMatch(JSON.stringify({sources:resolved.parameter_sources,overrides:resolved.effective_parameter_overrides,options}),/private-manual|dataset@example/,'priority and provenance carry names only');
 assert.deepEqual({input,linked},before);
});
test('linked manual defaults stay live; explicit automation blanks and values win with value-free provenance',()=>{
 const before=JSON.stringify({target,sources}),resolved=pure.resolveLinkedManualParameters(target,sources);
 assert.equal(resolved.effective_parameter_values['t.email'],'automation@example.test');assert.equal(resolved.effective_parameter_values['t.password'],'primary-secret');assert.equal(resolved.effective_parameter_values['t.optional'],'');assert.equal(resolved.effective_parameter_values['t.blank'],'filled');assert.equal(resolved.effective_parameter_values['s.region'],'suite-region');
 assert.deepEqual(resolved.parameter_sources['t.password'],{kind:'linked_manual',test_case_id:'primary',display_id:'TC_1'});assert.equal(resolved.parameter_sources['t.email'].kind,'automation');assert.deepEqual(resolved.parameter_conflicts,[{name:'t.password',chosen_test_case_id:'primary',other_test_case_ids:['secondary']}]);assert.doesNotMatch(JSON.stringify(resolved.parameter_sources),/primary-secret|secondary-secret/);
 const updated=pure.resolveLinkedManualParameters(target,sources.map(row=>row.is_primary?{...row,parameter_values:{...row.parameter_values,'t.password':'edited-secret'}}:row));assert.equal(updated.effective_parameter_values['t.password'],'edited-secret');assert.notEqual(updated.source_key,resolved.source_key);assert.equal(resolved.effective_parameter_values['t.password'],'primary-secret','earlier snapshots remain immutable');assert.equal(JSON.stringify({target,sources}),before);
 assert.equal(pure.resolveLinkedManualParameters(target,[]).effective_parameter_values['t.password'],undefined,'unlinking removes live defaults');assert.equal(pure.parameterProjection(resolved).source_key,undefined);
});
test('chosen linked private-name flags survive own overrides and bind source freshness without classifying ignored source values',()=>{
 const linked=[{manual_test_case_id:'primary',is_primary:true,parameter_values:{'r.mode':'private-mode','r.other':'Public default'},test_data_options:{private_parameter_names:['r.mode']}},{manual_test_case_id:'secondary',parameter_values:{'r.mode':'other-private','r.other':'Ignored private'},test_data_options:{private_parameter_names:['r.other']}}];
 const target={id:'automation',automated:'yes',parameter_values:{'r.mode':'own-private-edit'}};
 const result=pure.resolveLinkedManualParameters(target,linked);
 assert.deepEqual(result.private_parameter_names,['r.mode']);assert.deepEqual(pure.parameterProjection(result).effective_private_parameter_names,['r.mode']);
 assert.equal(result.effective_parameter_values['r.mode'],'own-private-edit');assert.equal(result.effective_parameter_values['r.other'],'Public default');
 const changed=pure.resolveLinkedManualParameters(target,linked.map(row=>row.is_primary?{...row,test_data_options:{}}:row));assert.notEqual(changed.source_key,result.source_key);
 const resolver=createBrowserParameterResolver({caseValues:result.effective_parameter_values,privateParameterNames:result.private_parameter_names});
 assert.equal(resolver.publicParameterValues['r.mode'],undefined);assert.equal(resolver.publicParameterValues['r.other'],'Public default');assert.equal(resolver.resolve('browser_fill',{value:'@r.mode'}).value,'own-private-edit');
});
test('default loader pins manual and automation identity, same application and project; no source reads for manual cases',async()=>{
 const queries=[],module={exports:{}};
 new Function('require','module',fs.readFileSync(require.resolve('../../../testing/backend/services/linkedManualParameters.service'),'utf8'))(id=>id.endsWith('/db')?{prepare:sql=>({all:async(...args)=>{queries.push({sql,args});return sources.map(row=>({...row,automation_test_case_id:'automation'}));}})}:pure,module);
 const result=await module.exports.resolveForCases([target],{projectId:'project',lock:true});assert.equal(result.get('automation').effective_parameter_values['t.password'],'primary-secret');assert.deepEqual(queries[0].args,[['automation'],'project','project']);assert.match(queries[0].sql,/source\.test_data_options/);assert.match(queries[0].sql,/source\.app_type_id=target\.app_type_id/);assert.match(queries[0].sql,/source\.automated,'no'\)='no'/);assert.match(queries[0].sql,/target\.automated='yes'/);assert.match(queries[0].sql,/app\.project_id=\?/);assert.match(queries[0].sql,/FOR SHARE OF target,source,link,app/);
 await module.exports.resolveForCases([{id:'manual',automated:'no'}]);assert.equal(queries.length,1);
});
test('AI context uses inherited defaults but masks secrets and never queries them without data/case access',async()=>{
 let allowed=true,caseAccess=true,reads=0;const module={exports:{}};
 new Function('require','module',fs.readFileSync(require.resolve('../../backend/lib/automationBuildContext'),'utf8'))(id=>id.endsWith('/db')?{}:id.endsWith('optionalEvidenceAccess.service')?{getOptionalEvidenceAccess:async()=>({'data.view':allowed,'testcase.view':caseAccess})}:id.endsWith('linkedManualParameters.service')?{resolveForCase:async()=>{reads++;return pure.resolveLinkedManualParameters(target,sources);}}:pure,module);
 const input={testCase:target,projectId:'project',userId:'author'};
 const value=await module.exports.loadAutomationParameterContext(input);assert.equal(value.parameter_values['t.email'],'automation@example.test');assert.equal(value.parameter_values['t.password'],'[private parameter reference]');assert.equal(value.runtime_parameter_values['t.password'],'primary-secret');assert.doesNotMatch(JSON.stringify(value.parameter_values),/primary-secret/);
 allowed=false;assert.deepEqual((await module.exports.loadAutomationParameterContext(input)).parameter_values,{});assert.equal(reads,1);allowed=true;caseAccess=false;assert.equal((await module.exports.loadAutomationParameterContext(input)).parameter_values['t.password'],undefined);assert.equal(reads,1);
});
test('browser inputs resolve exact authorized references once, preserve scope/data rules, and redact tool responses/errors',()=>{
 const defaults=pure.resolveLinkedManualParameters(target,sources).effective_parameter_values;
 const resolver=createBrowserParameterResolver({caseValues:defaults,environment:{variables:[{key:'r.origin',value:'https://app.test'}]},dataSet:{mode:'table',rows:[{'t.dataset':'row-data'}]}});
 assert.equal(referenceKey("params['t.password']"),'t.password');assert.equal(referenceKey('@t.[User name]'),'t.user name');assert.equal(referenceKey("params['t.password']; fetch('https://evil.test')"),null);
 const first=resolver.resolve('browser_fill',{locator:'#password',value:'@t.password'});assert.equal(first.value,'primary-secret');assert.equal(resolver.resolve('browser_fill',{locator:'#email',value:'@t.email'}).value,'automation@example.test');assert.equal(resolver.resolve('browser_select_option',{locator:'#region',value:'@s.region'}).value,'suite-region');assert.equal(resolver.resolve('browser_fill',{value:'@t.dataset'}).value,'row-data');assert.equal(resolver.resolve('browser_fill',{value:'@t.optional'}).value,'');
 const generated=resolver.resolve('browser_fill',{value:'@t.id'}).value;assert.equal(generated.length,10);assert.equal(resolver.resolve('browser_fill',{value:'@t.id'}).value,generated);assert.notEqual(generated,'{{randomString:10}}');
 const result=resolver.redactResult({content:[{type:'text',text:JSON.stringify({message:'Failed primary-secret',url:'https://app.test/?password=primary-secret',echo:encodeURIComponent('automation@example.test')})}]});assert.doesNotMatch(JSON.stringify(result),/primary-secret|automation%40example/);assert.doesNotMatch(resolver.redactError(new Error('Failed primary-secret')).message,/primary-secret/);
 assert.throws(()=>resolver.resolve('browser_fill',{value:'@t.missing'}),error=>error.code==='AUTOMATION_PARAMETER_MISSING');assert.equal(resolver.resolve('browser_fill',{value:'literal text'}).value,'literal text');
 const short=createBrowserParameterResolver({caseValues:{'t.otp':'1','t.api_key':'no'}});short.resolve('browser_fill',{value:'@t.otp'});short.resolve('browser_fill',{value:'@t.api_key'});const fault=JSON.parse(short.redactResult({isError:true,content:[{type:'text',text:JSON.stringify({code:'BROWSER_ACTION_OUTCOME_UNKNOWN',message:'OTP 1 and key no failed',action_outcome:'unknown',retry_safe:false})}]}).content[0].text);assert.equal(fault.action_outcome,'unknown','redaction preserves trusted protocol enums');assert.equal(fault.retry_safe,false);assert.doesNotMatch(fault.message,/OTP 1|key no/);assert.match(fault.message,/private parameter value/);
});
test('parameter availability reflects authorized effective layers and does not expose bound values',()=>{
 const defaults=pure.resolveLinkedManualParameters({...target,parameter_values:{'t.password':'','t.own':'automation-value'}},sources).effective_parameter_values;
 const resolver=createBrowserParameterResolver({caseValues:defaults,environment:{variables:[{key:'r.mailbox_token',value:'private-mailbox-value',is_secret:true}]},configuration:{variables:[{key:'r.region',value:'configured-region'}]},dataSet:{mode:'key_value',rows:[{key:'t.dataset_secret',value:'private-data-value',is_secret:true}]}});
 assert.ok(resolver.availableParameterNames.includes('t.email'),'linked manual defaults are available');
 assert.ok(resolver.availableParameterNames.includes('r.mailbox_token'),'authorized stored environment secrets are bound privately');
 assert.ok(resolver.availableParameterNames.includes('t.dataset_secret'),'authorized stored dataset secrets are bound privately');
 assert.ok(resolver.availableParameterNames.includes('r.region'));
 assert.ok(resolver.availableParameterNames.includes('t.password'),'an explicit blank remains a supplied binding');
 assert.equal(resolver.resolve('browser_fill',{value:'@t.password'}).value,'','blank does not expose the filled manual fallback');
 assert.doesNotMatch(JSON.stringify(resolver.availableParameterNames),/primary-secret|private-mailbox-value|private-data-value|automation-value/);
});

test('legacy unscoped references prefer run bindings then inherited case inputs while explicit scopes remain exact',async()=>{
 assert.equal(referenceKey('@name'),'r.name');assert.equal(referenceKey('@[Display name]'),'r.display name');
 assert.equal(referenceKey('@t.name'),'t.name');assert.equal(referenceKey('@s.name'),'s.name');
 const resolver=createBrowserParameterResolver({caseValues:{'r.name':'Configured Reader','r.display name':'Configured Display','t.name':'Different case value'}});
 assert.equal(resolver.resolve('browser_fill',{value:'@name'}).value,'Configured Reader');
 assert.equal(resolver.resolve('browser_fill',{value:'@[Display name]'}).value,'Configured Display');
 assert.equal(resolver.projectText('Enter @name'),'Enter Configured Reader');
 assert.equal(resolver.requiresDataAccess('browser_fill',{value:'@name'}),true);
 assert.throws(()=>resolver.resolve('browser_fill',{value:'@unfilled'}),error=>error.code==='AUTOMATION_PARAMETER_MISSING'&&error.parameter_reference==='r.unfilled');
 const wrongScope=createBrowserParameterResolver({caseValues:{'t.name':'Only case value'}});
 assert.equal(wrongScope.resolve('browser_fill',{value:'@name'}).value,'Only case value');
 assert.equal(wrongScope.canonicalArguments('browser_fill',{value:'@name'}).value,'@t.name');
 assert.throws(()=>wrongScope.resolve('browser_fill',{value:'@r.name'}),error=>error.code==='AUTOMATION_PARAMETER_MISSING','Explicit run references never take another scope.');
 for(const value of ['person@example.test','Say hello to @name','@name and more','literal text','https://example.test/@name','@example.test']){
  assert.equal(referenceKey(value),null);assert.equal(resolver.resolve('browser_fill',{value}).value,value);
 }
 let sent=0;
 const browser={tools:[{name:'browser_fill'}],call:async(name,args)=>{const actual=resolver.resolve(name,args);sent++;assert.notEqual(actual.value,'@name');return{content:[{type:'text',text:JSON.stringify({source:'playwright',action_outcome:'completed'})}]};}};
 const {runAutomationBrowserAgent}=require('../../backend/lib/automationBrowserAgent');let turn=0;
 await runAutomationBrowserAgent({browser,prompt:'Fill configured input',parse:JSON.parse,complete:async()=>JSON.stringify(++turn===1?{tool_calls:[{name:'browser_fill',arguments:{locator:'#name',value:'@name'}}]}:{steps:[]})});
 assert.equal(sent,1);
 await assert.rejects(runAutomationBrowserAgent({browser,prompt:'Fill unavailable input',parse:JSON.parse,complete:async()=>'{"tool_calls":[{"name":"browser_fill","arguments":{"locator":"#name","value":"@unfilled"}}]}'}),error=>error.code==='AUTOMATION_PARAMETER_MISSING');
 assert.equal(sent,1,'Missing unscoped input stops before dispatch instead of typing the placeholder.');
});
test('new direct and suite execution snapshots freeze inherited parameters and later manual changes cannot alter that run',async()=>{
 let manual='first-secret';const caseRow={test_case_id:'automation',automated:'yes',test_case_title:'Automation',parameter_values:{'t.email':'override@example.test'},app_type_id:'app'};
 const resolver={resolveForCases:async rows=>new Map(rows.map(row=>[row.test_case_id,pure.resolveLinkedManualParameters({...row,id:row.test_case_id},[{manual_test_case_id:'manual',parameter_values:{'t.password':manual,'r.email':''},test_data_options:{parameter_overrides:['r.email']}}])]))};
 const database={prepare:sql=>({all:async()=>sql.includes('FROM suite_test_cases')?[caseRow]:[],get:async()=>null})};
 const actual=id=>require(id),module={exports:{}};
 new Function('require','module','exports',fs.readFileSync(require.resolve('../../../testing/backend/services/execution.service'),'utf8')+'\nmodule.exports={buildSnapshotPayload};')(id=>{
  if(id.endsWith('/db'))return database;if(id==='crypto')return require('node:crypto');if(id==='./linkedManualParameters.service')return resolver;if(id==='./caseExecutionHooks.service')return {snapshotCaseExecutionHooks:async()=>[]};if(id==='./effectiveCaseDataSets.service')return{loadEffectiveCaseDataSets:async()=>[]};if(id==='./suiteExecutionContext.service')return {loadSuiteContexts:async()=>new Map()};if(id==='./executionSnapshot.repository')return {loadSteps:async()=>new Map([['automation',[{id:'step',step_order:1,action:'Use @t.password',expected_result:'Ready',step_type:'web',automation_code:'await page.locator("#password").fill("@t.password");'}]]])};
  if(id.startsWith('@hellotest/platform/backend/src/utils/'))return actual(id);return {};
 },module,module.exports);
 const direct=await module.exports.buildSnapshotPayload('direct',[],{directCases:[caseRow],persisted:true});const suite=await module.exports.buildSnapshotPayload('suite',[{suite_id:'suite',suite_name:'Suite'}]);assert.equal(direct.caseSnapshots[0].parameter_values['t.password'],'first-secret');assert.equal(suite.caseSnapshots[0].parameter_values['t.password'],'first-secret');assert.equal(direct.caseSnapshots[0].parameter_values['t.email'],'override@example.test');assert.deepEqual(direct.caseSnapshots[0].test_data_options.parameter_overrides,['r.email']);assert.deepEqual(suite.caseSnapshots[0].test_data_options.parameter_overrides,['r.email']);assert.equal(direct.caseSnapshots[0].parameter_values['r.email'],'');manual='later-secret';const later=await module.exports.buildSnapshotPayload('later',[],{directCases:[caseRow]});assert.equal(later.caseSnapshots[0].parameter_values['t.password'],'later-secret');assert.equal(direct.caseSnapshots[0].parameter_values['t.password'],'first-secret');
});
test('selected runtime data is not read without current data/resource access, and a missing parameter never reaches MCP',async()=>{
 let dataAllowed=false,environmentAllowed=true,reads=0;const module={exports:{}},local=require('node:module').createRequire(require.resolve('../../backend/lib/automationBrowserParameters'));
 new Function('require','module',fs.readFileSync(require.resolve('../../backend/lib/automationBrowserParameters'),'utf8'))(id=>id.endsWith('/db')?{prepare:sql=>({all:async()=>[],get:async(...args)=>{if(sql.includes('FROM test_case_data_sets mapping'))return null;reads++;assert.match(sql,/project_id=\?/);assert.deepEqual(args,['environment','project','app']);return {variables:[{key:'r.secret',value:'private-runtime',is_secret:true}]};}})}:id.endsWith('optionalEvidenceAccess.service')?{getOptionalEvidenceAccess:async()=>({'data.view':dataAllowed,'environment.view':environmentAllowed})}:local(id),module);
 const input={testCase:target,projectId:'project',userId:'author',caseValues:{'t.email':'known'},test_environment_id:'environment'};
 let resolver=await module.exports.loadBrowserParameterResolver(input);assert.equal(reads,0);assert.throws(()=>resolver.resolve('browser_fill',{value:'@t.email'}),error=>error.code==='AUTOMATION_PARAMETER_MISSING');dataAllowed=true;environmentAllowed=false;await assert.rejects(module.exports.loadBrowserParameterResolver(input),error=>error.statusCode===403);assert.equal(reads,0);environmentAllowed=true;resolver=await module.exports.loadBrowserParameterResolver(input);assert.equal(resolver.resolve('browser_fill',{value:'@r.secret'}).value,'private-runtime');assert.equal(reads,1);
 const {runAutomationBrowserAgent}=require('../../backend/lib/automationBrowserAgent');let sent=0;
 const browser={tools:[{name:'browser_fill'}],call:async(name,args)=>{const resolved=resolver.resolve(name,args);sent++;return resolver.redactResult({content:[{type:'text',text:JSON.stringify({data:resolved.value})}]});}};let turns=0;
 await runAutomationBrowserAgent({browser,prompt:'Fill configured value',parse:JSON.parse,complete:async prompt=>{if(++turns===1)return '{"tool_calls":[{"name":"browser_fill","arguments":{"locator":"#secret","value":"@r.secret"}}]}';assert.doesNotMatch(prompt,/private-runtime/);assert.match(prompt,/private parameter value/);return '{"steps":[]}';}});assert.equal(sent,1);
 await assert.rejects(runAutomationBrowserAgent({browser,prompt:'Missing configured value',parse:JSON.parse,complete:async()=>'{"tool_calls":[{"name":"browser_fill","arguments":{"locator":"#secret","value":"@t.absent"}}]}'}),error=>error.code==='AUTOMATION_PARAMETER_MISSING');assert.equal(sent,1,'missing parameters stop before any MCP request');
});
