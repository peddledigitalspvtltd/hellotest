const test=require('node:test');
const assert=require('node:assert/strict');
const expressionProgram=source=>'// @hellotest-parameter-bindings expressions-v1\n'+source;
const {buildWithUpstreamPlaywright,preActionSelectorError}=require('../../backend/lib/automationUpstreamEngineer');
const {inspectExecutablePlan}=require('../../backend/services/automationReadiness.service');
const startUrl='https://app.test/';
const goto=`await page.goto(${JSON.stringify(startUrl)});`;
const verify='await expect(page.getByRole("status")).toHaveText("Saved");';
const fill=(label,value)=>`await page.getByLabel(${JSON.stringify(label)}).fill(${JSON.stringify(value)});`;
const native=code=>({content:[{type:'text',text:'### Ran Playwright code\n```js\n'+code+'\n```\n- textbox "First" [ref=e16]\n- textbox "Second" [ref=e17]'}]});
const parseFailure={isError:true,content:[{type:'text',text:'### Error\nError: locator.fill: Unknown engine "ref" while parsing selector ref=e17'}]};
const type=(ref,text)=>({name:'browser_type',arguments:{ref,text}});
const tools=[
 {name:'browser_type',inputSchema:{type:'object',properties:{ref:{type:'string'},text:{type:'string'}},required:['ref','text'],additionalProperties:false}},
 {name:'browser_click',inputSchema:{type:'object',properties:{ref:{type:'string'}},required:['ref'],additionalProperties:false}},
 {name:'browser_verify_text_visible',inputSchema:{type:'object',properties:{text:{type:'string'}},required:['text'],additionalProperties:false}},
 {name:'browser_snapshot',inputSchema:{type:'object',properties:{},additionalProperties:false}}
];
function fixture({actor,call,source,assertAccess,deadlineMs,navigation=native(goto),onObservation,maxCallsPerSection,catalog=tools,steps=[{id:'current',step_order:1,step_type:'web',action:'Fill the known fields and verify their values',expected_result:'Saved is visible'}]}={}){
 const calls=[],requests=[],saved=[];let actors=0,closed=0;
 const run=()=>buildWithUpstreamPlaywright({steps,startUrl,interactive:true,
  browser:{tools:catalog,call:async(name,args)=>{calls.push({name,args});return name==='browser_navigate'?navigation:call(name,args,calls);},close:async()=>{closed++;}},
  complete:async request=>{
   requests.push(request);
   if(request.phase==='upstream_browser_actor')return actor(request,++actors);
   if(request.phase==='upstream_source')return typeof source==='function'?source(request):{automation_code:source};
   const payload=JSON.parse(request.prompt.slice(request.prompt.indexOf('{"task":')));
   return {schema:'hellotest.playwrightInstructionMapping.v1',steps:payload.steps.map(step=>({step_id:step.step_id,source_sha256:step.source_sha256,instructions:step.operations.map(op=>({operation_id:op.operation_id,kind:op.kind,depth:op.depth,label:'Native operation',args:[]}))}))};
  },validate:inspectExecutablePlan,onSection:async update=>saved.push(update),assertAccess,deadlineMs,onObservation,maxCallsPerSection});
 return {run,calls,requests,saved,get actors(){return actors;},get closed(){return closed;}};
}

test('bare native ref correction is a new model decision and never a host rewrite or replay',async()=>{
 const f=fixture({actor:(request,count)=>{
  assert.match(JSON.parse(request.prompt).completion,/refs as bare/);assert.match(request.prompt,/browser_fill_form/);
  if(count===1)return {tool:type('ref=e16','Ada')};
  if(count===2){assert.match(request.prompt,/Unknown engine/);return {tool:type('e16','Ada')};}
  return {done:true};
 },call:async(_name,args)=>args.ref==='ref=e16'?parseFailure:native(fill('First','Ada')),source:[goto,fill('First','Ada'),verify].join('\n')});
 const result=await f.run();
 assert.deepEqual(f.calls.filter(call=>call.name==='browser_type').map(call=>call.args.ref),['ref=e16','e16']);
 assert.equal(result.side_effects.browser_actions,1);assert.equal(f.actors,3);assert.equal(f.saved.length,1);assert.equal(f.closed,1);
});

