import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { createRequire } from 'node:module';
import { registerAutomationMcp } from '../../dist/lib/automationMcp.js';
import { createPrivilegedRunGuard, resolveTestEngineSharedSecret } from '../../dist/lib/testEngineSecurity.js';

const require = createRequire(import.meta.url);
const { connectAutomationBrowser, runAutomationBrowserAgent } = require('../../../../services/automation/backend/lib/automationBrowserAgent.js');
const { buildFailureProgress } = require('../../../../services/automation/backend/lib/automationBuildFailureProgress.js');
const read = result => JSON.parse(result.content.find(part => part.type === 'text').text);

async function fixture(t) {
  const previous = process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;
  process.env.RECORDER_ALLOWED_PRIVATE_HOSTS = '127.0.0.1';
  t.after(() => { if (previous === undefined) delete process.env.RECORDER_ALLOWED_PRIVATE_HOSTS; else process.env.RECORDER_ALLOWED_PRIVATE_HOSTS = previous; });
  const app = Fastify(); let submissions = 0, ssoRequests = 0, redirectRequests = 0, authPosts = 0, signedInRequests = 0;
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_request, body, done) => done(null, body));
  let base;
  const ssoUrl = () => base.replace('127.0.0.1', 'localhost') + '/external-sso';
  app.get('/form', async (_request, reply) => reply.type('text/html').send(`<!doctype html><title>Scoped form</title><main>
    <button id="popup" onclick="fetch('/submit',{method:'POST'});window.open('/child','_blank')">Open popup</button>
    <button id="sso" onclick="fetch('/submit',{method:'POST'});window.location.href='${ssoUrl()}'">External SSO</button>
    <p>Current application</p></main>`));
  app.get('/child', async (_request, reply) => reply.type('text/html').send('<!doctype html><title>Child</title>Popup'));
  app.get('/embedded', async (_request, reply) => reply.type('text/html').send(`<!doctype html><title>Parent page</title><main><button>Save parent</button><iframe src="${ssoUrl()}"></iframe></main>`));
  app.get('/auth-form', async (_request, reply) => reply.type('text/html').send('<!doctype html><title>Sign in</title><form method="post" action="/session"><button id="sign-in">Sign in</button></form>'));
  app.post('/session', async (_request, reply) => { authPosts++; return reply.header('set-cookie', 'fixture_session=ok; Path=/; HttpOnly').redirect('/signed-in', 303); });
  app.get('/signed-in', async (request, reply) => { signedInRequests++; return reply.type('text/html').send(`<!doctype html><title>Account</title><p role="status">${request.headers.cookie === 'fixture_session=ok' ? 'Signed in' : 'Missing cookie'}</p>`); });
  app.post('/submit', async () => { submissions++; return {}; });
  app.get('/external-sso', async () => { ssoRequests++; return {}; });
  app.get('/redirect', async (_request, reply) => { redirectRequests++; return reply.redirect(ssoUrl()); });
  await registerAutomationMcp(app, createPrivilegedRunGuard(resolveTestEngineSharedSecret()));
  base = await app.listen({ host: '127.0.0.1', port: 0 });
  t.after(() => app.close());
  const browser = await connectAutomationBrowser({ integration: { base_url: base }, startUrl: base + '/form', allowBrowserActions: true });
  t.after(() => browser.close());
  return { app, base, browser, ssoUrl, counts: () => ({ submissions, ssoRequests, redirectRequests }), authCounts: () => ({ authPosts, signedInRequests }) };
}

