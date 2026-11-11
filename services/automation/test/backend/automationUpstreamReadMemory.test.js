const test=require('node:test');
const assert=require('node:assert/strict');
const {buildWithUpstreamPlaywright,projectNativeModelContext,projectNativePageResult,repeatedNativeReadFeedback}=require('../../backend/lib/automationUpstreamEngineer');
const {inspectExecutablePlan}=require('../../backend/services/automationReadiness.service');
const {assertInputBudget}=require('@hellotest/platform/backend/src/utils/llmRequestPolicy');

const step={id:'details',step_order:8,step_type:'web',action:'Open the product information and inspect @r.product_code',expected_result:'Product information is visible and its exact Model Number equals @r.product_code.'};
const parameters={'r.product_code':'9000017248'};
const details='### Result\n- heading "Product information" [ref=f1e1592]\n- row "Model Number ‎9000017248" [ref=f1e1613]:\n  - rowheader "Model Number" [ref=f1e1614]\n  - cell "‎9000017248" [ref=f1e1615]';
const result=text=>({isError:false,content:[{type:'text',text}]});
const read=(tool,args,text,code='')=>({tool,arguments:JSON.stringify(args),result:result(text),code});
const textOf=value=>JSON.stringify(value);

test('exact targeted rows survive a broad verifier and a shallow snapshot without an intervening mutation',()=>{
 const found=read('browser_find',{text:'9000017248',maxResults:10},details);
 const verified=read('browser_verify_element_visible',{role:'heading',accessibleName:'Product information'},'Done',"await expect(page.getByRole('heading',{name:'Product summary presents key'})).toBeVisible();");
 const shallow=read('browser_snapshot',{depth:2},'### Snapshot\n- document [ref=f1e1]\n  - banner [ref=f1e2]');
 const packet=projectNativeModelContext([found,verified,shallow],{latest:shallow,snapshot:shallow,step,parameters});
 assert.match(textOf(packet.observations),/Model Number/);assert.match(textOf(packet.observations),/f1e1615/);
 assert.equal(packet.delivery.targeted_find_results_retained,1);
});

test('targeted evidence is deduplicated and UTF-8 bounded over twenty finds while older precise rows remain available',()=>{
 const noise=Array.from({length:2000},(_,i)=>`- generic "商品説明 unrelated recommendation ${i}" [ref=n${i}]`).join('\n');
 const found=read('browser_find',{text:'9000017248'},noise+'\n'+details);
 found.result=projectNativePageResult(found.result,{step,parameters,maxBytes:60000});
 const observations=[found,...Array.from({length:19},(_,i)=>read('browser_find',{text:'Product information',maxResults:i+1},noise+'\n- heading "Product information" [ref=f1e1592]'))];
 const latest=read('browser_verify_element_visible',{role:'heading',accessibleName:'Product information'},'Done','await expect(page.locator("#summary")).toBeVisible();');
 observations.push(latest);
 const packet=projectNativeModelContext(observations,{latest,step,parameters});
 const retained=packet.observations.filter(item=>item.tool==='browser_find'&&item.result.content);
 assert.equal(retained.length,2);assert.equal(packet.delivery.targeted_find_results_retained,2);
 assert.ok(retained.reduce((n,item)=>n+Buffer.byteLength(JSON.stringify(item.result)),0)<=8000);
 assert.match(textOf(packet.observations),/f1e1615/);
 assert.ok(packet.observations.length<=10,'A bounded find window does not retain an unbounded page history.');
 assert.doesNotThrow(()=>assertInputBudget({model:'fixture',messages:[{role:'system',content:'Trusted policy. '.repeat(300)},{role:'user',content:textOf(packet)}],tools:[{type:'function',function:{name:'browser_find',description:'Native contract. '.repeat(500),parameters:{type:'object'}}}]}));
});

test('a small retained find prioritizes the current model cell and its row label over unrelated case URLs and titles',()=>{
 const unrelated=Array.from({length:50},(_,i)=>`- heading "Parker Vector Standard Roller Ball Blue 9000017248" [ref=title${i}]\n  - /url: https://www.amazon.in/Parker-Vector-Standard-Roller-Ball/dp/B00LZPR246?keywords=9000017248&position=${i}`).join('\n');
 const found=read('browser_find',{text:'9000017248'},unrelated+'\n'+details),latest=read('browser_snapshot',{depth:2},'### Snapshot\n- document [ref=top]');
 const packet=projectNativeModelContext([found,latest],{latest,step,parameters:{...parameters,'r.home_url':'https://www.amazon.in/','r.product_reference_url':'https://www.amazon.in/Parker-Vector-Standard-Roller-Ball/dp/B00LZPR246','r.expected_unit_price':'INR 353.00'}});
 assert.match(textOf(packet.observations),/f1e1614/);assert.match(textOf(packet.observations),/f1e1615/);
 assert.match(textOf(packet.observations),/Model Number/);
});

test('a mutation or tab selection invalidates old targeted refs and a stale supplied snapshot; listing tabs does not',()=>{
 for(const mutation of [read('browser_click',{target:'button'},'Click complete'),read('browser_type',{target:'input',text:'new'},'Input complete'),read('browser_tabs',{action:'select',index:1},'Selected tab')]){
  const found=read('browser_find',{text:'9000017248'},details),snapshot=read('browser_snapshot',{},details);
  const packet=projectNativeModelContext([found,snapshot,mutation],{latest:mutation,snapshot,step,parameters});
  assert.equal(packet.delivery.targeted_find_results_retained,0);assert.equal(packet.current_page_snapshot,undefined);
  assert.doesNotMatch(textOf(packet),/f1e1615/);
 }
 const found=read('browser_find',{text:'9000017248'},details),listed=read('browser_tabs',{action:'list'},'One tab');
 assert.match(textOf(projectNativeModelContext([found,listed],{latest:listed,step,parameters})),/f1e1615/);
});