test('three native read-only verifications share one actor decision and keep their exact sequential results',async()=>{
 const texts=['First','Second','Third'],assertions=texts.map(text=>`await expect(page.getByText(${JSON.stringify(text)})).toBeVisible();`);
 const f=fixture({actor:(_request,count)=>count===1?{tool_calls:texts.map(text=>({name:'browser_verify_text_visible',arguments:{text}}))}:{done:true},
  call:async(_name,args)=>native(assertions[texts.indexOf(args.text)]),source:[goto,...assertions].join('\n')});
 const result=await f.run();
 assert.deepEqual(f.calls.slice(1).map(call=>call.args.text),texts);assert.equal(f.actors,2);
 assert.equal(result.browser_evidence.observation_count,4);assert.equal(result.side_effects.browser_actions,0);
 assert.equal(result.updates[0].automation_code,expressionProgram([goto,...assertions].join('\n')));
});

test('a batch stops at a known selector error and retains successful earlier fills while the model corrects only its failed request',async()=>{
 const f=fixture({actor:(request,count)=>{
  if(count===1)return {tool_calls:[type('e16','Ada'),type('ref=e17','Lovelace'),{name:'browser_click',arguments:{ref:'submit'}}]};
  if(count===2){assert.match(request.prompt,/Unknown engine/);return {tool:type('e17','Lovelace')};}
  return {done:true};
 },call:async(_name,args)=>args.ref==='ref=e17'?parseFailure:native(fill(args.ref==='e16'?'First':'Second',args.text)),source:[goto,fill('First','Ada'),fill('Second','Lovelace'),verify].join('\n')});
 const result=await f.run();
 assert.deepEqual(f.calls.map(call=>[call.name,call.args.ref]),[['browser_navigate',undefined],['browser_type','e16'],['browser_type','ref=e17'],['browser_type','e17']]);
 assert.equal(result.side_effects.browser_actions,2);assert.equal(f.calls.some(call=>call.name==='browser_click'),false);
});

test('permission revocation is checked between batch calls and prevents the next native action',async()=>{
 const f=fixture({actor:()=>({tool_calls:[type('e16','Ada'),type('e17','Lovelace')]}),call:async()=>native(fill('First','Ada')),
  assertAccess:async()=>{if(f.calls.some(call=>call.name==='browser_type'))throw Object.assign(new Error('Access revoked'),{statusCode:403});}});
 await assert.rejects(f.run(),{statusCode:403});
 assert.deepEqual(f.calls.map(call=>call.name),['browser_navigate','browser_type']);assert.equal(f.saved.length,0);assert.equal(f.closed,1);
});

test('unknown action outcomes and multi-field form errors remain terminal and never execute the rest of a batch',async()=>{
 assert.equal(preActionSelectorError('browser_fill_form',parseFailure),false,'A form tool may have already changed an earlier field.');
 const unknown={isError:true,content:[{type:'text',text:'The action outcome is unknown.'}]};
 assert.equal(preActionSelectorError('browser_type',unknown),false);
 const f=fixture({actor:()=>({tool_calls:[type('e16','Ada'),type('e17','Lovelace')]}),call:async()=>unknown});
 await assert.rejects(f.run(),{code:'AUTOMATION_UPSTREAM_ACTION_OUTCOME_UNCONFIRMED'});
 assert.equal(f.actors,1);assert.equal(f.calls.length,2);assert.equal(f.saved.length,0);
});

test('oversized batches return bounded validation without dispatching their proposed native calls',async()=>{
 const f=fixture({actor:(request,count)=>{
  if(count===1)return {tool_calls:Array.from({length:7},()=>type('e16','Ada'))};
  if(count===2){assert.match(request.prompt,/between 1 and 6/);return {tool:type('e16','Ada')};}
  return {done:true};
 },call:async()=>native(fill('First','Ada')),source:[goto,fill('First','Ada'),verify].join('\n')});
 await f.run();assert.equal(f.calls.filter(call=>call.name==='browser_type').length,1);assert.equal(f.saved.length,1);
});

