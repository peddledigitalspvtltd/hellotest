const test = require('node:test');
const assert = require('node:assert/strict');
const { connectAutomationBrowser, runAutomationBrowserAgent } = require('../../backend/lib/automationBrowserAgent');
test('agent requests tools, receives observations and returns a single final structured build', async () => {
  const events=[];const prompts=[];const calls=[];
  const final={steps:[{step_id:'step',automation_code:'await page.getByRole("button", {name:"Save"}).click();'}]};
  const browser={tools:[{name:'browser_snapshot'}],call:async(name,args)=>{calls.push([name,args]);return {content:[{type:'text',text:'Save button'}]};}};
  const result=await runAutomationBrowserAgent({prompt:'Manual step Save, expected saved.',browser,parse:JSON.parse,complete:async prompt=>{prompts.push(prompt);return JSON.stringify(prompts.length===1?{tool_calls:[{name:'browser_snapshot',arguments:{}}]}:final);},onProgress:async event=>events.push(event)});
  assert.deepEqual(result,final);assert.equal(calls.length,1);assert.match(prompts[1],/Save button/);assert.ok(events.some(e=>e.phase==='automation.agent.browser'));
});
test('agent fails unavailable tools, empty plans and exhausted budgets without returning starter code', async () => {
  for(const tool_calls of [[],[{name:'shell',arguments:{command:'bad'}}]] )await assert.rejects(runAutomationBrowserAgent({prompt:'case',browser:{tools:[]},parse:JSON.parse,complete:async()=>JSON.stringify({tool_calls})}));
  await assert.rejects(runAutomationBrowserAgent({prompt:'case',browser:{tools:[{name:'browser_snapshot'}],call:async()=>({})},parse:JSON.parse,complete:async()=>JSON.stringify({tool_calls:[{name:'browser_snapshot',arguments:{}}]}),maxTurns:2}),/complete build/);
});

test('MCP client completes its session handshake, forwards tools and closes once', async (context) => {
  const requests = [];
  context.mock.method(globalThis, 'fetch', async (url, init) => {
    const request = init.body ? JSON.parse(init.body) : null;
    requests.push({ url, ...init, request });
    if (init.method === 'DELETE') return new Response(null, { status: 204 });
    if (request.method === 'notifications/initialized') return new Response(null, { status: 202 });
    const result = request.method === 'initialize'
      ? { protocolVersion: '2025-03-26', capabilities: { tools: {} } }
      : request.method === 'tools/list' ? { tools: [{ name: 'browser_snapshot', inputSchema: { type: 'object' } }] }
        : { content: [{ type: 'text', text: 'Observed page' }] };
    return Response.json({ jsonrpc: '2.0', id: request.id, result }, { headers: request.method === 'initialize' ? { 'mcp-session-id': 'browser-session' } : {} });
  });
  const browser = await connectAutomationBrowser({ integration: { base_url: 'http://engine.test/' }, startUrl: 'https://app.test', allowBrowserActions: true });
  const observation = await browser.call('browser_snapshot', {});
  assert.equal(observation.content[0].text, 'Observed page');
  assert.equal(requests[0].request.params._meta.hellotest.allow_browser_actions, true);
  assert.equal(requests[1].headers['mcp-session-id'], 'browser-session');
  assert.equal(requests[3].request.params.name, 'browser_snapshot');
  await browser.close();
  await browser.close();
  assert.equal(requests.filter((request) => request.method === 'DELETE').length, 1);
  await assert.rejects(browser.call('browser_snapshot', {}), /session is closed/);
});

test('MCP failures release established sessions and reject mismatched responses', async (context) => {
  for (const failure of ['protocol', 'response_id', 'catalog', 'response_size']) {
    let closed = false;
    context.mock.method(globalThis, 'fetch', async (url, init) => {
      if (init.method === 'DELETE') { closed = true; return new Response(null, { status: 204 }); }
      const request = JSON.parse(init.body);
      if (request.method === 'notifications/initialized') return new Response(null, { status: 202 });
      const result = request.method === 'initialize'
        ? { protocolVersion: failure === 'protocol' ? 'unsupported' : '2025-03-26', capabilities: { tools: {} } }
        : failure === 'response_size' ? { value: 'x'.repeat(300_000) } : { tools: [null] };
      return Response.json({ jsonrpc: '2.0', id: failure === 'response_id' ? 99 : request.id, result }, { headers: { 'mcp-session-id': 'browser-session' } });
    });
    await assert.rejects(connectAutomationBrowser({ integration: { base_url: 'http://engine.test' }, startUrl: 'https://app.test' }));
    assert.equal(closed, true, failure);
  }
});

