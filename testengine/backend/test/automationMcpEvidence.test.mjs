import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { captureAutomationBrowserSnapshot, registerAutomationMcp, waitForAutomationPageReadiness, assertAutomationBrowserCondition, validateAutomationBrowserAssertion } from '../dist/lib/automationMcp.js';

const fakeScope = ({ count = 1, aria = '- button "Save"', elements = [], sensitive = [], ariaError, domError } = {}) => ({
  count: async () => count,
  ariaSnapshot: async options => { assert.ok(options.timeout>0&&options.timeout<=5000); assert.equal(options.depth,8); if(ariaError)throw ariaError;return aria; },
  evaluate: async (_fn,limits) => { assert.equal(limits.elements,120); if(domError)throw domError;return {elements,scanned_elements:elements.length,truncated:false,sensitive_values:sensitive}; }
});
const fakePage = scope => ({locator:()=>scope,url:()=> 'https://app.test/orders',title:async()=> 'Orders'});

test('accessibility link URL metadata cannot bypass destination privacy, including multiline URL values', async () => {
  const scope = fakeScope({ aria: '- link "Continue":\n  - /url: |\n      https://user:unknown-secret@app.test/callback?access_token=unknown-secret\n      continuation-secret\n  - text: Visible destination label\n- button "Done"' });
  const snapshot = await captureAutomationBrowserSnapshot(fakePage(scope));
  assert.match(snapshot.accessibility, /link "Continue"/); assert.match(snapshot.accessibility, /Visible destination label/); assert.match(snapshot.accessibility, /button "Done"/);
  assert.doesNotMatch(snapshot.accessibility, /\/url:|unknown-secret|continuation-secret|access_token/);
});

test('alert visible-text evidence uses the same private-value redaction as textContent', async () => {
  const secret = 'private-alert-detail';
  const snapshot = await captureAutomationBrowserSnapshot(fakePage(fakeScope({
    sensitive: [secret], elements: [{ tag: 'div', attributes: { role: 'alert' }, text: secret + ' hidden detail Dismiss', visible_text: secret + ' Dismiss', visible_text_truncated: false }]
  })));
  assert.equal(snapshot.elements[0].visible_text, '[redacted] Dismiss');
  assert.equal(snapshot.elements[0].visible_text_truncated, false);
  assert.doesNotMatch(JSON.stringify(snapshot), /private-alert-detail/);
});

test('snapshot bounds UTF-8 evidence, preserves provenance and identifies truncation',async()=>{
  const scope=fakeScope({aria:'- button "'+ '🙂'.repeat(30000)+'"',elements:Array.from({length:120},()=>({tag:'button',attributes:{'aria-label':'🙂'.repeat(200)},locator_candidates:['getByRole("button")']}))});
  const snapshot=await captureAutomationBrowserSnapshot(fakePage(scope));
  assert.equal(snapshot.source,'playwright');assert.equal(snapshot.verification_status,'unverified');assert.ok(snapshot.observation_id);assert.ok(Number.isFinite(Date.parse(snapshot.captured_at)));
  assert.equal(snapshot.truncated,true);assert.equal(snapshot.accessibility_truncated,true);assert.equal(snapshot.elements_truncated,true);
  assert.ok(Buffer.byteLength(JSON.stringify(snapshot))<=64*1024);assert.equal(snapshot.url,'https://app.test/orders');assert.equal(snapshot.title,'Orders');
});

test('partial snapshots retain available grounding and redact sensitive accessibility values',async()=>{
  const dom=[{tag:'button',text:'Save',displayed:true,locator_candidates:['getByRole("button", {name:"Save"})'],locators_validated:false}];
  const partial=await captureAutomationBrowserSnapshot(fakePage(fakeScope({ariaError:new Error('Unsupported ariaSnapshot'),elements:dom})));
  assert.equal(partial.partial,true);assert.equal(partial.accessibility,'');assert.equal(partial.elements[0].text,'Save');assert.match(partial.warnings.join(' '),/Accessibility capture is unavailable/);
  const redacted=await captureAutomationBrowserSnapshot(fakePage(fakeScope({aria:'- textbox "Password": fixture-secret',sensitive:['fixture-secret'],elements:dom})));
  assert.doesNotMatch(JSON.stringify(redacted),/fixture-secret|sensitive_values/);assert.match(redacted.accessibility,/redacted/);
  const specialSecret='private"value\\with-slash';
  const repeated=await captureAutomationBrowserSnapshot(fakePage(fakeScope({aria:'- paragraph: '+specialSecret,sensitive:[specialSecret],elements:[{tag:'p',attributes:{id:'result'},text:'Received '+specialSecret,locator_candidates:['#result']}]})));
  assert.equal(repeated.elements[0].text,'Received [redacted]');assert.deepEqual(repeated.elements[0].locator_candidates,['#result']);assert.doesNotMatch(repeated.accessibility,/with-slash/);
  const ariaOnly=await captureAutomationBrowserSnapshot(fakePage(fakeScope({domError:new Error('DOM unavailable')})));
  assert.equal(ariaOnly.partial,true);assert.match(ariaOnly.accessibility,/Save/);
  await assert.rejects(captureAutomationBrowserSnapshot(fakePage(fakeScope({ariaError:new Error('No aria'),domError:new Error('No DOM')}))),/Browser evidence is unavailable/);
});

