import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { registerAutomationMcp } from '../../dist/lib/automationMcp.js';
import { createPrivilegedRunGuard, resolveTestEngineSharedSecret } from '../../dist/lib/testEngineSecurity.js';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const {connectAutomationBrowser,runAutomationBrowserAgent}=require('../../../../services/automation/backend/lib/automationBrowserAgent.js');
const {completeAutomationBuild}=require('../../../../services/automation/backend/lib/automationBuildCompletion.js');
const {createBrowserParameterResolver}=require('../../../../services/automation/backend/lib/automationBrowserParameters.js');

test('backend agent uses real MCP Chromium snapshots, validates strict locators and closes its session', {timeout:60000}, async t=>{
  const old=process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;process.env.RECORDER_ALLOWED_PRIVATE_HOSTS='127.0.0.1';
  t.after(()=>{if(old===undefined)delete process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;else process.env.RECORDER_ALLOWED_PRIVATE_HOSTS=old;});
  const app=Fastify();
  app.get('/fixture',async(_request,reply)=>reply.type('text/html').send('<!doctype html><title>Order fixture</title><main id="order-form"><img alt="Company logo"><button title="Continue">Next</button><button title="Continue later">Later</button><label>Email<input name="email"></label><label>Agree<input id="agree" type="checkbox"></label><label>Password<input type="password" value="fixture-private-password"></label><label>Delivery<select><option value=" express ">Express</option></select></label><button id="large-id" data-testid="'+ 'large'.repeat(80)+'">Large attribute</button><button onclick="document.title=\'First saved\'">Save</button><button onclick="document.title=\'Second saved\'">Save</button></main>'));
  await registerAutomationMcp(app,createPrivilegedRunGuard(resolveTestEngineSharedSecret()));
  const base=await app.listen({host:'127.0.0.1',port:0});t.after(()=>app.close());
  const browser=await connectAutomationBrowser({integration:{base_url:base},startUrl:`${base}/fixture`,allowBrowserActions:true});t.after(()=>browser.close());
  let turn=0;const observations=[];
  const result=await runAutomationBrowserAgent({prompt:'Fill Email and save the second record. Expected Second saved.',startUrl:`${base}/fixture`,browser,parse:JSON.parse,onObservation:item=>observations.push(item),complete:async prompt=>{
    assert.match(prompt,/Email/);assert.match(prompt,/Save/);
    return JSON.stringify(++turn===1?{tool_calls:[{name:'browser_validate_locator',arguments:{locator:'getByRole("button", { name: "Save" }).nth(1)'}}]}:{steps:[{step_id:'save',step_type:'web',automation_code:'await page.getByRole("button", { name: "Save" }).nth(1).click();'}]});
  }});
  assert.equal(result.steps.length,1);
  const image=observations.find(item=>item.tool==='browser_screenshot')?.result?.content.find(item=>item.type==='image');
  assert.equal(image?.mimeType,'image/jpeg');assert.ok(Buffer.from(image.data,'base64').length<=128*1024);assert.ok(Buffer.from(image.data,'base64').subarray(0,3).equals(Buffer.from([255,216,255])));
  const snapshot=JSON.parse(observations.find(item=>item.tool==='browser_snapshot').result.content[0].text);
  assert.equal(snapshot.source,'playwright');assert.equal(snapshot.verification_status,'unverified');assert.ok(snapshot.observation_id);assert.ok(Number.isFinite(Date.parse(snapshot.captured_at)));
  const email=snapshot.elements.find(item=>item.attributes.name==='email');assert.equal(email.label,'Email');assert.equal(email.displayed,true);assert.equal(email.locators_validated,true);assert.ok(email.locator_candidates.some(value=>value.includes('getByLabel("Email"')));
  const delivery=snapshot.elements.find(item=>item.tag==='select');assert.equal(delivery.options[0].value,' express ','option values must retain their exact bytes');
  const large=snapshot.elements.find(item=>item.attributes.id==='large-id');assert.ok(large.truncated_attributes.includes('data-testid'));assert.ok(!large.locator_candidates.some(value=>value.startsWith('getByTestId(')),'a truncated attribute must never become an invented locator');
  assert.equal(snapshot.fields_truncated,true);assert.doesNotMatch(JSON.stringify(snapshot),/fixture-private-password|sensitive_values/);assert.ok(Buffer.byteLength(JSON.stringify(snapshot))<=64*1024);
  const imageMetadata=JSON.parse(observations.find(item=>item.tool==='browser_screenshot').result.content[0].text);assert.equal(imageMetadata.source,'playwright');assert.equal(imageMetadata.optional,true);assert.equal(imageMetadata.capture_scope,'viewport');assert.equal(imageMetadata.byte_length,Buffer.from(image.data,'base64').length);
  const unsupportedScope=await browser.call('browser_snapshot',{locator:'getByRole("button",{name:"Save"})'});assert.equal(unsupportedScope.isError,true);assert.match(JSON.parse(unsupportedScope.content[0].text).message,/Snapshot scope matches 2/);
  const scoped=JSON.parse((await browser.call('browser_snapshot',{locator:'#order-form'})).content[0].text);assert.equal(scoped.scope,'#order-form');assert.equal(scoped.elements.find(item=>item.attributes.name==='email').label,'Email');
  for(const locator of ['getByAltText("Company logo")','getByTitle("Continue")','title=Continue']) {
    const observed=await browser.call('browser_validate_locator',{locator});assert.ok(!observed.isError,JSON.stringify(observed));
  }
  const unsupported=await browser.call('browser_validate_locator',{locator:'getByUnknown("Continue")'});assert.equal(unsupported.isError,true);assert.match(unsupported.content[0].text,/Unsupported semantic repository locator/);
  const waited=await browser.call('browser_wait_for',{locator:'#agree'});assert.ok(!waited.isError);
  const checked=await browser.call('browser_check',{locator:'#agree'});assert.ok(!checked.isError);
  assert.match((await browser.call('browser_snapshot',{})).content[0].text,/checked/);
  const unchecked=await browser.call('browser_uncheck',{locator:'#agree'});assert.ok(!unchecked.isError);
  const hovered=await browser.call('browser_hover',{locator:'#agree'});assert.ok(!hovered.isError);
  const ambiguous=await browser.call('browser_click',{locator:'getByRole("button", {name:"Save"})'});assert.equal(ambiguous.isError,true);assert.match(ambiguous.content[0].text,/2 elements/);assert.equal(JSON.parse(ambiguous.content[0].text).action_outcome,'not_attempted');
  const selected=await browser.call('browser_click',{locator:'getByRole("button", {name:"Save"}).nth(1)'});assert.ok(!selected.isError);
  const invalid=await browser.call('browser_navigate',{url:'https://example.com'});assert.equal(invalid.isError,true);
  await browser.close();await assert.rejects(browser.call('browser_snapshot',{}),/expired|closed/);
});

