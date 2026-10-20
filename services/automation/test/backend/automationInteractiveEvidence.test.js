const test = require('node:test');
const assert = require('node:assert/strict');
const { runAutomationBrowserAgent, connectAutomationBrowser } = require('../../backend/lib/automationBrowserAgent');
const { browserActionRequirements, interactiveEvidenceFeedback } = require('../../backend/lib/automationInteractiveEvidence');
const { createBrowserParameterResolver } = require('../../backend/lib/automationBrowserParameters');

const code = 'await page.locator("#email").fill("@t.email"); await expect(page.locator("#email")).toHaveValue("@t.email");';
const candidate = { step_id: 'email', automation_code: code };
const execution = { required: true, step_id: 'email', expected_result: 'Email contains the supplied address' };
const receipt = (tool, extra = {}) => ({ content: [{ type: 'text', text: JSON.stringify({ source: 'playwright', verification_status: 'unverified', url: 'https://app.test/signup', ...(tool === 'browser_assert' ? { assertion_outcome: 'satisfied' } : { action_outcome: 'completed' }), ...extra }) }] });
function browserFixture() {
  const calls = [];
  return {
    calls,
    tools: ['browser_fill', 'browser_assert', 'browser_snapshot', 'browser_screenshot'].map(name => ({ name })),
    call: async (name, args) => { calls.push({ name, args }); return receipt(name); }
  };
}

test('interactive code-only output performs real MCP actions and assertions before publishing saved instructions', async () => {
  const browser = browserFixture(), events = [], observations = [], published = [], prompts = [];
  const result = await runAutomationBrowserAgent({ browser, execution, generationMode: 'sequential', prompt: 'Enter the supplied email', parse: JSON.parse,
    complete: async prompt => {
      prompts.push(prompt);
      return JSON.stringify(prompts.length === 1 ? { steps: [candidate] } : { steps: [candidate], tool_calls: [
        { name: 'browser_fill', arguments: { locator: 'getByLabel("Email")', value: '@t.email' } },
        { name: 'browser_assert', arguments: { assertion: 'value', locator: 'getByLabel("Email")', value: '@t.email' } }
      ] });
    },
    onObservation: observation => observations.push(observation), onProgress: event => events.push(event),
    onPartialBuild: async payload => {
      assert.equal(browser.calls.filter(call => call.name === 'browser_fill').length, 1);
      assert.equal(browser.calls.filter(call => call.name === 'browser_assert').length, 1);
      assert.ok(events.find(event => event.phase === 'automation.agent.action.completed' && event.details.assertion_outcome === 'satisfied'));
      published.push(payload); return { generation_mode: 'sequential', generation_complete: true };
    }
  });
  assert.equal(result.steps[0].automation_code, code); assert.equal(published.length, 1);
  assert.equal(prompts.length,1); assert.ok(observations.some(row=>row.tool==='automation_program_tools'&&row.mcp_call===false));
  assert.equal(observations.find(row => row.tool === 'browser_assert').arguments.value, '[redacted]');
  const actions = events.filter(event => event.phase === 'automation.agent.action.completed');
  assert.equal(new Set(actions.map(event => event.details.action_id)).size, 2);
  assert.ok(actions.every(event => event.details.active_step_id === 'email'));
});

test('an assertion made before the last action cannot complete the current section', async () => {
  const browser = browserFixture(); let turns = 0, published = 0;
  await runAutomationBrowserAgent({ browser, execution, generationMode: 'sequential', prompt: 'Email', parse: JSON.parse,
    complete: async prompt => {
      turns++;
      if (turns === 2) assert.match(prompt, /browser_assert_required_after_actions/);
      return JSON.stringify({ steps: [candidate], tool_calls: turns === 1 ? [
        { name: 'browser_assert', arguments: { assertion: 'visible', locator: '#email' } },
        { name: 'browser_fill', arguments: { locator: '#email', value: '@t.email' } }
      ] : [{ name: 'browser_assert', arguments: { assertion: 'value', locator: '#email', value: '@t.email' } }] });
    }, onPartialBuild: async () => { published++; return { generation_mode: 'sequential', generation_complete: true }; }
  });
  assert.equal(published, 1); assert.equal(browser.calls.filter(call => call.name === 'browser_fill').length, 1);
  assert.equal(browser.calls.filter(call => call.name === 'browser_assert').length, 2);
});