test('scoped snapshots enforce unique observed locators',async()=>{
  const page=fakePage(fakeScope({count:2}));page.getByRole=()=>fakeScope({count:2});
  await assert.rejects(captureAutomationBrowserSnapshot(page,'getByRole("button",{name:"Save"})'),/Snapshot scope matches 2/);
});

test('sensitive selector redaction retains exact safe candidates instead of authorizing rewritten selectors',async()=>{
  const secret='fixture"private\\token';
  const privateCandidate=`getByRole("button", { name: ${JSON.stringify(secret)}, exact: true })`;
  const snapshot=await captureAutomationBrowserSnapshot(fakePage(fakeScope({
    aria:`- button ${JSON.stringify(secret)}`,sensitive:[secret],
    elements:[{tag:'button',text:secret,locators_validated:true,locator_candidates:[privateCandidate,'#safe-target']}]
  })));
  assert.deepEqual(snapshot.elements[0].locator_candidates,['#safe-target']);
  assert.equal(snapshot.elements[0].locators_validated,true);
  assert.equal(snapshot.elements[0].text,'[redacted]');
  assert.doesNotMatch(JSON.stringify(snapshot),/fixture|private|token|sensitive_selector_values/);
});

test('redacted select option values remain excerpts and cannot become invented executable inputs',async()=>{
  const secret='private-option-token';
  const snapshot=await captureAutomationBrowserSnapshot(fakePage(fakeScope({sensitive:[secret],elements:[{
    tag:'select',locators_validated:true,locator_candidates:['#choice'],options:[
      {label:'Private configured choice',value:secret,selected:true,disabled:false},
      {label:'Public choice',value:'public-value',selected:false,disabled:false}
    ]
  }]})));
  const [privateOption,publicOption]=snapshot.elements[0].options;
  assert.equal(privateOption.value,undefined);
  assert.equal(privateOption.value_excerpt,'[redacted]');
  assert.equal(privateOption.value_truncated,true);
  assert.equal(publicOption.value,'public-value');
  assert.doesNotMatch(JSON.stringify(snapshot),/private-option-token/);
});

