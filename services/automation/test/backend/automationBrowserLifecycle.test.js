const test = require('node:test');
const assert = require('node:assert/strict');
const { connectAutomationBrowser, runAutomationBrowserAgent } = require('../../backend/lib/automationBrowserAgent');
const { planAutomationFlow } = require('../../backend/lib/automationFlowPlanning');

const receipt = value => ({ content: [{ type: 'text', text: JSON.stringify({ source: 'playwright', url: 'https://app.test/', ...value }) }] });
const click = { name: 'browser_click', arguments: { locator: '#save' } };
const options = () => ({ prompt: 'Save the current form', parse: JSON.parse,
  browser: { tools: [{ name: 'browser_click', inputSchema: { type: 'object' } }], call: () => assert.fail('expired work reached the browser') },
  complete: async () => JSON.stringify({ tool_calls: [click] }) });

test('a provider response arriving after the section deadline cannot dispatch or save its proposed work', async t => {
  let now = 1000, models = 0, saves = 0;
  t.mock.method(Date, 'now', () => now);
  await assert.rejects(runAutomationBrowserAgent({ ...options(), deadlineMs: 2000,
    complete: async () => { models++; now = 2001; return JSON.stringify({ steps: [{ step_id: 'one' }], tool_calls: [click] }); },
    onPartialBuild: async () => { saves++; return {}; }
  }), { code: 'AUTOMATION_BUILD_DEADLINE', nonRetryable: true });
  assert.equal(models, 1); assert.equal(saves, 0);
});

test('awaited progress cannot open another model call or browser action after the deadline', async t => {
  for (const boundary of ['automation.agent.prompt.packed', 'automation.agent.action.started']) await t.test(boundary, async t => {
    let now = 1000, models = 0;
    t.mock.method(Date, 'now', () => now);
    await assert.rejects(runAutomationBrowserAgent({ ...options(), deadlineMs: 2000,
      complete: async () => { models++; return JSON.stringify({ tool_calls: [click] }); },
      onProgress: async event => { if (event.phase === boundary) now = 2001; }
    }), { code: 'AUTOMATION_BUILD_DEADLINE', nonRetryable: true });
    assert.equal(models, boundary === 'automation.agent.prompt.packed' ? 0 : 1);
  });
});

test('optional progress preserves cancellation, revoked access and lost ownership before browser dispatch', async t => {
  for (const error of [Object.assign(new Error('Revoked'), { statusCode: 403 }),
    Object.assign(new Error('Lease lost'), { code: 'BATCH_JOB_LEASE_LOST' }),
    Object.assign(new Error('Cancelled'), { name: 'AbortError' })]) await t.test(error.code || error.name, async () => {
    await assert.rejects(runAutomationBrowserAgent({ ...options(), onProgress: async event => {
      if (event.phase === 'automation.agent.action.started') throw error;
    } }), error);
  });
});

test('cancellation during optional startup screenshots stops before any model request', async () => {
  const controller = new AbortController(), reason = new Error('Build cancelled');
  const calls = []; let models = 0;
  await assert.rejects(runAutomationBrowserAgent({ ...options(), signal: controller.signal, startUrl: 'https://app.test/',
    browser: { tools: ['browser_navigate', 'browser_snapshot', 'browser_screenshot'].map(name => ({ name })), call: async name => {
      calls.push(name);
      if (name === 'browser_screenshot') { controller.abort(reason); throw reason; }
      return receipt({ action_outcome: 'completed', accessibility: 'Current form' });
    } }, complete: async () => { models++; return '{}'; }
  }), reason);
  assert.deepEqual(calls, ['browser_navigate', 'browser_snapshot', 'browser_screenshot']); assert.equal(models, 0);
});

