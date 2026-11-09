const test = require('node:test');
const assert = require('node:assert/strict');
const { connectAutomationBrowser, runAutomationBrowserAgent } = require('../../backend/lib/automationBrowserAgent');
const { buildFailureProgress } = require('../../backend/lib/automationBuildFailureProgress');
const { stepBuildError } = require('../../backend/lib/automationStepBuildErrors');

const tools = ['browser_navigate', 'browser_snapshot', 'browser_screenshot'].map(name => ({ name, inputSchema: { type: 'object' } }));
const receipt = { content: [{ type: 'text', text: JSON.stringify({ source: 'playwright', url: 'https://app.test', action_outcome: 'completed', accessibility: 'Application form' }) }] };
function engine(t, reject) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    const rpc = init.body ? JSON.parse(init.body) : null;
    calls.push({ method: rpc?.method || init.method, tool: rpc?.params?.name, headers: init.headers });
    if (init.method === 'DELETE') return new Response(null, { status: 204 });
    const rejected = reject(rpc);
    if (rejected) return rejected;
    if (rpc.method === 'notifications/initialized') return new Response(null, { status: 202 });
    return Response.json({ jsonrpc: '2.0', id: rpc.id, result: rpc.method === 'initialize'
      ? { protocolVersion: '2025-03-26', capabilities: { tools: {} } }
      : rpc.method === 'tools/list' ? { tools } : receipt }, { headers: { 'mcp-session-id': 'pinned-session' } });
  });
  return calls;
}

test('plain JSON, HTML and oversized engine 401 responses retain authentication instead of RPC/body errors', async t => {
  for (const format of ['json', 'html', 'oversized']) await t.test(format, async t => {
    const calls = engine(t, rpc => rpc.method === 'initialize' ? format === 'json'
      ? Response.json({ message: 'PRIVATE engine credential rejected' }, { status: 401 })
      : new Response(format === 'html' ? '<html>PRIVATE proxy credential</html>' : 'PRIVATE'.repeat(100000), { status: 401 }) : null);
    await assert.rejects(connectAutomationBrowser({ integration: { base_url: 'https://engine.test' }, startUrl: 'https://app.test' }), error => {
      assert.equal(error.code, 'AUTOMATION_BROWSER_ENGINE_AUTHENTICATION_FAILED');
      assert.equal(error.statusCode, 401); assert.equal(error.upstreamStatusCode, 401); assert.equal(error.nonRetryable, true);
      assert.match(error.message, /same shared secret/); assert.doesNotMatch(error.message, /PRIVATE|mismatched|exceeded/);
      return true;
    });
    assert.equal(calls.length, 1, 'a denied initialization cannot open a replacement session');
  });
});

test('the same engine secret authenticates initialize, notification, tool discovery, tools and cleanup', async t => {
  const calls = engine(t, () => null);
  const browser = await connectAutomationBrowser({ integration: { base_url: 'https://engine.test', config: { shared_secret: 'explicit-engine-fixture-secret' } }, startUrl: 'https://app.test' });
  await browser.call('browser_navigate', { url: 'https://app.test' }); await browser.close();
  assert.deepEqual(calls.map(call => call.method), ['initialize', 'notifications/initialized', 'tools/list', 'tools/call', 'DELETE']);
  for (const call of calls) assert.equal(call.headers['x-hellotest-testengine-secret'], 'explicit-engine-fixture-secret');
  for (const call of calls.slice(1)) assert.equal(call.headers['mcp-session-id'], 'pinned-session');
});

test('a rejected initialization notification preserves auth and releases the established session', async t => {
  const calls = engine(t, rpc => rpc.method === 'notifications/initialized' ? Response.json({ message: 'PRIVATE' }, { status: 403 }) : null);
  await assert.rejects(connectAutomationBrowser({ integration: { base_url: 'https://engine.test' }, startUrl: 'https://app.test' }), { code: 'AUTOMATION_BROWSER_ENGINE_ACCESS_DENIED', statusCode: 403, nonRetryable: true });
  assert.deepEqual(calls.map(call => call.method), ['initialize', 'notifications/initialized', 'DELETE']);
});

test('expired browser authorization after navigation stops before the model and remains distinct in activity', async t => {
  const calls = engine(t, rpc => rpc.params?.name === 'browser_snapshot' ? Response.json({ message: 'PRIVATE' }, { status: 401 }) : null);
  const browser = await connectAutomationBrowser({ integration: { base_url: 'https://engine.test' }, startUrl: 'https://app.test' });
  let models = 0;
  try {
    await assert.rejects(runAutomationBrowserAgent({ browser, startUrl: 'https://app.test', prompt: 'Build', parse: JSON.parse,
      complete: async () => { models++; return '{}'; } }), error => {
      const event = buildFailureProgress(error, { modelStarted: false });
      const issue = stepBuildError(event, '2026-11-05T00:00:00.000Z');
      assert.equal(event.details.failure_stage, 'browser');
      assert.equal(issue.code, 'AUTOMATION_BROWSER_ENGINE_AUTHENTICATION_FAILED');
      assert.match(event.message, /HTTP 401/); assert.match(issue.message, /TestEngine/);
      assert.doesNotMatch(JSON.stringify({ event, issue }), /PRIVATE|model provider|application authentication|unknown outcome/);
      return true;
    });
  } finally { await browser.close(); }
  assert.equal(models, 0);
  assert.deepEqual(calls.filter(call => call.tool).map(call => call.tool), ['browser_navigate', 'browser_snapshot']);
  assert.equal(calls.filter(call => call.method === 'initialize').length, 1);
});

test('an optional screenshot cannot hide an expired or incompatible MCP session', async t => {
  for (const failure of ['expired', 'protocol']) await t.test(failure, async t => {
    const calls = engine(t, rpc => rpc.params?.name === 'browser_screenshot' ? failure === 'expired'
      ? Response.json({ message: 'PRIVATE' }, { status: 404 })
      : Response.json({ jsonrpc: '2.0', id: 'wrong', error: { message: 'PRIVATE' } }) : null);
    const browser = await connectAutomationBrowser({ integration: { base_url: 'https://engine.test' }, startUrl: 'https://app.test' });
    let models = 0;
    try {
      await assert.rejects(runAutomationBrowserAgent({ browser, startUrl: 'https://app.test', prompt: 'Build', parse: JSON.parse,
        complete: async () => { models++; return '{}'; } }), { code: failure === 'expired' ? 'AUTOMATION_BROWSER_SESSION_EXPIRED' : 'AUTOMATION_BROWSER_PROTOCOL_INVALID', nonRetryable: true });
    } finally { await browser.close(); }
    assert.equal(models, 0); assert.equal(calls.filter(call => call.method === 'initialize').length, 1);
  });
});