test('MCP error receipts distinguish unknown side effects, optional captures and lost contexts',async t=>{
  const old=process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;process.env.RECORDER_ALLOWED_PRIVATE_HOSTS='127.0.0.1';
  const app=Fastify();let closed=false,launches=0,clicks=0,fills=0,checks=0,readinessFailed=false,proxyCloses=0;
  const scope={...fakeScope(),click:async()=>{clicks++;throw new Error('Click timed out after dispatch');},fill:async value=>{fills++;throw new Error(`fill("${value}") timed out`);},check:async()=>{checks++;readinessFailed=true;}};
  const page={...fakePage(scope),url:()=> 'http://127.0.0.1:1234/',isClosed:()=>closed,on:()=>{},evaluate:async()=>{if(readinessFailed)throw Object.assign(new Error('Application did not settle after the action'),{code:'BROWSER_PAGE_NOT_READY'});return {loaded:true,usable:true,actionable:true,busy:false,signature:1};},setDefaultTimeout:()=>{},goto:async()=>{},screenshot:async()=>{throw new Error('Optional capture failed');}};
  const context={route:async()=>{},newPage:async()=>page,on:()=>{}};
  const browser={newContext:async()=>context,isConnected:()=>!closed,close:async()=>{closed=true;}};
  await registerAutomationMcp(app,async()=>{}, {launchBrowser:async()=>{launches++;closed=false;return browser;},createProxy:async()=>({server:'http://proxy.test',close:async()=>{proxyCloses++;}})});
  t.after(async()=>{await app.close();if(old===undefined)delete process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;else process.env.RECORDER_ALLOWED_PRIVATE_HOSTS=old;});
  const endpoint='/api/v1/automation/mcp';let session;
  const rpc=async(method,params={})=>(await app.inject({method:'POST',url:endpoint,headers:session?{'mcp-session-id':session}:{},payload:{jsonrpc:'2.0',id:1,method,params}}));
  const init=await rpc('initialize',{_meta:{hellotest:{start_url:'http://127.0.0.1:1234/',allow_browser_actions:true}}});session=init.headers['mcp-session-id'];
  const call=async(name,args={})=>(await rpc('tools/call',{name,arguments:args})).json().result;
  const receipt=async(name,args)=>JSON.parse((await call(name,args)).content[0].text);
  const tools=(await rpc('tools/list')).json().result.tools;assert.ok(tools.find(tool=>tool.name==='browser_snapshot').inputSchema.properties.locator);
  assert.equal((await receipt('browser_navigate',{url:'http://127.0.0.1:1234/'})).action_outcome,'completed');
  const click=await receipt('browser_click',{locator:'button'});assert.equal(click.action_outcome,'unknown');assert.equal(click.retry_safe,false);assert.equal(click.code,'BROWSER_ACTION_OUTCOME_UNKNOWN');assert.equal(clicks,1);
  const fill=await receipt('browser_fill',{locator:'input',value:'private-fixture-value'});assert.equal(fill.action_outcome,'unknown');assert.doesNotMatch(JSON.stringify(fill),/private-fixture-value/);assert.match(fill.message,/redacted/);assert.equal(fills,1);
  const screenshot=await receipt('browser_screenshot');assert.equal(screenshot.code,'SCREENSHOT_UNAVAILABLE');assert.equal(screenshot.optional,true);assert.equal(screenshot.retry_safe,true);
  scope.count=async()=>2;const ambiguous=await receipt('browser_click',{locator:'button'});assert.equal(ambiguous.action_outcome,'not_attempted');assert.equal(ambiguous.retry_safe,true);assert.equal(clicks,1);scope.count=async()=>1;
  scope.count=async()=>0;scope.waitFor=async options=>{assert.equal(options.state,'attached');assert.ok(options.timeout>0&&options.timeout<=10000);throw new Error('Attached locator wait timed out before dispatch');};
  const absent=await receipt('browser_click',{locator:'#not-rendered'});assert.equal(absent.action_outcome,'not_attempted');assert.equal(absent.retry_safe,true);assert.equal(clicks,1,'a timed-out render wait must not dispatch or replay a click');scope.count=async()=>1;
  const unsettled=await receipt('browser_check',{locator:'input'});assert.equal(unsettled.code,'BROWSER_ACTION_OUTCOME_UNKNOWN');assert.equal(unsettled.action_outcome,'unknown');assert.equal(unsettled.retry_safe,false);assert.equal(checks,1,'readiness failure after dispatch must never replay the action');readinessFailed=false;
  closed=true;
  for(let attempt=0;attempt<2;attempt++){const lost=await receipt('browser_snapshot');assert.equal(lost.code,'BROWSER_CONTEXT_LOST');assert.equal(lost.action_outcome,'not_attempted');}
  assert.equal(launches,1,'lost-context evidence cannot silently open a blank replacement browser');
  await receipt('browser_navigate',{url:'http://127.0.0.1:1234/'});assert.equal(launches,2);
  assert.ok((await receipt('browser_snapshot')).observation_id);assert.ok(proxyCloses>=1);
});