test('confirmed actions remain retained when source progress expires the deadline before the Plan save', async t => {
  let now = 1000, saves = 0;
  t.mock.method(Date, 'now', () => now);
  const calls = [], observations = [];
  const page = receipt({ observation_id: 'save-page', elements: [
    { tag: 'button', role: 'button', accessible_name: 'Save', displayed: true, locators_validated: true, locator_candidates: ['#save'] },
    { tag: 'div', role: 'status', accessible_name: 'Saved', text: 'Saved', displayed: true, locators_validated: true, locator_candidates: ['#status'] }
  ] });
  await assert.rejects(runAutomationBrowserAgent({ ...options(), deadlineMs: 2000, actorMode: true,
    execution: { required: true, step_id: 'one', action: 'Save the current form', expected_result: 'Saved status is visible' },
    initialObservations: [{ tool: 'browser_snapshot', result: page }],
    browser: { tools: ['browser_click', 'browser_assert', 'browser_snapshot'].map(name => ({ name, inputSchema: { type: 'object' } })),
      call: async name => { calls.push(name); return name === 'browser_snapshot' ? page : receipt(name === 'browser_assert'
        ? { assertion_outcome: 'satisfied' } : { action_outcome: 'completed' }); } },
    complete: async () => JSON.stringify({ stage: 'act', step_id: 'one', section_complete: true,
      tool_calls: [click, { name: 'browser_assert', arguments: { assertion: 'visible', locator: '#status' } }] }),
    onObservation: observation => observations.push(observation),
    onProgress: async event => { if (event.phase === 'automation.agent.source.compiled') now = 2001; },
    onPartialBuild: async () => { saves++; return { generation_complete: true }; }
  }), { code: 'AUTOMATION_BUILD_DEADLINE', nonRetryable: true });
  assert.equal(calls.filter(name => name === 'browser_click').length, 1);
  assert.equal(observations.filter(item => item.tool === 'browser_click' && !item.result.isError).length, 1);
  assert.equal(saves, 0);
});

test('a cancelled MCP initialization only releases its original session, without notification or discovery', async t => {
  const controller = new AbortController(), reason = new Error('Cancelled handshake'), calls = [];
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    const rpc = init.body ? JSON.parse(init.body) : null;
    calls.push(rpc?.method || init.method);
    if (init.method === 'DELETE') return new Response(null, { status: 204 });
    controller.abort(reason);
    return Response.json({ jsonrpc: '2.0', id: rpc.id, result: { protocolVersion: '2025-03-26', capabilities: { tools: {} } } },
      { headers: { 'mcp-session-id': 'original-session' } });
  });
  await assert.rejects(connectAutomationBrowser({ integration: { base_url: 'https://engine.test' }, signal: controller.signal }), reason);
  assert.deepEqual(calls, ['initialize', 'DELETE']);
  calls.length = 0;
  await assert.rejects(connectAutomationBrowser({ integration: { base_url: 'https://engine.test' }, signal: controller.signal }), reason);
  assert.deepEqual(calls, []);
});

test('manual planning does not return an acceptable flow after cancellation during its provider request', async () => {
  const controller = new AbortController(), reason = new Error('Cancelled planning'); let models = 0;
  await assert.rejects(planAutomationFlow({ featureKey: 'ai.agentic.automation-engineer', context: {}, signal: controller.signal,
    parse: JSON.parse, complete: async () => { models++; controller.abort(reason);
      return JSON.stringify({ flow_steps: [{ action: 'Save form', expected_result: 'Saved status appears', step_type: 'web' }] }); }
  }), reason);
  assert.equal(models, 1);
});

test('the actual MCP transport rechecks the forwarded deadline after awaited access and bounds request time', async t => {
  let now = 1000;
  const requests = [], timeouts = [];
  t.mock.method(Date, 'now', () => now);
  t.mock.method(AbortSignal, 'timeout', ms => { timeouts.push(ms); return new AbortController().signal; });
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    const rpc = init.body ? JSON.parse(init.body) : null;
    requests.push(rpc?.method || init.method);
    if (init.method === 'DELETE') return new Response(null, { status: 204 });
    if (rpc.method === 'notifications/initialized') return new Response(null, { status: 202 });
    return Response.json({ jsonrpc: '2.0', id: rpc.id, result: rpc.method === 'initialize'
      ? { protocolVersion: '2025-03-26', capabilities: { tools: {} } }
      : rpc.method === 'tools/list' ? { tools: [{ name: 'browser_click', inputSchema: { type: 'object' } }] }
        : receipt({ action_outcome: 'completed' }) }, { headers: { 'mcp-session-id': 'original-session' } });
  });
  const browser = await connectAutomationBrowser({ integration: { base_url: 'https://engine.test' } });
  await browser.call('browser_click', { locator: '#save' }, { deadlineMs: 1025 });
  assert.equal(timeouts.at(-1), 25, 'request timeout shares the remaining section allowance');
  const dispatch = browser.call;
  browser.call = async (name, args, policy) => {
    await Promise.resolve(); // Existing permission lookup boundary.
    now = 2001;
    return dispatch(name, args, policy);
  };
  const callsBefore = requests.length;
  try {
    await assert.rejects(runAutomationBrowserAgent({ ...options(), browser, deadlineMs: 2000 }),
      { code: 'AUTOMATION_BUILD_DEADLINE', nonRetryable: true });
    assert.equal(requests.length, callsBefore, 'the expired browser proposal did not reach HTTP');
  } finally { await browser.close(); }
});
