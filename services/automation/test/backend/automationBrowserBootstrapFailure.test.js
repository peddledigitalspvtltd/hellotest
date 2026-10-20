const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { browserBootstrapFailure } = require('../../backend/lib/automationBrowserBootstrapFailure');
const { runAutomationBrowserAgent } = require('../../backend/lib/automationBrowserAgent');
const result = value => ({ isError: true, content: [{ type: 'text', text: JSON.stringify(value) }] });
const launchError = overrides => result({ code: 'BROWSER_TOOL_FAILED', action_outcome: 'not_attempted', retry_safe: true,
  message: 'browserType.launch: Target page, context or browser has been closed\nBrowser logs:\n--proxy-server=http://user:private-value@localhost', ...overrides });

test('the real pre-model launch failure shape retains safe retry evidence without exposing raw browser logs', () => {
  const error = browserBootstrapFailure(launchError());
  assert.equal(error.code, 'AUTOMATION_BROWSER_STARTUP_FAILED');
  assert.equal(error.statusCode, 503);
  assert.equal(error.nonRetryable, false);
  assert.equal(error.action_outcome, 'not_attempted');
  assert.equal(error.retry_safe, true);
  assert.equal(error.browser_code, 'BROWSER_TOOL_FAILED');
  assert.doesNotMatch(error.message, /private-value|proxy-server|Browser logs/);
  assert.equal(browserBootstrapFailure(launchError({ code: 'BROWSER_LAUNCH_FAILED', launch_phase: 'startup', message: 'Browser startup failed.' })).code, 'AUTOMATION_BROWSER_STARTUP_FAILED');
  assert.equal(browserBootstrapFailure(launchError(), { tool: 'browser_snapshot' }).nonRetryable, true);
});

test('main-document HTTP failures retain only validated status and fixed actionable guidance', () => {
  for (const [status, guidance] of [[400, /saved Start URL/], [401, /authentication/], [403, /access requirements/], [404, /application route/], [410, /application route/], [429, /rate limit/], [500, /upstream services/], [502, /upstream services/], [503, /upstream services/], [504, /upstream services/], [599, /upstream services/]]) {
    const error = browserBootstrapFailure(result({ code: 'BROWSER_NAVIGATION_FAILED', http_status: status, action_outcome: 'completed', retry_safe: false,
      message: 'page.goto https://private.example/secret-route?token=fixture-private-token raw exception', url: 'https://private.example/secret-route?token=fixture-private-token' }));
    assert.equal(error.code, 'AUTOMATION_BROWSER_NAVIGATION_HTTP_ERROR');
    assert.equal(error.http_status, status);
    assert.equal(error.statusCode, 422, 'target HTTP status is data, not a transient API status');
    assert.equal(error.nonRetryable, true); assert.equal(error.retry_safe, false);
    assert.match(error.message, new RegExp(`HTTP ${status}`)); assert.match(error.message, guidance);
    assert.doesNotMatch(JSON.stringify(error) + error.message, /https?:|private.example|secret-route|fixture-private-token|raw exception/);
    assert.equal(error.browser_diagnostic, undefined, 'remote HTTP errors are not browser startup diagnostics');
  }
});

test('HTTP status diagnostics require a typed navigation receipt, never parsed messages or untrusted statuses', () => {
  for (const http_status of [undefined, null, '502', 200, 302, 399, 600, 400.5, {}, true]) {
    const error = browserBootstrapFailure(result({ code: 'BROWSER_NAVIGATION_FAILED', http_status, message: 'HTTP 502 https://private.example/?token=fixture-private-token' }));
    assert.equal(error.code, 'AUTOMATION_BROWSER_INSPECTION_FAILED'); assert.equal(error.http_status, undefined);
    assert.doesNotMatch(error.message, /502|private.example|fixture-private-token/);
  }
  for (const code of ['BROWSER_NETWORK_POLICY_DENIED', 'BROWSER_LAUNCH_FAILED', 'UNTRUSTED_HTTP_STATUS']) {
    const error = browserBootstrapFailure(result({ code, http_status: 502, message: 'HTTP 502' }));
    assert.equal(error.http_status, undefined); assert.equal(error.retry_safe, false);
  }
  const read = browserBootstrapFailure(result({ code: 'BROWSER_NAVIGATION_FAILED', http_status: 502 }), { tool: 'browser_snapshot' });
  assert.equal(read.http_status, undefined);
  const redirected = browserBootstrapFailure(result({ code: 'BROWSER_PAGE_NOT_READY', http_status: 503, action_outcome: 'completed', retry_safe: false }));
  assert.equal(redirected.code, 'AUTOMATION_BROWSER_NAVIGATION_HTTP_ERROR'); assert.equal(redirected.http_status, 503);
});

