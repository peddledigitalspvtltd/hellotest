const test = require('node:test');
const assert = require('node:assert/strict');
const {runAutomationBrowserAgent,compactBrowserObservations}=require('../../backend/lib/automationBrowserAgent');
const {browserPromptContext}=require('../../backend/lib/automationBrowserContext');

const receipt=(value,isError=false)=>({isError,content:[{type:'text',text:JSON.stringify({source:'playwright',...value})}]});
const tools=['browser_navigate','browser_snapshot','browser_fill','browser_click','browser_assert'].map(name=>({name}));

test('bare model locator assertions are awaited and really checked before their canonical source is saved',async()=>{
 const calls=[],events=[];let turns=0,saved=0;
 const source='expect(page.getByRole("heading",{name:"Sign up"})).toBeVisible();';
 const browser={tools,call:async(name,args)=>{calls.push({name,args});return receipt({url:'https://app.test/signup',...(name==='browser_assert'?{assertion_outcome:'satisfied'}:{accessibility:'Sign up heading'})});}};
 const result=await runAutomationBrowserAgent({browser,prompt:'Navigate to signup',generationMode:'sequential',execution:{required:true,step_id:'signup',expected_result:'Signup form displayed'},parse:JSON.parse,
  initialObservations:[{tool:'browser_snapshot',result:receipt({url:'https://app.test/signup',accessibility:'Sign up heading'})}],onProgress:event=>events.push(event),
  complete:async()=>{turns++;return JSON.stringify({steps:[{step_id:'signup',automation_code:source}]});},
  onPartialBuild:async payload=>{saved++;assert.equal(payload.steps[0].automation_code,`await ${source}`);return {generation_mode:'sequential',generation_complete:true};}
 });
 assert.equal(result.steps[0].automation_code,`await ${source}`);assert.equal(turns,1);assert.equal(saved,1);
 assert.equal(calls.filter(call=>call.name==='browser_assert').length,1);
 assert.equal(events.filter(event=>event.phase==='automation.agent.output.normalized').length,1);
});

test('a failed input or read stops a dependent submit in the same model batch',async()=>{
 for(const failure of ['invalid','not_attempted','read_transport']){
  const calls=[];let turns=0;
  const first=failure==='invalid'?'unavailable_tool':failure==='read_transport'?'browser_assert':'browser_fill';
  const browser={tools,call:async name=>{
   calls.push(name);
   if(failure==='read_transport')throw new Error('Read response lost');
   return receipt({action_outcome:'not_attempted',retry_safe:true,message:'Input matches two elements'},true);
  }};
  const result=await runAutomationBrowserAgent({browser,prompt:'Fill then submit',parse:JSON.parse,
   complete:async prompt=>{
    if(++turns===1)return JSON.stringify({tool_calls:[{name:first,arguments:{locator:'#input',value:'fixture'}},{name:'browser_click',arguments:{locator:'#submit'}}]});
    assert.match(prompt,/not_attempted|No browser action was performed/);
    return '{"steps":[]}';
   }});
  assert.deepEqual(result,{steps:[]});
  assert.deepEqual(calls,failure==='invalid'?[]:[first],failure);
 }
});

test('a navigation transition pauses queued locators and exposes the new page before continuing',async()=>{
 for(const trigger of ['browser_click','browser_navigate']){
  const calls=[],observations=[];let turns=0,published=0;
  const initial={tool:'browser_snapshot',result:receipt({url:'https://app.test/login',accessibility:'Sign up link'})};
  const browser={tools,call:async(name,args)=>{
   calls.push([name,args]);
   return receipt({url:'https://app.test/signup',...(name==='browser_snapshot'?{accessibility:'Current signup page',elements:[{locator_candidates:['getByLabel("Email")']}]}:{action_outcome:'completed'})});
  }};
  const result=await runAutomationBrowserAgent({browser,prompt:'Open signup then enter email',generationMode:'sequential',parse:JSON.parse,initialObservations:[initial],onObservation:item=>observations.push(item),
   onPartialBuild:async()=>{published++;return {generation_mode:'sequential',generation_complete:true};},
   complete:async prompt=>{
    if(++turns===1)return JSON.stringify({steps:[{step_id:'signup'}],tool_calls:[{name:trigger,arguments:trigger==='browser_navigate'?{url:'https://app.test/signup'}:{locator:'#signup'}},{name:'browser_fill',arguments:{locator:'#stale-email',value:'fixture'}}]});
    assert.match(prompt,/BROWSER_TOOL_BATCH_PAUSED/);assert.match(prompt,/Current signup page/);assert.equal(published,0);
    return JSON.stringify({steps:[{step_id:'signup'}],tool_calls:[{name:'browser_fill',arguments:{locator:'getByLabel("Email")',value:'fixture'}}]});
   }});
  assert.equal(result.steps[0].step_id,'signup');assert.equal(published,1);assert.equal(turns,2);
  assert.equal(calls.filter(([name])=>name===trigger).length,1,'completed navigation must not replay');
  assert.equal(calls.some(([,args])=>args.locator==='#stale-email'),false);
  assert.equal(calls.find(([name])=>name==='browser_fill')[1].locator,'getByLabel("Email")');
  assert.equal(observations.filter(item=>item.tool==='automation_browser_batch_feedback').length,1);
 }
});