test('file-link-only native navigate and action snapshots receive one direct inline snapshot without another model turn',async()=>{
 const observations=[],click='await page.getByRole("button",{name:"Save"}).click();';
 const link=code=>({content:[{type:'text',text:'### Ran Playwright code\n```js\n'+code+'\n```\n### Snapshot\n- [Snapshot](artifacts/page.yml)'}]});
 const f=fixture({navigation:link(goto),onObservation:async item=>{observations.push(item);},actor:(request,count)=>{
  const payload=JSON.parse(request.prompt);assert.equal(payload.latest_observation.tool,'browser_snapshot');assert.match(payload.latest_observation.result.content[0].text,/INLINE_NATIVE_BODY/);
  return count===1?{tool:{name:'browser_click',arguments:{ref:'e16'}}}:{done:true};
 },call:async name=>name==='browser_snapshot'?{content:[{type:'text',text:'### Snapshot\n```yaml\n- status "INLINE_NATIVE_BODY Saved"\n```'}]}:link(click),source:[goto,click,verify].join('\n')});
 const result=await f.run();
 assert.deepEqual(f.calls.map(call=>call.name),['browser_navigate','browser_snapshot','browser_click','browser_snapshot']);
 assert.deepEqual(observations.map(item=>item.tool),f.calls.map(call=>call.name));
 assert.equal(f.actors,2);assert.equal(result.browser_evidence.observation_count,4);assert.equal(result.updates[0].automation_code,expressionProgram([goto,click,verify].join('\n')));
 const sourceRequest=JSON.parse(f.requests.find(request=>request.phase==='upstream_source').prompt);
 assert.deepEqual([...sourceRequest.observations,sourceRequest.final_observation].map(item=>item.tool),f.calls.map(call=>call.name));
});

test('inline action snapshots and link-only read results do not trigger redundant native snapshots',async()=>{
 const inline={content:[{type:'text',text:'### Snapshot\n```yaml\n- textbox "First" [ref=e16]\n```'}]};
 const f=fixture({navigation:{content:[...native(goto).content,...inline.content]},actor:(_request,count)=>count===1?{tool:type('e16','Ada')}:{done:true},
  call:async()=>({content:[...native(fill('First','Ada')).content,...inline.content]}),source:[goto,fill('First','Ada'),verify].join('\n')});
 await f.run();assert.deepEqual(f.calls.map(call=>call.name),['browser_navigate','browser_type']);
 const g=fixture({actor:(_request,count)=>count===1?{tool:{name:'browser_snapshot',arguments:{}}}:{done:true},call:async()=>({content:[{type:'text',text:'### Snapshot\n- [Snapshot](artifacts/read.yml)'}]}),source:[goto,verify].join('\n')});
 await g.run();assert.deepEqual(g.calls.map(call=>call.name),['browser_navigate','browser_snapshot']);
});

test('automatic native snapshots consume the existing section call allowance without replaying an action',async()=>{
 const link={content:[...native(goto).content,{type:'text',text:'### Snapshot\n- [Snapshot](artifacts/page.yml)'}]};
 const f=fixture({navigation:link,maxCallsPerSection:3,actor:()=>({tool:type('e16','Ada')}),call:async name=>name==='browser_snapshot'?{content:[{type:'text',text:'### Snapshot\n```yaml\n- textbox "First" [ref=e16]\n```'}]}:{content:[...native(fill('First','Ada')).content,{type:'text',text:'### Snapshot\n- [Snapshot](artifacts/filled.yml)'}]}});
 await assert.rejects(f.run(),/inline native snapshot.*call allowance/);
 assert.deepEqual(f.calls.map(call=>call.name),['browser_navigate','browser_snapshot','browser_type']);assert.equal(f.saved.length,0);assert.equal(f.closed,1);
});

test('a section deadline is checked between native batch actions',async t=>{
 let expired=false;t.mock.method(Date,'now',()=>expired?2000:0);
 const f=fixture({deadlineMs:1000,actor:()=>({tool_calls:[type('e16','Ada'),type('e17','Lovelace')]}),call:async()=>{expired=true;return native(fill('First','Ada'));}});
 await assert.rejects(f.run(),/time allowance ended/);
 assert.deepEqual(f.calls.map(call=>call.name),['browser_navigate','browser_type']);assert.equal(f.saved.length,0);
});