test('unperformed code remains unsaved while an explicit source-only build can still return a draft', async () => {
  const browser = browserFixture(); let published = 0;
  const unsupported={...candidate,automation_code:'if(await page.locator("#email").isVisible()){await page.locator("#email").fill("@t.email");}'};
  await assert.rejects(runAutomationBrowserAgent({ browser, execution, prompt: 'Email', parse: JSON.parse, maxTurns: 2,
    complete: async () => JSON.stringify({ steps: [unsupported] }), onPartialBuild: async () => { published++; }
  }), error => error.code === 'AUTOMATION_BROWSER_EXECUTION_INCOMPLETE' && error.nonRetryable);
  assert.equal(published, 0); assert.equal(browser.calls.length, 0);
  assert.deepEqual(await runAutomationBrowserAgent({ browser, execution: { ...execution, required: false }, prompt: 'Source only', parse: JSON.parse,
    complete: async () => JSON.stringify({ steps: [candidate] }) }), { steps: [candidate] });
});

test('other sections, fabricated model claims and earlier assertions cannot satisfy current action coverage', () => {
  assert.deepEqual(browserActionRequirements('await page.getByLabel("Email").fill("x"); await page.getByLabel("Name").fill("y"); await page.getByRole("button").click();'), { browser_fill: 2, browser_click: 1 });
  assert.deepEqual(browserActionRequirements('const email=page.getByLabel("Email"); await email.fill("x");'), { browser_fill: 1 });
  const observations = [{ tool: 'browser_fill', execution_step_id: 'other', result: receipt('browser_fill') },
    { tool: 'browser_assert', execution_step_id: 'other', result: receipt('browser_assert') }];
  const feedback = interactiveEvidenceFeedback({ payload: { steps: [candidate], actions_performed: true, expected_result_verified: true }, execution, observations });
  assert.equal(feedback.missing_actions.browser_fill, 1); assert.equal(feedback.expected_result_check, 'browser_assert_required_after_actions');
  assert.equal(interactiveEvidenceFeedback({payload:{steps:[candidate],blocked_steps:'none'},execution,observations}).missing_actions.browser_fill,1);
  assert.equal(interactiveEvidenceFeedback({payload:{steps:[candidate],blocked_steps:[{step_id:'other'}]},execution,observations}).missing_actions.browser_fill,1);
  assert.equal(interactiveEvidenceFeedback({ payload: { blocked_steps: [{ step_id: 'email', dependency_type: 'parameter' }] }, execution, observations }), null);
});

test('a confirmed MCP invalid-arguments response is corrected without treating it as an unknown action', async t => {
  let toolCalls = 0, turns = 0;
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    if (init.method === 'DELETE') return new Response(null, { status: 204 });
    const rpc = JSON.parse(init.body);
    if (rpc.method === 'notifications/initialized') return new Response(null, { status: 202 });
    if (rpc.method === 'tools/call' && ++toolCalls === 1) return Response.json({ jsonrpc: '2.0', id: rpc.id, error: { code: -32602, message: 'Invalid assertion arguments' } });
    return Response.json({ jsonrpc: '2.0', id: rpc.id, result: rpc.method === 'initialize'
      ? { protocolVersion: '2025-03-26', capabilities: { tools: {} } }
      : rpc.method === 'tools/list' ? { tools: [{ name: 'browser_assert', inputSchema: { type: 'object', properties: { assertion: { type: 'string' }, value: { type: 'string' }, locator: { type: 'string' } }, required: ['assertion'], additionalProperties: false } }] }
      : receipt('browser_assert') }, { headers: { 'mcp-session-id': 'validated-session' } });
  });
  const browser = await connectAutomationBrowser({ integration: { base_url: 'http://engine.test' }, startUrl: 'https://app.test', allowBrowserActions: true });
  try {
    const result = await runAutomationBrowserAgent({ browser, execution: { ...execution, expected_result: 'Ready' }, generationMode: 'sequential', prompt: 'Check ready', parse: JSON.parse,
      complete: async prompt => {
        turns++;
        if (turns === 2) assert.match(prompt, /BROWSER_TOOL_INVALID_ARGUMENTS/);
        return JSON.stringify({ steps: [{ step_id: 'email', automation_code: 'await expect(page.getByText("Ready")).toBeVisible();' }], tool_calls: [
          { name: 'browser_assert', arguments: turns === 1 ? { assertion: 'text', locator: '#status' } : { assertion: 'text', locator: '#status', value: 'Ready' } }
        ] });
      }, onPartialBuild: async () => ({ generation_mode: 'sequential', generation_complete: true })
    });
    assert.equal(result.steps.length, 1); assert.equal(turns, 2); assert.equal(toolCalls, 2);
  } finally { await browser.close(); }
});