test('agent stops before LLM generation when initial application inspection fails', async () => {
  let completions = 0;
  const browser = { tools: [{ name: 'browser_navigate' }, { name: 'browser_snapshot' }],
    call: async () => ({ isError: true, content: [{ type: 'text', text: 'Application returned an error' }] }) };
  await assert.rejects(runAutomationBrowserAgent({ prompt: 'case', browser, startUrl: 'https://app.test', parse: JSON.parse,
    complete: async () => { completions++; return '{}'; } }), error => error.code === 'AUTOMATION_BROWSER_INSPECTION_FAILED' && error.nonRetryable === true);
  assert.equal(completions, 0);
});

test('bounded model calls retain an existing browser session and its initial observations',async()=>{
 const observed={tool:'browser_snapshot',result:{content:[{type:'text',text:'Pinned browser state'}]}};let calls=0;
 const result=await runAutomationBrowserAgent({prompt:'Repair feature contract',browser:{tools:[]},initialObservations:[observed],maxTurns:1,deadlineMs:Date.now()+5000,parse:value=>value,
 complete:async prompt=>{calls++;assert.match(prompt,/Pinned browser state/);return {automation_repair:null,headline:'Need more evidence'};}});
 assert.equal(calls,1);assert.equal(result.automation_repair,null);
});
test('browser observation compression preserves recent evidence without malformed JSON or unbounded history',()=>{
 const {compactBrowserObservations}=require('../../backend/lib/automationBrowserAgent');
 const history=Array.from({length:12},(_,index)=>({tool:'browser_snapshot',result:{content:[{type:'text',text:JSON.stringify({url:`https://app.test/${index}`,accessibility:'A'.repeat(40000),elements:[{label:'B'.repeat(50000)}]})}]}}));
 const packed=compactBrowserObservations(history);assert.ok(JSON.stringify(packed).length<33000);assert.match(JSON.stringify(packed.at(-1)),/app.test\/11/);assert.ok(packed.some(entry=>entry.result.omitted_older_observation||entry.result.content?.some(part=>part.text.includes("excerpt_truncated"))));for(const entry of packed)for(const item of entry.result.content || [])assert.doesNotThrow(()=>JSON.parse(item.text));
});
test('MCP carries the gateway affinity cookie across initialization, tools and session cleanup',async t=>{
 const calls=[];t.mock.method(globalThis,'fetch',async(_url,request)=>{calls.push(request);if(request.method==='DELETE')return new Response(null,{status:204});const rpc=JSON.parse(request.body);if(rpc.method==='notifications/initialized')return new Response(null,{status:202});return Response.json({jsonrpc:'2.0',id:rpc.id,result:rpc.method==='initialize'?{protocolVersion:'2025-03-26',capabilities:{tools:{}}}:rpc.method==='tools/list'?{tools:[{name:'browser_snapshot',inputSchema:{type:'object'}}]}:{content:[]}}, {headers:{'mcp-session-id':'session','set-cookie':'HELLOTEST_ENGINE=worker-one; path=/'}});});
 const browser=await connectAutomationBrowser({integration:{base_url:'http://engine.test'},startUrl:'https://app.test'});await browser.call('browser_snapshot',{});await browser.close();
 for(const request of calls.slice(1))assert.equal(request.headers.cookie,'HELLOTEST_ENGINE=worker-one');for(const request of calls)assert.equal(request.redirect,'error');
});

test('browser tool protocol markers belong to the selected AI Controls profile',async()=>{
 const prompts=[];const output=await runAutomationBrowserAgent({featureKey:'ai.agentic.automation-engineer',prompt:'Build all sections',browser:{tools:[],call:async()=>({content:[]})},complete:async prompt=>{prompts.push(prompt);return '{"steps":[]}';},parse:JSON.parse,maxTurns:1});
 assert.deepEqual(output,{steps:[]});assert.match(prompts[0],/HELLOTEST_AI:ai.agentic.automation-engineer:automationBrowserAgent.toolProtocol/);
});
test('completion retries retain browser observations without reopening or replaying the flow',async()=>{
 const history=[],calls=[];const browser={tools:[{name:'browser_navigate'},{name:'browser_snapshot'},{name:'browser_click'}],call:async(name,args)=>{calls.push({name,args});return {content:[{type:'text',text:name==='browser_click'?'Saved after click':'Observed checkout'}]};}};
 let turns=0;
 await runAutomationBrowserAgent({browser,startUrl:'https://app.test',prompt:'Full case',parse:JSON.parse,onObservation:item=>history.push(item),complete:async()=>JSON.stringify(++turns===1?{tool_calls:[{name:'browser_click',arguments:{locator:'#save'}}]}:{steps:[{step_id:'one'}]})});
 const count=calls.length;
 const result=await runAutomationBrowserAgent({browser,prompt:'Complete missing section two',initialObservations:history,parse:JSON.parse,onObservation:item=>history.push(item),complete:async prompt=>{assert.match(prompt,/Saved after click/);return '{"steps":[{"step_id":"two"}]}';}});
 assert.equal(calls.length,count);assert.equal(calls.filter(call=>call.name==='browser_navigate').length,1);assert.equal(calls.filter(call=>call.name==='browser_click').length,1);assert.equal(result.steps[0].step_id,'two');
});

