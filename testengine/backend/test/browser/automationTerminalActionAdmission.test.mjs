import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import Fastify from 'fastify';
import { registerAutomationMcp } from '../../dist/lib/automationMcp.js';
const require = createRequire(import.meta.url);
const { connectAutomationBrowser, runAutomationBrowserAgent } = require('../../../../services/automation/backend/lib/automationBrowserAgent.js');
const { inspectExecutablePlan } = require('../../../../services/automation/backend/services/automationReadiness.service.js');
const current = prompt => JSON.parse(prompt.match(/^Current browser state and confirmed section progress .*?: (.+)$/m)[1]).current_snapshot;
const envelope = (tool_calls, section_complete = false) => JSON.stringify({ stage: 'act', step_id: 'current', section_complete, tool_calls });
const body = contents => '<!doctype html><title>Action phase fixture</title>' + contents;
const sourceAction = action => ({ required: true, step_id: 'current', action, expected_result: 'The Dashboard and Employee Management and Log Out are visible.',
  source_obligations: [{ id: 'current', action }, { id: 'manual:linked:current', action }] });

test('real MCP Login completion closes later dashboard fills/links while partial credentials and original outcome checks remain executable', { timeout: 90000 }, async t => {
  const previous = process.env.RECORDER_ALLOWED_PRIVATE_HOSTS; process.env.RECORDER_ALLOWED_PRIVATE_HOSTS = '127.0.0.1';
  t.after(() => { if (previous === undefined) delete process.env.RECORDER_ALLOWED_PRIVATE_HOSTS; else process.env.RECORDER_ALLOWED_PRIVATE_HOSTS = previous; });
  const app = Fastify(); let logins = 0, dashboardInputs = 0, employeeLinks = 0, onboardingLinks = 0;
  app.get('/login', async (_req, reply) => reply.type('text/html').send(body('<form onsubmit="event.preventDefault();location.href=\'/dashboard\'"><label>Username<input id="username"></label><label>Password<input id="password" type="password"></label><button id="login" type="submit">Login</button></form>')));
  app.get('/dashboard', async (_req, reply) => { logins++; return reply.type('text/html').send(body('<h1>Dashboard</h1><label>Search<input id="search" oninput="fetch(\'/dashboard-input\',{method:\'POST\'})"></label><a href="/employees">Employee Management</a><button id="logout" type="button">Log Out</button>')); });
  app.post('/dashboard-input', async () => { dashboardInputs++; return { ok: true }; });
  app.get('/employees', async (_req, reply) => { employeeLinks++; return reply.type('text/html').send(body('<h1>Employees</h1><a href="/onboarding">Onboarding</a>')); });
  app.get('/onboarding', async (_req, reply) => { onboardingLinks++; return reply.type('text/html').send(body('<h1>Onboarding ready</h1>')); });
  await registerAutomationMcp(app, async () => {}); const base = await app.listen({ host: '127.0.0.1', port: 0 }); t.after(() => app.close());
  const browser = await connectAutomationBrowser({ integration: { base_url: base }, startUrl: base + '/login', allowBrowserActions: true }); t.after(() => browser.close());
  const original = browser.call, calls = [], observations = []; browser.call = async (name, args, ...rest) => { calls.push({ name, args: structuredClone(args) }); return original(name, args, ...rest); };
  let actors = 0, saves = 0;
  const action = 'Enter @r.username in Username, enter @r.password in Password, then click Login.';
  // Bind symbolic data at the transport boundary, exactly as a configured build
  // does. The Agent and compiled source retain references, never resolved data.
  const actualCall = browser.call;
  browser.call = (name, args, ...rest) => actualCall(name, { ...args, ...(name === 'browser_fill' ? { value: args.value === '@r.username' ? 'fixture-user' : args.value === '@r.password' ? 'fixture-password' : args.value } : {}) }, ...rest);
  const result = await runAutomationBrowserAgent({ browser, startUrl: base + '/login', prompt: 'Complete only this current login section and its authored outcome.',
    execution: sourceAction(action), actorMode: true, parse: JSON.parse, maxTurns: 5, maxCalls: 12,
    onObservation: row => observations.push(row), onPartialBuild: async payload => { saves++; assert.equal(inspectExecutablePlan(payload.steps).length, 0); return { generation_complete: true }; },
    complete: async prompt => {
      actors++; const page = current(prompt), target = name => { const row = page.targets.find(row => row.name === name); assert.ok(row, name); return row.ref; };
      if (actors === 1) return envelope([{ name: 'browser_fill', arguments: { locator: target('Username'), value: '@r.username' } }]);
      if (actors === 2) {
        assert.equal(calls.filter(row => row.name === 'browser_click').length, 0, 'a username fill does not close the authored password and Login actions');
        return envelope([{ name: 'browser_fill', arguments: { locator: target('Password'), value: '@r.password' } }, { name: 'browser_click', arguments: { locator: target('Login') } }]);
      }
      if (actors === 3) {
        assert.equal(logins, 1); assert.match(prompt, /post_terminal_verification_only/);
        return envelope([{ name: 'browser_fill', arguments: { locator: target('Search'), value: '@r.password' } }, { name: 'browser_click', arguments: { locator: target('Employee Management') }, occurrence: 2 }], true);
      }
      assert.equal(actors, 4); assert.match(prompt, /AUTOMATION_BROWSER_ACTION_OUT_OF_ORDER/); assert.match(prompt, /final explicit terminal action/);
      assert.equal(dashboardInputs, 0); assert.equal(employeeLinks, 0);
      assert.equal(calls.filter(row => row.name === 'browser_fill').length, 2); assert.equal(calls.filter(row => row.name === 'browser_click').length, 1);
      return envelope([{ name: 'browser_assert', arguments: { assertion: 'url', value: base + '/dashboard' } },
        ...['Dashboard', 'Employee Management', 'Log Out'].map(name => ({ name: 'browser_assert', arguments: { assertion: 'visible', locator: target(name) } }))], true);
    } });
  assert.equal(actors, 4); assert.equal(saves, 1); assert.equal(logins, 1); assert.equal(dashboardInputs, 0); assert.equal(employeeLinks, 0);
  const code = result.steps[0].automation_code;
  assert.equal((code.match(/\.click\(/g) || []).length, 1); assert.equal((code.match(/\.fill\(/g) || []).length, 2);
  assert.match(code, /@r\.username/); assert.match(code, /@r\.password/); assert.doesNotMatch(code, /fixture-password|fixture-user/);
  assert.ok(observations.some(row => row.tool === 'automation_action_order_feedback' && row.mcp_call === false));
  // Reproduce the real next-section handoff: the final login oracle narrowed
  // evidence to Log Out. The next actor must receive fresh body context before
  // selecting Employee Management, without replaying the completed Login.
  const narrowArgs = { locator: 'getByRole("button", {name:"Log Out",exact:true})' };
  observations.push({ tool: 'browser_snapshot', arguments: narrowArgs, execution_step_id: 'current', result: await browser.call('browser_snapshot', narrowArgs) });
  browser.tools = browser.tools.filter(tool => tool.name !== 'browser_screenshot');
  const sectionStart = calls.length; let navigationTurns = 0, navigationSaves = 0;
  const navigationAction = 'Click Employee Management and click Onboarding';
  const navigation = await runAutomationBrowserAgent({ browser, prompt: navigationAction, actorMode: true, parse: JSON.parse, maxTurns: 4, maxCalls: 12,
    execution: { required: true, step_id: 'navigation', action: navigationAction, expected_result: 'Onboarding ready is visible.', source_obligations: [{ id: 'navigation', action: navigationAction }] },
    initialObservations: observations, onObservation: row => observations.push(row), onPartialBuild: async payload => { navigationSaves++; assert.equal(inspectExecutablePlan(payload.steps).length, 0); return { generation_complete: true }; },
    complete: async prompt => {
      navigationTurns++; const snapshot = current(prompt), name = navigationTurns === 1 ? 'Employee Management' : navigationTurns === 2 ? 'Onboarding' : 'Onboarding ready';
      if (navigationTurns === 1) { assert.equal(snapshot.scope, 'body'); assert.deepEqual(calls[sectionStart], { name: 'browser_snapshot', args: {} }); }
      const target = snapshot.targets.find(row => row.name === name); assert.ok(target, name);
      return JSON.stringify({ stage: 'act', step_id: 'navigation', section_complete: navigationTurns === 3, tool_calls: [{ name: navigationTurns === 3 ? 'browser_assert' : 'browser_click',
        arguments: { locator: target.ref, ...(navigationTurns === 3 ? { assertion: 'visible' } : {}) } }] });
    } });
  const navigationCalls = calls.slice(sectionStart);
  assert.equal(navigationTurns, 3); assert.equal(navigationSaves, 1); assert.equal(logins, 1); assert.equal(employeeLinks, 1); assert.equal(onboardingLinks, 1); assert.equal(dashboardInputs, 0);
  assert.ok(navigationCalls.length <= 12); assert.equal(navigationCalls.filter(row => row.name === 'browser_navigate' || row.name === 'browser_fill').length, 0);
  assert.equal(navigationCalls.filter(row => row.name === 'browser_click').length, 2);
  assert.equal((navigation.steps[0].automation_code.match(/\.click\(/g) || []).length, 2); assert.doesNotMatch(navigation.steps[0].automation_code, /\.fill\(|\.goto\(/);
});

test('real MCP Save receipt stays closed across same-session actor attempts, including a new Save occurrence and new field', { timeout: 60000 }, async t => {
  const previous = process.env.RECORDER_ALLOWED_PRIVATE_HOSTS; process.env.RECORDER_ALLOWED_PRIVATE_HOSTS = '127.0.0.1';
  t.after(() => { if (previous === undefined) delete process.env.RECORDER_ALLOWED_PRIVATE_HOSTS; else process.env.RECORDER_ALLOWED_PRIVATE_HOSTS = previous; });
  const app = Fastify(); let saves = 0, inputs = 0, signalSave;
  const saveObserved = new Promise(resolve => { signalSave = resolve; });
  app.get('/save', async (_req, reply) => reply.type('text/html').send(body('<button id="save" type="button" onclick="fetch(\'/save\',{method:\'POST\'}).then(()=>document.getElementById(\'status\').textContent=\'Saved\')">Save</button><label>New field<input id="new-field" oninput="fetch(\'/input\',{method:\'POST\'})"></label><h2 id="status">Ready</h2>')));
  app.post('/save', async () => { saves++; signalSave(); return { ok: true }; }); app.post('/input', async () => { inputs++; return { ok: true }; });
  await registerAutomationMcp(app, async () => {}); const base = await app.listen({ host: '127.0.0.1', port: 0 }); t.after(() => app.close());
  const browser = await connectAutomationBrowser({ integration: { base_url: base }, startUrl: base + '/save', allowBrowserActions: true }); t.after(() => browser.close());
  const observations = [], calls = [], original = browser.call; browser.call = async (name, args, ...rest) => { calls.push({ name, args }); return original(name, args, ...rest); };
  const execution = { ...sourceAction('Click Save once.'), expected_result: 'Saved is visible.' };
  let firstTurns = 0;
  await assert.rejects(runAutomationBrowserAgent({ browser, startUrl: base + '/save', execution, actorMode: true, prompt: 'Click Save once.', parse: JSON.parse,
    onObservation: row => { observations.push(row); if (row.tool === 'browser_click') throw Object.assign(new Error('Fixture observer interruption after confirmed Save'), { code: 'FIXTURE_INTERRUPTION' }); }, maxTurns: 3, complete: async prompt => {
      firstTurns++;
      return envelope([{ name: 'browser_click', arguments: { locator: current(prompt).targets.find(row => row.name === 'Save').ref } }]);
    } }), error => error.code === 'FIXTURE_INTERRUPTION');
  await Promise.race([saveObserved, new Promise((_, reject) => { const timeout = setTimeout(() => reject(Error('The one completed Save did not reach the fixture')), 3000); timeout.unref(); })]);
  assert.equal(saves, 1); assert.equal(firstTurns, 1);
  let retryTurns = 0, saved = 0;
  const result = await runAutomationBrowserAgent({ browser, execution, actorMode: true, prompt: 'Resume only remaining outcome checks.', parse: JSON.parse, initialObservations: observations,
    maxTurns: 4, maxCalls: 12, onPartialBuild: async () => { saved++; return { generation_complete: true }; }, complete: async prompt => {
      const page = current(prompt), target = name => page.targets.find(row => row.name === name)?.ref;
      if (++retryTurns === 1) return envelope([{ name: 'browser_click', arguments: { locator: target('Save') }, occurrence: 2 }, { name: 'browser_fill', arguments: { locator: target('New field'), value: 'unrelated' } }]);
      assert.match(prompt, /post_terminal_verification_only/); assert.equal(calls.filter(row => row.name === 'browser_click').length, 1); assert.equal(inputs, 0);
      if (retryTurns === 2) return envelope([{ name: 'browser_snapshot', arguments: {} }]);
      return envelope([{ name: 'browser_assert', arguments: { assertion: 'visible', locator: target('Saved') } }], true);
    } });
  assert.equal(saves, 1); assert.equal(inputs, 0); assert.equal(saved, 1); assert.equal(retryTurns, 3);
  assert.equal((result.steps[0].automation_code.match(/\.click\(/g) || []).length, 1);
});
