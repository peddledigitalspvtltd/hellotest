const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {createRequire}=require('node:module');
const {createBrowserParameterResolver}=require('../../backend/lib/automationBrowserParameters');
const {runUpstreamBrowserReview}=require('../../backend/lib/automationUpstreamEngineer');
const utils=require('../../../platform/backend/src/utils/testStepAutomation');
const tools=[
 {name:'browser_navigate',inputSchema:{type:'object',properties:{url:{type:'string'}},required:['url']}},
 {name:'browser_snapshot',inputSchema:{type:'object',properties:{},additionalProperties:false}},
 {name:'browser_type',inputSchema:{type:'object',properties:{ref:{type:'string'},text:{type:'string'}},required:['ref','text'],additionalProperties:false}},
 {name:'browser_verify_value',inputSchema:{type:'object',properties:{type:{enum:['textbox','checkbox','radio','combobox','slider']},element:{type:'string'},target:{type:'string'},value:{type:'string'}},required:['type','element','target','value'],additionalProperties:false}}
];
function fixture({password='PRIVATE-native-password'}={}){
 const file=require.resolve('../../backend/services/aiAutomationBuilder.service'),local=createRequire(file),source=fs.readFileSync(file,'utf8');
 const body=source.slice(source.indexOf('exports.connectCaseBrowser ='),source.indexOf('exports.loadAutomationAgentCaseContext ='));
 const initialized=[],calls=[],legacy=[],denied=new Set(),testCase={id:'case',project_id:'project',app_type_id:'app',app_type_kind:'web',automation_start_url:'https://application.test/'};
 const steps=[{id:'step',step_order:1,step_type:'web',action:'Enter @t.username and @t.password',expected_result:'The login form accepts its inputs'}];
 const resolver=createBrowserParameterResolver({testCase,steps,caseValues:{'t.username':'reader@example.test','t.password':password},privateParameterNames:['t.password'],materialize:false});
 const fakeRequire=name=>name==='../lib/automationBrowserAgent'?{connectAutomationBrowser:async options=>{legacy.push(options);return {tools,call:async()=>({content:[]}),close:async()=>{}};}}:name==='../lib/automationBrowserParameters'?{loadBrowserParameterResolver:async()=>resolver}:name==='../lib/automationUpstreamMcpClient'?{connectUpstreamPlaywright:async options=>{initialized.push(options);return {tools,call:async(name,args)=>{calls.push({name,args});return {content:[{type:'text',text:'Native evidence PRIVATE-native-password'}]};},close:async()=>{}};}}:local(name);
 const context={require:fakeRequire,exports:{},selectCaseWithScope:{get:async()=>testCase},selectStepsForCase:{all:async()=>steps},
  getOptionalEvidenceAccess:async(_user,_project,keys)=>Object.fromEntries(keys.map(key=>[key,!denied.has(key)])),
  resolveAutomationCaseSteps:require('../../../platform/backend/src/utils/automationCaseType').resolveAutomationCaseSteps,normalizeTestStepType:utils.normalizeTestStepType,
  resolveBuildContext:async()=>({}),resolveAutomationStartUrl:()=>({url:'https://application.test/'}),resolveTestEngineIntegration:async()=>({base_url:'https://engine.test'}),loadAutomationParameterContext:async()=>({runtime_parameter_values:{}})};
 new Function(...Object.keys(context),body)(...Object.values(context));
 return {connect:options=>context.exports.connectCaseBrowser({projectId:'project',appTypeId:'app',caseId:'case',user:{id:'actor'},...options}),initialized,calls,legacy,denied,resolver};
}

