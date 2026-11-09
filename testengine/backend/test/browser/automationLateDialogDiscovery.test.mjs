import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import Fastify from 'fastify';
import { chromium } from 'playwright';
import { captureAutomationBrowserSnapshot, registerAutomationMcp } from '../../dist/lib/automationMcp.js';
import { AutomationObservedSubjects } from '../../dist/lib/automationObservedSubjects.js';
const require = createRequire(import.meta.url);
const { connectAutomationBrowser, runAutomationBrowserAgent } = require('../../../../services/automation/backend/lib/automationBrowserAgent.js');
const { inspectExecutablePlan } = require('../../../../services/automation/backend/services/automationReadiness.service.js');
const layout = '<div></div>'.repeat(2500);
const form = '<form id="employee-dialog" role="dialog" aria-label="Employee details" style="position:fixed;left:200px;top:100px;background:white;padding:20px"><label>First Name<input id="first-name" oninput="fetch(\'/input\',{method:\'POST\'})"></label><label>Last Name<input id="last-name" oninput="fetch(\'/input\',{method:\'POST\'})"></label></form>';

test('native candidate discovery reaches portal fields beyond2500structural nodes and still caps unique candidate inspection', { timeout: 30000 }, async t => {
  const app = Fastify();
  app.get('/late', async (_req, reply) => reply.type('text/html').send('<!doctype html><title>Late dialog fixture</title><label>Background Search<input id="background"></label>' + layout + form));
  app.get('/many', async (_req, reply) => reply.type('text/html').send('<!doctype html><title>Many candidates</title>' + Array.from({ length: 2100 }, (_, index) => `<input id="candidate-${index}" style="position:absolute;left:-9999px">`).join('')));
  const base = await app.listen({ host: '127.0.0.1', port: 0 });
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}) });
  t.after(async () => { await browser.close(); await app.close(); });
  const page = await browser.newPage(); await page.goto(base + '/late');
  const before = await page.content(); assert.ok(await page.locator('body *').count() > 2500);
  const subjects = new AutomationObservedSubjects(); await subjects.beginSnapshot();
  const snapshot = await captureAutomationBrowserSnapshot(page, undefined, Date.now() + 7000, subjects);
  assert.ok(snapshot.scanned_elements < 20, 'inert layout nodes do not consume the candidate inspection allowance');
  assert.equal(snapshot.limits.scanned_elements, 2000); assert.ok(snapshot.elements.length <= 120); assert.ok(Buffer.byteLength(JSON.stringify(snapshot)) <= 65536);
  for (const id of ['first-name', 'last-name']) {
    const field = snapshot.elements.find(row => row.attributes?.id === id); assert.ok(field, id); assert.equal(field.tag, 'input'); assert.equal(field.locators_validated, true); assert.ok(field.locator_candidates.includes('#' + id));
    const handle = await subjects.resolve(page, '#' + id, Date.now() + 1000); assert.equal(await handle.evaluate((node, id) => node === document.getElementById(id), id), true);
  }
  assert.equal(await page.content(), before, 'candidate discovery and grounding do not modify DOM attributes or roles'); await subjects.clear();
  await page.goto(base + '/many'); const bounded = await captureAutomationBrowserSnapshot(page, undefined, Date.now() + 3000);
  assert.equal(bounded.scanned_elements, 2000); assert.equal(bounded.elements_truncated, true); assert.ok(bounded.elements.length <= 120); assert.ok(Buffer.byteLength(JSON.stringify(bounded)) <= 65536);
});