test('done with native tool calls executes the calls and requests a new decision before source generation',async()=>{
 const checked='await expect(page.getByText("Saved")).toBeVisible();';
 const f=fixture({actor:(request,count)=>{
  if(count===1)return {done:true,tool_calls:[{name:'browser_verify_text_visible',arguments:{text:'Saved'}}]};
  assert.equal(count,2);assert.equal(f.calls.filter(item=>item.name==='browser_verify_text_visible').length,1);
  const payload=JSON.parse(request.prompt);
  assert.equal(payload.latest_observation.tool,'browser_verify_text_visible');
  assert.match(payload.latest_observation.result.content[0].text,/toBeVisible/);
  assert.equal(f.requests.some(item=>item.phase==='upstream_source'),false);
  return {done:true};
 },call:async()=>native(checked),source:[goto,checked].join('\n')});
 await f.run();
 assert.deepEqual(f.calls.map(item=>item.name),['browser_navigate','browser_verify_text_visible']);
 assert.deepEqual(f.requests.map(item=>item.phase),['upstream_browser_actor','upstream_browser_actor','upstream_source','upstream_instruction_mapping']);
 assert.equal(f.saved.length,1);assert.equal(f.closed,1);
});

const targetTools=tools.map(tool=>['browser_type','browser_click'].includes(tool.name)?{...tool,inputSchema:{...tool.inputSchema,
 properties:{target:{type:'string'},...(tool.name==='browser_type'?{text:{type:'string'}}:{})},required:tool.name==='browser_type'?['target','text']:['target']}}:tool);
const inlineSnapshot={content:[{type:'text',text:'### Page\n- Page URL: https://app.test/\n### Snapshot\n```yaml\n- textbox "First" [ref=e16]\n- textbox "Second" [ref=e17]\n```'}]};

test('invalid wrapper and invalid arguments preserve the last native observation and snapshot refs across sections',async()=>{
 const firstCheck='await expect(page.getByText("First")).toBeVisible();';
 const steps=[{id:'observe',step_order:1,step_type:'web',action:'Inspect the form',expected_result:'First is visible'},
  {id:'fill',step_order:2,step_type:'web',action:'Fill First',expected_result:'Saved is visible'}];
 const f=fixture({steps,catalog:targetTools,navigation:{content:[...native(goto).content,{type:'text',text:'### Snapshot\n- [Snapshot](artifacts/page.yml)'}]},
  actor:(request,count)=>{
   const payload=JSON.parse(request.prompt);
   if(count===1)return {tool:{name:'browser_verify_text_visible',arguments:{text:'First'}}};
   if(count===2)return {done:true};
   if(count===6){assert.equal(payload.latest_observation.tool,'browser_type');assert.equal(payload.host_feedback,undefined);return {done:true};}
   assert.equal(request.step.id,'fill');assert.equal(f.saved.length,1);
   assert.equal(payload.latest_observation.tool,'browser_verify_text_visible');
   assert.equal(payload.current_page_snapshot.tool,'browser_snapshot');
   assert.match(payload.current_page_snapshot.result.content[0].text,/textbox "First" \[ref=e16\]/);
   assert.equal(f.calls.filter(item=>item.name==='browser_type').length,0);
   if(count===3){assert.equal(payload.host_feedback,undefined);return {response:{tool:{name:'browser_type',arguments:{target:'e16',text:'Ada'}}},completion:'A copied response envelope is not a native call.'};}
   assert.equal(payload.host_feedback.code,'AUTOMATION_UPSTREAM_TOOL_INVALID');
   assert.ok(payload.host_feedback.message);
   if(count===4)return {tool:{name:'browser_type',arguments:{target:16,text:'Ada'}}};
   if(count===5)return {tool:{name:'browser_type',arguments:{target:'e16',text:'Ada'}}};
   throw Error('Unexpected actor decision');
  },call:async name=>name==='browser_snapshot'?inlineSnapshot:name==='browser_verify_text_visible'?native(firstCheck):native(fill('First','Ada')),
  source:request=>({automation_code:request.step.id==='observe'?[goto,firstCheck].join('\n'):[fill('First','Ada'),verify].join('\n')})});
 const result=await f.run();
 assert.equal(result.updates.length,2);
 assert.deepEqual(f.calls.map(item=>item.name),['browser_navigate','browser_snapshot','browser_verify_text_visible','browser_type']);
 assert.deepEqual(f.calls.filter(item=>item.name==='browser_type').map(item=>item.args.target),['e16']);
 assert.equal(f.closed,1);
});

