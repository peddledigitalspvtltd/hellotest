const test=require('node:test');
const assert=require('node:assert/strict');
const {buildWithUpstreamPlaywright,projectWorkflowBrief,projectNativePageResult,projectNativeModelContext}=require('../../backend/lib/automationUpstreamEngineer');
const {assertInputBudget}=require('@hellotest/platform/backend/src/utils/llmRequestPolicy');

const story={ref:'requirement:story',story_revision:'revision',content:{title:'Amazon guest product journey',description:'Product code 9000017248, Parker Vector roller ball pen.',
 acceptance_criteria:['Price INR353','Discount12%','Cart quantity1']}};
const workflowBrief={workflow_scope:{project_id:'project',sprint_id:'sprint',story_id:'story'},selected_story:story,
 supplied_context:'Use the exact published product and preserve every expected result.',readiness_policy:'verify-inputs',
 content_provenance:{scope_owner:'workflow_runtime',upstream_reviews:'model_generated'},
 story_assurance:{summary:'Repeated model review. '.repeat(1000)},story_assurance_limitations:['Earlier model findings are hypotheses.'],
 case_assurance:{summary:'Repeated case review. '.repeat(1000),automation_readiness:{status:'needs_input',missing_context:[{kind:'fixture',reason:'Verify current availability.'}]}},
 case_assurance_limitations:['A code draft is not a passing run.'],test_data:{source:'synthetic',parameter_sources:{product_code:'existing'}}};
const step={id:'open',step_order:1,step_type:'web',action:'Open the homepage and verify the Search textbox',expected_result:'The search box and main navigation are visible.'};
const snapshot=()=>`### Snapshot\n\x60\x60\x60yaml\n- document [ref=e1]:\n${Array.from({length:5000},(_,index)=>`  - link "Unrelated catalog recommendation ${index} ${'商品説明'.repeat(5)}" [ref=e${index+2}]`).join('\n')}\n  - searchbox "Search Amazon.in" [ref=e9001]\n  - button "Search" [ref=e9002]\n\x60\x60\x60`;
const native=(code,text)=>({content:[{type:'text',text:`### Ran Playwright code\n\x60\x60\x60js\n${code}\n\x60\x60\x60\n${text}`} ]});

test('workflow model context retains the complete pinned product authority and user guidance while disclosing duplicated reviews',()=>{
 const projected=JSON.parse(projectWorkflowBrief(JSON.stringify(workflowBrief)));
 assert.deepEqual(projected.selected_story,story);
 assert.deepEqual(projected.workflow_scope,workflowBrief.workflow_scope);
 assert.equal(projected.supplied_context,workflowBrief.supplied_context);
 assert.deepEqual(projected.upstream_automation_readiness,workflowBrief.case_assurance.automation_readiness);
 assert.deepEqual(projected.test_data,workflowBrief.test_data);
 assert.equal(projected.story_assurance,undefined);assert.equal(projected.case_assurance,undefined);
 assert.ok(projected.context_delivery.omitted_upstream_review_fields.includes('case_assurance'));
 assert.equal(projectWorkflowBrief('Review this entire customer supplied narrative.'),'Review this entire customer supplied narrative.');
 assert.equal(projectWorkflowBrief('{"story_assurance":"User data without a native scope"}'),'{"story_assurance":"User data without a native scope"}');
});

test('large multibyte snapshots retain late exact native controls within their byte allowance without inventing absence',()=>{
 const result=projectNativePageResult({isError:false,content:[{type:'text',text:snapshot()}]},{step,maxBytes:24000});
 assert.ok(Buffer.byteLength(JSON.stringify(result))<24000);
 const text=result.content.map(block=>block.text).join('\n');
 assert.match(text,/- searchbox "Search Amazon\.in" \[ref=e9001\]/);
 assert.match(text,/- button "Search" \[ref=e9002\]/);
 assert.match(text,/omitted text is unknown/);assert.match(text,/browser_find/);
 assert.ok(result.omitted_page_lines>4000);
});