test('real host actor opens one appended dialog and fills/proves its late native fields without changing the background input', { timeout: 60000 }, async t => {
  const previous = process.env.RECORDER_ALLOWED_PRIVATE_HOSTS; process.env.RECORDER_ALLOWED_PRIVATE_HOSTS = '127.0.0.1';
  t.after(() => { if (previous === undefined) delete process.env.RECORDER_ALLOWED_PRIVATE_HOSTS; else process.env.RECORDER_ALLOWED_PRIVATE_HOSTS = previous; });
  const app = Fastify(); let opened = 0, inputs = 0, backgroundInputs = 0;
  app.get('/shell', async (_req, reply) => reply.type('text/html').send('<!doctype html><title>Employee workspace fixture</title><label>Background Search<input id="background" value="untouched" oninput="fetch(\'/wrong-input\',{method:\'POST\'})"></label><button type="button" id="add" onclick="openEmployee()">Add Employee</button>' + layout
    + `<script>function openEmployee(){fetch('/opened',{method:'POST'});const container=document.createElement('div');container.innerHTML=${JSON.stringify(form)};document.body.append(container)}</script>`));
  app.post('/opened', async () => { opened++; return { ok: true }; }); app.post('/input', async () => { inputs++; return { ok: true }; }); app.post('/wrong-input', async () => { backgroundInputs++; return { ok: true }; });
  await registerAutomationMcp(app, async () => {}); const base = await app.listen({ host: '127.0.0.1', port: 0 }); t.after(() => app.close());
  const browser = await connectAutomationBrowser({ integration: { base_url: base }, startUrl: base + '/shell', allowBrowserActions: true }); t.after(() => browser.close());
  browser.tools = browser.tools.filter(tool => tool.name !== 'browser_screenshot');
  const calls = [], original = browser.call; browser.call = async (name, args, ...rest) => { calls.push({ name, args: structuredClone(args) }); return original(name, { ...args,
    ...(typeof args.value === 'string' ? { value: args.value === '@r.first_name' ? 'Fixture first' : args.value === '@r.last_name' ? 'Fixture last' : args.value } : {}) }, ...rest); };
  let turns = 0, saves = 0;
  const action = 'Click Add Employee, enter @r.first_name in First Name and enter @r.last_name in Last Name';
  const result = await runAutomationBrowserAgent({ browser, startUrl: base + '/shell', prompt: 'Complete only the current employee detail entry and its exact field checks.', actorMode: true, parse: JSON.parse, maxTurns: 4, maxCalls: 12,
    execution: { required: true, step_id: 'details', action, expected_result: 'First Name and Last Name contain the entered values.', source_obligations: [{ id: 'details', action }] },
    onPartialBuild: async payload => { saves++; assert.equal(inspectExecutablePlan(payload.steps).length, 0); return { generation_complete: true }; },
    complete: async prompt => {
      turns++; const snapshot = JSON.parse(prompt.match(/^Current browser state and confirmed section progress .*?: (.+)$/m)[1]).current_snapshot;
      const target = name => { const row = snapshot.targets.find(row => row.name === name); assert.ok(row, name); return row.ref; };
      const envelope = (tool_calls, section_complete = false) => JSON.stringify({ stage: 'act', step_id: 'details', section_complete, tool_calls });
      if (turns === 1) return envelope([{ name: 'browser_click', arguments: { locator: target('Add Employee') } }]);
      assert.equal(turns, 2); assert.equal(snapshot.scope, 'body');
      return envelope([{ name: 'browser_fill', arguments: { locator: target('First Name'), value: '@r.first_name' } }, { name: 'browser_fill', arguments: { locator: target('Last Name'), value: '@r.last_name' } },
        { name: 'browser_assert', arguments: { assertion: 'value', locator: target('First Name'), value: '@r.first_name' } }, { name: 'browser_assert', arguments: { assertion: 'value', locator: target('Last Name'), value: '@r.last_name' } }], true);
    } });
  assert.equal(turns, 2); assert.equal(saves, 1); assert.equal(opened, 1); assert.equal(inputs, 2); assert.equal(backgroundInputs, 0);
  assert.equal(calls.filter(row => row.name === 'browser_click').length, 1); assert.equal(calls.filter(row => row.name === 'browser_fill').length, 2); assert.equal(calls.filter(row => row.name === 'browser_assert').length, 2);
  assert.ok(calls.length - 2 <= 12, 'the same twelve-call allowance covers the new dialog and both value proofs');
  assert.match(result.steps[0].automation_code, /@r\.first_name/); assert.match(result.steps[0].automation_code, /@r\.last_name/); assert.doesNotMatch(result.steps[0].automation_code, /Fixture first|Fixture last|#background/);
});
