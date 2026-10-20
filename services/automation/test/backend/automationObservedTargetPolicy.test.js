const test=require('node:test');
const assert=require('node:assert/strict');
const {projectModelSnapshot,resolveModelToolRequest,browserObservedTargetFeedback}=require('../../backend/lib/automationBrowserModelTargets');
const candidate='getByLabel("Password", { exact: true })';
const fixture=(extra={})=>({tool:'browser_snapshot',result:{content:[{type:'text',text:JSON.stringify({source:'playwright',observation_id:'actual-current-page',url:'https://fixture.test/login',scope:'body',
 elements:[{tag:'input',attributes:{id:'password',type:'password'},accessible_name:'Password',displayed:true,disabled:false,locators_validated:true,locator_candidates:[candidate,'#password']}],...extra})}]}});
const request=(name='browser_fill',locator=candidate,extra={})=>({name,arguments:{locator,...extra}});
const guard=(proposed,snapshot)=>browserObservedTargetFeedback({request:proposed,snapshot,execution:{step_id:'current'}});

test('positive target dispatch accepts exact current candidates and resolved opaque references without selecting replacements',()=>{
 const snapshot=fixture(),projection=projectModelSnapshot(snapshot),ref=projection.targets[0].ref;
 for(const name of ['browser_click','browser_fill','browser_press_key','browser_select_option','browser_hover','browser_check','browser_uncheck','browser_assert']){
  for(const locator of [candidate,'#password',ref]){
   const proposed=request(name,locator,{assertion:'value',value:'@r.password'}),before=structuredClone(proposed);
   assert.equal(guard(proposed,snapshot),null);assert.deepEqual(proposed,before);
   assert.equal(guard(resolveModelToolRequest(proposed,snapshot),snapshot),null);
  }
 }
 projection.targets[0].ref='ref:aaaaaaaaaaaa:1';
 assert.equal(guard(request('browser_fill','ref:aaaaaaaaaaaa:1'),snapshot).code,'AUTOMATION_BROWSER_LOCATOR_NOT_OBSERVED');
});