test('latest evidence and its separately retained page snapshot both use bounded projections',()=>{
 const page={tool:'browser_snapshot',arguments:'{}',result:{isError:false,content:[{type:'text',text:snapshot()}]}};
 const read={tool:'browser_find',arguments:'{"query":"Search"}',code:'',result:{isError:false,content:[{type:'text',text:'Search textbox [ref=e9001]'}]}};
 const result=projectNativeModelContext([page,read],{latest:read,snapshot:page,step});
 assert.ok(Buffer.byteLength(JSON.stringify(result.current_page_snapshot))<17000);
 assert.equal(result.latest_observation.result.content[0].text,'Search textbox [ref=e9001]');
 assert.equal(result.observations[0].result.isError,false);
 assert.equal(result.delivery.omitted_page_text_is_unknown,true);
});

async function actorFixture({click=false}={}){
 const requests=[],dispatched=[];
 const tools=[{name:'browser_navigate',inputSchema:{type:'object',properties:{url:{type:'string'}},required:['url'],additionalProperties:false}},
  {name:'browser_click',inputSchema:{type:'object',properties:{ref:{type:'string'}},required:['ref'],additionalProperties:false}}];
 const browser={tools,call:async(name,args)=>{dispatched.push({name,args});return native(name==='browser_navigate'?'await page.goto("https://www.amazon.in/");':'await page.getByRole("button",{name:"Search"}).click();',name==='browser_navigate'?snapshot():'The native click completed.');},close:async()=>{}};
 const complete=async request=>{
  requests.push(request);
  const packet=JSON.parse(request.prompt);
  const payload={model:'fixture',messages:[{role:'system',content:'Trusted instructions. '.repeat(200)},{role:'user',content:request.prompt}],
   tools:Array.from({length:19},(_,index)=>({type:'function',function:{name:`native_${index}`,description:'Native tool contract. '.repeat(25),parameters:{type:'object',properties:{ref:{type:'string'}}}}}))};
  assert.doesNotThrow(()=>assertInputBudget(payload));
  assert.deepEqual(packet.current_section,{id:step.id,action:step.action,expected_result:step.expected_result});
  assert.deepEqual(JSON.parse(packet.brief).selected_story,story);
  if(click&&requests.length===1)return{tool:{name:'browser_click',arguments:{ref:'e9002'}}};
  if(click)assert.equal(packet.current_page_snapshot,undefined,'A confirmed mutation without a replacement snapshot invalidates the older page state.');
  throw Object.assign(new Error('Inspected first model request without a provider call.'),{code:'AUDIT_CAPTURE_COMPLETE'});
 };
 await assert.rejects(buildWithUpstreamPlaywright({steps:[step],startUrl:'https://www.amazon.in/',brief:JSON.stringify(workflowBrief),browser,complete,interactive:true,
  parameterBindings:{parameterValues:{product_code:'9000017248'}},validate:()=>[]}),{code:'AUDIT_CAPTURE_COMPLETE'});
 return{requests,dispatched};
}

test('the actual first actor request fits the existing 96KB transport budget for a large page and repeated workflow reviews',async()=>{
 const result=await actorFixture();
 const actor=JSON.parse(result.requests[0].prompt);
 assert.match(actor.latest_observation.result.content.map(block=>block.text).join('\n'),/\[ref=e9001\]/);
 assert.deepEqual(result.dispatched.map(item=>item.name),['browser_navigate']);
});

test('the next actor never receives an obsolete full page after a native action',async()=>{
 const result=await actorFixture({click:true});
 assert.deepEqual(result.dispatched.map(item=>item.name),['browser_navigate','browser_click']);
 assert.equal(result.requests.length,2,'Compaction never repeats a successful native action.');
});