test('malformed JSON and unavailable or invalid tools recover within the same MCP session and bounded budget',async()=>{
 const calls=[],events=[],prompts=[];
 const browser={tools:[{name:'browser_fill',inputSchema:{type:'object',properties:{locator:{type:'string',maxLength:2000},value:{type:'string',maxLength:2000}},required:['locator','value'],additionalProperties:false}}],call:async(name,args)=>{calls.push({name,args});return {content:[{type:'text',text:'Email value entered'}]};}};
 const responses=['not JSON',JSON.stringify({tool_calls:[{name:'browser_type',arguments:{ref:'e1',text:'PRIVATE'}},{name:'browser_fill',arguments:{locator:'#email',value:'PRIVATE',ref:'e1'}}]}),JSON.stringify({tool_calls:[{name:'browser_fill',arguments:{locator:'#email',value:'PRIVATE'}}]}),JSON.stringify({steps:[{step_id:'email',automation_code:'await page.getByLabel("Email").fill("@t.email");'}]})];
 const output=await runAutomationBrowserAgent({browser,prompt:'Build registration',parse:JSON.parse,complete:async prompt=>{prompts.push(prompt);return responses.shift();},onProgress:async event=>events.push(event),maxTurns:4});
 assert.equal(calls.length,1);assert.equal(output.steps[0].step_id,'email');assert.match(prompts[2],/No browser action was performed/);assert.doesNotMatch(prompts[3],/PRIVATE/);assert.ok(events.some(event=>event.phase==='automation.agent.output.invalid'));assert.equal(events.filter(event=>event.phase==='automation.agent.tool.invalid').length,1,'a rejected request stops the dependent batch');
});

test('a browser tool error is evidence for correction but an uncertain transport outcome is never replayed',async()=>{
 let calls=0,turns=0;
 const browser={tools:[{name:'browser_click'}],call:async()=>{calls++;return {isError:true,content:[{type:'text',text:JSON.stringify({message:'Locator matches two elements',action_outcome:'not_attempted',retry_safe:true})}]};}};
 const result=await runAutomationBrowserAgent({browser,prompt:'Use a unique observed locator',parse:JSON.parse,complete:async prompt=>{if(++turns===2){assert.match(prompt,/matches two elements/);return '{"steps":[]}';}return '{"tool_calls":[{"name":"browser_click","arguments":{"locator":"button"}}]}';}});
 assert.deepEqual(result,{steps:[]});assert.equal(calls,1);
 browser.call=async()=>{calls++;throw Object.assign(new Error('response lost'),{code:'ETIMEDOUT'});};turns=0;
 await assert.rejects(runAutomationBrowserAgent({browser,prompt:'Click once',parse:JSON.parse,complete:async()=>{turns++;return '{"tool_calls":[{"name":"browser_click","arguments":{"locator":"#submit"}}]}';}}),error=>error.code==='AUTOMATION_BROWSER_OUTCOME_UNKNOWN'&&error.nonRetryable);
 assert.equal(turns,1);assert.equal(calls,2);
});