test('latest accessible page retains typed locator context after screenshots and generation feedback',()=>{
 const observations=Array.from({length:20},(_,index)=>({tool:'browser_snapshot',result:receipt({url:`https://app.test/old/${index}`,accessibility:'old '.repeat(3000)})}));
 observations.push({tool:'browser_snapshot',result:receipt({url:'https://app.test/current',accessibility:'Current page '.repeat(2000),elements:Array.from({length:60},(_,index)=>({name:`Field ${index}`,locator_candidates:[`getByLabel("Field ${index}")`],description:'Context '.repeat(50)}))})});
 observations.push({tool:'browser_screenshot',result:receipt({url:'https://app.test/current'})});
 observations.push(...Array.from({length:3},()=>({tool:'automation_generation_feedback',result:receipt({completed_step_ids:['previous'],validation_errors:[]})})));
 const packed=compactBrowserObservations(observations);
 assert.ok(JSON.stringify(packed).length<=32000);
 const current=packed.find(item=>item.tool==='browser_snapshot'&&item.result.content?.some(part=>part.text.includes('/current')));
 const page=JSON.parse(current.result.content[0].text);
 assert.equal(page.url,'https://app.test/current');assert.ok(page.elements.length>0);assert.ok(page.elements[0].locator_candidates.length>0);
 assert.ok(page.accessibility.length>1800);assert.equal(page.omitted_structured_fields,undefined);
});

test('a snapshot from the previous URL is explicitly stale when the new page capture is unavailable',()=>{
 const old={tool:'browser_snapshot',result:receipt({url:'https://app.test/login',accessibility:'Old login elements'})};
 const navigate={tool:'browser_navigate',result:receipt({url:'https://app.test/signup',action_outcome:'completed'})};
 const failed={tool:'browser_snapshot',result:receipt({url:'https://app.test/signup',code:'BROWSER_READ_UNAVAILABLE'},true)};
 const packed=compactBrowserObservations([old,navigate,failed]);
 assert.equal(packed[0].stale_page,true);assert.equal(packed[1].stale_page,undefined);
});

test('failed same-URL navigation invalidates old controls and earlier expected-result evidence',()=>{
 const {interactiveEvidenceFeedback}=require('../../backend/lib/automationInteractiveEvidence');
 const observations=[{tool:'browser_snapshot',execution_step_id:'signup',result:receipt({url:'https://app.test/signup',elements:[{tag:'input',locator_candidates:['#email']}]})},{tool:'browser_assert',execution_step_id:'signup',result:receipt({assertion_outcome:'satisfied'})},{tool:'browser_navigate',execution_step_id:'signup',result:receipt({code:'BROWSER_NAVIGATION_FAILED',url:'https://app.test/signup',action_outcome:'not_attempted'},true)}];
 assert.equal(browserPromptContext(observations,'signup').current.snapshot_available,false);
 for(const expected_result of ['Signup visible','']){
  const feedback=interactiveEvidenceFeedback({payload:{steps:[{step_id:'signup',automation_code:'await expect(page.locator("#email")).toBeVisible();'}]},execution:{required:true,step_id:'signup',expected_result},observations});
  assert.equal(feedback.expected_result_check,'browser_assert_required_after_actions');
 }
});