test('sequential linked generation reuses one random value and captures each real browser action before advancing', {timeout:60000},async t=>{
 const old=process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;process.env.RECORDER_ALLOWED_PRIVATE_HOSTS='127.0.0.1';
 t.after(()=>{if(old===undefined)delete process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;else process.env.RECORDER_ALLOWED_PRIVATE_HOSTS=old;});
 const app=Fastify();app.get('/sequential',async(_req,reply)=>reply.type('text/html').send('<!doctype html><title>Sequential fixture</title><label>Name<input id="name"></label><button id="next" onclick="document.querySelector(\'#result\').textContent=\'Hello \'+document.querySelector(\'#name\').value">Next</button><p id="result"></p>'));
 await registerAutomationMcp(app,createPrivilegedRunGuard(resolveTestEngineSharedSecret()));
 const base=await app.listen({host:'127.0.0.1',port:0});t.after(()=>app.close());
 const browser=await connectAutomationBrowser({integration:{base_url:base},startUrl:`${base}/sequential`,allowBrowserActions:true});t.after(()=>browser.close());
 const steps=[{id:'one',test_case_id:'automation',step_order:1,step_type:'web',action:'Enter @t.name',expected_result:'Name contains @t.name'},{id:'two',test_case_id:'automation',step_order:2,step_type:'web',action:'Click Next',expected_result:'Hello @t.name is visible'}];
 const manual=steps.map((step,index)=>({...step,id:'manual-'+index,test_case_id:'manual'}));
 const data=createBrowserParameterResolver({caseValues:{'t.name':'{{randomString:8}}'},steps});
 const actual=data.resolve('browser_fill',{value:'@t.name'}).value;
 const call=browser.call,actions=[],observations=[],events=[],modelSteps=[];
 browser.call=async(name,args)=>{if(['browser_fill','browser_click'].includes(name))actions.push(name);return data.redactResult(await call(name,data.resolve(name,args)));};
 const result=await completeAutomationBuild({steps,manualSteps:manual,displaySteps:data.projectSteps(steps),displayManualSteps:data.projectSteps(manual),sequential:true,availableParameters:data.availableParameterNames,
  validate:(payload,required)=>{assert.equal(payload.steps.length,required.length);for(const item of payload.steps)assert.ok(item.automation_code.includes('params["t.name"]'));return {updates:payload.steps};},
  onProgress:async event=>events.push(event),onValidatedSection:async({step})=>{assert.ok(observations.some(item=>item.tool==='browser_snapshot'),'real evidence captured before preview');if(step.id==='two')assert.deepEqual(actions,['browser_fill','browser_click']);return {};},
  generate:async({attempt,activeStepId,feedback,onPartial})=>{
   modelSteps.push(activeStepId);assert.equal(feedback.required_sections.length,1);if(activeStepId==='one')assert.equal(feedback.required_sections[0].action,`Enter ${actual}`);
   const code=activeStepId==='one'?'await page.locator("#name").fill(params["t.name"]); await expect(page.locator("#name")).toHaveValue(params["t.name"]);':'await page.locator("#next").click(); await expect(page.locator("#result")).toHaveText("Hello " + params["t.name"]);';
   return runAutomationBrowserAgent({browser,startUrl:attempt===1?`${base}/sequential`:undefined,generationMode:'sequential',initialObservations:observations,prompt:'Develop the current section with its exact supplied value.',parse:JSON.parse,onPartialBuild:onPartial,
    onObservation:async observation=>observations.push(observation),complete:async()=>JSON.stringify({steps:[{step_id:activeStepId,automation_code:code}],tool_calls:[activeStepId==='one'?{name:'browser_fill',arguments:{locator:'#name',value:'@t.name'}}:{name:'browser_click',arguments:{locator:'#next'}}]})});
  }
 });
 assert.equal(result.updates.length,2);assert.deepEqual(modelSteps,['one','two']);assert.deepEqual(actions,['browser_fill','browser_click']);
 const observed=await call('browser_snapshot',{});assert.match(observed.content[0].text,new RegExp('Hello '+actual));
 assert.equal(data.generatedCaseValues['t.name'],actual);assert.deepEqual(events.filter(event=>event.phase==='automation.agent.section.ready').map(event=>event.details.step_id),['one','two']);
 await browser.close();
});

