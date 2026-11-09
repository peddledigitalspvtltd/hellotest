const test=require('node:test');
const assert=require('node:assert/strict');
const {connectUpstreamPlaywright}=require('../../backend/lib/automationUpstreamMcpClient');
const tools=[{name:'browser_fill_form',description:'Fill native form fields',annotations:{readOnlyHint:false},inputSchema:{type:'object',properties:{fields:{type:'array',items:{type:'object',properties:{ref:{type:'string'},value:{type:'string'}}}}},required:['fields'],additionalProperties:false}}];
const nativeResult={content:[{type:'text',text:'### Result\nFilled the form\n### Ran Playwright code\n```js\nawait page.getByRole(\'textbox\', { name: \'Name\' }).fill(\'Ada\');\n```'},{type:'image',mimeType:'image/png',data:'aW1hZ2U='}],isError:false,_meta:{native:'untouched'}};
const integration={base_url:'https://engine.test/',config:{shared_secret:'upstream-testengine-fixture-secret'}};
const initialized=rpc=>({protocolVersion:'2025-03-26',capabilities:{tools:{listChanged:true}},serverInfo:{name:'api',version:'native'},_meta:{hellotest:{provider:'playwright_mcp_upstream',upstream_package:'@playwright/mcp',upstream_version:'0.0.84',assertion_timeout_ms:rpc.params._meta.hellotest.assertion_timeout_ms??10000,navigation_timeout_ms:rpc.params._meta.hellotest.navigation_timeout_ms??30000}}});
function engine(t,{reject,initial=initialized,toolResult=nativeResult,preview}={}){
  const calls=[];
  const transport=async(endpoint,init)=>{
    const rpc=init.body?JSON.parse(init.body):null;
    calls.push({endpoint,init,rpc});
    if(init.method==='DELETE')return new Response(null,{status:204});
    const rejected=await reject?.(rpc,init);if(rejected)return rejected;
    if(rpc.method==='notifications/initialized')return new Response(null,{status:202});
    return Response.json({jsonrpc:'2.0',id:rpc.id,result:rpc.method==='initialize'?initial(rpc):rpc.method==='tools/list'?{tools}:toolResult,...(preview?{_meta:{hellotest:{browser_preview:preview}}}:{})},{headers:{'mcp-session-id':'native-session','set-cookie':'OTHER=hidden; Path=/, HELLOTEST_ENGINE=worker-1; HttpOnly; Path=/'}});
  };
  t.mock.method(globalThis,'fetch',transport);
  return {calls,transport};
}

test('upstream client keeps exact native tool schemas and results, protected initialization, session affinity and cleanup',async t=>{
  const f=engine(t),secrets={password:'PRIVATE-wire-only-value'};
  const browser=await connectUpstreamPlaywright({integration,startUrl:'https://application.test/login',buildId:'build:reviewed',secrets});
  assert.deepEqual(browser.tools,tools);
  const args={fields:[{ref:'native-ref',value:'password'}]};
  assert.deepEqual(await browser.call('browser_fill_form',args),nativeResult);
  await browser.close();await browser.close();
  assert.deepEqual(f.calls.map(call=>call.rpc?.method||call.init.method),['initialize','notifications/initialized','tools/list','tools/call','DELETE']);
  for(const call of f.calls){
    assert.equal(call.endpoint,'https://engine.test/api/v1/automation/playwright-mcp');assert.equal(call.init.redirect,'error');
    assert.equal(call.init.headers['x-hellotest-testengine-secret'],integration.config.shared_secret);
  }
  for(const call of f.calls.slice(1)){assert.equal(call.init.headers['mcp-session-id'],'native-session');assert.equal(call.init.headers.cookie,'HELLOTEST_ENGINE=worker-1');}
  assert.deepEqual(f.calls[0].rpc.params._meta.hellotest,{start_url:'https://application.test/login',build_id:'build:reviewed',secrets});
  assert.deepEqual(f.calls[3].rpc.params,{name:'browser_fill_form',arguments:args});
  assert.doesNotMatch(JSON.stringify(browser),/PRIVATE-wire-only-value/);
  await assert.rejects(browser.call('browser_fill_form',args),{code:'AUTOMATION_UPSTREAM_MCP_CLOSED'});
});

