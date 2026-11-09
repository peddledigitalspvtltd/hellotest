import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import Fastify from 'fastify';
import { registerAutomationMcp } from '../../dist/lib/automationMcp.js';
const require = createRequire(import.meta.url);
const { connectAutomationBrowser, runAutomationBrowserAgent } = require('../../../../services/automation/backend/lib/automationBrowserAgent.js');
const { createRetainedAssertionContract } = require('../../../../services/automation/backend/lib/automationRetainedAssertions.js');
const { compileRecordedProgram } = require('../../../../services/automation/backend/lib/automationRecordedProgram.js');
const { inspectExecutablePlan } = require('../../../../services/automation/backend/services/automationReadiness.service.js');

test('real native Login runs the saved URL/LogOut suffix before another actor and fails closed on a retained oracle failure', { timeout: 90000 }, async t => {
  const previous = process.env.RECORDER_ALLOWED_PRIVATE_HOSTS; process.env.RECORDER_ALLOWED_PRIVATE_HOSTS = '127.0.0.1';
  t.after(() => { if (previous === undefined) delete process.env.RECORDER_ALLOWED_PRIVATE_HOSTS; else process.env.RECORDER_ALLOWED_PRIVATE_HOSTS = previous; });
  const app = Fastify(); let logins = 0;
  app.get('/login', async (_req, reply) => reply.type('text/html').send('<!doctype html><title>Login</title><form onsubmit="event.preventDefault();location.href=\'/dashboard\'"><label>Username<input id="username"></label><label>Password<input type="password" id="password"></label><button id="login" type="submit">Login</button></form>'));
  app.get('/dashboard', async (_req, reply) => { logins++; return reply.type('text/html').send('<!doctype html><title>Dashboard</title><nav><a href="/employees">Employee Management</a><span>Log Out</span></nav>'); });
  await registerAutomationMcp(app, async () => {}); const base = await app.listen({ host: '127.0.0.1', port: 0 }); t.after(() => app.close());
  for (const fail of [false, true]) await t.test(fail ? 'missing saved oracle stops without replay' : 'saved oracles execute and semantic/source acceptance remain mandatory', async () => {
    const before = logins, browser = await connectAutomationBrowser({ integration: { base_url: base }, startUrl: base + '/login', allowBrowserActions: true });
    try {
      browser.tools = browser.tools.filter(tool => tool.name !== 'browser_screenshot'); browser.projectPromptText = value => value;
      await browser.call('browser_navigate', { url: base + '/login' }); const initial = await browser.call('browser_snapshot', {});
      const operations = [{ name: 'browser_fill', arguments: { locator: 'getByLabel("Username", {exact:true})', value: '@r.username' } },
        { name: 'browser_fill', arguments: { locator: 'getByLabel("Password", {exact:true})', value: '@r.password' } },
        { name: 'browser_click', arguments: { locator: 'getByRole("button", {name:"Login",exact:true})' } },
        { name: 'browser_assert', arguments: { assertion: 'url', value: base + '/dashboard' } },
        { name: 'browser_assert', arguments: { assertion: 'visible', locator: fail ? '#missing-logout' : 'getByText("Log Out", {exact:true})' } }];
      const source = compileRecordedProgram(operations).source, contract = createRetainedAssertionContract({ step: { id: 'current', step_type: 'web', automation_code: source } }); assert.equal(contract.status, 'available');
      const calls = [], original = browser.call; browser.call = async (name, args, ...rest) => { calls.push({ name, args: structuredClone(args) }); return original(name, { ...args,
        ...(args.value === '@r.username' ? { value: 'fixture-user' } : args.value === '@r.password' ? { value: 'fixture-password' } : {}) }, ...rest); };
      let actors = 0, reviews = 0, saves = 0;
      const action = 'Enter @r.username in Username, enter @r.password in Password, then click Login.', expected_result = 'The dashboard URL is reached and Log Out is visible.';
      const run = runAutomationBrowserAgent({ browser, prompt: 'Complete the current saved login contract.', actorMode: true, parse: JSON.parse, maxCalls: 12, maxTurns: 4,
        execution: { required: true, step_id: 'current', action, expected_result, source_obligations: [{ id: 'current', source: 'section', action, expected_result }], obligations: [{ id: 'current', source: 'section', action, expected_result }], semantic_review_required: true, retained_assertion_contract: contract },
        initialObservations: [{ tool: 'browser_snapshot', execution_step_id: 'previous', result: initial }], onPartialBuild: async payload => { saves++; assert.equal(inspectExecutablePlan(payload.steps).length, 0); return { generation_complete: true }; },
        complete: async prompt => {
          if (prompt.includes('"kind":"automation_section_semantic_review"')) {
            reviews++; assert.equal(saves, 0); const packet = JSON.parse(prompt.split('\n').at(-1));
            return JSON.stringify({ decision: 'accept', obligations: packet.obligations.map(row => ({ id: row.id, action_operations: [1, 2, 3], assertion_operations: [4, 5] })), issues: [] });
          }
          actors++; const current = JSON.parse(prompt.match(/^Current browser state and confirmed section progress .*?: (.+)$/m)[1]);
          if (actors === 1) {
            const target = name => current.current_snapshot.targets.find(row => row.name === name)?.ref;
            return JSON.stringify({ stage: 'act', step_id: 'current', section_complete: false, tool_calls: [
              { name: 'browser_fill', arguments: { locator: target('Username'), value: '@r.username' } }, { name: 'browser_fill', arguments: { locator: target('Password'), value: '@r.password' } },
              { name: 'browser_click', arguments: { locator: target('Login') } }] });
          }
          assert.equal(actors, 2); assert.equal(calls.filter(row => row.name === 'browser_assert').length, 2, 'native saved suffix precedes this actor decision');
          assert.equal(current.recorded_section.completion_available, true); return JSON.stringify({ stage: 'act', step_id: 'current', section_complete: true, tool_calls: [] });
        } });
      if (fail) { await assert.rejects(run, error => error.code === 'AUTOMATION_BROWSER_RETAINED_ASSERTION_FAILED' && error.nonRetryable); assert.equal(actors, 1); assert.equal(reviews, 0); assert.equal(saves, 0); }
      else { const result = await run; assert.equal(actors, 2); assert.equal(reviews, 1); assert.equal(saves, 1); assert.match(result.steps[0].automation_code, /@r\.username/); assert.match(result.steps[0].automation_code, /@r\.password/); assert.match(result.steps[0].automation_code, /Log Out/); }
      assert.equal(logins - before, 1); assert.equal(calls.filter(row => row.name === 'browser_click').length, 1); assert.equal(calls.filter(row => row.name === 'browser_fill').length, 2); assert.equal(calls.filter(row => row.name === 'browser_assert').length, 2);
      assert.ok(calls.length <= 12, 'saved checks consume the unchanged section allowance'); assert.equal(calls.filter(row => row.name === 'browser_navigate').length, 0);
    } finally { await browser.close(); }
  });
});