test('interactive linked generation performs supported code-only drafts through real MCP before saving each section', {timeout:60000},async t=>{
 const old=process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;process.env.RECORDER_ALLOWED_PRIVATE_HOSTS='127.0.0.1';
 t.after(()=>{if(old===undefined)delete process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;else process.env.RECORDER_ALLOWED_PRIVATE_HOSTS=old;});
 const app=Fastify();let submitted=0;
 app.get('/interactive-linked',async(_req,reply)=>reply.type('text/html').send('<!doctype html><title>Linked manual fixture</title><label>Name<input id="name"></label><button id="create">Create record</button><p id="result"></p><script>document.querySelector("#create").onclick=()=>{document.body.setAttribute("aria-busy","true");fetch("/interactive-save",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({name:document.querySelector("#name").value})}).then(response=>response.json()).then(result=>{document.querySelector("#result").textContent=result.message;document.body.removeAttribute("aria-busy")})}</script>'));
 app.post('/interactive-save',async(request)=>{submitted++;await new Promise(resolve=>setTimeout(resolve,850));return {message:'Created '+request.body.name};});
 await registerAutomationMcp(app,createPrivilegedRunGuard(resolveTestEngineSharedSecret()));
 const base=await app.listen({host:'127.0.0.1',port:0});t.after(()=>app.close());
 const browser=await connectAutomationBrowser({integration:{base_url:base},startUrl:`${base}/interactive-linked`,allowBrowserActions:true});t.after(()=>browser.close());
 const steps=[{id:'fill',test_case_id:'automation',step_order:1,step_type:'web',action:'Enter @t.name',expected_result:'Name contains @t.name'},{id:'create',test_case_id:'automation',step_order:2,step_type:'web',action:'Create the record',expected_result:'Created @t.name is visible'}];
 const manual=steps.map((step,index)=>({...step,id:'manual-'+index,test_case_id:'manual'}));
 const data=createBrowserParameterResolver({caseValues:{'t.name':'{{randomString:10}}'},steps}),actual=data.resolve('browser_fill',{value:'@t.name'}).value;
 const rawCall=browser.call,actions=[],observations=[],events=[],saved=[],previews=[],modelSections=[],turns=new Map();
 browser.call=async(name,args)=>{
  if(name==='browser_click'){assert.deepEqual(saved,['fill'],'the next manual action must wait for the previous section save');assert.equal(submitted,0);}
  if(['browser_fill','browser_click'].includes(name))actions.push(name);
  return data.redactResult(await rawCall(name,data.resolve(name,args)));
 };
 const receipt=observation=>{if(observation.result?.isError)return null;for(const item of observation.result?.content||[])if(item.type==='text')try{return JSON.parse(item.text);}catch{}return null;};
 const result=await completeAutomationBuild({steps,manualSteps:manual,displaySteps:data.projectSteps(steps),displayManualSteps:data.projectSteps(manual),sequential:true,availableParameters:data.availableParameterNames,
  validate:(payload,required)=>{assert.equal(payload.steps.length,required.length);for(const item of payload.steps)assert.match(item.automation_code,/params\["t.name"\]/);return {updates:payload.steps};},
  onProgress:async event=>events.push(event),
  onSaveSection:async({step,normalized,manualCoverage})=>{
   const current=observations.filter(observation=>observation.execution_step_id===step.id),lastAction=current.findLastIndex(observation=>['browser_fill','browser_click'].includes(observation.tool)&&receipt(observation)?.action_outcome==='completed'),lastAssertion=current.findLastIndex(observation=>observation.tool==='browser_assert'&&receipt(observation)?.assertion_outcome==='satisfied');
   assert.ok(lastAction>=0&&lastAssertion>lastAction,'saving requires the current section action and its subsequent expected-result receipt');assert.equal(normalized.updates[0].step_id,step.id);assert.ok(manualCoverage.some(mapping=>mapping.section_step_id===step.id));
   if(step.id==='fill'){assert.deepEqual(actions,['browser_fill']);assert.equal(submitted,0,'first save cannot submit the later action');assert.ok(observations.some(observation=>observation.tool==='automation_program_tools'&&receipt(observation)?.code==='AUTOMATION_PROGRAM_TOOLS_PLANNED'),'source-only text must be lowered to typed tools and actually checked before save');}
   else {assert.deepEqual(saved,['fill']);assert.deepEqual(actions,['browser_fill','browser_click']);assert.equal(submitted,1,'the intended submission is performed exactly once');}
   saved.push(step.id);return {saved:true,saved_step_ids:[...saved],saved_sections:saved.length,verification_status:'unverified'};
  },
  onValidatedSection:async({step})=>{assert.ok(saved.includes(step.id),'Plan save must precede its optional preview');previews.push(step.id);return {};},
  generate:async({attempt,activeStepId,feedback,onPartial})=>{
   modelSections.push(activeStepId);assert.equal(feedback.required_sections.length,1);if(activeStepId==='create')assert.deepEqual(saved,['fill']);
   const current=feedback.required_sections[0],code=activeStepId==='fill'?'await page.getByLabel("Name", {exact:true}).fill(params["t.name"]); await expect(page.locator("#name")).toHaveValue(params["t.name"]);':'await page.getByRole("button", {name:"Create record",exact:true}).click(); await expect(page.locator("#result")).toHaveText("Created " + params["t.name"]);';
   const candidate={steps:[{step_id:activeStepId,automation_code:code}]};
   return runAutomationBrowserAgent({browser,startUrl:attempt===1?`${base}/interactive-linked`:undefined,generationMode:'sequential',execution:{required:true,step_id:activeStepId,expected_result:current.expected_result},initialObservations:observations,
    prompt:JSON.stringify({story:{id:'story',title:'Create a named record',acceptance_criteria:'The entered name is retained and one record is created.'},linked_manual_case:{id:'manual',steps:data.projectSteps(manual)},current_section:current}),parse:JSON.parse,onPartialBuild:onPartial,onObservation:async observation=>observations.push(observation),onProgress:async event=>events.push(event),
    complete:async prompt=>{
     assert.match(prompt,/Create a named record/);assert.match(prompt,new RegExp(actual));const turn=(turns.get(activeStepId)||0)+1;turns.set(activeStepId,turn);
     if(activeStepId==='fill'){assert.equal(turn,1);assert.deepEqual(saved,[]);assert.deepEqual(actions,[]);return JSON.stringify(candidate);}
     return JSON.stringify({...candidate,tool_calls:[{name:'browser_click',arguments:{locator:'getByRole("button", { name: "Create record", exact: true })'}},{name:'browser_assert',arguments:{assertion:'text',locator:'#result',value:`Created ${actual}`}}]});
    }
   });
  }
 });
 assert.deepEqual(modelSections,['fill','create']);assert.deepEqual(saved,['fill','create']);assert.deepEqual(previews,['fill','create']);assert.equal(submitted,1);assert.equal(turns.get('fill'),1);assert.equal(turns.get('create'),1);assert.equal(result.updates.length,2);assert.equal(result.manual_coverage.length,2);assert.equal(result.verification_status,'unverified','interactive evidence must not fabricate a full test-run pass');assert.equal(Object.hasOwn(result,'passed'),false);
 for(const section of steps){const current=observations.filter(observation=>observation.execution_step_id===section.id);assert.ok(current.some(observation=>observation.tool==='browser_assert'&&receipt(observation)?.assertion_outcome==='satisfied'));assert.ok(current.some(observation=>observation.tool==='browser_snapshot'));}
 assert.equal(data.generatedCaseValues['t.name'],actual);assert.deepEqual(events.filter(event=>event.phase==='automation.agent.section.ready').map(event=>event.details.step_id),['fill','create']);
 const final=await rawCall('browser_assert',{assertion:'text',locator:'#result',value:`Created ${actual}`});assert.ok(!final.isError,JSON.stringify(final));await browser.close();
});

