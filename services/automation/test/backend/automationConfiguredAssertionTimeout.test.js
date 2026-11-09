const test=require('node:test'),assert=require('node:assert/strict');
const {configuredAssertionTimeoutMs,configuredNavigationTimeoutMs,browserTransportTimeoutMs}=require('../../backend/lib/automationAssertionTimeout');
const {connectAutomationBrowser}=require('../../backend/lib/automationBrowserAgent');
const {verifyRecordedAutomation}=require('../../backend/lib/automationVerificationClient');

test('configured assertion policy matches Run parsing without changing default, fixed-predicate or action transport limits',()=>{
 for(const [input,expected]of [[undefined,undefined],[null,undefined],['',undefined],[' ',undefined],[0,250],['0',250],[45000.9,45000],['45000ms',45000],[200000,120000],['bad',10000],[true,10000],[Infinity,10000]])assert.equal(configuredAssertionTimeoutMs(input),expected,String(input));
 for(const assertion of ['url','url_contains','visible','value','title'])assert.equal(browserTransportTimeoutMs('tools/call',{name:'browser_assert',arguments:{assertion}},45000),55000);
 for(const assertion of ['valid','invalid','field_valid','input_type'])assert.equal(browserTransportTimeoutMs('tools/call',{name:'browser_assert',arguments:{assertion}},45000),30000);
 for(const name of ['browser_click','browser_fill','browser_navigate','browser_snapshot'])assert.equal(browserTransportTimeoutMs('tools/call',{name},45000),30000);
 assert.equal(browserTransportTimeoutMs('tools/call',{name:'browser_assert'},undefined),30000);assert.equal(browserTransportTimeoutMs('tools/call',{name:'browser_assert'},120000),130000);
});

function transport(t,{echo='accepted',onCall}={}){
 const timeouts=[],calls=[];
 t.mock.method(AbortSignal,'timeout',ms=>{timeouts.push(ms);return new AbortController().signal;});
 t.mock.method(globalThis,'fetch',async(url,init)=>{
  const rpc=init.body?JSON.parse(init.body):null,row={rpc,budget:timeouts.at(-1),signal:init.signal};calls.push(row);
  if(init.method==='DELETE')return new Response(null,{status:204});
  if(onCall&&rpc?.method==='tools/call')return onCall(row);
  if(rpc.method==='notifications/initialized')return new Response(null,{status:202});
  const policy=rpc.params?._meta?.hellotest?.assertion_timeout_ms,navigation=rpc.params?._meta?.hellotest?.navigation_timeout_ms;
  const result=rpc.method==='initialize'?{protocolVersion:'2025-03-26',capabilities:{tools:{}},...(echo==='accepted'?{_meta:{hellotest:{assertion_timeout_ms:policy??10000,...(navigation!==undefined?{navigation_timeout_ms:navigation}:{})}}}:echo==='mismatch'?{_meta:{hellotest:{assertion_timeout_ms:10000,navigation_timeout_ms:1000}}}:{})}
   :rpc.method==='tools/list'?{tools:['browser_assert','browser_click','browser_snapshot'].map(name=>({name,inputSchema:{type:'object'}}))}:{content:[{type:'text',text:'{"source":"playwright","assertion_outcome":"satisfied"}'}]};
  return Response.json({jsonrpc:'2.0',id:rpc.id,result},{headers:{'mcp-session-id':'fixture-session'}});
 });
 return {calls,timeouts};
}

test('connect freezes selected policy, requires its acknowledgement and reserves only configured assertion transport within the original section deadline',async t=>{
 t.mock.method(Date,'now',()=>1000);const f=transport(t),integration={base_url:'http://engine.fixture',config:{assertion_timeout_ms:'45000ms'}};
 const browser=await connectAutomationBrowser({integration,startUrl:'https://app.fixture'});
 try{
  assert.equal(f.calls[0].rpc.params._meta.hellotest.assertion_timeout_ms,45000);integration.config.assertion_timeout_ms=1000;
  await browser.call('browser_assert',{assertion:'url_contains',value:'/dashboard'});assert.equal(f.calls.at(-1).budget,55000);
  await browser.call('browser_assert',{assertion:'url_contains',value:'/dashboard'},{deadlineMs:2500});assert.equal(f.calls.at(-1).budget,1500);
  for(const assertion of ['valid','invalid','field_valid','input_type']){await browser.call('browser_assert',{assertion,locator:'#field'});assert.equal(f.calls.at(-1).budget,30000);}
  for(const name of ['browser_click','browser_snapshot']){await browser.call(name,{locator:'#field'});assert.equal(f.calls.at(-1).budget,30000);}
 }finally{await browser.close();}
});