test('generic Engineer uses native filtered schemas, one reviewed bootstrap and exact protected secret bindings',async()=>{
 const f=fixture(),session=await f.connect({allowBrowserActions:true});
 assert.equal(session.browser.driver,'playwright_mcp_upstream');assert.equal(f.initialized.length,1);assert.equal(f.legacy.length,0);
 assert.deepEqual(session.browser.tools,tools);
 const [secretName]=Object.keys(f.initialized[0].secrets);assert.equal(f.initialized[0].secrets[secretName],'PRIVATE-native-password');
 await session.browser.navigateToStart();await assert.rejects(session.browser.navigateToStart(),{code:'AUTOMATION_UPSTREAM_TOOL_INVALID'});
 const result=await session.browser.call('browser_type',{ref:'native-password',text:'@t.password'});
 assert.deepEqual(f.calls.at(-1),{name:'browser_type',args:{ref:'native-password',text:secretName}});assert.doesNotMatch(JSON.stringify(result),/PRIVATE-native-password/);
 await session.browser.call('browser_type',{ref:'native-user',text:'@t.username'});assert.equal(f.calls.at(-1).args.text,'reader@example.test');
 await session.browser.call('browser_type',{ref:'native-user',text:'Account: @t.username'});assert.equal(f.calls.at(-1).args.text,'Account: reader@example.test');
 const checked=await session.browser.call('browser_verify_value',{type:'textbox',element:'Password',target:'native-password',value:'@t.password'});
 assert.equal(f.calls.at(-1).args.value,'PRIVATE-native-password');assert.doesNotMatch(JSON.stringify(checked),/PRIVATE-native-password/);
 const count=f.calls.length;f.denied.add('data.view');
 await assert.rejects(session.browser.call('browser_type',{ref:'native-password',text:secretName}),{statusCode:403});assert.equal(f.calls.length,count,'Revoked data access cannot reuse initialized native secrets.');
});

test('generic read-only Engineer rejects mutation or invented native arguments before transport; F18 legacy is explicit',async()=>{
 const f=fixture(),session=await f.connect();
 assert.deepEqual(session.browser.tools.map(tool=>tool.name),['browser_snapshot','browser_verify_value']);
 await assert.rejects(session.browser.call('browser_type',{ref:'field',text:'value'}),{code:'AUTOMATION_UPSTREAM_TOOL_INVALID'});
 await assert.rejects(session.browser.call('browser_snapshot',{javascript:'invented'}),{code:'AUTOMATION_UPSTREAM_TOOL_INVALID'});assert.equal(f.calls.length,0);
 await session.browser.navigateToStart();assert.equal(f.calls.length,1);
 await f.connect({browser_driver:'legacy_repair_mcp'});assert.equal(f.legacy.length,1);assert.equal(f.initialized.length,1);
 await assert.rejects(f.connect({projectId:'foreign'}),{statusCode:404});assert.equal(f.initialized.length,1);
});

test('reviewed empty private inputs stay blank at native typing and verification dispatch and remain safe symbolic source bindings',async()=>{
 const f=fixture({password:''}),session=await f.connect({allowBrowserActions:true});
 const bindings=f.resolver.upstreamBindings(),[env]=Object.keys(bindings.secrets);
 assert.equal(bindings.secrets[env],'');assert.equal(bindings.parameterValues['t.password'],'');
 await session.browser.call('browser_type',{ref:'native-password',text:'@t.password'});
 assert.equal(f.calls.at(-1).args.text,'');
 await session.browser.call('browser_verify_value',{type:'textbox',element:'Password',target:'native-password',value:env});
 assert.equal(f.calls.at(-1).args.value,'');
 const {bindUpstreamSourceParameters}=require('../../backend/lib/automationUpstreamSourceBindings');
 const source=bindUpstreamSourceParameters({source:'await page.getByLabel("Password").fill("");await expect(page.getByLabel("Password")).toHaveValue("");',parameterValues:bindings.parameterValues,secretBindings:bindings.secretBindings,privateNames:f.resolver.privateParameterNames}).source;
 assert.match(source,/fill\("@t\.password"\)/);assert.match(source,/toHaveValue\("@t\.password"\)/);
 assert.doesNotMatch(JSON.stringify({...bindings,secrets:undefined}),/PRIVATE-native-password/);
});