test('MCP waits for supplied URL redirects, delayed hydration and post-action rendering before exposing evidence', {timeout:60000},async t=>{
 const old=process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;process.env.RECORDER_ALLOWED_PRIVATE_HOSTS='127.0.0.1';
 t.after(()=>{if(old===undefined)delete process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;else process.env.RECORDER_ALLOWED_PRIVATE_HOSTS=old;});
 const app=Fastify();let submissions=0;
 app.get('/supplied-start',async(_req,reply)=>reply.redirect('/delayed-signup'));
 app.get('/client-redirect',async(_req,reply)=>reply.type('text/html').send('<!doctype html><title>Redirecting</title><body aria-busy="true">Loading…<script>setTimeout(()=>location.replace("/delayed-signup"),150)</script></body>'));
 app.get('/delayed-signup',async(_req,reply)=>reply.type('text/html').send('<!doctype html><title>Loading signup</title><body aria-busy="true"><div role="progressbar">Loading…</div><script src="/signup-loader.js"></script></body>'));
 app.get('/signup-loader.js',async(_req,reply)=>{
  await new Promise(resolve=>setTimeout(resolve,250));
  return reply.type('application/javascript').send('fetch("/signup-metadata").then(response=>response.json()).then(data=>{document.title=data.title;document.body.innerHTML=\'<h1>Signup ready</h1><label>Email<input id="email"></label><button id="create">Create account</button>\';document.body.removeAttribute("aria-busy");document.querySelector("#create").onclick=()=>{document.body.setAttribute("aria-busy","true");fetch("/signup-submit").then(response=>response.json()).then(result=>{document.title=result.title;document.body.innerHTML="<h1>Account created</h1>";document.body.removeAttribute("aria-busy")})}});');
 });
 app.get('/signup-metadata',async()=>{await new Promise(resolve=>setTimeout(resolve,850));return {title:'Ready signup'};});
 app.get('/signup-submit',async()=>{submissions++;await new Promise(resolve=>setTimeout(resolve,850));return {title:'Created signup'};});
 app.get('/unavailable',async(_req,reply)=>reply.code(503).type('text/html').send('<h1>Unavailable</h1>'));
 app.get('/wrong-origin',async(_req,reply)=>reply.redirect('https://example.com/signup'));
 await registerAutomationMcp(app,createPrivilegedRunGuard(resolveTestEngineSharedSecret()));
 const base=await app.listen({host:'127.0.0.1',port:0});t.after(()=>app.close());
 const browser=await connectAutomationBrowser({integration:{base_url:base},startUrl:`${base}/supplied-start`,allowBrowserActions:true});t.after(()=>browser.close());
 const receipt=async(name,args={})=>{const result=await browser.call(name,args);return {result,value:JSON.parse(result.content[0].text)};};
 const opened=await receipt('browser_navigate',{url:`${base}/supplied-start`});
 assert.ok(!opened.result.isError,JSON.stringify(opened));assert.equal(opened.value.url,`${base}/delayed-signup`);assert.equal(opened.value.title,'Ready signup');assert.equal(opened.value.readiness.load_state,'complete');
 const first=await receipt('browser_snapshot');assert.match(first.value.accessibility,/Signup ready|Email/);assert.doesNotMatch(first.value.accessibility,/Loading/);
 const clicked=await receipt('browser_click',{locator:'#create'});assert.ok(!clicked.result.isError,JSON.stringify(clicked));assert.equal(clicked.value.title,'Created signup');assert.equal(submissions,1,'readiness must not repeat the submitted action');
 const after=await receipt('browser_snapshot');assert.match(after.value.accessibility,/Account created/);
 const redirected=await receipt('browser_navigate',{url:`${base}/client-redirect`});assert.ok(!redirected.result.isError,JSON.stringify(redirected));assert.equal(redirected.value.url,`${base}/delayed-signup`);assert.equal(redirected.value.title,'Ready signup');
 const unavailable=await receipt('browser_navigate',{url:`${base}/unavailable`});assert.equal(unavailable.result.isError,true);assert.equal(unavailable.value.code,'BROWSER_NAVIGATION_FAILED');assert.match(unavailable.value.message,/HTTP 503/);
 const stale=await receipt('browser_snapshot');assert.equal(stale.result.isError,true);assert.equal(stale.value.code,'BROWSER_PAGE_NOT_READY','failed navigation must not expose an error page as application grounding');
 const restored=await receipt('browser_navigate',{url:`${base}/supplied-start`});assert.ok(!restored.result.isError,JSON.stringify(restored));
 const outside=await receipt('browser_navigate',{url:`${base}/wrong-origin`});assert.equal(outside.result.isError,true,'redirecting outside the configured origin stays blocked');
 const afterOutside=await receipt('browser_snapshot');assert.equal(afterOutside.result.isError,true);assert.equal(afterOutside.value.code,'BROWSER_PAGE_NOT_READY');
 await browser.close();
});