for (const [target, capability] of [['popup', 'new_page'], ['sso', 'cross_origin_navigation']]) {
  test(`${target} stops the Engineer after one action with an explicit capability outcome and no replay`, { timeout: 60_000 }, async t => {
    const f = await fixture(t), observations = [], events = []; let models = 0, saves = 0;
    await assert.rejects(runAutomationBrowserAgent({ browser: f.browser, startUrl: f.base + '/form', prompt: 'Open the requested transition', parse: JSON.parse,
      onObservation: observation => observations.push(observation), onProgress: event => events.push(event),
      onPartialBuild: async () => { saves++; return { generation_complete: true }; },
      complete: async prompt => {
        models++;
        assert.match(prompt, /Browser session scope \(host restriction\)/);
        assert.match(prompt, /"external_sso":"unsupported"/);
        assert.equal(models, 1, 'unsupported transition cannot open another model turn');
        return JSON.stringify({ tool_calls: [{ name: 'browser_click', arguments: { locator: '#' + target } }] });
      }
    }), error => {
      assert.equal(error.code, 'AUTOMATION_BROWSER_FLOW_UNSUPPORTED'); assert.equal(error.unsupported_capability, capability);
      assert.equal(error.action_outcome, 'unknown'); assert.equal(error.retry_safe, false); assert.equal(error.nonRetryable, true);
      const publicEvent = buildFailureProgress(error, { modelStarted: true });
      assert.match(publicEvent.message, target === 'popup' ? /popup or a new tab/ : /external SSO/);
      assert.match(publicEvent.message, /Inspect the original application state/);
      return true;
    });
    assert.equal(models, 1); assert.equal(saves, 0);
    assert.equal(f.counts().submissions, 1); assert.equal(f.counts().ssoRequests, 0);
    assert.equal(observations.filter(item => item.tool === 'browser_click').length, 1);
    assert.ok(events.some(event => event.phase === 'automation.agent.browser.capabilities'));
    assert.ok(events.some(event => event.phase === 'automation.agent.action.unknown'));
    const stopped = read(await f.browser.call('browser_click', { locator: '#' + target }));
    assert.equal(stopped.code, 'BROWSER_FLOW_UNSUPPORTED'); assert.equal(stopped.action_outcome, 'not_attempted'); assert.equal(stopped.retry_safe, false);
    assert.equal(f.counts().submissions, 1, 'terminal session cannot dispatch another interaction');
  });
}

test('an external SSO redirect during startup is reported before any model turn or navigation replay', { timeout: 60_000 }, async t => {
  const f = await fixture(t); let models = 0;
  await assert.rejects(runAutomationBrowserAgent({ browser: f.browser, startUrl: f.base + '/redirect', prompt: 'Read login flow', parse: JSON.parse,
    complete: async () => { models++; return '{}'; }
  }), { code: 'AUTOMATION_BROWSER_FLOW_UNSUPPORTED', unsupported_capability: 'cross_origin_navigation', action_outcome: 'unknown', nonRetryable: true });
  assert.equal(models, 0); assert.deepEqual(f.counts(), { submissions: 0, ssoRequests: 0, redirectRequests: 1 });
});

test('cross-origin navigation admission fails before launching or navigating a browser', async t => {
  const f = await fixture(t);
  const result = read(await f.browser.call('browser_navigate', { url: f.ssoUrl() }));
  assert.equal(result.code, 'BROWSER_FLOW_UNSUPPORTED'); assert.equal(result.unsupported_capability, 'cross_origin_navigation');
  assert.equal(result.action_outcome, 'not_attempted'); assert.equal(result.retry_safe, false);
  assert.deepEqual(f.counts(), { submissions: 0, ssoRequests: 0, redirectRequests: 0 });
});

test('a blocked unrelated cross-origin iframe does not prevent inspecting the supported parent page', { timeout: 60_000 }, async t => {
  const f = await fixture(t); let models = 0;
  const result = await runAutomationBrowserAgent({ browser: f.browser, startUrl: f.base + '/embedded', prompt: 'Read the parent page', parse: JSON.parse,
    complete: async prompt => { models++; assert.match(prompt, /Save parent/); return JSON.stringify({ steps: [] }); }
  });
  assert.deepEqual(result, { steps: [] }); assert.equal(models, 1);
  assert.deepEqual(f.counts(), { submissions: 0, ssoRequests: 0, redirectRequests: 0 });
});

test('same-origin sign-in redirects preserve cookies and execute their form POST exactly once', { timeout: 60_000 }, async t => {
  const f = await fixture(t);
  const opened = read(await f.browser.call('browser_navigate', { url: f.base + '/auth-form' }));
  assert.equal(opened.action_outcome, 'completed');
  const clicked = read(await f.browser.call('browser_click', { locator: '#sign-in' }));
  assert.equal(clicked.action_outcome, 'completed', JSON.stringify(clicked)); assert.equal(clicked.url, f.base + '/signed-in');
  const checked = read(await f.browser.call('browser_assert', { assertion: 'text', locator: '[role="status"]', value: 'Signed in' }));
  assert.equal(checked.assertion_outcome, 'satisfied');
  assert.deepEqual(f.authCounts(), { authPosts: 1, signedInRequests: 1 });
});