test('navigation exposes its fresh destination before a queued target assertion and never replays navigation',async()=>{
 const calls=[],observations=[];let turns=0,saved=0;
 const browser={tools,call:async name=>{
  calls.push(name);
  return receipt({url:'https://app.test/auth',...(name==='browser_navigate'?{action_outcome:'completed'}:name==='browser_assert'?{assertion_outcome:'satisfied'}:{accessibility:'Welcome back heading'})});
 }};
 const step={step_id:'entry',automation_code:'await page.goto("https://app.test"); await expect(page.getByRole("heading",{name:"Welcome back"})).toBeVisible();'};
 const result=await runAutomationBrowserAgent({browser,prompt:'Open entry page',generationMode:'sequential',execution:{required:true,step_id:'entry',expected_result:'Welcome back is visible'},parse:JSON.parse,
  initialObservations:[{tool:'browser_snapshot',result:receipt({url:'https://app.test/login',accessibility:'Previous login page'})}],
  onObservation:item=>observations.push(item),
  complete:async prompt=>{
   turns++;
   if(turns===1)return JSON.stringify({steps:[step],tool_calls:[{name:'browser_navigate',arguments:{url:'https://app.test'}},{name:'browser_snapshot',arguments:{}},{name:'browser_assert',arguments:{assertion:'visible',locator:'getByRole("heading",{name:"Welcome back"})'}}]});
   assert.equal(saved,0);
   assert.match(prompt,/BROWSER_TOOL_BATCH_PAUSED/);
   assert.match(prompt,/Welcome back heading/);
   assert.deepEqual(calls,['browser_navigate','browser_snapshot'],'the queued target assertion waits for the destination evidence');
   return JSON.stringify({steps:[step],tool_calls:[{name:'browser_assert',arguments:{assertion:'visible',locator:'getByRole("heading",{name:"Welcome back"})'}}]});
  },
  onPartialBuild:async()=>{saved++;return {generation_mode:'sequential',generation_complete:true};}
 });
 assert.equal(result.steps[0].step_id,'entry');assert.equal(turns,2);assert.equal(saved,1);
 assert.deepEqual(calls,['browser_navigate','browser_snapshot','browser_assert']);
 const paused=observations.find(item=>item.tool==='automation_browser_batch_feedback');
 assert.deepEqual(JSON.parse(paused.result.content[0].text).unattempted_tools,['browser_snapshot','browser_assert']);
 assert.equal(observations.filter(item=>item.tool==='browser_navigate').length,1);
});

test('a confirmed same-page reload keeps semantic locators usable without repeatedly reopening the page',async()=>{
 let turns=0,saved=0;const calls=[];
 const elements=[{tag:'input',label:'Email',attributes:{id:'email'},locator_candidates:['getByLabel("Email",{exact:true})']}];
 const browser={tools,call:async name=>{calls.push(name);return receipt({url:'https://app.test/signup',...(name==='browser_assert'?{assertion_outcome:'satisfied'}:name==='browser_snapshot'?{accessibility:'Email field',elements}:{action_outcome:'completed'})});}};
 const candidate={step_id:'email',automation_code:'await page.goto("https://app.test/signup"); await page.getByLabel("Email",{exact:true}).fill("fixture"); await expect(page.getByLabel("Email",{exact:true})).toHaveValue("fixture");'};
 await runAutomationBrowserAgent({browser,prompt:'Open signup and enter email',generationMode:'sequential',execution:{required:true,step_id:'email',expected_result:'Email populated'},parse:JSON.parse,
  initialObservations:[{tool:'browser_snapshot',result:receipt({url:'https://app.test/signup',accessibility:'Email field',elements})}],
  complete:async()=>{turns++;return JSON.stringify({steps:[candidate],tool_calls:[{name:'browser_navigate',arguments:{url:'https://app.test/signup'}},{name:'browser_fill',arguments:{locator:'getByLabel("Email",{exact:true})',value:'fixture'}},{name:'browser_assert',arguments:{assertion:'value',locator:'getByLabel("Email",{exact:true})',value:'fixture'}}]});},
  onPartialBuild:async()=>{saved++;return {generation_mode:'sequential',generation_complete:true};}
 });
 assert.equal(turns,1);assert.equal(saved,1);assert.equal(calls.filter(name=>name==='browser_navigate').length,1);assert.equal(calls.filter(name=>name==='browser_fill').length,1);
});