test('visible settled controls remain usable while a same-origin background fetch is streaming', {timeout:30000},async t=>{
 const old=process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;process.env.RECORDER_ALLOWED_PRIVATE_HOSTS='127.0.0.1';
 t.after(()=>{if(old===undefined)delete process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;else process.env.RECORDER_ALLOWED_PRIVATE_HOSTS=old;});
 const app=Fastify(),streams=new Set();
 app.get('/background',async(_req,reply)=>reply.type('text/html').send('<!doctype html><title>Interactive page</title><label>Search<input id="search"></label><button>Search</button><div role="progressbar" aria-label="Password strength" aria-valuenow="65">Strong</div><script>fetch("/background-stream").then(response=>response.text())</script>'));
 app.get('/background-stream',async(_req,reply)=>{reply.hijack();reply.raw.writeHead(200,{'content-type':'text/plain','cache-control':'no-store'});reply.raw.write('background update\n');streams.add(reply.raw);reply.raw.on('close',()=>streams.delete(reply.raw));});
 await registerAutomationMcp(app,createPrivilegedRunGuard(resolveTestEngineSharedSecret()));
 const base=await app.listen({host:'127.0.0.1',port:0});t.after(async()=>{for(const stream of streams)stream.destroy();await app.close();});
 const browser=await connectAutomationBrowser({integration:{base_url:base},startUrl:`${base}/background`,allowBrowserActions:true});t.after(()=>browser.close());
 const opened=await browser.call('browser_navigate',{url:`${base}/background`});assert.ok(!opened.isError,JSON.stringify(opened));assert.equal(JSON.parse(opened.content[0].text).readiness.application_requests,'background_active');
 const snapshot=await browser.call('browser_snapshot',{});assert.ok(!snapshot.isError,JSON.stringify(snapshot));assert.match(snapshot.content[0].text,/Search/);
 const filled=await browser.call('browser_fill',{locator:'#search',value:'ready with background polling'});assert.ok(!filled.isError,JSON.stringify(filled));assert.equal(JSON.parse(filled.content[0].text).action_outcome,'completed');
 await browser.close();
});