test('repeated read feedback uses canonical arguments and unchanged native evidence, and resets on mutations',()=>{
 const code='await expect(page.getByRole("heading",{name:"Product summary presents key"})).toBeVisible();';
 const first=read('browser_verify_element_visible',{role:'heading',accessibleName:'Product information'},'Done',code);
 const second=read('browser_verify_element_visible',{accessibleName:'Product information',role:'heading'},'Done with fresh surrounding snapshot',code);
 assert.equal(repeatedNativeReadFeedback([first]),undefined);
 const feedback=repeatedNativeReadFeedback([first,second]);
 assert.equal(feedback.matching_observations,2);assert.equal(feedback.returned_native_code,code);
 assert.match(feedback.message,/different precise native find/);assert.match(feedback.message,/do not.*force completion/);
 assert.equal(repeatedNativeReadFeedback([first,read('browser_tabs',{action:'select',index:1},'Selected'),second]),undefined);
 assert.equal(repeatedNativeReadFeedback([first,{...second,code:code.replace('Product summary presents key','Product information')}]),undefined);
});

test('ambiguous native verifiers recover through observed model-row evidence without replaying the completed click',async()=>{
 const startUrl='https://fixture.test/product',goto=`await page.goto(${JSON.stringify(startUrl)});`;
 const click='await page.getByRole("heading",{name:"Product information",exact:true}).click();';
 const wrong='await expect(page.getByRole("heading",{name:"Product summary presents key"})).toBeVisible();';
 const native=(code,text='')=>result(`### Ran Playwright code\n\x60\x60\x60js\n${code}\n\x60\x60\x60\n${text}`);
 const calls=[],requests=[];let turn=0;
 const browser={tools:[
  {name:'browser_navigate',inputSchema:{type:'object',properties:{url:{type:'string'}},required:['url']}},
  {name:'browser_click',inputSchema:{type:'object',properties:{target:{type:'string'}},required:['target']}},
  {name:'browser_verify_element_visible',inputSchema:{type:'object',properties:{role:{type:'string'},accessibleName:{type:'string'}},required:['role','accessibleName']}},
  {name:'browser_find',inputSchema:{type:'object',properties:{regex:{type:'string'}},required:['regex']}},
  {name:'browser_generate_locator',inputSchema:{type:'object',properties:{target:{type:'string'}},required:['target']}}
 ],call:async(name,args)=>{calls.push({name,args});return name==='browser_navigate'?native(goto,details):name==='browser_click'?native(click,details):name==='browser_verify_element_visible'?native(wrong,'Done'):name==='browser_find'?result(details):result('page.getByRole("row").filter({has:page.getByRole("rowheader",{name:"Model Number",exact:true})}).getByRole("cell")');},close:async()=>{}};
 const source=[goto,click,'await expect(page.getByRole("heading",{name:"Product information",exact:true})).toBeVisible();','const row=page.getByRole("row").filter({has:page.getByRole("rowheader",{name:"Model Number",exact:true})});','await expect.poll(async()=> (await row.getByRole("cell").innerText()).replace(/\\p{Cf}/gu, "").trim()).toBe(params["r.product_code"]);'].join('\n');
 const built=await buildWithUpstreamPlaywright({steps:[step],startUrl,browser,interactive:true,parameterBindings:{parameterValues:parameters},validate:inspectExecutablePlan,complete:async request=>{
  requests.push(request);const packet=JSON.parse(request.prompt.slice(request.phase==='upstream_instruction_mapping'?request.prompt.indexOf('{"task":'):0));
  if(request.phase==='upstream_browser_actor'){
   turn++;assert.match(packet.native_verification_contract,/substring matching/);
   if(turn===1)return {tool:{name:'browser_click',arguments:{target:'f1e1592'}}};
   if(turn<=3)return {tool:{name:'browser_verify_element_visible',arguments:{role:'heading',accessibleName:'Product information'}}};
   if(turn===4){assert.equal(packet.host_feedback.code,'AUTOMATION_UPSTREAM_READ_REPEATED');assert.match(packet.host_feedback.returned_native_code,/Product summary presents key/);return {tool:{name:'browser_find',arguments:{regex:'rowheader "Model Number"'}}};}
   if(turn===5){assert.match(textOf(packet.latest_observation),/f1e1615/);return {tool:{name:'browser_generate_locator',arguments:{target:'f1e1615'}}};}
   assert.match(textOf(packet.recent_section_observations),/f1e1615/);return {done:true};
  }
  if(request.phase==='upstream_source'){assert.match(textOf(packet.observations),/f1e1615/);return {automation_code:source};}
  const entry=packet.steps[0];return {schema:'hellotest.playwrightInstructionMapping.v1',steps:[{step_id:step.id,source_sha256:entry.source_sha256,instructions:entry.operations.map(operation=>({operation_id:operation.operation_id,kind:operation.kind,depth:operation.depth,label:'Retained native operation',args:[]}))}]};
 }});
 assert.equal(calls.filter(call=>call.name==='browser_click').length,1);
 assert.equal(calls.filter(call=>call.name==='browser_verify_element_visible').length,2);
 assert.equal(built.updates.length,1);assert.match(built.updates[0].automation_code,/Model Number/);assert.match(built.updates[0].automation_code,/toBe\(params\["r.product_code"\]\)/);
 assert.doesNotMatch(built.updates[0].automation_code,/Product summary presents key/);
 assert.equal(requests.filter(request=>request.phase==='upstream_source').length,1);
});
