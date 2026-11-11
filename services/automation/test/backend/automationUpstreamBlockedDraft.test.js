const test=require('node:test');
const assert=require('node:assert/strict');
const {buildWithUpstreamPlaywright}=require('../../backend/lib/automationUpstreamEngineer');
const {inspectExecutablePlan}=require('../../backend/services/automationReadiness.service');
const startUrl='https://shop.test/product';
const goto=`await page.goto(${JSON.stringify(startUrl)});`;
const click='await page.getByRole("button",{name:"Search",exact:true}).click();';
const price='await expect(page.getByTestId("price")).toHaveText(params["r.price"]);';
const native=(code,text)=>({content:[{type:'text',text:`### Ran Playwright code\n\x60\x60\x60js\n${code}\n\x60\x60\x60\n### Snapshot\n${text}`}],isError:false});
const tools=[{name:'browser_navigate',inputSchema:{type:'object',properties:{url:{type:'string'}},required:['url']}},
 {name:'browser_click',inputSchema:{type:'object',properties:{ref:{type:'string'}},required:['ref']}}];

test('a real business mismatch stops live work but the LLM authors all sections with the original oracle',async()=>{
 const steps=[{id:'search',step_order:1,step_type:'web',action:'Click Search',expected_result:'The product is displayed'},
  {id:'price',step_order:2,step_type:'web',action:'Check the product price',expected_result:'The price is @r.price'},
  {id:'cart',step_order:3,step_type:'web',action:'Click Add to cart',expected_result:'The cart price is @r.price'}];
 const calls=[],sources=[],saved=[],events=[];let turns=0;
 const result=await buildWithUpstreamPlaywright({steps,startUrl,interactive:true,parameterBindings:{parameterValues:{'r.price':'353'}},validate:inspectExecutablePlan,
  browser:{tools,call:async(name,args)=>{calls.push({name,args});return native(name==='browser_navigate'?goto:click,'- text "Price 400"\n- button "Add to cart" [ref=e2]');},close:async()=>{}},
  onSection:async(update,evidence)=>saved.push({update,evidence}),onProgress:async event=>events.push(event),
  complete:async request=>{
   const packet=JSON.parse(request.prompt);
   if(request.phase==='upstream_browser_actor'){
    if(request.step.id==='search')return ++turns===1?{tool:{name:'browser_click',arguments:{ref:'e1'}}}:{done:true};
    assert.equal(request.step.id,'price');return {blocked_reason:'Observed price is 400; the fixed expected price is 353.'};
   }
   assert.equal(request.phase,'upstream_source');sources.push(packet);
   if(request.step.id==='search')return {automation_code:[goto,click,'await expect(page.getByRole("button",{name:"Add to cart",exact:true})).toBeVisible();'].join('\n')};
   assert.equal(packet.authoring_only,true);assert.equal(packet.live_validation.status,'blocked');
   return {automation_code:request.step.id==='price'?price:'await page.getByRole("button",{name:"Add to cart",exact:true}).click();\nawait expect(page.getByTestId("cart-price")).toHaveText(params["r.price"]);'};
  }});
 assert.equal(result.updates.length,3);assert.deepEqual(calls.map(call=>call.name),['browser_navigate','browser_click']);
 assert.equal(result.browser_evidence.live_validation.status,'blocked');assert.equal(result.browser_evidence.live_validation.stopped_at_step_id,'price');
 assert.equal(result.side_effects.browser_actions,1);assert.equal(saved[2].evidence.execution_status,'not_executed');
 assert.match(result.updates[1].automation_code,/params\["r.price"\]/);assert.doesNotMatch(result.updates[1].automation_code,/400/);
 assert.equal(sources[2].observation_delivery.page_state,'last_live_observation_before_authoring_stopped');
 assert.deepEqual(sources[2].observation_delivery.planned_sections_after_observation,['price']);
 assert.equal(events.filter(event=>event.phase==='automation.agent.validation.blocked').length,1);
});

test('a known navigation failure can produce a draft with confirmed prefix and planned suffix without replay',async()=>{
 const calls=[],sourceCalls=[];
 const result=await buildWithUpstreamPlaywright({steps:[{id:'retryable-site',step_order:1,step_type:'web',action:'Open the product',expected_result:'The product price is @r.price'}],startUrl,interactive:true,
  parameterBindings:{parameterValues:{'r.price':'353'}},validate:inspectExecutablePlan,
  browser:{tools,call:async name=>{calls.push(name);return native(goto,'- heading "503 Service Unavailable"');},close:async()=>{}},
  complete:async request=>{if(request.phase==='upstream_browser_actor')return {blocked_reason:'The document is a 503 Service Unavailable page.'};
   sourceCalls.push(JSON.parse(request.prompt));return {automation_code:[goto,price].join('\n')};}});
 assert.deepEqual(calls,['browser_navigate']);assert.equal(sourceCalls.length,1);
 assert.equal(result.browser_evidence.live_validation.status,'blocked');assert.match(result.updates[0].automation_code,/toHaveText/);
});

test('unavailable executable contracts remain explicit input gaps instead of invented credentials or selectors',async()=>{
 const calls=[];
 await assert.rejects(buildWithUpstreamPlaywright({steps:[{id:'fixture',step_order:1,step_type:'web',action:'Open the configured custom tenant',expected_result:'The tenant is available'}],startUrl,interactive:true,validate:inspectExecutablePlan,
  browser:{tools,call:async name=>{calls.push(name);return native(goto,'- heading "Public page"');},close:async()=>{}},
  complete:async request=>request.phase==='upstream_browser_actor'?{blocked_reason:'The required custom tenant is not supplied.'}
   :{input_required:{reason:'Supply the custom tenant URL.',required_context:['Custom tenant URL'],required_parameters:[]}}}),error=>{
  assert.equal(error.code,'AUTOMATION_DEPENDENCY_MISSING');assert.deepEqual(error.blocked_steps[0].required_context,['Custom tenant URL']);return true;
 });
 assert.deepEqual(calls,['browser_navigate']);
});