test('a blocked decision never dispatches speculative mutations and stops after two native snapshot attempts',async()=>{
 const f=fixture({catalog:targetTools,actor:(request,count)=>{
  if(count>1){const payload=JSON.parse(request.prompt);assert.equal(payload.latest_observation.tool,'browser_snapshot');assert.match(payload.latest_observation.result.content[0].text,/\[ref=e16\]/);assert.match(payload.host_feedback.message,/native snapshot/);}
  return {blocked_reason:'Need the actual native ref before typing.',done:false,tool_calls:[{name:'browser_type',arguments:{target:'e2',text:'Ada'}},{name:'browser_click',arguments:{target:'e3'}}]};
 },call:async name=>{assert.equal(name,'browser_snapshot');return inlineSnapshot;}});
 await assert.rejects(f.run(),{code:'AUTOMATION_UPSTREAM_BUILD_INCOMPLETE'});
 assert.equal(f.actors,3);
 assert.deepEqual(f.calls.map(item=>item.name),['browser_navigate','browser_snapshot','browser_snapshot']);
 assert.equal(f.saved.length,0);assert.equal(f.requests.some(item=>item.phase==='upstream_source'),false);assert.equal(f.closed,1);
});

test('configured model mocks discover the original upstream function catalog through nativeTools',async()=>{
 const f=fixture({catalog:targetTools,actor:(request,count)=>{
  assert.ok(Array.isArray(request.nativeTools));
  const discovered=request.nativeTools.find(tool=>tool.name==='browser_type');
  assert.equal(discovered,targetTools.find(tool=>tool.name==='browser_type'));
  assert.deepEqual(discovered.inputSchema.required,['target','text']);
  const packet=JSON.parse(request.prompt);
  assert.deepEqual(packet.available_tools,request.nativeTools.map(tool=>tool.name));
  assert.equal(packet.tools,undefined,'full schemas reach the provider function channel instead of a duplicated prompt field');
  return count===1?{tool:{name:discovered.name,arguments:{target:'e16',text:'Ada'}}}:{done:true};
 },call:async()=>native(fill('First','Ada')),source:[goto,fill('First','Ada'),verify].join('\n')});
 await f.run();
 assert.deepEqual(f.calls.filter(item=>item.name==='browser_type').map(item=>item.args),[{target:'e16',text:'Ada'}]);
 assert.equal(f.saved.length,1);assert.equal(f.closed,1);
});

test('a native click ends its old batch and the next decision uses the returned page before dispatching another target',async()=>{
 const click='await page.getByRole("button",{name:"Save"}).click();';
 const check='await expect(page.getByText("Saved")).toBeVisible();';
 const f=fixture({actor:(request,count)=>{
  const packet=JSON.parse(request.prompt);
  if(count===1)return {tool_calls:[{name:'browser_click',arguments:{ref:'save'}},{name:'browser_click',arguments:{ref:'stale-delete'}}]};
  if(count===2){
   assert.equal(packet.latest_observation.tool,'browser_click');
   assert.match(packet.latest_observation.result.content.map(block=>block.text).join('\n'),/CURRENT_SAVED_PAGE/);
   assert.equal(packet.host_feedback.code,'AUTOMATION_UPSTREAM_REPLAN_AFTER_ACTION');
   assert.equal(packet.host_feedback.undispatched_batch_calls,1);
   assert.match(packet.host_feedback.message,/Do not repeat the completed action/);
   return {tool:{name:'browser_verify_text_visible',arguments:{text:'Saved'}}};
  }
  return {done:true};
 },call:async name=>name==='browser_click'?{content:[...native(click).content,{type:'text',text:'### Snapshot\n- status "CURRENT_SAVED_PAGE Saved"'}]}:native(check),source:[goto,click,check].join('\n')});
 const result=await f.run();
 assert.deepEqual(f.calls.map(call=>[call.name,call.args.ref]),[['browser_navigate',undefined],['browser_click','save'],['browser_verify_text_visible',undefined]]);
 assert.equal(result.side_effects.browser_actions,1);assert.equal(f.actors,3);assert.equal(f.saved.length,1);
});