test('expected-value checks bind private data inside the wrapper and retain protocol receipts without values', () => {
  const resolver = createBrowserParameterResolver({ caseValues: { 't.password': 'fixture-private-value' } });
  const args = { assertion: 'value', locator: '#password', value: '@t.password' };
  assert.equal(resolver.requiresDataAccess('browser_assert', args), true);
  assert.equal(resolver.resolve('browser_assert', args).value, 'fixture-private-value');
  const result = resolver.redactResult(receipt('browser_assert', { message: 'fixture-private-value', assertion: 'value' }));
  assert.doesNotMatch(JSON.stringify(result), /fixture-private-value/);
  assert.equal(JSON.parse(result.content[0].text).assertion_outcome, 'satisfied');
  assert.throws(() => resolver.resolve('browser_assert', { ...args, value: '@t.missing' }), error => error.code === 'AUTOMATION_PARAMETER_MISSING');
});
test('a temporary assertion transport failure retries only the read and never repeats a completed action',async()=>{
 const browser=browserFixture();let fills=0,assertions=0,turns=0;
 browser.call=async name=>{if(name==='browser_fill')fills++;if(name==='browser_assert'&&++assertions===1)throw new Error('temporary read connection lost');return receipt(name);};
 await runAutomationBrowserAgent({browser,execution,generationMode:'sequential',prompt:'Email',parse:JSON.parse,
  complete:async prompt=>{turns++;if(turns===3)assert.match(prompt,/BROWSER_READ_UNAVAILABLE/);return JSON.stringify(turns===1?{tool_calls:[{name:'browser_fill',arguments:{locator:'#email',value:'@t.email'}}]}:{steps:[candidate],tool_calls:[{name:'browser_assert',arguments:{assertion:'value',locator:'#email',value:'@t.email'}}]});},
  onPartialBuild:async()=>({generation_mode:'sequential',generation_complete:true})
 });
 assert.equal(fills,1);assert.equal(assertions,2);assert.equal(turns,3);
});

test('a later failed expected-result check invalidates an earlier success until a real corrected check completes',()=>{
 const action={tool:'browser_fill',execution_step_id:execution.step_id,result:receipt('browser_fill')};
 const success={tool:'browser_assert',execution_step_id:execution.step_id,result:receipt('browser_assert')};
 const failure={tool:'browser_assert',execution_step_id:execution.step_id,result:{isError:true,content:[{type:'text',text:JSON.stringify({source:'playwright',assertion_outcome:'not_satisfied',code:'BROWSER_ASSERTION_NOT_SATISFIED'})}]}};
 const payload={steps:[candidate]};
 const feedback=interactiveEvidenceFeedback({payload,execution,observations:[action,success,failure]});
 assert.equal(feedback.expected_result_check,'browser_assert_required_after_failed_check');
 assert.equal(interactiveEvidenceFeedback({payload,execution:{...execution,expected_result:''},observations:[action,success,failure]}).expected_result_check,'browser_assert_required_after_failed_check');
 assert.equal(interactiveEvidenceFeedback({payload,execution,observations:[action,success,failure,{tool:'automation_generation_feedback',execution_step_id:execution.step_id,result:{}}]}).expected_result_check,'browser_assert_required_after_failed_check');
 assert.equal(interactiveEvidenceFeedback({payload,execution,observations:[action,success,failure,{...failure,execution_step_id:'another-section'},success]}),null);
 assert.equal(interactiveEvidenceFeedback({payload,execution,observations:[action,success,{...failure,execution_step_id:'another-section'}]}),null);
});