test('an HTTP error stops before any model request, snapshot or automatic navigation replay', async () => {
  let tools = 0, models = 0;
  await assert.rejects(runAutomationBrowserAgent({ prompt: 'Build the case', startUrl: 'https://app.example.test/',
    browser: { tools: ['browser_navigate', 'browser_snapshot'].map(name => ({ name })), call: async name => {
      tools++; assert.equal(name, 'browser_navigate');
      return result({ code: 'BROWSER_NAVIGATION_FAILED', http_status: 502, action_outcome: 'completed', retry_safe: false });
    } }, complete: async () => { models++; }, parse: JSON.parse
  }), error => error.code === 'AUTOMATION_BROWSER_NAVIGATION_HTTP_ERROR' && error.http_status === 502 && error.nonRetryable === true);
  assert.equal(tools, 1); assert.equal(models, 0);
});

test('bootstrap never grants replay permission for unknown, completed, unproven, policy or locator failures', () => {
  for (const entry of [
    launchError({ action_outcome: 'unknown', retry_safe: false }),
    launchError({ action_outcome: 'completed' }), launchError({ retry_safe: undefined }),
    launchError({ code: 'BROWSER_NETWORK_POLICY_DENIED' }),
    launchError({ code: 'BROWSER_LAUNCH_FAILED', launch_phase: 'navigation', message: 'Browser closed during navigation.' }),
    launchError({ code: 'BROWSER_TOOL_FAILED', message: 'A locator matched no elements.' }),
    { isError: true, content: [{ type: 'text', text: 'Unstructured launch failure' }] }
  ]) {
    const error = browserBootstrapFailure(entry);
    assert.equal(error.nonRetryable, true);
    assert.equal(error.retry_safe, false);
    assert.equal(error.statusCode, 422);
  }
  const unknown = browserBootstrapFailure(null, { cause: new Error('Connection dropped after dispatch') });
  assert.equal(unknown.code, 'AUTOMATION_BROWSER_BOOTSTRAP_OUTCOME_UNKNOWN');
  assert.equal(unknown.nonRetryable, true);
});

test('startup gets one immediate retry and exhaustion cannot multiply through the durable queue policy', async () => {
  const observations = [], events = [];
  let models = 0, tools = 0;
  let finalError;
  await assert.rejects(runAutomationBrowserAgent({ prompt: 'Build the case', startUrl: 'https://app.example.test/',
    browser: { tools: ['browser_navigate', 'browser_snapshot'].map(name => ({ name, inputSchema: { type: 'object' } })), call: async () => { tools++; return launchError(); } },
    complete: async () => { models++; }, parse: JSON.parse, onObservation: async value => observations.push(value), onProgress: async value => {
      events.push(value);
      if (['automation.agent.browser.startup.retry', 'automation.agent.browser.startup.failed'].includes(value.phase)) throw Object.assign(new Error('Optional progress unavailable'), { statusCode: 503 });
    }
  }), error => { finalError = error; return error.code === 'AUTOMATION_BROWSER_STARTUP_FAILED' && error.statusCode === 503 && error.nonRetryable && error.automatic_retry_exhausted && error.startup_attempts === 2; });
  assert.equal(models, 0); assert.equal(tools, 2);
  assert.equal(observations[0].result.isError, true);
  assert.deepEqual(events.filter(event => event.phase.startsWith('automation.agent.action.')).map(event => event.phase), ['automation.agent.action.started', 'automation.agent.action.failed', 'automation.agent.action.started', 'automation.agent.action.failed']);
  const source = fs.readFileSync(require.resolve('../../../testing/backend/services/batchProcess.service'), 'utf8');
  const body = source.slice(source.indexOf('const isRetryableBatchError ='), source.indexOf('const isAiCapacityError ='));
  const retryable = new Function(`${body};return isRetryableBatchError;`)();
  assert.equal(retryable(browserBootstrapFailure(launchError())), true);
  assert.equal(retryable(finalError), false);
  assert.equal(retryable(browserBootstrapFailure(launchError({ action_outcome: 'unknown', retry_safe: false }))), false);
});