test('a submitting native text input ends its old batch without replaying the submitted value',async()=>{
 const submit='await page.getByLabel("First").fill("Ada");\nawait page.getByLabel("First").press("Enter");';
 const submittingTools=tools.map(tool=>tool.name==='browser_type'?{...tool,inputSchema:{...tool.inputSchema,properties:{...tool.inputSchema.properties,submit:{type:'boolean'}}}}:tool);
 const f=fixture({catalog:submittingTools,actor:(request,count)=>{
  if(count===1)return {tool_calls:[{name:'browser_type',arguments:{ref:'e16',text:'Ada',submit:true}},{name:'browser_click',arguments:{ref:'stale-submit'}}]};
  const packet=JSON.parse(request.prompt);assert.equal(packet.host_feedback.completed_tool,'browser_type');return {done:true};
 },call:async()=>native(submit),source:[goto,submit,verify].join('\n')});
 await f.run();
 assert.deepEqual(f.calls.map(call=>call.name),['browser_navigate','browser_type']);assert.equal(f.saved.length,1);assert.equal(f.actors,2);
});

test('unrepresentable native tab and dialog actions return source-capability feedback before dispatch',async()=>{
 const original=require('../../../platform/backend/test/fixtures/upstreamPlaywrightMcpTools.v0.0.84.json');
 const unsupported=[...['new','select','close'].map(action=>({name:'browser_tabs',arguments:{action}})),{name:'browser_handle_dialog',arguments:{accept:true}}];
 for(const request of unsupported){
  const f=fixture({catalog:original,actor:(model,count)=>{
   if(count===1)return {tool:request};
   const packet=JSON.parse(model.prompt);assert.equal(packet.host_feedback.code,'AUTOMATION_UPSTREAM_TOOL_INVALID');
   assert.match(packet.host_feedback.message,/runtime|capability/);assert.match(packet.host_feedback.message,/No browser action was dispatched/);
   assert.equal(f.calls.length,1);return {done:true};
  },call:async()=>{throw new Error('Unsupported action must not reach native transport');},source:[goto,verify].join('\n')});
  await f.run();assert.deepEqual(f.calls.map(call=>call.name),['browser_navigate']);assert.equal(f.saved.length,1);
 }
});

test('native tab listing keeps its original schema and remains available during read-only inspection',async()=>{
 const original=require('../../../platform/backend/test/fixtures/upstreamPlaywrightMcpTools.v0.0.84.json');
 const tabTool=original.find(tool=>tool.name==='browser_tabs');
 const {toolsForPolicy,validateRequest}=require('../../backend/lib/automationUpstreamEngineer');
 const catalog=toolsForPolicy(original,false);assert.equal(catalog.find(tool=>tool.name==='browser_tabs'),tabTool);
 assert.deepEqual(validateRequest({name:'browser_tabs',arguments:{action:'list'}},new Map(catalog.map(tool=>[tool.name,tool])),{interactive:false,startUrl}),{action:'list'});
 for(const action of ['new','select','close'])assert.throws(()=>validateRequest({name:'browser_tabs',arguments:{action}},new Map(catalog.map(tool=>[tool.name,tool])),{interactive:false,startUrl}),{code:'AUTOMATION_UPSTREAM_TOOL_INVALID'});
});

test('native tab listing and independent read-only checks still share one bounded actor batch',async()=>{
 const original=require('../../../platform/backend/test/fixtures/upstreamPlaywrightMcpTools.v0.0.84.json');
 const f=fixture({catalog:original,actor:(_request,count)=>count===1?{tool_calls:[{name:'browser_tabs',arguments:{action:'list'}},{name:'browser_snapshot',arguments:{}}]}:{done:true},
  call:async name=>({content:[{type:'text',text:name==='browser_tabs'?'One existing tab':'### Snapshot\n- status "Saved"'}]}),source:[goto,verify].join('\n')});
 await f.run();assert.deepEqual(f.calls.map(call=>call.name),['browser_navigate','browser_tabs','browser_snapshot']);assert.equal(f.actors,2);assert.equal(f.saved.length,1);
});