test('optional screenshot timeout or tool error never blocks text-grounded generation or replays interactions',async()=>{
 for(const failure of ['timeout','tool']){
  const calls=[],events=[];
  const browser={tools:[{name:'browser_navigate'},{name:'browser_snapshot'},{name:'browser_screenshot'}],call:async name=>{calls.push(name);if(name==='browser_screenshot'){if(failure==='timeout')throw Object.assign(new Error('Screenshot timeout'),{name:'AbortError'});return {isError:true,content:[{type:'text',text:'Screenshot unavailable'}]};}return {content:[{type:'text',text:'Application accessible evidence'}]};}};
  const result=await runAutomationBrowserAgent({browser,startUrl:'https://app.test',prompt:'Open and inspect',parse:JSON.parse,complete:async prompt=>{assert.match(prompt,/Application accessible evidence/);return '{"steps":[{"step_id":"one"}]}';},onProgress:async event=>events.push(event)});
  assert.equal(result.steps[0].step_id,'one');assert.deepEqual(calls,['browser_navigate','browser_snapshot','browser_screenshot']);assert.ok(events.some(event=>event.phase==='automation.agent.screenshot.unavailable'));
 }
});

test('actual post-interaction evidence is sampled once within the tool budget; screenshot failure never replays the action',async()=>{
 const calls=[],observations=[];let turns=0;
 const browser={tools:['browser_click','browser_snapshot','browser_screenshot'].map(name=>({name})),call:async name=>{calls.push(name);if(name==='browser_screenshot')throw new Error('Optional image timeout');return {content:[{type:'text',text:JSON.stringify(name==='browser_snapshot'?{url:'https://app.test/saved',accessibility:'Saved confirmation',observation_id:'actual-after-click'}:{clicked:true})}]};}};
 const result=await runAutomationBrowserAgent({browser,prompt:'Save',parse:JSON.parse,maxCalls:3,onObservation:item=>observations.push(item),complete:async prompt=>{if(++turns===1)return '{"tool_calls":[{"name":"browser_click","arguments":{"locator":"#save"}}]}';assert.match(prompt,/actual-after-click/);return '{"steps":[]}';}});
 assert.deepEqual(result,{steps:[]});assert.deepEqual(calls,['browser_click','browser_snapshot','browser_screenshot']);assert.equal(observations.filter(item=>item.tool==='browser_click').length,1);assert.ok(observations.every(item=>Number.isFinite(Date.parse(item.observed_at))));
});
test('an MCP uncertain action receipt stops all subsequent tools and model turns, while retained observations expose the failure',async()=>{
 const calls=[],observations=[];let turns=0;
 const browser={tools:[{name:'browser_click'},{name:'browser_snapshot'}],call:async name=>{calls.push(name);return {isError:true,content:[{type:'text',text:JSON.stringify({code:'BROWSER_ACTION_OUTCOME_UNKNOWN',action_outcome:'unknown',retry_safe:false,message:'Click result lost'})}]};}};
 await assert.rejects(runAutomationBrowserAgent({browser,prompt:'Save once',parse:JSON.parse,onObservation:item=>observations.push(item),complete:async()=>{turns++;return '{"tool_calls":[{"name":"browser_click","arguments":{"locator":"#submit"}},{"name":"browser_snapshot","arguments":{}}]}';}}),error=>error.code==='AUTOMATION_BROWSER_OUTCOME_UNKNOWN'&&error.nonRetryable);
 assert.deepEqual(calls,['browser_click']);assert.equal(turns,1);assert.equal(observations.length,1);assert.equal(observations[0].result.isError,true);
});
test('incremental section drafts validate before successive browser calls and their safe receipts reach the next model turn',async()=>{
 const order=[],observations=[];let turns=0;
 const browser={tools:[{name:'browser_snapshot'}],call:async()=>{order.push('browser');return {content:[{type:'text',text:'Actual page evidence'}]};}};
 const result=await runAutomationBrowserAgent({browser,prompt:'Build step by step',parse:JSON.parse,onObservation:item=>observations.push(item),onPartialBuild:async payload=>{order.push('draft');assert.equal(payload.steps[0].step_id,'one');return {completed_step_ids:['one'],validation_errors:[]};},complete:async prompt=>{if(++turns===1)return JSON.stringify({steps:[{step_id:'one',automation_code:'await page.locator("PRIVATE SOURCE IN PROTECTED PREVIEW ONLY").click();'}],tool_calls:[{name:'browser_snapshot',arguments:{}}]});assert.match(prompt,/completed_step_ids/);assert.doesNotMatch(prompt,/PRIVATE SOURCE/);return '{"steps":[{"step_id":"two"}]}';}});
 assert.deepEqual(order,['draft','browser']);assert.equal(result.steps[0].step_id,'two');assert.ok(observations.some(item=>item.tool==='automation_generation_feedback'));
});
test('incremental feedback and rejected browser requests do not consume remaining MCP calls across completion attempts',async()=>{
 const {remainingBrowserCalls}=require('../../backend/lib/automationBrowserAgent');
 const observations=[{tool:'browser_navigate'},{tool:'browser_snapshot'}],calls=[];let turns=0;
 const browser={tools:[{name:'browser_snapshot',inputSchema:{type:'object',properties:{},additionalProperties:false}}],call:async name=>{calls.push(name);return {content:[{type:'text',text:'Actual page evidence'}]};}};
 await runAutomationBrowserAgent({browser,prompt:'Progressive sections',parse:JSON.parse,maxCalls:1,initialObservations:observations,onObservation:item=>observations.push(item),onPartialBuild:async()=>({completed_step_ids:['one'],validation_errors:[]}),complete:async()=>{
  if(++turns===1)return JSON.stringify({steps:[{step_id:'one'}],tool_calls:[{name:'browser_snapshot',arguments:{unsupported:'not sent'}}]});
  if(turns===2)return JSON.stringify({tool_calls:[{name:'browser_snapshot',arguments:{}}]});
  return '{"steps":[]}';
 }});
 assert.deepEqual(calls,['browser_snapshot']);assert.equal(observations.find(item=>item.tool==='automation_tool_schema_feedback'&&item.result?.isError).mcp_call,false);
 observations.push(...Array.from({length:50},()=>({tool:'automation_generation_feedback'})));
 assert.equal(remainingBrowserCalls(observations),9);assert.equal(remainingBrowserCalls([{tool:'browser_navigate'},{tool:'browser_snapshot'}]),10);
 assert.equal(remainingBrowserCalls(Array.from({length:20},()=>({tool:'browser_click'}))),0);
});