test('interaction waits for a late-rendered unique element while discovery stays immediate and dispatch happens once', {timeout:30000},async t=>{
 const previous=process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;process.env.RECORDER_ALLOWED_PRIVATE_HOSTS='127.0.0.1';
 t.after(()=>{if(previous===undefined)delete process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;else process.env.RECORDER_ALLOWED_PRIVATE_HOSTS=previous;});
 let submitted=0;
 const app=Fastify();
 app.get('/late-element',async(_req,reply)=>reply.type('text/html').send('<!doctype html><title>Late application control</title><h1>Application shell ready</h1><p id="result"></p><script>setTimeout(()=>{const button=document.createElement("button");button.id="late";button.textContent="Create record";button.onclick=()=>fetch("/late-submit",{method:"POST"}).then(response=>response.json()).then(value=>document.querySelector("#result").textContent=value.message);document.body.append(button)},6000)</script>'));
 app.post('/late-submit',async()=>{submitted++;return {message:'Created exactly once'};});
 await registerAutomationMcp(app,createPrivilegedRunGuard(resolveTestEngineSharedSecret()));
 const base=await app.listen({host:'127.0.0.1',port:0});t.after(()=>app.close());
 const browser=await connectAutomationBrowser({integration:{base_url:base},startUrl:`${base}/late-element`,allowBrowserActions:true});t.after(()=>browser.close());
 const navigate=await browser.call('browser_navigate',{url:`${base}/late-element`});assert.ok(!navigate.isError,JSON.stringify(navigate));
 const discovery=await browser.call('browser_validate_locator',{locator:'#late'});assert.ok(!discovery.isError,JSON.stringify(discovery));assert.equal(JSON.parse(discovery.content[0].text).match_count,0,'locator discovery must report current absence without an implicit action wait');assert.equal(submitted,0);
 const clicked=await browser.call('browser_click',{locator:'#late'});assert.ok(!clicked.isError,JSON.stringify(clicked));assert.equal(JSON.parse(clicked.content[0].text).action_outcome,'completed');assert.equal(submitted,1,'the rendered action must be dispatched exactly once');
 const outcome=await browser.call('browser_assert',{assertion:'text',locator:'#result',value:'Created exactly once'});assert.ok(!outcome.isError,JSON.stringify(outcome));assert.equal(JSON.parse(outcome.content[0].text).assertion_outcome,'satisfied');assert.equal(submitted,1);
 await browser.close();
});