test('older or mismatched runtimes fail before tool discovery, navigation or actions for an explicit nondefault policy',async t=>{
 for(const echo of ['absent','mismatch'])await t.test(echo,async t=>{
  const f=transport(t,{echo});await assert.rejects(connectAutomationBrowser({integration:{base_url:'http://engine.fixture',config:{assertion_timeout_ms:45000}},startUrl:'https://app.fixture'}),{
   code:'AUTOMATION_BROWSER_ASSERTION_POLICY_UNSUPPORTED',nonRetryable:true,action_outcome:'not_attempted'
  });
  assert.deepEqual(f.calls.map(row=>row.rpc?.method||'DELETE'),['initialize','DELETE']);
 });
 for(const value of [undefined,10000])await t.test('default-'+value,async t=>{
  const f=transport(t,{echo:'absent'}),browser=await connectAutomationBrowser({integration:{base_url:'http://engine.fixture',config:{assertion_timeout_ms:value}},startUrl:'https://app.fixture'});
  await browser.call('browser_assert',{assertion:'url_contains',value:'/dashboard'});assert.equal(f.calls.at(-1).budget,30000);await browser.close();
 });
});

test('caller cancellation still interrupts one configured long assertion without a replacement call',async t=>{
 const parent=new AbortController();let started;const ready=new Promise(resolve=>{started=resolve;});
 const f=transport(t,{onCall:row=>{started();return new Promise((_,reject)=>row.signal.addEventListener('abort',()=>reject(row.signal.reason),{once:true}));}});
 const browser=await connectAutomationBrowser({integration:{base_url:'http://engine.fixture',config:{assertion_timeout_ms:45000}},startUrl:'https://app.fixture',signal:parent.signal});
 try{const pending=browser.call('browser_assert',{assertion:'url_contains',value:'/dashboard'});await ready;const reason=new Error('Cancelled fixture build');parent.abort(reason);await assert.rejects(pending,error=>error===reason);assert.equal(f.calls.filter(row=>row.rpc?.method==='tools/call').length,1);}
 finally{await browser.close();}
});

test('isolated verification receives only selected integration policy and keeps the frozen program/data and total allowance',async t=>{
 const request={schema_version:1,timeout_ms:60000,assertion_timeout_ms:120000,navigation_timeout_ms:600000,sections:[{step_id:'one',automation_code:'UNCHANGED'}],parameters:{'r.value':'frozen'}},original=structuredClone(request),bodies=[];
 t.mock.method(globalThis,'fetch',async(_url,init)=>{bodies.push(JSON.parse(init.body));return Response.json({schema_version:1,status:'passed'});});
 await verifyRecordedAutomation({integration:{base_url:'https://engine.fixture',config:{assertion_timeout_ms:45000,navigation_timeout_ms:'45000'}},request});
 assert.equal(bodies[0].assertion_timeout_ms,45000);assert.equal(bodies[0].navigation_timeout_ms,45000);assert.equal(bodies[0].timeout_ms,60000);assert.deepEqual(bodies[0].sections,request.sections);assert.deepEqual(bodies[0].parameters,request.parameters);assert.deepEqual(request,original);
 await verifyRecordedAutomation({integration:{base_url:'https://engine.fixture',config:{}},request});
 for(const key of ['assertion_timeout_ms','navigation_timeout_ms'])assert.equal(Object.hasOwn(bodies[1],key),false,'A caller supplied timeout cannot replace the selected integration policy');
});