test('startup failure retains the fatal diagnostic, releases resources and rejects concurrent or silent replacement work',async t=>{
 const previous=process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;process.env.RECORDER_ALLOWED_PRIVATE_HOSTS='127.0.0.1';
 const app=Fastify();let launches=0,proxies=0,proxyCloses=0,browserCloses=0,navigations=0,browserClosed=false,releaseLaunch,startedLaunch;
 const launchStarted=new Promise(resolve=>startedLaunch=resolve),launchBlocked=new Promise(resolve=>releaseLaunch=resolve);
 const page={isClosed:()=>browserClosed,url:()=> 'http://127.0.0.1:1234/',title:async()=> 'Ready',setDefaultTimeout:()=>{},on:()=>{},goto:async()=>{navigations++;},evaluate:async()=>({loaded:true,usable:true,actionable:true,busy:false,signature:1})};
 const browser={isConnected:()=>!browserClosed,newContext:async()=>({route:async()=>{},newPage:async()=>page,on:()=>{}}),close:async()=>{browserCloses++;browserClosed=true;}};
 await registerAutomationMcp(app,async()=>{}, {createProxy:async()=>{proxies++;return {server:'http://proxy.test',close:async()=>{proxies--;proxyCloses++;}};},launchBrowser:async()=>{launches++;if(launches===1){startedLaunch();await launchBlocked;throw new Error('browserType.launch: Target browser has been closed\n'+'launch flag '.repeat(1000)+'\n<process did exit: exitCode=null, signal=SIGTRAP>');}browserClosed=false;return browser;}});
 t.after(async()=>{releaseLaunch();await app.close();if(previous===undefined)delete process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;else process.env.RECORDER_ALLOWED_PRIVATE_HOSTS=previous;});
 const endpoint='/api/v1/automation/mcp';let session;
 const rpc=(method,params={})=>app.inject({method:'POST',url:endpoint,headers:session?{'mcp-session-id':session}:{},payload:{jsonrpc:'2.0',id:1,method,params}});
 const initialized=await rpc('initialize',{_meta:{hellotest:{start_url:'http://127.0.0.1:1234/'}}});session=initialized.headers['mcp-session-id'];
 const call=(name,args={})=>rpc('tools/call',{name,arguments:args});
 const pending=call('browser_navigate',{url:'http://127.0.0.1:1234/'});await launchStarted;
 assert.equal((await call('browser_navigate',{url:'http://127.0.0.1:1234/'})).json().error.code,-32000);assert.equal(launches,1);assert.equal(proxies,1,'concurrent work must not allocate another proxy or browser');
 releaseLaunch();const failure=JSON.parse((await pending).json().result.content[0].text);
 assert.equal(failure.code,'BROWSER_LAUNCH_FAILED');assert.equal(failure.launch_phase,'startup');assert.equal(failure.startup_stage,'browser');assert.equal(failure.action_outcome,'not_attempted');assert.equal(failure.retry_safe,true);assert.ok(failure.message.length<=2000);assert.match(failure.message,/^browserType\.launch/);assert.match(failure.message,/signal=SIGTRAP/);assert.equal(proxies,0);assert.equal(proxyCloses,1);assert.equal(navigations,0);
 const read=JSON.parse((await call('browser_snapshot')).json().result.content[0].text);assert.equal(read.code,'BROWSER_CONTEXT_LOST');assert.equal(launches,1,'a failed startup cannot silently replace the browser during an evidence read');
 const retry=JSON.parse((await call('browser_navigate',{url:'http://127.0.0.1:1234/'})).json().result.content[0].text);assert.equal(retry.action_outcome,'completed');assert.equal(launches,2);assert.equal(navigations,1);assert.equal(proxies,1);
 await app.inject({method:'DELETE',url:endpoint,headers:{'mcp-session-id':session}});assert.equal(proxies,0);assert.equal(proxyCloses,2);assert.equal(browserCloses,1);
});

test('context startup failure closes the launched browser and proxy before its safe failure receipt',async t=>{
 const previous=process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;process.env.RECORDER_ALLOWED_PRIVATE_HOSTS='127.0.0.1';
 const app=Fastify();let browserClosed=false,proxyClosed=false;
 await registerAutomationMcp(app,async()=>{}, {createProxy:async()=>({server:'http://proxy.test',close:async()=>{proxyClosed=true;}}),launchBrowser:async()=>({newContext:async()=>{throw new Error('Browser context initialization failed');},close:async()=>{browserClosed=true;}})});
 t.after(async()=>{await app.close();if(previous===undefined)delete process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;else process.env.RECORDER_ALLOWED_PRIVATE_HOSTS=previous;});
 const endpoint='/api/v1/automation/mcp',init=await app.inject({method:'POST',url:endpoint,payload:{jsonrpc:'2.0',id:1,method:'initialize',params:{_meta:{hellotest:{start_url:'http://127.0.0.1:1234/'}}}}});
 const called=await app.inject({method:'POST',url:endpoint,headers:{'mcp-session-id':init.headers['mcp-session-id']},payload:{jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'browser_navigate',arguments:{url:'http://127.0.0.1:1234/'}}}});
 const receipt=JSON.parse(called.json().result.content[0].text);assert.equal(receipt.code,'BROWSER_LAUNCH_FAILED');assert.equal(receipt.launch_phase,'startup');assert.equal(receipt.startup_stage,'context');assert.equal(receipt.action_outcome,'not_attempted');assert.equal(receipt.retry_safe,true);assert.equal(browserClosed,true);assert.equal(proxyClosed,true);
});