test('read-only expected-result tools verify real accessibility-driven actions and return bounded private-safe receipts', {timeout:60000},async t=>{
 const old=process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;process.env.RECORDER_ALLOWED_PRIVATE_HOSTS='127.0.0.1';
 t.after(()=>{if(old===undefined)delete process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;else process.env.RECORDER_ALLOWED_PRIVATE_HOSTS=old;});
 const app=Fastify();
 app.get('/assertions',async(_req,reply)=>reply.type('text/html').send(`<!doctype html><title>Signup assertions</title><span id="email-label">Email address</span><span id="email-required">required</span><input id="email" aria-label="Incorrect fallback" aria-labelledby="email-label email-required"><label>Private value<input id="private" type="password" value="private-assertion-fixture"></label><label>Subscribe<input id="subscribe" type="checkbox"></label><span id="submit-label">Create account</span><button id="create" aria-labelledby="submit-label" disabled></button><p id="result" hidden></p><script>
 const email=document.querySelector('#email'),button=document.querySelector('#create'),result=document.querySelector('#result');
 email.addEventListener('input',()=>button.disabled=!email.value.includes('@'));
 button.addEventListener('click',()=>{setTimeout(()=>{result.hidden=false;result.textContent='Account created';document.title='Signup completed'},4200)});
 </script>`));
 await registerAutomationMcp(app,createPrivilegedRunGuard(resolveTestEngineSharedSecret()));
 const base=await app.listen({host:'127.0.0.1',port:0});t.after(()=>app.close());
 const browser=await connectAutomationBrowser({integration:{base_url:base},startUrl:`${base}/assertions`,allowBrowserActions:true});t.after(()=>browser.close());
 const call=async(name,args={})=>{const result=await browser.call(name,args);assert.ok(!result.isError,JSON.stringify(result));return JSON.parse(result.content[0].text);};
 await call('browser_navigate',{url:`${base}/assertions`});
 const snapshot=await call('browser_snapshot');
 const email=snapshot.elements.find(element=>element.attributes.id==='email');assert.equal(email.label,'Email address required');assert.ok(!email.locator_candidates.some(locator=>locator==='getByLabel("Email address required", { exact: true })'),'multiple labels must not create a combined getByLabel expression that Playwright cannot resolve');assert.ok(email.locator_candidates.some(locator=>locator.includes('getByRole("textbox", { name: "Email address required"')),'aria-labelledby must override aria-label in locator hints');
 const button=snapshot.elements.find(element=>element.attributes.id==='create');assert.equal(button.label,'Create account');
 await call('browser_assert',{assertion:'disabled',locator:'getByRole("button", { name: "Create account", exact: true })'});
 await call('browser_assert',{assertion:'hidden',locator:'#result'});
 const fill=await call('browser_fill',{locator:'getByRole("textbox", { name: "Email address required", exact: true })',value:'generated@example.test'});assert.equal(fill.action_outcome,'completed');
 for(const args of [{assertion:'value',locator:'#email',value:'generated@example.test'},{assertion:'value',locator:'#private',value:'private-assertion-fixture'},{assertion:'enabled',locator:'getByRole("button", { name: "Create account", exact: true })'},{assertion:'count',locator:'button',value:'1'}]) {
  const receipt=await call('browser_assert',args);assert.equal(receipt.assertion_outcome,'satisfied');assert.equal(receipt.verification_status,'unverified');assert.doesNotMatch(JSON.stringify(receipt),/generated@example.test|private-assertion-fixture/);
 }
 await call('browser_check',{locator:'getByLabel("Subscribe", { exact: true })'});await call('browser_assert',{assertion:'checked',locator:'#subscribe'});
 const click=await call('browser_click',{locator:'getByRole("button", { name: "Create account", exact: true })'});assert.equal(click.action_outcome,'completed');
 const outcome=await call('browser_assert',{assertion:'text',locator:'#result',value:'Account created'});assert.equal(outcome.assertion_outcome,'satisfied');assert.ok(outcome.duration_ms>=300,'expected-result checks must retry until the delayed outcome actually appears');
 for(const args of [{assertion:'title',value:'Signup completed'},{assertion:'url',value:`${base}/assertions`},{assertion:'text_contains',locator:'#result',value:'created'}]) assert.equal((await call('browser_assert',args)).assertion_outcome,'satisfied');
 const wrong=await browser.call('browser_assert',{assertion:'value',locator:'#private',value:'incorrect-private-expectation'});assert.equal(wrong.isError,true);const failed=JSON.parse(wrong.content[0].text);assert.equal(failed.code,'BROWSER_ASSERTION_NOT_SATISFIED');assert.equal(failed.assertion_outcome,'not_satisfied');assert.equal(failed.action_outcome,'not_attempted');assert.equal(failed.retry_safe,true);assert.doesNotMatch(JSON.stringify(wrong),/private-assertion-fixture|incorrect-private-expectation/);
 const ambiguous=await browser.call('browser_assert',{assertion:'visible',locator:'input'});assert.equal(ambiguous.isError,true);assert.equal(JSON.parse(ambiguous.content[0].text).code,'BROWSER_ASSERTION_AMBIGUOUS');
 await browser.close();
 const readOnly=await connectAutomationBrowser({integration:{base_url:base},startUrl:`${base}/assertions`,allowBrowserActions:false});t.after(()=>readOnly.close());assert.ok(readOnly.tools.some(tool=>tool.name==='browser_assert'));assert.ok(!readOnly.tools.some(tool=>tool.name==='browser_fill'));
 await readOnly.call('browser_navigate',{url:`${base}/assertions`});const observed=await readOnly.call('browser_assert',{assertion:'visible',locator:'#email'});assert.ok(!observed.isError,JSON.stringify(observed));await readOnly.close();
});