test('configured navigation matches Run parsing and extends only navigation transport',()=>{
 for(const [input,expected]of [[undefined,undefined],[null,undefined],['',undefined],[' ',undefined],[0,1000],['0',1000],[45000.9,45000],['45000ms',45000],[900000,600000],['bad',30000],[true,30000],[Infinity,30000]])assert.equal(configuredNavigationTimeoutMs(input),expected,String(input));
 assert.equal(browserTransportTimeoutMs('tools/call',{name:'browser_navigate'},undefined,45000),55000);
 assert.equal(browserTransportTimeoutMs('tools/call',{name:'browser_navigate'},undefined,600000),610000);
 assert.equal(browserTransportTimeoutMs('tools/call',{name:'browser_navigate'},undefined,1000),30000);
 for(const name of ['browser_click','browser_fill','browser_press_key','browser_select_option','browser_snapshot'])assert.equal(browserTransportTimeoutMs('tools/call',{name},undefined,45000),30000);
 assert.equal(browserTransportTimeoutMs('tools/call',{name:'browser_assert',arguments:{assertion:'visible'}},45000,600000),55000);
});

test('connect freezes navigation policy, requires exact echo and preserves original deadline bounds',async t=>{
 t.mock.method(Date,'now',()=>1000);const f=transport(t),integration={base_url:'http://engine.fixture',config:{navigation_timeout_ms:'45000ms'}};
 const browser=await connectAutomationBrowser({integration,startUrl:'https://app.fixture'});
 try{
  assert.equal(f.calls[0].rpc.params._meta.hellotest.navigation_timeout_ms,45000);integration.config.navigation_timeout_ms=1000;
  await browser.call('browser_navigate',{url:'https://app.fixture/'});assert.equal(f.calls.at(-1).budget,55000);
  await browser.call('browser_navigate',{url:'https://app.fixture/'},{deadlineMs:2500});assert.equal(f.calls.at(-1).budget,1500);
  for(const name of ['browser_click','browser_snapshot']){await browser.call(name,{locator:'#field'});assert.equal(f.calls.at(-1).budget,30000);}
 }finally{await browser.close();}
});

test('every explicit navigation policy fails before discovery or actions when the runtime cannot echo it exactly',async t=>{
 for(const value of [25000,30000,45000])for(const echo of ['absent','mismatch'])await t.test(value+'-'+echo,async t=>{
  const f=transport(t,{echo});await assert.rejects(connectAutomationBrowser({integration:{base_url:'http://engine.fixture',config:{navigation_timeout_ms:value}},startUrl:'https://app.fixture'}),{
   code:'AUTOMATION_BROWSER_NAVIGATION_POLICY_UNSUPPORTED',nonRetryable:true,action_outcome:'not_attempted'
  });assert.deepEqual(f.calls.map(row=>row.rpc?.method||'DELETE'),['initialize','DELETE']);
 });
 await t.test('absent policy keeps older runtimes compatible',async t=>{
  const f=transport(t,{echo:'absent'}),browser=await connectAutomationBrowser({integration:{base_url:'http://engine.fixture',config:{}},startUrl:'https://app.fixture'});
  await browser.call('browser_navigate',{url:'https://app.fixture/'});assert.equal(f.calls.at(-1).budget,30000);await browser.close();
 });
});

test('caller cancellation interrupts exactly one configured navigation without replacement',async t=>{
 const parent=new AbortController();let started;const ready=new Promise(resolve=>{started=resolve;});
 const f=transport(t,{onCall:row=>{started();return new Promise((_,reject)=>row.signal.addEventListener('abort',()=>reject(row.signal.reason),{once:true}));}});
 const browser=await connectAutomationBrowser({integration:{base_url:'http://engine.fixture',config:{navigation_timeout_ms:45000}},startUrl:'https://app.fixture',signal:parent.signal});
 try{const pending=browser.call('browser_navigate',{url:'https://app.fixture/'});await ready;const reason=new Error('Cancelled fixture navigation');parent.abort(reason);await assert.rejects(pending,error=>error===reason);assert.equal(f.calls.filter(row=>row.rpc?.method==='tools/call').length,1);}
 finally{await browser.close();}
});