test('source handoff retains the current iframe snapshot, pinned Story and supplied guidance after verifier Done',async()=>{
 const startUrl='https://fixture.test/product',goto=`await page.goto(${JSON.stringify(startUrl)});`;
 const productStep={id:'model',step_order:1,step_type:'web',action:'Inspect the product information',expected_result:'Model Number equals @r.product_code.'};
 const page='### Snapshot\n- iframe "Product information" [ref=f1e1]:\n  - table "Product details" [ref=f1e2]:\n    - row "Model Number 9000017248" [ref=f1e3]:\n      - cell "9000017248" [ref=f1e4]';
 const source=[goto,'await expect(page.frameLocator("#product").getByRole("cell",{name:params["r.product_code"],exact:true})).toHaveText(params["r.product_code"]);'].join('\n');
 const requests=[],calls=[];
 const browser={tools:[{name:'browser_navigate',inputSchema:{type:'object',properties:{url:{type:'string'}}}},
  {name:'browser_verify_text_visible',inputSchema:{type:'object',properties:{text:{type:'string'}}}}],
  call:async(name)=>{calls.push(name);return name==='browser_navigate'?native(goto,page):native('await expect(page.getByText("9000017248")).toBeVisible();','### Result\nDone');},close:async()=>{}};
 const built=await buildWithUpstreamPlaywright({steps:[productStep],startUrl,brief:JSON.stringify(workflowBrief),context:{case:{title:'Product contract'}},
  parameterBindings:{parameterValues:{'r.product_code':'9000017248'}},interactive:true,browser,validate:()=>[],complete:async request=>{
   const packet=JSON.parse(request.prompt);requests.push({phase:request.phase,packet});
   if(request.phase==='upstream_browser_actor')return requests.filter(item=>item.phase===request.phase).length===1?
    {tool:{name:'browser_verify_text_visible',arguments:{text:'9000017248'}}}:{done:true};
   assert.equal(request.phase,'upstream_source');
   assert.deepEqual(JSON.parse(packet.brief).selected_story,story);
   assert.equal(JSON.parse(packet.brief).supplied_context,workflowBrief.supplied_context);
   assert.equal(packet.task_context.case.title,'Product contract');
   assert.match(JSON.stringify(packet.current_page_snapshot),/iframe.*Product information/);
   assert.match(JSON.stringify(packet.current_page_snapshot),/Model Number 9000017248/);
   assert.deepEqual(packet.final_observation.result,{isError:false});
   assert.ok(packet.observations.every(item=>!Object.hasOwn(item,'code')),'Native statements have one source field.');
   assert.doesNotMatch(JSON.stringify(packet.current_page_snapshot),/Ran Playwright code/);
   assert.match(packet.native_emitted_code,/getByText/);
   assert.equal(packet.observation_delivery.historical_find_refs_require_refresh_after_scoped_snapshot,true);
   return {automation_code:source};
  }});
 assert.equal(built.updates.length,1);assert.deepEqual(calls,['browser_navigate','browser_verify_text_visible']);
 const actors=requests.filter(item=>item.phase==='upstream_browser_actor').map(item=>item.packet);
 assert.deepEqual(actors[0].planner_budget.section_tool_calls,{limit:20,used:1,remaining:19,includes_host_snapshots:true});
 assert.deepEqual(actors[1].planner_budget.section_tool_calls,{limit:20,used:2,remaining:18,includes_host_snapshots:true});
 assert.deepEqual(actors[0].planner_budget.section_decisions,{limit:25,used:1,remaining:24});
 assert.deepEqual(actors[1].planner_budget.section_decisions,{limit:25,used:2,remaining:23});
 assert.ok(actors[1].planner_budget.remaining_time_ms<=actors[0].planner_budget.remaining_time_ms);
});

test('a source prompt exceeding the shared transport allowance fails without slicing primary facts or dispatching a model request',async()=>{
 const {generateUpstreamSectionSource}=require('../../backend/lib/automationUpstreamSectionSource');
 const brief='Pinned Story requirement: '+ 'Preserve this explicit product fact. '.repeat(3000);let modelCalls=0;
 await assert.rejects(generateUpstreamSectionSource({step,brief,emitted:'await page.goto("https://fixture.test/");',
  sourceContext:{latest_observation:{tool:'browser_verify_text_visible',result:{isError:false}},observations:[],delivery:{}},
  sourceBindings:{parameterValues:{}},privateScope:{references:{},availability:{}},complete:async()=>{modelCalls++;},validate:()=>[]}),{code:'AI_INPUT_BUDGET_EXCEEDED'});
 assert.equal(modelCalls,0);
 assert.ok(brief.endsWith('Preserve this explicit product fact. '));
});