test('result snapshots expose static assertion targets, redact parameter values and prioritize controls within the evidence budget', {timeout:45000},async t=>{
 const previous=process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;process.env.RECORDER_ALLOWED_PRIVATE_HOSTS='127.0.0.1';
 t.after(()=>{if(previous===undefined)delete process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;else process.env.RECORDER_ALLOWED_PRIVATE_HOSTS=previous;});
 const app=Fastify();let submissions=0;
 app.get('/review-static',async(_req,reply)=>reply.type('text/html').send(`<!doctype html><title>Static expected-result fixture</title><main id="app"><h1>Contact details</h1><label>Email address<input id="email"></label><button id="continue">Continue</button></main><script id="fixture-script">
 document.querySelector('#continue').onclick=()=>{const email=document.querySelector('#email').value;document.querySelector('#app').innerHTML='<h1>Review details</h1><p id="review-email"></p><div role="status">Ready for confirmation</div><table aria-label="Review"><tr><th scope="row">State</th><td>Pending</td></tr></table><p id="hidden-result" hidden>Hidden result</p><button id="confirm">Confirm</button>';document.querySelector('#review-email').textContent=email;fetch('/review-observed',{method:'POST'});};
 </script>`));
 app.post('/review-observed',async()=>{submissions++;return {ok:true};});
 app.get('/crowded-static',async(_req,reply)=>reply.type('text/html').send('<!doctype html><title>Crowded static evidence</title>'+Array.from({length:150},(_,index)=>`<h2 id="result-${index}">Result ${index}</h2>`).join('')+'<label>Late input<input id="late-input"></label><button id="late-button">Late action</button>'));
 await registerAutomationMcp(app,createPrivilegedRunGuard(resolveTestEngineSharedSecret()));
 const base=await app.listen({host:'127.0.0.1',port:0});t.after(()=>app.close());
 const browser=await connectAutomationBrowser({integration:{base_url:base},startUrl:`${base}/review-static`,allowBrowserActions:true});t.after(()=>browser.close());
 const actual='owned-private-result@example.test',data=createBrowserParameterResolver({caseValues:{'t.email':actual}});
 const call=async(name,args={})=>{const result=data.redactResult(await browser.call(name,data.resolve(name,args)));assert.ok(!result.isError,JSON.stringify(result));return {result,value:JSON.parse(result.content[0].text)};};
 await call('browser_navigate',{url:`${base}/review-static`});await call('browser_fill',{locator:'getByLabel("Email address", { exact: true })',value:'@t.email'});await call('browser_click',{locator:'#continue'});
 const {result:snapshot,value}=await call('browser_snapshot');assert.equal(submissions,1);assert.doesNotMatch(JSON.stringify(snapshot),new RegExp(actual));assert.match(value.accessibility,/Review details/);
 const heading=value.elements.find(item=>item.tag==='h1');assert.ok(heading.locator_candidates.includes('getByRole("heading", { name: "Review details", exact: true })'));
 const email=value.elements.find(item=>item.attributes.id==='review-email');assert.ok(email,'plain text result with an ID must be discoverable');assert.equal(email.text,'[private parameter value]');assert.ok(email.locator_candidates.includes('#review-email'));
 assert.ok(value.elements.find(item=>item.attributes.role==='status').locator_candidates.includes('getByRole("status")'),'status text must not be advertised as its accessible name');
 assert.ok(value.elements.find(item=>item.tag==='td').locator_candidates.includes('getByRole("cell", { name: "Pending", exact: true })'));
 assert.ok(!value.elements.some(item=>['fixture-script','hidden-result'].includes(item.attributes.id)),'hidden results and scripts must not become static evidence');
 const checked=await call('browser_assert',{assertion:'text',locator:email.locator_candidates.find(item=>item==='#review-email'),value:'@t.email'});assert.equal(checked.value.assertion_outcome,'satisfied');assert.equal(submissions,1,'read-only expected-result checks cannot replay the previous action');
 await call('browser_navigate',{url:`${base}/crowded-static`});const crowded=(await call('browser_snapshot')).value;
 assert.equal(crowded.elements.length,120);assert.equal(crowded.elements_truncated,true);assert.ok(Buffer.byteLength(JSON.stringify(crowded))<=64*1024);assert.deepEqual(crowded.elements.slice(0,2).map(item=>item.attributes.id),['late-input','late-button'],'controls after static content retain discovery priority');
 await browser.close();
});
