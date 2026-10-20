import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { registerAutomationMcp } from '../dist/lib/automationMcp.js';
import { createPrivilegedRunGuard, resolveTestEngineSharedSecret } from '../dist/lib/testEngineSecurity.js';
import { resolveRepositoryLocator } from '../dist/lib/repositoryLocator.js';

test('MCP requires engine auth, confines tools, rejects private URLs and releases capacity', async t => {
  const old = process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;
  process.env.RECORDER_ALLOWED_PRIVATE_HOSTS = '127.0.0.1';
  const app = Fastify();
  await registerAutomationMcp(app, createPrivilegedRunGuard(resolveTestEngineSharedSecret({ TESTENGINE_SHARED_SECRET: 'test-secret' })));
  t.after(async () => { await app.close(); if(old===undefined)delete process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;else process.env.RECORDER_ALLOWED_PRIVATE_HOSTS=old; });
  const url='/api/v1/automation/mcp';
  const headers={'x-hellotest-testengine-secret':'test-secret'};
  const invoke=(method,params={},session)=>app.inject({method:'POST',url,headers:{...headers,...(session?{'mcp-session-id':session}:{})},payload:{jsonrpc:'2.0',id:1,method,params}});
  assert.equal((await app.inject({method:'POST',url,payload:{}})).statusCode,401);
  assert.ok((await invoke('initialize',{_meta:{hellotest:{start_url:'http://169.254.169.254/'}}})).json().error);
  const init=()=>invoke('initialize',{_meta:{hellotest:{start_url:'http://127.0.0.1:1234/'}}});
  const first=await init(); const session=first.headers['mcp-session-id'];
  assert.ok(session);
  const listed=(await invoke('tools/list',{},session)).json().result.tools;
  assert.equal(listed.some(t=>t.name==='browser_fill'),false);
  assert.equal(listed.some(t=>t.name==='browser_assert'),true,'expected-result checks remain available in read-only sessions');
  for (const argumentsValue of [{assertion:'execute',value:'arbitrary JS'},{assertion:'visible'},{assertion:'text',locator:'#result'},{assertion:'count',locator:'button',value:'-1'},{assertion:'url',value:'https://example.com'},{assertion:'title',locator:'body',value:'Title'},{assertion:'checked',locator:'input',value:'true'}]) assert.equal((await invoke('tools/call',{name:'browser_assert',arguments:argumentsValue},session)).json().error.code,-32602);
  assert.ok((await invoke('tools/call',{name:'browser_click',arguments:{locator:'button'}},session)).json().error);
  assert.ok((await invoke('tools/call',{name:'browser_evaluate',arguments:{}},session)).json().error);
  for (const argumentsValue of [[], '', 1, false]) assert.equal((await invoke('tools/call',{name:'browser_snapshot',arguments:argumentsValue},session)).json().error.code,-32602);
  assert.equal((await invoke('tools/list',[],session)).json().error.code,-32600);
  await init(); assert.equal((await init()).statusCode,429);
  await app.inject({method:'DELETE',url,headers:{...headers,'mcp-session-id':session}});
  assert.equal((await invoke('tools/list',{},session)).statusCode,404);
  assert.equal((await init()).statusCode,200);
});
test('inspection and execution locators preserve strict matches and explicit nth',()=>{
  const calls=[];
  const locator={nth:n=>{calls.push(['nth',n]);return locator;},first:()=>{calls.push(['first']);return locator;},last:()=>locator};
  const page={getByRole:(...args)=>{calls.push(args);return locator;},locator:selector=>{calls.push(selector);return locator;}};
  resolveRepositoryLocator(page,'getByRole("button", { name: "Save", exact: true }).nth(1)');
  assert.deepEqual(calls,[['button',{name:'Save',exact:true}],['nth',1]]);
  calls.length=0;resolveRepositoryLocator(page,'button');assert.deepEqual(calls,['button']);
  assert.throws(()=>resolveRepositoryLocator(page,'getByRole("button").filter({hasText:"Save"})'),/Unsupported locator chain/);
  const semantic={getByTitle:(...args)=>{calls.push(['title',...args]);return locator;},getByAltText:(...args)=>{calls.push(['alt',...args]);return locator;}};
  calls.length=0;
  resolveRepositoryLocator(semantic,'getByTitle("Continue", { exact: false }).nth(1)');
  resolveRepositoryLocator(semantic,'getByAltText("Logo")');
  resolveRepositoryLocator(semantic,'title=Continue');
  assert.deepEqual(calls,[['title','Continue',{exact:false}],['nth',1],['alt','Logo',{exact:true}],['title','Continue',{exact:true}]]);
  assert.throws(()=>resolveRepositoryLocator(page,'getByUnknown("Save")'),/Unsupported semantic repository locator/);
  for(const expression of ['getByRole("button", {name:/Save/})','getByRole("button", {"name":someName})','getByText(variable)','locator(selector)']) assert.throws(()=>resolveRepositoryLocator(page,expression),/supported quoted string literals/);
  calls.length=0;resolveRepositoryLocator(page,'getByRole("button", {"name":"Save"})');assert.deepEqual(calls,[['button',{name:'Save',exact:true}]]);
  calls.length=0;resolveRepositoryLocator(page,'getByRole("button", {"name":"Save","exact":false})');assert.deepEqual(calls,[['button',{name:'Save',exact:false}]]);
  for(const expression of ['getByRole("checkbox", {checked:true})','getByText("Save", {exact:variable})','locator("button",{hasText:"Save"})']) assert.throws(()=>resolveRepositoryLocator(page,expression),/Unsupported repository locator option|literal boolean/);
});