test('a guessed password role is rejected before dispatch without inventing a locator or changing its expectation',()=>{
 const snapshot=fixture();projectModelSnapshot(snapshot);
 const proposed=request('browser_assert','getByRole("textbox", { name: "Password *" })',{assertion:'visible'}),before=structuredClone(proposed);
 const feedback=guard(proposed,snapshot);
 assert.equal(feedback.code,'AUTOMATION_BROWSER_LOCATOR_NOT_OBSERVED');assert.equal(feedback.action_outcome,'not_attempted');assert.equal(feedback.retry_safe,true);
 assert.match(feedback.message,/current target reference/);assert.match(feedback.message,/scoped snapshot/);
 assert.doesNotMatch(JSON.stringify(feedback),/Password|textbox|#password|getBy|ref:/);
 assert.deepEqual(proposed,before);assert.equal(feedback.locator,undefined);assert.equal(feedback.evidence_refs,undefined);
});

test('closed semantic locator formatting resolves to the original validated alias without changing target semantics',()=>{
 const captured='getByRole("textbox", { name: "Email", exact: true })';
 const snapshot=fixture({elements:[{tag:'input',accessible_role:'textbox',accessible_name:'Email',locators_validated:true,locator_candidates:[captured]}]});
 projectModelSnapshot(snapshot);
 for(const locator of ['getByRole("textbox", {"name":"Email","exact":true})',
  ' getByRole ( \'textbox\' , { exact: true, name: \'Email\' } ) ',
  'page.getByRole("textbox", {"exact":true,"name":"Email"})']){
  const proposed=request('browser_fill',locator,{value:'@r.email'}),before=structuredClone(proposed);
  const resolved=resolveModelToolRequest(proposed,snapshot);
  assert.equal(resolved.arguments.locator,captured);assert.equal(resolved.arguments.value,'@r.email');
  assert.equal(guard(proposed,snapshot),null);assert.equal(guard(resolved,snapshot),null);assert.deepEqual(proposed,before);
 }
 const exact=request('browser_fill',captured);assert.equal(resolveModelToolRequest(exact,snapshot),exact);
 for(const locator of ['getByRole("textbox", { name: "Email", exact: false })','getByRole("textbox", { name: "Email ", exact: true })',
  'getByRole("Textbox", { name: "Email", exact: true })','getByRole("button", { name: "Email", exact: true })',
  'getByLabel("Email", { exact: true })','role=textbox[name="Email"]','#password ']){
  const proposed=request('browser_fill',locator);assert.equal(resolveModelToolRequest(proposed,snapshot),proposed);
  assert.equal(guard(proposed,snapshot).code,'AUTOMATION_BROWSER_LOCATOR_NOT_OBSERVED');
 }
 const indexed='getByRole("textbox", { name: "Email", exact: true }).nth(2)';
 const indexedSnapshot=fixture({elements:[{tag:'input',locators_validated:true,locator_candidates:[indexed]}]});projectModelSnapshot(indexedSnapshot);
 assert.equal(resolveModelToolRequest(request('browser_fill','getByRole("textbox",{"exact":true,"name":"Email"}).nth( 2 )'),indexedSnapshot).arguments.locator,indexed);
 for(const locator of [captured,captured+'.nth(1)',captured+'.first()',captured+'.last()'])assert.equal(guard(request('browser_fill',locator),indexedSnapshot).code,'AUTOMATION_BROWSER_LOCATOR_NOT_OBSERVED');
});

test('semantic alias normalization rejects executable expressions, regexes and duplicate options without evaluating them',()=>{
 const captured='getByRole("textbox", { name: "Email", exact: true })';
 const snapshot=fixture({elements:[{tag:'input',locators_validated:true,locator_candidates:[captured]}]});projectModelSnapshot(snapshot);
 for(const locator of [captured+'; globalThis.targetPolicyInjected=true',
  'getByRole("textbox", { name: /Email/, exact: true })','getByRole("textbox", { name: "Email", name: "Email", exact: true })',
  'getByRole("textbox", { name: "Email", exact: true, exact: true })',
  'getByRole("textbox", { ["name"]: "Email", exact: true })',
  'getByRole("textbox", { name: "Email", exact: true, hidden: false })',
  'getByRole("textbox", { name: `${globalThis.targetPolicyInjected=true}`, exact: true })',
  captured+'.filter({hasText:"Email"})',captured+'.nth(2).nth(0)']){
  const proposed=request('browser_fill',locator);assert.equal(resolveModelToolRequest(proposed,snapshot),proposed);
  assert.equal(guard(proposed,snapshot).code,'AUTOMATION_BROWSER_LOCATOR_NOT_OBSERVED');
 }
 assert.equal(globalThis.targetPolicyInjected,undefined);
});

test('formatting equivalence cannot acquire authority from copied, unvalidated or replaced snapshot evidence',()=>{
 const proposed=request('browser_fill','getByLabel("Password", {"exact":true})');
 const snapshot=fixture(),copy=structuredClone(snapshot);projectModelSnapshot(snapshot);
 for(const current of [copy,projectModelSnapshot(snapshot),undefined]){
  assert.equal(resolveModelToolRequest(proposed,current),proposed);assert.equal(guard(proposed,current).code,'AUTOMATION_BROWSER_LOCATOR_NOT_OBSERVED');
 }
 const unvalidated=fixture({elements:[{tag:'input',locators_validated:false,locator_candidates:[candidate]}]});projectModelSnapshot(unvalidated);
 assert.equal(resolveModelToolRequest(proposed,unvalidated),proposed);assert.equal(guard(proposed,unvalidated).code,'AUTOMATION_BROWSER_LOCATOR_NOT_OBSERVED');
 snapshot.result.content[0].text=snapshot.result.content[0].text.replace('actual-current-page','replaced-current-page');
 assert.equal(resolveModelToolRequest(proposed,snapshot),proposed);assert.equal(guard(proposed,snapshot).code,'AUTOMATION_BROWSER_LOCATOR_NOT_OBSERVED');
});

test('canonical collisions across distinct validated targets refuse formatting-only resolution',()=>{
 const first='getByRole("textbox", { name: "Email", exact: true })',second='getByRole("textbox", {exact:true,name:"Email"})';
 const snapshot=fixture({elements:[{tag:'input',locators_validated:true,locator_candidates:[first]},
  {tag:'input',locators_validated:true,locator_candidates:[second]}]});
 const projected=projectModelSnapshot(snapshot),proposed=request('browser_fill','getByRole("textbox", {"name":"Email","exact":true})');
 assert.equal(resolveModelToolRequest(proposed,snapshot),proposed);assert.equal(guard(proposed,snapshot).code,'AUTOMATION_BROWSER_LOCATOR_NOT_OBSERVED');
 for(const [index,locator] of [first,second].entries()){
  const exact=request('browser_fill',locator);assert.equal(resolveModelToolRequest(exact,snapshot),exact);assert.equal(guard(exact,snapshot),null);
  assert.equal(resolveModelToolRequest(request('browser_fill',projected.targets[index].ref),snapshot).arguments.locator,locator);
 }
});

test('the actual compact actor dispatches a formatting-only alias once using its original captured locator',async()=>{
 const {runAutomationBrowserAgent}=require('../../backend/lib/automationBrowserAgent');
 const captured='getByRole("textbox", { name: "Email", exact: true })',calls=[];let models=0,saves=0;
 const snapshot=fixture({elements:[{tag:'input',attributes:{type:'email'},accessible_role:'textbox',accessible_name:'Email',displayed:true,locators_validated:true,locator_candidates:[captured]}]});
 await runAutomationBrowserAgent({actorMode:true,prompt:'Inspect only the email input.',execution:{required:true,step_id:'current',action:'Inspect the email input',expected_result:'The email input is visible'},parse:JSON.parse,initialObservations:[snapshot],
  browser:{tools:[{name:'browser_assert',inputSchema:{type:'object'}}],call:async(name,args)=>{
   calls.push({name,args});assert.equal(args.locator,captured);return {content:[{type:'text',text:JSON.stringify({source:'playwright',assertion_outcome:'satisfied'})}]};
  }},complete:async()=>{models++;return JSON.stringify({section_complete:true,tool_calls:[request('browser_assert','getByRole("textbox", {"exact":true,"name":"Email"})',{assertion:'visible'})]});},
  onPartialBuild:async()=>{saves++;return {generation_complete:true};}
 });
 assert.equal(models,1);assert.equal(calls.length,1);assert.equal(saves,1);
});

test('snapshot copies, projected target maps, unknown and replaced receipts cannot supply registry authority',()=>{
 const actual=fixture(),copied=structuredClone(actual);projectModelSnapshot(actual);
 for(const snapshot of [undefined,null,{},copied,projectModelSnapshot(actual)])assert.equal(guard(request(),snapshot).code,'AUTOMATION_BROWSER_LOCATOR_NOT_OBSERVED');
 actual.result.content[0].text=actual.result.content[0].text.replace('actual-current-page','replaced-page');
 assert.equal(guard(request(),actual).code,'AUTOMATION_BROWSER_LOCATOR_NOT_OBSERVED');
});

test('partial pages allow observed targets and request scoped discovery for missing targets without claiming absence',()=>{
 const snapshot=fixture({partial:true});projectModelSnapshot(snapshot);
 assert.equal(guard(request(),snapshot),null);
 const feedback=guard(request('browser_click','#missing-control'),snapshot);
 assert.equal(feedback.snapshot_partial,true);assert.equal(feedback.action_outcome,'not_attempted');
 assert.match(feedback.remaining_contract,/scoped_discovery/);assert.doesNotMatch(feedback.message,/target does not exist|target is absent/i);
});

test('read-only discovery and native page, absence and count predicates keep their original behavior',()=>{
 const snapshot=fixture();projectModelSnapshot(snapshot);
 for(const proposed of [request('browser_snapshot','#not-yet-observed'),request('browser_validate_locator','#not-yet-observed'),
  request('browser_assert','#absent',{assertion:'hidden'}),request('browser_assert','#absent',{assertion:'count',value:'0'}),
  request('browser_assert','#multiple',{assertion:'count',value:'@r.expectedCount'}),
  ...['url','url_contains','title','title_normalized'].map(assertion=>request('browser_assert','#unused',{assertion,value:'expected'})),
  {name:'browser_press_key',arguments:{key:'Escape'}}])assert.equal(guard(proposed,snapshot),null);
});

test('the actual compact actor rejects a guessed positive locator with zero MCP calls before correction',async()=>{
 const {runAutomationBrowserAgent}=require('../../backend/lib/automationBrowserAgent');
 const snapshot=fixture(),stop=new Error('Stop after inspecting host correction');let models=0,calls=0;
 await assert.rejects(runAutomationBrowserAgent({actorMode:true,prompt:'Inspect only the password input.',execution:{required:true,step_id:'current',action:'Inspect the password input',expected_result:'The password input is visible'},parse:JSON.parse,
  initialObservations:[snapshot],browser:{tools:[{name:'browser_assert',inputSchema:{type:'object'}}],call:async()=>{calls++;return {isError:true,content:[{type:'text',text:JSON.stringify({source:'playwright',code:'BROWSER_ASSERTION_NOT_SATISFIED',assertion_outcome:'not_satisfied'})}]};}},
  complete:async prompt=>{
   if(++models===1)return JSON.stringify({stage:'act',step_id:'current',tool_calls:[request('browser_assert','getByRole("textbox", { name: "Password *" })',{assertion:'visible'})]});
   assert.equal(calls,0,'the guessed target must be rejected before a native browser assertion budget is spent');
   assert.match(prompt,/AUTOMATION_BROWSER_LOCATOR_NOT_OBSERVED/);throw stop;
  }}),error=>error===stop);
 assert.equal(models,2);assert.equal(calls,0);
});

test('the actual actor can correct a guessed target to a current opaque reference and dispatch exactly once',async()=>{
 const {runAutomationBrowserAgent}=require('../../backend/lib/automationBrowserAgent');
 const stop=new Error('Stop after confirmed correction'),calls=[],observations=[];let models=0;
 await assert.rejects(runAutomationBrowserAgent({actorMode:true,prompt:'Inspect only the password input.',execution:{required:true,step_id:'current',action:'Inspect the password input',expected_result:'The password input is visible'},parse:JSON.parse,
  initialObservations:[fixture()],onObservation:row=>observations.push(row),browser:{tools:[{name:'browser_assert',inputSchema:{type:'object'}}],call:async(name,args)=>{
   calls.push({name,args});assert.equal(name,'browser_assert');assert.equal(args.locator,candidate,'the private host registry resolves the reference to its observed portable candidate');
   return {content:[{type:'text',text:JSON.stringify({source:'playwright',url:'https://fixture.test/login',assertion_outcome:'satisfied',match_count:1})}]};
  }},complete:async prompt=>{
   models++;
   if(models===1)return JSON.stringify({tool_calls:[request('browser_assert','getByRole("textbox", { name: "Password *" })',{assertion:'visible'})]});
   const line=prompt.split('\n').find(line=>line.startsWith('Current browser state and confirmed section progress'));
   const current=JSON.parse(line.slice(line.indexOf('{')));
   if(models===2){
    assert.equal(calls.length,0);assert.equal(current.latest_failure.code,'AUTOMATION_BROWSER_LOCATOR_NOT_OBSERVED');
    assert.equal(current.latest_failure.action_outcome,'not_attempted');
    const target=current.current_snapshot.targets.find(row=>row.name==='Password');assert.ok(target?.ref);
    return JSON.stringify({tool_calls:[request('browser_assert',target.ref,{assertion:'visible'})]});
   }
   assert.equal(calls.length,1);assert.equal(current.latest_failure,undefined,'the real current predicate resolves the correction feedback');throw stop;
  }}),error=>error===stop);
 assert.equal(models,3);assert.equal(calls.length,1);
 assert.equal(observations.filter(row=>row.tool==='automation_target_feedback').length,1);
 assert.equal(observations.filter(row=>row.tool==='browser_assert').length,1);
});

test('repeating an identical guessed target stops after one correction without any MCP call or save',async()=>{
 const {runAutomationBrowserAgent}=require('../../backend/lib/automationBrowserAgent');
 let calls=0,models=0,saves=0;const observations=[];
 await assert.rejects(runAutomationBrowserAgent({actorMode:true,prompt:'Inspect only the password input.',execution:{required:true,step_id:'current',action:'Inspect the password input',expected_result:'The password input is visible'},parse:JSON.parse,
  initialObservations:[fixture()],onObservation:row=>observations.push(row),onPartialBuild:async()=>{saves++;},browser:{tools:[{name:'browser_assert',inputSchema:{type:'object'}}],call:async()=>{calls++;throw new Error('The guessed target cannot reach MCP');}},
  complete:async prompt=>{models++;if(models===2)assert.match(prompt,/AUTOMATION_BROWSER_LOCATOR_NOT_OBSERVED/);return JSON.stringify({tool_calls:[request('browser_assert','getByRole("textbox", { name: "Password *" })',{assertion:'visible'})]});}
 }),error=>error.code==='AUTOMATION_BROWSER_TARGET_PROPOSAL_STALLED'&&error.nonRetryable===true&&error.details.action_outcome==='not_attempted');
 assert.equal(models,2);assert.equal(calls,0);assert.equal(saves,0);assert.equal(observations.filter(row=>row.tool==='automation_target_feedback').length,1);
});

test('a changed current snapshot retires old aliases and references instead of silently retargeting them',()=>{
 const previous=fixture(),oldRef=projectModelSnapshot(previous).targets[0].ref;
 const changed=fixture({observation_id:'next-current-page',elements:[{tag:'input',attributes:{id:'new-password',type:'password'},accessible_name:'Password',displayed:true,locators_validated:true,locator_candidates:['#new-password']}]});
 const newRef=projectModelSnapshot(changed).targets[0].ref;
 assert.equal(guard(request('browser_fill','#new-password'),changed),null);
 assert.equal(guard(resolveModelToolRequest(request('browser_fill',newRef),changed),changed),null);
 for(const locator of [candidate,'#password',oldRef])assert.equal(guard(request('browser_fill',locator),changed).code,'AUTOMATION_BROWSER_LOCATOR_NOT_OBSERVED');
 assert.throws(()=>resolveModelToolRequest(request('browser_fill',oldRef),changed),{code:'AUTOMATION_BROWSER_TARGET_REF_STALE'});
 assert.notEqual(oldRef,newRef);
});