test('native generic review directly exposes its discovered tools and returns the final ordinary result without custom browser guards',async()=>{
 const calls=[],requests=[],final={headline:'Observed the login form',findings:[]};
 const result=await runUpstreamBrowserReview({browser:{tools:[tools[1]],call:async(name,args)=>{calls.push({name,args});return {content:[{type:'text',text:'Native accessibility snapshot'}]};}},prompt:'Review the selected case',deadlineMs:Date.now()+1000,
  complete:async prompt=>{const request=JSON.parse(prompt);requests.push(request);return requests.length===1?{tool_calls:[{name:'browser_snapshot',arguments:{}}]}:final;}});
 assert.equal(result,final);assert.deepEqual(calls,[{name:'browser_snapshot',args:{}}]);assert.deepEqual(requests[0].tools,[tools[1]]);assert.equal(requests[1].observations[0].tool,'browser_snapshot');
});

test('native generic review never retries uncertain actions or a transport acknowledgement',async()=>{
 for(const mode of ['transport','error']){
  let calls=0,models=0;
  await assert.rejects(runUpstreamBrowserReview({browser:{tools:[tools[2]],call:async()=>{calls++;if(mode==='transport')throw Object.assign(new Error('Lost acknowledgement'),{code:'LOST'});return {isError:true,content:[]};}},prompt:'Review',deadlineMs:Date.now()+1000,
   complete:async()=>{models++;return {tool_calls:[{name:'browser_type',arguments:{ref:'native',text:'value'}}]};}}),error=>mode==='transport'?error.code==='LOST':error.code==='AUTOMATION_UPSTREAM_ACTION_OUTCOME_UNCONFIRMED');
  assert.equal(calls,1);assert.equal(models,1);
 }
});

test('native generic review obtains an inline snapshot after a file-link action result without a model turn',async()=>{
 const calls=[],observations=[],final={headline:'Observed the current form',findings:[]};let models=0;
 const result=await runUpstreamBrowserReview({browser:{tools:[tools[1],tools[2]],call:async name=>{calls.push(name);return {content:[{type:'text',text:name==='browser_type'?'### Snapshot\n- [Snapshot](artifacts/form.yml)':'### Snapshot\n```yaml\n- status "Saved"\n```'}]};}},prompt:'Review',deadlineMs:Date.now()+1000,
  onObservation:async observation=>observations.push(observation),complete:async()=>++models===1?{tool_calls:[{name:'browser_type',arguments:{ref:'e16',text:'Ada'}}]}:final});
 assert.equal(result,final);assert.equal(models,2);assert.deepEqual(calls,['browser_type','browser_snapshot']);assert.deepEqual(observations.map(item=>item.tool),calls);
});

test('native generic review replans from a completed transition instead of using the old batch targets',async()=>{
 const calls=[],final={headline:'Saved page inspected',findings:[]};let models=0;
 const clickTool={name:'browser_click',inputSchema:{type:'object',properties:{ref:{type:'string'}},required:['ref']}};
 const result=await runUpstreamBrowserReview({browser:{tools:[clickTool,tools[2]],call:async(name,args)=>{
  calls.push({name,args});return {content:[{type:'text',text:'### Snapshot\n- status "CURRENT_SAVED_PAGE"'}]};
 }},prompt:'Save the reviewed form',deadlineMs:Date.now()+1000,complete:async prompt=>{
  if(++models===1)return {tool_calls:[{name:'browser_click',arguments:{ref:'save'}},{name:'browser_type',arguments:{ref:'stale-field',text:'never dispatched'}}]};
  const packet=JSON.parse(prompt);assert.equal(packet.host_feedback.code,'AUTOMATION_UPSTREAM_REPLAN_AFTER_ACTION');
  assert.equal(packet.host_feedback.undispatched_batch_calls,1);assert.match(packet.observations[0].result.content[0].text,/CURRENT_SAVED_PAGE/);
  return final;
 }});
 assert.equal(result,final);assert.equal(models,2);assert.deepEqual(calls,[{name:'browser_click',args:{ref:'save'}}]);
});