test('a complete current-section receipt stops before tool requests belonging to a later section',async()=>{
 let calls=0,turns=0;
 const response={steps:[{step_id:'current'}],tool_calls:[{name:'browser_click',arguments:{locator:'#next'}}]};
 const result=await runAutomationBrowserAgent({browser:{tools:[{name:'browser_click'}],call:async()=>{calls++;}},prompt:'Current section only',parse:JSON.parse,
  onPartialBuild:async()=>({generation_mode:'sequential',generation_complete:true,active_step_id:'current',completed_step_ids:['current'],validation_errors:[]}),
  complete:async()=>{turns++;return JSON.stringify(response);}
 });
 assert.deepEqual(result,response);assert.equal(calls,0);assert.equal(turns,1);
});

test('sequential current tools finish before publishing a draft and safe tool failures cannot advance the section',async()=>{
 const order=[];let turns=0;
 const browser={tools:[{name:'browser_click'},{name:'browser_snapshot'}],call:async(name,args)=>{
  order.push(`${name}:${args.locator||''}`);
  if(name==='browser_click'&&args.locator==='#ambiguous')return {isError:true,content:[{type:'text',text:JSON.stringify({action_outcome:'not_attempted',retry_safe:true,message:'Locator matches two elements'})}]};
  return {content:[{type:'text',text:'Actual current-step evidence'}]};
 }};
 const result=await runAutomationBrowserAgent({browser,generationMode:'sequential',prompt:'Only current section',parse:JSON.parse,
  onPartialBuild:async()=>{order.push('validated');return {generation_mode:'sequential',generation_complete:true};},
  complete:async prompt=>{if(++turns>1)assert.match(prompt,/AUTOMATION_CURRENT_TOOL_BATCH_FAILED/);return JSON.stringify({steps:[{step_id:'current'}],tool_calls:[{name:'browser_click',arguments:{locator:turns===1?'#ambiguous':'#unique'}}]});}
 });
 assert.equal(result.steps[0].step_id,'current');assert.equal(turns,2);
 assert.deepEqual(order,['browser_click:#ambiguous','browser_click:#unique','browser_snapshot:','validated']);
});

test('a real sequential dependency is consumed before browser tools and cannot perform the blocked action',async()=>{
 let calls=0;
 const dependency=Object.assign(new Error('Mailbox missing'),{code:'AUTOMATION_DEPENDENCY_MISSING'});
 await assert.rejects(runAutomationBrowserAgent({browser:{tools:[{name:'browser_click'}],call:async()=>{calls++;}},generationMode:'sequential',prompt:'Only current section',parse:JSON.parse,
  onPartialBuild:async()=>{throw dependency;},complete:async()=>JSON.stringify({blocked_steps:[{step_id:'current'}],tool_calls:[{name:'browser_click',arguments:{locator:'#blocked'}}]})
 }),dependency);
 assert.equal(calls,0);
});