test('model context separates current static evidence from replaced controls and scopes completed actions',()=>{
 const observations=[
  {tool:'browser_snapshot',execution_step_id:'email',result:receipt({url:'https://app.test/contact',accessibility:'Old Email address input',elements:[{locator_candidates:['input#email']}]})},
  {tool:'browser_fill',execution_step_id:'email',arguments:{locator:'input#email',value:'private-input-value'},result:receipt({action_outcome:'completed'})},
  {tool:'browser_click',execution_step_id:'review',arguments:{locator:'button#continue'},result:receipt({action_outcome:'completed',url:'https://app.test/contact'})},
  {tool:'browser_assert',execution_step_id:'review',arguments:{locator:'input#email',assertion:'value',value:'private-input-value'},result:receipt({assertion_outcome:'not_satisfied'},true)},
  {tool:'browser_snapshot',execution_step_id:'review',result:receipt({url:'https://app.test/contact',accessibility:'Review details and supplied email',elements:[{locator_candidates:['#review-email']}]})}
 ];
 const context=browserPromptContext(observations,'review');
 assert.equal(context.current.current_snapshot.accessibility,'Review details and supplied email');
 assert.deepEqual(context.current.completed_actions,{browser_click:1});
 assert.equal(context.current.recent_section_receipts.at(-1).failed,true);
 assert.match(JSON.stringify(context.current.current_snapshot),/#review-email/);
 assert.doesNotMatch(JSON.stringify(context.history),/Old Email address input|locator_candidates/);
 assert.doesNotMatch(JSON.stringify(context.current),/private-input-value/);
});

test('fresh review evidence prevents a stale input assertion and reuses the completed submission receipt',async()=>{
 const calls=[],observations=[],events=[];let turns=0,saved=0;
 const browser={tools,call:async(name,args)=>{
  calls.push({name,args});
  if(name==='browser_assert'&&args.locator==='input#email')return receipt({assertion_outcome:'not_satisfied',action_outcome:'not_attempted',retry_safe:true},true);
  return receipt({url:'https://app.test/review',...(name==='browser_click'?{action_outcome:'completed'}:name==='browser_assert'?{assertion_outcome:'satisfied'}:{accessibility:'Review details',elements:[{locator_candidates:['#review-email']}]})});
 }};
 await runAutomationBrowserAgent({browser,prompt:'Continue and verify the supplied email',generationMode:'sequential',execution:{required:true,step_id:'review',expected_result:'Review shows the supplied email'},parse:JSON.parse,maxCalls:5,
  initialObservations:[{tool:'browser_snapshot',result:receipt({url:'https://app.test/form',accessibility:'Email input and Continue button',elements:[{tag:'input',locator_candidates:['input#email']},{tag:'button',locator_candidates:['button#continue']}]})}],
  onObservation:item=>observations.push(item),onProgress:event=>events.push(event),
  complete:async prompt=>{
   turns++;
   if(turns===2){
    assert.equal(saved,0);
    assert.match(prompt,/BROWSER_TOOL_BATCH_PAUSED/);
    assert.match(prompt,/Review details/);
    assert.equal(calls.some(call=>call.name==='browser_assert'),false,'the obsolete input check never reaches the browser');
    assert.equal(calls.filter(call=>call.name==='browser_click').length,1);
   }
   const target=turns===1?'input#email':'#review-email';
   return JSON.stringify({steps:[{step_id:'review',automation_code:`await page.locator("button#continue").click(); await expect(page.locator("${target}")).toHaveText("@t.email");`}],tool_calls:[{name:'browser_click',arguments:{locator:'button#continue'}},{name:'browser_assert',arguments:{assertion:'text',locator:target,value:'@t.email'}}]});
  },onPartialBuild:async()=>{saved++;return {generation_mode:'sequential',generation_complete:true};}
 });
 assert.equal(turns,2);assert.equal(saved,1);
 assert.equal(calls.filter(call=>call.name==='browser_click').length,1);
 assert.deepEqual(calls.filter(call=>call.name==='browser_assert').map(call=>call.args.locator),['#review-email']);
 assert.equal(observations.filter(item=>item.tool==='automation_browser_batch_feedback').length,1);
 assert.equal(events.filter(event=>event.phase==='automation.agent.action.failed').length,0,'fresh evidence avoids an avoidable failed assertion');
 const reused=observations.filter(item=>item.tool==='automation_action_reconciliation');
 assert.equal(reused.length,1);assert.equal(reused[0].mcp_call,false);
 assert.equal(observations.filter(item=>item.tool==='browser_click').length,1);
 assert.equal(events.filter(event=>event.phase==='automation.agent.action.started'&&event.details.tool==='browser_click').length,1);
 assert.equal(JSON.parse(reused[0].result.content[0].text).source_action_id,observations.find(item=>item.tool==='browser_click').action_id);
});

test('a real fill of another field cannot substantiate revised source until its exact target and value are performed',async()=>{
 const calls=[];let turns=0,saved=0;
 const browser={tools,call:async(name,args)=>{calls.push({name,args});return receipt({action_outcome:'completed'});}};
 await runAutomationBrowserAgent({browser,prompt:'Populate the phone',generationMode:'sequential',execution:{required:true,step_id:'phone',expected_result:''},parse:JSON.parse,
  complete:async prompt=>{
   turns++;
   if(turns===2){assert.equal(saved,0);assert.match(prompt,/missing_actions/);}
   return JSON.stringify({steps:[{step_id:'phone',automation_code:'await page.locator("#phone").fill("@t.phone");'}],tool_calls:[{name:'browser_fill',arguments:turns===1?{locator:'#email',value:'@t.email'}:{locator:'#phone',value:'@t.phone'}}]});
  },onPartialBuild:async()=>{saved++;return {generation_mode:'sequential',generation_complete:true};}
 });
 assert.equal(turns,2);assert.equal(saved,1);
 assert.deepEqual(calls.filter(call=>call.name==='browser_fill').map(call=>call.args.locator),['#email','#phone']);
});

test('invalid semantic locator wrappers get source correction before dispatching the proposed browser action',async()=>{
 const calls=[];let turns=0,saved=0;
 const browser={tools,call:async(name,args)=>{calls.push({name,args});return receipt({action_outcome:'completed'});}};
 await runAutomationBrowserAgent({browser,prompt:'Populate email',generationMode:'sequential',execution:{required:true,step_id:'email',expected_result:''},parse:JSON.parse,
  complete:async prompt=>{
   turns++;
   if(turns===2){assert.equal(calls.length,0);assert.match(prompt,/AUTOMATION_GENERATED_SOURCE_INVALID/);assert.match(prompt,/Call page.getByRole\/getByLabel directly/);}
   const code=turns===1?`await page.locator('getByLabel("Email", {exact:true})').fill('@t.email');`:`await page.getByLabel('Email',{exact:true}).fill('@t.email');`;
   return JSON.stringify({steps:[{step_id:'email',automation_code:code}],tool_calls:[{name:'browser_fill',arguments:{locator:'getByLabel("Email",{exact:true})',value:'@t.email'}}]});
  },onPartialBuild:async()=>{saved++;return {generation_mode:'sequential',generation_complete:true};}
 });
 assert.equal(turns,2);assert.equal(saved,1);assert.equal(calls.filter(call=>call.name==='browser_fill').length,1);
});

test('code-only navigation is performed and its corrected URL check completes without reopening the entry page',async()=>{
 const calls=[];let turns=0,saved=0;
 const browser={tools,call:async(name,args)=>{
  calls.push({name,args});
  if(name==='browser_assert'&&args.value==='https://app.test/')return receipt({url:'https://app.test/auth',assertion_outcome:'not_satisfied',action_outcome:'not_attempted',retry_safe:true},true);
  return receipt({url:'https://app.test/auth',...(name==='browser_assert'?{assertion_outcome:'satisfied'}:name==='browser_snapshot'?{accessibility:'Sign in'}:{action_outcome:'completed'})});
 }};
 await runAutomationBrowserAgent({browser,startUrl:'https://app.test',prompt:'Open the sign in entry',execution:{required:true,step_id:'entry',expected_result:'The sign in entry is loaded'},generationMode:'sequential',parse:JSON.parse,maxTurns:2,
  complete:async prompt=>{
   turns++;
   if(turns===2)assert.match(prompt,/not_satisfied/);
   return JSON.stringify({steps:[{step_id:'entry',automation_code:`await page.goto('https://app.test');await page.waitForLoadState('domcontentloaded');await expect(page).toHaveURL('${turns===1?'https://app.test/':'https://app.test/auth'}');`}]});
  },onPartialBuild:async()=>{saved++;return {generation_mode:'sequential',generation_complete:true};}
 });
 assert.equal(turns,2);assert.equal(saved,1);
 assert.equal(calls.filter(call=>call.name==='browser_navigate').length,1);
 assert.equal(calls.filter(call=>call.name==='browser_assert').length,2);
});

test('a runner missing native assertion capabilities stops before source-derived form actions',async()=>{
 const calls=[];
 const browser={tools:[{name:'browser_fill'},{name:'browser_assert',inputSchema:{properties:{assertion:{enum:['value','visible']}}}}],call:async name=>calls.push(name)};
 await assert.rejects(runAutomationBrowserAgent({browser,prompt:'Fill and verify result text',execution:{required:true,step_id:'email',expected_result:'Email is displayed'},parse:JSON.parse,
  complete:async()=>JSON.stringify({steps:[{step_id:'email',automation_code:'await page.locator("#email").fill("@t.email");await expect(page.locator("#review-email")).toHaveText("@t.email");'}]})
 }),error=>error.code==='AUTOMATION_MCP_CAPABILITY_MISSING'&&error.nonRetryable);
 assert.deepEqual(calls,[]);
});

test('unsupported source-only URL expressions receive a precise correction before any browser action',async()=>{
 const calls=[];let turns=0,saved=0;
 const browser={tools,call:async(name,args)=>{calls.push({name,args});return receipt({assertion_outcome:'satisfied'});}};
 await runAutomationBrowserAgent({browser,prompt:'Verify the current entry URL',execution:{required:true,step_id:'entry',expected_result:'The sign-in entry is open'},generationMode:'sequential',parse:JSON.parse,
  complete:async prompt=>{
   turns++;
   if(turns===2){assert.equal(calls.length,0);assert.match(prompt,/AUTOMATION_PROGRAM_TOOLS_UNSUPPORTED/);assert.match(prompt,/unsupported_url_regex/);}
   return JSON.stringify({steps:[{step_id:'entry',automation_code:String.raw`await expect(page).toHaveURL(/^https:\/\/app\.test\/auth$/);`}],...(turns===2?{tool_calls:[{name:'browser_assert',arguments:{assertion:'url',value:'https://app.test/auth'}}]}:{})});
  },onPartialBuild:async()=>{saved++;return {generation_mode:'sequential',generation_complete:true};}
 });
 assert.equal(turns,2);assert.equal(saved,1);assert.equal(calls.length,1);
});

test('failed URL checks stay prominent as address-bar checks without exposing expected private data',()=>{
 const context=browserPromptContext([
  {tool:'browser_snapshot',execution_step_id:'review',result:receipt({url:'https://app.test/form',accessibility:'Review details',elements:[{locator_candidates:['#review-email']}]})},
  {tool:'browser_assert',execution_step_id:'review',arguments:{assertion:'url_contains',value:'private-expected-value'},result:receipt({code:'BROWSER_ASSERTION_NOT_SATISFIED',assertion_outcome:'not_satisfied',action_outcome:'not_attempted',retry_safe:true},true)}
 ],'review');
 assert.equal(context.current.latest_failure.assertion_subject,'address_bar_url');
 assert.equal(context.current.latest_failure.code,'BROWSER_ASSERTION_NOT_SATISFIED');
 assert.equal(context.current.url,'https://app.test/form');
 assert.doesNotMatch(JSON.stringify(context.current),/private-expected-value/);
});

test('a corrected successful check clears the current failure and prior-section failures do not enter recovery',()=>{
 const failed=step=>({tool:'browser_assert',execution_step_id:step,arguments:{assertion:'url'},result:receipt({code:'BROWSER_ASSERTION_NOT_SATISFIED'},true)});
 assert.equal(browserPromptContext([failed('previous')],'current').current.latest_failure,undefined);
 assert.equal(browserPromptContext([failed('current'),{tool:'browser_assert',execution_step_id:'current',result:receipt({assertion_outcome:'satisfied'})}],'current').current.latest_failure,undefined);
});

test('URL-versus-content recovery corrects only the check after a completed click',async()=>{
 const calls=[];let turns=0,saved=0;
 const browser={tools,call:async(name,args)=>{
  calls.push({name,args});
  if(name==='browser_assert'&&args.assertion==='url_contains')return receipt({url:'https://app.test/form',code:'BROWSER_ASSERTION_NOT_SATISFIED',assertion_outcome:'not_satisfied',action_outcome:'not_attempted',retry_safe:true},true);
  return receipt({url:'https://app.test/form',...(name==='browser_click'?{action_outcome:'completed'}:name==='browser_assert'?{assertion_outcome:'satisfied'}:{accessibility:'Review details',elements:[{locator_candidates:['#review-email']}]})});
 }};
 await runAutomationBrowserAgent({browser,prompt:'Continue and show Review details',generationMode:'sequential',execution:{required:true,step_id:'review',expected_result:'Review details is visible'},parse:JSON.parse,maxTurns:2,
  complete:async prompt=>{
   turns++;
   if(turns===2){assert.match(prompt,/Current failed work:/);assert.match(prompt,/address_bar_url/);assert.match(prompt,/automationBrowserAgent.recovery/);}
   return JSON.stringify({steps:[{step_id:'review',automation_code:`await page.locator('#continue').click();${turns===1?"await expect(page).toHaveURL(/Review details/);":"await expect(page.getByRole('heading',{name:'Review details'})).toBeVisible();"}`}]});
  },onPartialBuild:async()=>{saved++;return {generation_mode:'sequential',generation_complete:true};}
 });
 assert.equal(saved,1);assert.equal(calls.filter(x=>x.name==='browser_click').length,1);
 assert.deepEqual(calls.filter(x=>x.name==='browser_assert').map(x=>x.args.assertion),['url_contains','visible']);
});

test('a failed tool batch at every turn retains a structured unfinished-execution error',async()=>{
 let saved=0;
 const browser={tools,call:async()=>receipt({code:'BROWSER_ASSERTION_NOT_SATISFIED',assertion_outcome:'not_satisfied',action_outcome:'not_attempted',retry_safe:true},true)};
 await assert.rejects(runAutomationBrowserAgent({browser,prompt:'Verify required URL',generationMode:'sequential',execution:{required:true,step_id:'entry',expected_result:'The required route is reached'},parse:JSON.parse,maxTurns:2,
  complete:async()=>JSON.stringify({steps:[{step_id:'entry',automation_code:"await expect(page).toHaveURL('https://app.test/required');"}]}),
  onPartialBuild:async()=>{saved++;return {};}
 }),error=>error.code==='AUTOMATION_BROWSER_EXECUTION_INCOMPLETE'&&error.details.expected_result_check==='browser_assert_required_after_failed_check');
 assert.equal(saved,0);
});

test('high-level manual input can reach its signup screen with tool-only navigation before synthesizing complete source',async()=>{
 const calls=[];let turns=0,saved=0;
 const browser={tools,call:async(name,args)=>{
  calls.push({name,args});
  return receipt({url:'https://app.test/signup',...(name==='browser_click'||name==='browser_fill'?{action_outcome:'completed'}:name==='browser_assert'?{assertion_outcome:'satisfied'}:{accessibility:'Create an account: Full name and Email',elements:[{locator_candidates:['#full-name']}]})});
 }};
 const invalid=String.raw`await page.locator('getByRole("textbox", {name:"Full name"})').fill('@t.name');`;
 await runAutomationBrowserAgent({browser,prompt:'Enter the supplied name on the signup screen',generationMode:'sequential',execution:{required:true,step_id:'signup',action:'Enter the supplied name in signup',expected_result:'The signup form displays the name'},parse:JSON.parse,maxTurns:3,maxCalls:5,
  initialObservations:[{tool:'browser_snapshot',result:receipt({url:'https://app.test/auth',accessibility:'Sign In and Sign up',elements:[{locator_candidates:['#signup']}]})}],
  complete:async prompt=>{
   turns++;
   if(turns===1){assert.match(prompt,/automationBrowserAgent.sectionIntent/);assert.match(prompt,/manual_action/);return JSON.stringify({steps:[{step_id:'signup',automation_code:invalid}]});}
   if(turns===2){assert.equal(calls.length,0);assert.match(prompt,/Current failed work:/);assert.match(prompt,/generated_source/);assert.match(prompt,/Previous current-section draft/);assert.match(prompt,/automationBrowserAgent.recovery/);return JSON.stringify({steps:[],tool_calls:[{name:'browser_click',arguments:{locator:'#signup'}}]});}
   assert.match(prompt,/Create an account: Full name/);
   return JSON.stringify({steps:[{step_id:'signup',automation_code:"await page.locator('#signup').click(); await page.locator('#full-name').fill('@t.name'); await expect(page.locator('#full-name')).toHaveValue('@t.name');"}]});
  },onPartialBuild:async()=>{saved++;return {generation_mode:'sequential',generation_complete:true};}
 });
 assert.equal(saved,1);assert.equal(calls.filter(x=>x.name==='browser_click').length,1);assert.equal(calls.filter(x=>x.name==='browser_fill').length,1);
});

test('repeated invalid draft is exposed for explicit replanning and exhaustion remains typed',async()=>{
 let turns=0;
 const browser={tools,call:async()=>assert.fail('invalid source must not dispatch browser actions')};
 await assert.rejects(runAutomationBrowserAgent({browser,prompt:'Enter signup name',execution:{required:true,step_id:'signup',expected_result:'The name appears'},parse:JSON.parse,maxTurns:3,
  complete:async prompt=>{turns++;if(turns===3){assert.match(prompt,/inspect_and_act_before_source/);assert.match(prompt,/repeated_invalid_source.*2/);}return JSON.stringify({steps:[{step_id:'signup',automation_code:String.raw`await page.locator('getByRole("textbox", {name:"Full name"})').fill('@t.name');`}]});}
 }),error=>error.code==='AUTOMATION_BROWSER_EXECUTION_INCOMPLETE'&&error.details.code==='AUTOMATION_GENERATED_SOURCE_INVALID');
 assert.equal(turns,3);
});

test('four explicit typed tools can complete on the final turn within the unchanged total call budget',async()=>{
 const calls=[];let saved=0;
 const browser={tools,call:async(name,args)=>{calls.push({name,args});return receipt(name==='browser_assert'?{assertion_outcome:'satisfied'}:{action_outcome:'completed'});}};
 await runAutomationBrowserAgent({browser,prompt:'Populate two supplied fields',generationMode:'sequential',execution:{required:true,step_id:'details',expected_result:'Both fields contain the supplied values'},parse:JSON.parse,maxTurns:1,maxCalls:5,
  complete:async prompt=>{assert.match(prompt,/max_requests_per_response.*12/);return JSON.stringify({steps:[{step_id:'details',automation_code:"await page.locator('#name').fill('@t.name'); await page.locator('#email').fill('@t.email'); await expect(page.locator('#name')).toHaveValue('@t.name'); await expect(page.locator('#email')).toHaveValue('@t.email');"}],tool_calls:[
   {name:'browser_fill',arguments:{locator:'#name',value:'@t.name'}},{name:'browser_fill',arguments:{locator:'#email',value:'@t.email'}},
   {name:'browser_assert',arguments:{assertion:'value',locator:'#name',value:'@t.name'}},{name:'browser_assert',arguments:{assertion:'value',locator:'#email',value:'@t.email'}}]});},
  onPartialBuild:async()=>{saved++;return {generation_mode:'sequential',generation_complete:true};}
 });
 assert.equal(saved,1);assert.equal(calls.length,5);assert.equal(calls.filter(x=>x.name==='browser_fill').length,2);
});

test('an oversized batch is corrected without dispatching any of its requests',async()=>{
 let turns=0,saved=0;const calls=[];
 const browser={tools,call:async name=>{calls.push(name);return receipt({assertion_outcome:'satisfied'});}};
 await runAutomationBrowserAgent({browser,prompt:'Check title',generationMode:'sequential',execution:{required:true,step_id:'entry',expected_result:'Signup title is displayed'},parse:JSON.parse,maxTurns:2,maxCalls:2,
  complete:async prompt=>{if(++turns===1)return JSON.stringify({tool_calls:Array.from({length:13},()=>({name:'browser_snapshot',arguments:{}}))});assert.equal(calls.length,0);assert.match(prompt,/AUTOMATION_TOOL_BATCH_TOO_LARGE/);return JSON.stringify({steps:[{step_id:'entry',automation_code:"await expect(page).toHaveTitle('Signup');"}]});},
  onPartialBuild:async()=>{saved++;return {generation_mode:'sequential',generation_complete:true};}
 });
 assert.equal(saved,1);assert.deepEqual(calls,['browser_assert']);
});

test('source cannot omit a prerequisite Signup click, including a same-URL form transition',async()=>{
 for(const changesUrl of [true,false]){
  let turns=0,saved=0;const calls=[];
  const browser={tools,call:async(name,args)=>{calls.push({name,args});return receipt({url:changesUrl?'https://app.test/signup':'https://app.test/auth',...(name==='browser_click'||name==='browser_fill'?{action_outcome:'completed'}:name==='browser_assert'?{assertion_outcome:'satisfied'}:{elements:[{role:'textbox',name:'Full name',locator_candidates:['#full-name']}]})});}};
  await runAutomationBrowserAgent({browser,prompt:'Enter name on signup',generationMode:'sequential',execution:{required:true,step_id:'signup',action:'Enter full name',expected_result:'The name appears'},parse:JSON.parse,maxTurns:3,maxCalls:5,
   initialObservations:[{tool:'browser_snapshot',result:receipt({url:'https://app.test/auth',elements:[{role:'button',name:'Sign up',locator_candidates:['#signup']}]})}],
   complete:async prompt=>{
    turns++;
    if(turns===1)return JSON.stringify({tool_calls:[{name:'browser_click',arguments:{locator:'#signup'}}]});
    if(turns===3){assert.match(prompt,/AUTOMATION_BROWSER_PREREQUISITE_SOURCE_REQUIRED/);assert.equal(calls.filter(x=>x.name==='browser_fill').length,0);}
    return JSON.stringify({steps:[{step_id:'signup',automation_code:(turns===3?"await page.locator('#signup').click();":"")+"await page.locator('#full-name').fill('@t.name'); expect(await page.locator('#full-name').inputValue()).toBe('@t.name');"}]});
   },onPartialBuild:async()=>{saved++;return {generation_mode:'sequential',generation_complete:true};}
  });
  assert.equal(saved,1);assert.equal(calls.filter(x=>x.name==='browser_click').length,1);assert.equal(calls.filter(x=>x.name==='browser_fill').length,1);
 }
});