test('one proven startup recovery reuses the same reviewed URL and reaches the model only after a real snapshot', async () => {
  const calls = [], events = [];
  let navigations = 0, models = 0;
  const url = 'https://app.example.test/signup?mode=review';
  const output = await runAutomationBrowserAgent({ prompt: 'Build the case', startUrl: url,
    browser: { tools: ['browser_navigate', 'browser_snapshot'].map(name => ({ name, inputSchema: { type: 'object' } })), call: async (name, args) => {
      calls.push({ name, args });
      if (name === 'browser_navigate' && ++navigations === 1) return launchError({ code: 'BROWSER_LAUNCH_FAILED', launch_phase: 'startup' });
      return { content: [{ type: 'text', text: JSON.stringify({ url, action_outcome: 'completed', accessibility: 'Account form' }) }] };
    } },
    complete: async prompt => { models++; assert.doesNotMatch(prompt,/proxy-server|private-value|Browser logs/);assert.deepEqual(calls.map(call => call.name), ['browser_navigate', 'browser_navigate', 'browser_snapshot']); return '{"steps":[]}'; },
    parse: JSON.parse, onProgress: async event => events.push(event)
  });
  assert.deepEqual(output, { steps: [] });
  assert.equal(models, 1);
  assert.deepEqual(calls.slice(0, 2).map(call => call.args.url), [url, url]);
  assert.equal(events.filter(event => event.phase === 'automation.agent.browser.startup.retry').length, 1);
});

test('a bootstrap transport failure has an unknown outcome and cannot replay automatically', async () => {
  let models = 0;
  await assert.rejects(runAutomationBrowserAgent({ prompt: 'Build the case', startUrl: 'https://app.example.test/',
    browser: { tools: ['browser_navigate', 'browser_snapshot'].map(name => ({ name, inputSchema: { type: 'object' } })), call: async () => { throw new Error('Connection dropped'); } },
    complete: async () => { models++; }, parse: JSON.parse
  }), error => error.code === 'AUTOMATION_BROWSER_BOOTSTRAP_OUTCOME_UNKNOWN' && error.nonRetryable === true);
  assert.equal(models, 0);
});

test('startup retry observes the case deadline and never retries cancellation', async t => {
  let now = 1000, calls = 0;
  t.mock.method(Date, 'now', () => now);
  await assert.rejects(runAutomationBrowserAgent({ prompt: 'Build', startUrl: 'https://app.example.test/', deadlineMs: 1500,
    browser: { tools: ['browser_navigate', 'browser_snapshot'].map(name => ({ name })), call: async () => { calls++; return launchError(); } },
    parse: JSON.parse, complete: async () => { throw new Error('No model call is permitted'); },
    onProgress: async event => { if (event.phase === 'automation.agent.browser.startup.retry') now = 1600; }
  }), error => error.code === 'AUTOMATION_BUILD_DEADLINE' && error.nonRetryable === true);
  assert.equal(calls, 1);
  calls = 0;
  await assert.rejects(runAutomationBrowserAgent({ prompt: 'Build', startUrl: 'https://app.example.test/',
    browser: { tools: ['browser_navigate', 'browser_snapshot'].map(name => ({ name })), call: async () => { calls++; throw Object.assign(new Error('Cancelled'), { name: 'AbortError' }); } },
    parse: JSON.parse, complete: async () => { throw new Error('No model call is permitted'); }
  }), error => error.name === 'AbortError');
  assert.equal(calls, 1);
});