test('discovered assertion contracts and pre-browser argument errors distinguish state, text and page checks without echoing inputs', async t => {
  const previous = process.env.RECORDER_ALLOWED_PRIVATE_HOSTS; process.env.RECORDER_ALLOWED_PRIVATE_HOSTS = '127.0.0.1';
  let launches = 0;
  const app = Fastify();
  await registerAutomationMcp(app, createPrivilegedRunGuard(resolveTestEngineSharedSecret({TESTENGINE_SHARED_SECRET:'test-secret'})), {launchBrowser:async()=>{launches++;throw new Error('Must not launch');}});
  t.after(async()=>{await app.close();if(previous===undefined)delete process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;else process.env.RECORDER_ALLOWED_PRIVATE_HOSTS=previous;});
  const headers={'x-hellotest-testengine-secret':'test-secret'};
  const invoke=(method,params={})=>app.inject({method:'POST',url:'/api/v1/automation/mcp',headers,payload:{jsonrpc:'2.0',id:1,method,params}});
  const initialized=await invoke('initialize',{_meta:{hellotest:{start_url:'http://127.0.0.1:1234/'}}});
  headers['mcp-session-id']=initialized.headers['mcp-session-id'];
  const tool=(await invoke('tools/list')).json().result.tools.find(row=>row.name==='browser_assert');
  const state=tool.inputSchema.oneOf.find(row=>row.properties.assertion.enum.includes('visible'));
  const text=tool.inputSchema.oneOf.find(row=>row.properties.assertion.enum.includes('text'));
  const page=tool.inputSchema.oneOf.find(row=>row.properties.assertion.enum.includes('title'));
  assert.deepEqual(state.required,['locator']); assert.deepEqual(state.not.required,['value']);
  assert.deepEqual(text.required,['locator','value']); assert.deepEqual(page.required,['value']); assert.deepEqual(page.not.required,['locator']);
  for(const [args,required,forbidden] of [
    [{assertion:'visible',locator:'#result',value:'private-must-not-echo'},['assertion','locator'],['value']],
    [{assertion:'text',locator:'#result'},['assertion','locator','value'],[]],
    [{assertion:'title',locator:'#result',value:'private-must-not-echo'},['assertion','value'],['locator']]
  ]) {
    const response=(await invoke('tools/call',{name:'browser_assert',arguments:args})).json();
    assert.equal(response.error.code,-32602);
    assert.deepEqual(response.error.data.assertion_contract.required_arguments,required);
    assert.deepEqual(response.error.data.assertion_contract.forbidden_arguments,forbidden);
    assert.doesNotMatch(JSON.stringify(response),/private-must-not-echo/);
  }
  assert.equal(launches,0);
});