test('case UI preview is explicitly opted in, isolated from the native model result and sanitized before its protected callback',async t=>{
  const image=Buffer.from([255,216,255,1,2,3]).toString('base64');
  const preview={tool:'browser_fill_form',url:'https://application.test/login?token=hidden',observed_at:'2026-11-09T12:00:00.000Z',
    content:[{type:'image',mimeType:'image/jpeg',data:image}],untrusted_field:'not forwarded'};
  const f=engine(t,{preview}),received=[];
  const browser=await connectUpstreamPlaywright({integration,startUrl:'https://application.test/',capturePreview:true,onPreview:value=>received.push(value)});
  assert.equal(f.calls[0].rpc.params._meta.hellotest.capture_preview,true);
  assert.deepEqual(await browser.call('browser_fill_form',{}),nativeResult,'model tool content is untouched');
  assert.deepEqual(received,[{tool:preview.tool,url:'https://application.test/login',observed_at:preview.observed_at,content:preview.content}]);
  await browser.close();
  const disabled=[];
  const headless=await connectUpstreamPlaywright({integration,startUrl:'https://application.test/',onPreview:value=>disabled.push(value)});
  await headless.call('browser_fill_form',{});await headless.close();
  assert.equal(disabled.length,0,'workflow/default browser never opts into UI pixels');
  assert.equal(f.calls.filter(call=>call.rpc?.method==='initialize').at(-1).rpc.params._meta.hellotest.capture_preview,undefined);
});

test('invalid, mismatched and error-result UI previews never reach the case callback',async t=>{
  for(const kind of ['invalid-image','wrong-tool','native-error'])await t.test(kind,async t=>{
    const preview={tool:kind==='wrong-tool'?'browser_type':'browser_fill_form',content:[{type:'image',mimeType:'image/jpeg',data:kind==='invalid-image'?'aW52YWxpZA==':Buffer.from([255,216,255,1]).toString('base64')}]};
    engine(t,{preview,...(kind==='native-error'?{toolResult:{...nativeResult,isError:true}}:{})});
    let count=0;
    const browser=await connectUpstreamPlaywright({integration,startUrl:'https://application.test/',capturePreview:true,onPreview:()=>count++});
    await browser.call('browser_fill_form',{});await browser.close();
    assert.equal(count,0);
  });
});

test('optional UI callback failure preserves confirmed native results while revoked authority still stops the call without replay',async t=>{
  const preview={tool:'browser_fill_form',content:[{type:'image',mimeType:'image/jpeg',data:Buffer.from([255,216,255,1]).toString('base64')}]};
  for(const kind of ['optional-store','permission','abort','lease'])await t.test(kind,async t=>{
    const f=engine(t,{preview}),diagnostics=require('../../backend/lib/automationProgressDiagnostics');
    const report=t.mock.method(diagnostics,'reportDiagnosticFailure',()=>{});
    const error=kind==='permission'?Object.assign(new Error('Access revoked'),{statusCode:403}):kind==='abort'?Object.assign(new Error('Cancelled'),{name:'AbortError'}):kind==='lease'?Object.assign(new Error('Lease lost'),{code:'BATCH_LEASE_LOST'}):new Error('Optional UI unavailable');
    const browser=await connectUpstreamPlaywright({integration,startUrl:'https://application.test/',capturePreview:true,onPreview:()=>{throw error;}});
    if(kind==='optional-store'){
      assert.deepEqual(await browser.call('browser_fill_form',{}),nativeResult);
      assert.equal(report.mock.callCount(),1);
    }else await assert.rejects(browser.call('browser_fill_form',{}),candidate=>candidate===error);
    await browser.close();
    assert.equal(f.calls.filter(call=>call.rpc?.method==='tools/call').length,1);
  });
});

test('upstream provider and timeout acknowledgement reject old or incompatible bridges before tool dispatch',async t=>{
  for(const kind of ['legacy','wrong-package','timeout'])await t.test(kind,async t=>{
    const f=engine(t,{initial:rpc=>{const result=initialized(rpc);if(kind==='legacy')delete result._meta;else if(kind==='wrong-package')result._meta.hellotest.upstream_package='custom';else result._meta.hellotest.navigation_timeout_ms=30000;return result;}});
    await assert.rejects(connectUpstreamPlaywright({integration:{...integration,config:{...integration.config,navigation_timeout_ms:90000}},startUrl:'https://application.test/'}),{code:'AUTOMATION_UPSTREAM_MCP_UNSUPPORTED',nonRetryable:true});
    assert.deepEqual(f.calls.map(call=>call.rpc?.method||call.init.method),['initialize','DELETE']);
  });
});

test('upstream HTTP authentication failures do not decode or expose the engine response',async t=>{
  const f=engine(t,{reject:rpc=>rpc.method==='initialize'?new Response('<html>PRIVATE rejected credentials</html>',{status:401}):null});
  await assert.rejects(connectUpstreamPlaywright({integration,startUrl:'https://application.test/'}),error=>{
    assert.equal(error.code,'AUTOMATION_BROWSER_ENGINE_AUTHENTICATION_FAILED');assert.equal(error.statusCode,401);assert.equal(error.retry_safe,false);assert.doesNotMatch(error.message,/PRIVATE|html/);return true;
  });
  assert.equal(f.calls.length,1);
});