test('readiness refuses unfinished loading, cancelled sessions and failed navigation',async()=>{
  const page={isClosed:()=>false,url:()=> 'https://app.test/signup',evaluate:async()=>({loaded:true,usable:true,actionable:true,busy:true,signature:1})};
  await assert.rejects(waitForAutomationPageReadiness(page,{deadline:Date.now()+50,origin:'https://app.test'}),error=>error.code==='BROWSER_PAGE_NOT_READY'&&/did not finish loading/.test(error.message));
  await assert.rejects(waitForAutomationPageReadiness(page,{deadline:Date.now()+1000,origin:'https://app.test',cancelled:()=>true}),/session was closed/);
  await assert.rejects(waitForAutomationPageReadiness(page,{deadline:Date.now()+1000,origin:'https://app.test',state:{pendingRequests:new Set(),navigationFailure:'net::ERR_FAILED'}}),/navigation failed/);
  await assert.rejects(waitForAutomationPageReadiness(page,{deadline:Date.now()+1000,origin:'https://app.test',state:{pendingRequests:new Set(),navigationStatus:503}}),error=>error.code==='BROWSER_PAGE_NOT_READY'&&error.http_status===503&&/HTTP 503/.test(error.message));
});

test('typed browser assertions retry observed conditions without exposing values or widening ambiguous locators',async()=>{
 const privateValue='private-fixture-password',calls=[];let count=1,visible=true,checked=false,enabled=true;
 const locator={count:async()=>count,isVisible:async()=>visible,isHidden:async()=>!visible,isChecked:async()=>checked,isEnabled:async()=>enabled,isDisabled:async()=>!enabled,inputValue:async()=>privateValue,innerText:async()=> 'Account\n   created'};
 const page={isClosed:()=>false,url:()=> 'https://app.test/signup',title:async()=> 'Ready signup',locator:expression=>{calls.push(expression);return locator;}};
 const check=(assertion,extra={})=>assertAutomationBrowserCondition(page,{assertion,...(['url','url_contains','title','title_normalized'].includes(assertion)?{}:{locator:'#observed'}),...extra},{deadline:Date.now()+500,origin:'https://app.test'});
 for(const assertion of ['visible','enabled','unchecked']) assert.equal((await check(assertion)).assertion_outcome,'satisfied');
 for(const [assertion,value] of [['text','Account created'],['text_contains','created'],['value',privateValue],['count','1'],['url','https://app.test/signup'],['title','Ready signup']]) {
  const receipt=await check(assertion,{value});assert.equal(receipt.assertion_outcome,'satisfied');assert.equal(receipt.source,'playwright');assert.equal(receipt.verification_status,'unverified');assert.doesNotMatch(JSON.stringify(receipt),/private-fixture-password|Account created|Ready signup/);assert.equal(Object.hasOwn(receipt,'value'),false);
 }
 const nativeTitle=await check('title_normalized',{value:'  Ready\u200b\n signup  '});assert.equal(nativeTitle.assertion_outcome,'satisfied');
 assert.equal((await check('url_contains',{value:'/signup'})).assertion_outcome,'satisfied');
 await assert.rejects(assertAutomationBrowserCondition(page,{assertion:'url_contains',value:'/review-details'},{deadline:Date.now()+30,origin:'https://app.test'}),error=>error.code==='BROWSER_ASSERTION_NOT_SATISFIED');
 assert.equal(validateAutomationBrowserAssertion({assertion:'url_contains',value:'/signup'}),true);
 for(const args of [{assertion:'url_contains',value:''},{assertion:'url_contains'},{assertion:'url_contains',locator:'#x',value:'signup'},{assertion:'url_contains',value:'a'.repeat(2001)}]) assert.equal(validateAutomationBrowserAssertion(args),false);
 await assert.rejects(assertAutomationBrowserCondition(page,{assertion:'title',value:'  Ready\u200b\n signup  '},{deadline:Date.now()+30,origin:'https://app.test'}),error=>error.code==='BROWSER_ASSERTION_NOT_SATISFIED','legacy title checks retain exact matching');
 for(const assertion of ['text_content','text_content_contains']) {
  assert.equal(validateAutomationBrowserAssertion({assertion,locator:'#observed',value:'expected'}),true);
  assert.equal(validateAutomationBrowserAssertion({assertion,locator:'#observed'}),false);
  assert.equal(validateAutomationBrowserAssertion({assertion,value:'expected'}),false);
 }
 assert.equal(validateAutomationBrowserAssertion({assertion:'title_normalized',value:'Title'}),true);
 assert.equal(validateAutomationBrowserAssertion({assertion:'title_normalized',locator:'#observed',value:'Title'}),false);
 visible=false;enabled=false;checked=true;
 for(const assertion of ['hidden','disabled','checked']) assert.equal((await check(assertion)).assertion_outcome,'satisfied');
 count=0;assert.equal((await check('hidden')).match_count,0);assert.equal((await check('count',{value:'0'})).assertion_outcome,'satisfied');
 count=2;await assert.rejects(check('visible'),error=>error.code==='BROWSER_ASSERTION_AMBIGUOUS');
 count=1;let samples=0;locator.isVisible=async()=>++samples>=3;
 assert.equal((await check('visible')).assertion_outcome,'satisfied');assert.equal(samples,3,'visibility assertions must retry transient rendering');
 await assert.rejects(assertAutomationBrowserCondition(page,{assertion:'value',locator:'#observed',value:'expected-private-value'},{deadline:Date.now()+30,origin:'https://app.test'}),error=>error.code==='BROWSER_ASSERTION_NOT_SATISFIED'&&!/private-fixture-password|expected-private-value/.test(error.message));
 await assert.rejects(assertAutomationBrowserCondition(page,{assertion:'visible',locator:'#observed'},{deadline:Date.now()+500,origin:'https://app.test',cancelled:()=>true}),error=>error.code==='BROWSER_ASSERTION_CANCELLED');
 for(const args of [{assertion:'javascript',value:'1'},{assertion:'text',locator:'#observed'},{assertion:'count',locator:'#observed',value:'2001'},{assertion:'url',value:'file:///etc/passwd'},{assertion:'visible',locator:'#observed',value:'unexpected'}]) assert.equal(validateAutomationBrowserAssertion(args),false);
});