test('an actual typed action error invalidates earlier checks without requiring a completed action replay', () => {
 const action={tool:'browser_fill',execution_step_id:execution.step_id,result:receipt('browser_fill')};
 const success={tool:'browser_assert',execution_step_id:execution.step_id,result:receipt('browser_assert')};
 const payload={steps:[candidate]};
 for(const tool of ['browser_navigate','browser_click','browser_fill','browser_press_key','browser_select_option','browser_hover','browser_check','browser_uncheck']){
  const failed={tool,execution_step_id:execution.step_id,result:{isError:true,content:[]}};
  for(const expected_result of [execution.expected_result,'']){
   const feedback=interactiveEvidenceFeedback({payload,execution:{...execution,expected_result},observations:[action,success,failed]});
   assert.equal(feedback.expected_result_check,'browser_assert_required_after_actions',tool);
   assert.deepEqual(feedback.missing_actions,{},'the prior completed fill remains supported');
   assert.equal(interactiveEvidenceFeedback({payload,execution:{...execution,expected_result},observations:[action,success,failed,success]}),null);
  }
 }
});

test('read-only and host-rejected calls do not manufacture an unknown action outcome', () => {
 const action={tool:'browser_fill',execution_step_id:execution.step_id,result:receipt('browser_fill')};
 const success={tool:'browser_assert',execution_step_id:execution.step_id,result:receipt('browser_assert')};
 const payload={steps:[candidate]};
 for(const tool of ['browser_snapshot','browser_screenshot','browser_validate_locator','browser_wait_for']){
  const failed={tool,execution_step_id:execution.step_id,result:{isError:true,content:[]}};
  assert.equal(interactiveEvidenceFeedback({payload,execution,observations:[action,success,failed]}),null,tool);
 }
 for(const tool of ['browser_click','browser_assert']){
  const rejected={tool,execution_step_id:execution.step_id,mcp_call:false,result:{isError:true,content:[]}};
  assert.equal(interactiveEvidenceFeedback({payload,execution,observations:[action,success,rejected]}),null,tool);
 }
});

test('successful development checks cannot save source that omits the expected-result assertion',async()=>{
 const browser=browserFixture();let turns=0,saved=0;
 await runAutomationBrowserAgent({browser,execution,generationMode:'sequential',prompt:'Fill and check email',parse:JSON.parse,
  complete:async prompt=>{
   turns++;
   if(turns===2){assert.equal(saved,0);assert.match(prompt,/executable_assertion_required/);}
   return JSON.stringify({steps:[turns===1?{...candidate,automation_code:'await page.locator("#email").fill("@t.email");'}:candidate],tool_calls:turns===1?[
    {name:'browser_fill',arguments:{locator:'#email',value:'@t.email'}},
    {name:'browser_assert',arguments:{assertion:'value',locator:'#email',value:'@t.email'}}
   ]:[]});
  },onPartialBuild:async()=>{saved++;return {generation_mode:'sequential',generation_complete:true};}
 });
 assert.equal(turns,2);assert.equal(saved,1);assert.equal(browser.calls.filter(call=>call.name==='browser_fill').length,1);
});

test('a code-only revision after a failed second check must perform a corrected check without replaying the action',async()=>{
 const browser=browserFixture();let turns=0,fills=0,checks=0,saved=0;
 browser.call=async name=>{if(name==='browser_fill')fills++;if(name==='browser_assert'&&++checks===2)return {isError:true,content:[{type:'text',text:JSON.stringify({source:'playwright',assertion_outcome:'not_satisfied',action_outcome:'not_attempted',retry_safe:true})}]};return receipt(name);};
 await runAutomationBrowserAgent({browser,execution,generationMode:'sequential',prompt:'Fill and check email',parse:JSON.parse,
  complete:async prompt=>{
   turns++;
   if(turns===1)return JSON.stringify({steps:[candidate],tool_calls:[{name:'browser_fill',arguments:{locator:'#email',value:'@t.email'}},{name:'browser_assert',arguments:{assertion:'visible',locator:'#email'}},{name:'browser_assert',arguments:{assertion:'value',locator:'#wrong-email',value:'@t.email'}}]});
   if(turns===2)return JSON.stringify({steps:[candidate]});
   assert.match(prompt,/browser_assert_required_after_failed_check/);
   return JSON.stringify({steps:[candidate],tool_calls:[{name:'browser_assert',arguments:{assertion:'value',locator:'#email',value:'@t.email'}}]});
  },onPartialBuild:async()=>{saved++;return {generation_mode:'sequential',generation_complete:true};}
 });
 assert.equal(turns,2);assert.equal(fills,1);assert.equal(checks,3);assert.equal(saved,1);
});