test('native tool errors remain exact results while invalid RPC, oversized bodies and lost acknowledgements never replay tools',async t=>{
  for(const kind of ['native-error','wrong-id','rpc-error','oversized','network'])await t.test(kind,async t=>{
    const errorResult={...nativeResult,isError:true};
    const f=engine(t,{toolResult:errorResult,reject:rpc=>{
      if(rpc.method!=='tools/call')return null;
      if(kind==='wrong-id')return Response.json({jsonrpc:'2.0',id:'other',result:nativeResult});
      if(kind==='rpc-error')return Response.json({jsonrpc:'2.0',id:rpc.id,error:{code:-32602,message:'PRIVATE invalid arguments'}});
      if(kind==='oversized')return new Response('ignored',{headers:{'content-length':String(2*1024*1024+1)}});
      if(kind==='network')throw Object.assign(new Error('PRIVATE broken host'),{code:'ECONNRESET'});
      return null;
    }});
    const browser=await connectUpstreamPlaywright({integration,startUrl:'https://application.test/'});
    try{
      if(kind==='native-error')assert.deepEqual(await browser.call('browser_fill_form',{}),errorResult);
      else await assert.rejects(browser.call('browser_fill_form',{}),error=>{assert.doesNotMatch(error.message,/PRIVATE/);assert.ok(error.code);return true;});
    }finally{await browser.close();}
    assert.equal(f.calls.filter(call=>call.rpc?.method==='tools/call').length,1);
    assert.equal(f.calls.filter(call=>call.rpc?.method==='initialize').length,1);
  });
});

test('cancellation, elapsed build deadlines and bounded transport timeouts cannot dispatch replacement actions',async t=>{
  const controller=new AbortController();let dispatched;
  const started=new Promise(resolve=>{dispatched=resolve;});
  const f=engine(t,{reject:async(rpc,init)=>{
    if(rpc.method!=='tools/call')return null;
    dispatched();return new Promise((resolve,reject)=>init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true}));
  }});
  const browser=await connectUpstreamPlaywright({integration,startUrl:'https://application.test/',signal:controller.signal});
  const pending=browser.call('browser_fill_form',{});await started;controller.abort();
  await assert.rejects(pending,{name:'AbortError'});await browser.close();
  assert.equal(f.calls.filter(call=>call.rpc?.method==='tools/call').length,1);
  const g=engine(t);
  const active=await connectUpstreamPlaywright({integration,startUrl:'https://application.test/'});
  await assert.rejects(active.call('browser_fill_form',{}, {deadlineMs:Date.now()-1}),{code:'AUTOMATION_BUILD_DEADLINE'});
  assert.equal(g.calls.filter(call=>call.rpc?.method==='tools/call').length,0);await active.close();
  const timed=engine(t,{reject:async(rpc,init)=>rpc.method==='tools/call'?new Promise((resolve,reject)=>init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true})):null});
  const bounded=await connectUpstreamPlaywright({integration,startUrl:'https://application.test/'});
  const keepAlive=setTimeout(()=>{},100);
  try{await assert.rejects(bounded.call('browser_fill_form',{}, {deadlineMs:Date.now()+5}),{code:'BROWSER_TRANSPORT_TIMEOUT',nonRetryable:true,retry_safe:false});}
  finally{clearTimeout(keepAlive);await bounded.close();}
  assert.equal(timed.calls.filter(call=>call.rpc?.method==='tools/call').length,1);
});

test('transport deadlines honor configured native navigation/assertion bounds and paired transport uses the same provider',async t=>{
  const realTimeout=AbortSignal.timeout,deadlines=[];
  t.mock.method(AbortSignal,'timeout',ms=>{deadlines.push(ms);return realTimeout(ms);});
  const f=engine(t),bridge={bridgeId:'scoped',projectId:'project',userId:'actor'};
  const service=require('../../backend/services/pairedBrowserBridge.service');
  const create=t.mock.method(service,'createTransport',async(scope,options)=>{assert.equal(scope,bridge);assert.deepEqual(options,{provider:'playwright_mcp_upstream',assertionTimeoutMs:120000,navigationTimeoutMs:90000});return f.transport;});
  const browser=await connectUpstreamPlaywright({integration:{paired_browser_bridge:bridge,config:{assertion_timeout_ms:120000,navigation_timeout_ms:90000}},startUrl:'https://application.test/'});
  await browser.call('browser_fill_form',{});await browser.close();
  assert.equal(create.mock.callCount(),1);assert.ok(deadlines.includes(140000));assert.equal(deadlines.at(-1),5000);
  for(const call of f.calls){assert.equal(call.endpoint,'paired-upstream-playwright-mcp');assert.equal(Object.hasOwn(call.init.headers,'x-hellotest-testengine-secret'),false);}
});