test('native valid and invalid checks read only supported constraint candidates without leaking values or dispatching methods',async()=>{
 let valid=false,willValidate=true,tagName='INPUT',reads=0;
 const control={get tagName(){return tagName},get willValidate(){return willValidate},validity:{get valid(){reads++;return valid}},
  get value(){throw Error('must not read private value')},get validationMessage(){throw Error('must not read private message')},
  checkValidity(){throw Error('must not dispatch invalid')},reportValidity(){throw Error('must not dispatch invalid')}};
 const locator={count:async()=>1,evaluate:async reader=>reader(control)};
 const page={isClosed:()=>false,url:()=> 'https://app.test/profile',locator:()=>locator};
 const check=assertion=>assertAutomationBrowserCondition(page,{assertion,locator:'#control'},{deadline:Date.now()+500,origin:'https://app.test'});
 for(const assertion of ['valid','invalid']){
  assert.equal(validateAutomationBrowserAssertion({assertion,locator:'#control'}),true);
  assert.equal(validateAutomationBrowserAssertion({assertion,locator:'#control',value:''}),false);
  assert.equal(validateAutomationBrowserAssertion({assertion}),false);
 }
 assert.equal((await check('invalid')).assertion_subject,'native_constraint_validity');
 valid=true;const result=await check('valid');assert.equal(result.validation_scope,'selected_control_only');
 assert.doesNotMatch(JSON.stringify(result),/validationMessage|private|"value"/);
 for(const tag of ['INPUT','TEXTAREA','SELECT']){tagName=tag;assert.equal((await check('valid')).assertion_outcome,'satisfied')}
 for(const tag of ['DIV','BUTTON','FIELDSET','OUTPUT'])for(const assertion of ['valid','invalid']){
  tagName=tag;await assert.rejects(check(assertion),error=>error.code==='BROWSER_ASSERTION_SUBJECT_UNSUPPORTED');
 }
 tagName='INPUT';willValidate=false;const before=reads;
 for(const assertion of ['valid','invalid'])await assert.rejects(check(assertion),error=>error.code==='BROWSER_ASSERTION_SUBJECT_UNSUPPORTED');
 assert.equal(reads,before,'barred controls do not read validity and cannot pass vacuously');
 willValidate=true;valid=false;
 await assert.rejects(assertAutomationBrowserCondition(page,{assertion:'valid',locator:'#control'},{deadline:Date.now()+20,origin:'https://app.test'}),error=>error.code==='BROWSER_ASSERTION_NOT_SATISFIED');
});
