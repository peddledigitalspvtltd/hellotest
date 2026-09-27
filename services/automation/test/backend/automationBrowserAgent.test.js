const test = require('node:test');
const assert = require('node:assert/strict');
const { connectAutomationBrowser, runAutomationBrowserAgent } = require('../../backend/lib/automationBrowserAgent');
test('agent requests tools, receives observations and returns a single final structured build', async () => {
  const events=[];const prompts=[];const calls=[];
  const final={steps:[{step_id:'step',automation_code:'await page.getByRole("button", {name:"Save"}).click();'}]};
  const browser={tools:[{name:'browser_snapshot'}],call:async(name,args)=>{calls.push([name,args]);return {content:[{type:'text',text:'Save button'}]};}};
  const result=await runAutomationBrowserAgent({prompt:'Manual step Save, expected saved.',browser,parse:JSON.parse,complete:async prompt=>{prompts.push(prompt);return JSON.stringify(prompts.length===1?{tool_calls:[{name:'browser_snapshot',arguments:{}}]}:final);},onProgress:async event=>events.push(event)});
  assert.deepEqual(result,final);assert.equal(calls.length,1);assert.match(prompts[1],/Save button/);assert.ok(events.some(e=>e.phase==='automation.agent.browser'));
});
test('agent fails unavailable tools, empty plans and exhausted budgets without returning starter code', async () => {
  for(const tool_calls of [[],[{name:'shell',arguments:{command:'bad'}}]] )await assert.rejects(runAutomationBrowserAgent({prompt:'case',browser:{tools:[]},parse:JSON.parse,complete:async()=>JSON.stringify({tool_calls})}));
  await assert.rejects(runAutomationBrowserAgent({prompt:'case',browser:{tools:[{name:'browser_snapshot'}],call:async()=>({})},parse:JSON.parse,complete:async()=>JSON.stringify({tool_calls:[{name:'browser_snapshot',arguments:{}}]}),maxTurns:2}),/complete build/);
});

test('MCP client completes its session handshake, forwards tools and closes once', async (context) => {
  const requests = [];
  context.mock.method(globalThis, 'fetch', async (url, init) => {
    const request = init.body ? JSON.parse(init.body) : null;
    requests.push({ url, ...init, request });
    if (init.method === 'DELETE') return new Response(null, { status: 204 });
    if (request.method === 'notifications/initialized') return new Response(null, { status: 202 });
    const result = request.method === 'initialize'
      ? { protocolVersion: '2025-03-26', capabilities: { tools: {} } }
      : request.method === 'tools/list' ? { tools: [{ name: 'browser_snapshot', inputSchema: { type: 'object' } }] }
        : { content: [{ type: 'text', text: 'Observed page' }] };
    return Response.json({ jsonrpc: '2.0', id: request.id, result }, { headers: request.method === 'initialize' ? { 'mcp-session-id': 'browser-session' } : {} });
  });
  const browser = await connectAutomationBrowser({ integration: { base_url: 'http://engine.test/' }, startUrl: 'https://app.test', allowBrowserActions: true });
  const observation = await browser.call('browser_snapshot', {});
  assert.equal(observation.content[0].text, 'Observed page');
  assert.equal(requests[0].request.params._meta.hellotest.allow_browser_actions, true);
  assert.equal(requests[1].headers['mcp-session-id'], 'browser-session');
  assert.equal(requests[3].request.params.name, 'browser_snapshot');
  await browser.close();
  await browser.close();
  assert.equal(requests.filter((request) => request.method === 'DELETE').length, 1);
  await assert.rejects(browser.call('browser_snapshot', {}), /session is closed/);
});

test('MCP failures release established sessions and reject mismatched responses', async (context) => {
  for (const failure of ['protocol', 'response_id', 'catalog', 'response_size']) {
    let closed = false;
    context.mock.method(globalThis, 'fetch', async (url, init) => {
      if (init.method === 'DELETE') { closed = true; return new Response(null, { status: 204 }); }
      const request = JSON.parse(init.body);
      if (request.method === 'notifications/initialized') return new Response(null, { status: 202 });
      const result = request.method === 'initialize'
        ? { protocolVersion: failure === 'protocol' ? 'unsupported' : '2025-03-26', capabilities: { tools: {} } }
        : failure === 'response_size' ? { value: 'x'.repeat(300_000) } : { tools: [null] };
      return Response.json({ jsonrpc: '2.0', id: failure === 'response_id' ? 99 : request.id, result }, { headers: { 'mcp-session-id': 'browser-session' } });
    });
    await assert.rejects(connectAutomationBrowser({ integration: { base_url: 'http://engine.test' }, startUrl: 'https://app.test' }));
    assert.equal(closed, true, failure);
  }
});

test('agent stops before LLM generation when initial application inspection fails', async () => {
  let completions = 0;
  const browser = { tools: [{ name: 'browser_navigate' }, { name: 'browser_snapshot' }],
    call: async () => ({ isError: true, content: [{ type: 'text', text: 'Application returned an error' }] }) };
  await assert.rejects(runAutomationBrowserAgent({ prompt: 'case', browser, startUrl: 'https://app.test', parse: JSON.parse,
    complete: async () => { completions++; return '{}'; } }), /Application returned an error/);
  assert.equal(completions, 0);
});
