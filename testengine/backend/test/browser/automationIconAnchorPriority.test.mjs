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
const html = '<!doctype html><title>Large employee workspace fixture</title><header>'
  + Array.from({ length: 56 }, (_, index) => {
    const name = `Navigation destination ${index} ` + 'navigation description '.repeat(7);
    return `<a id="navigation-${index}" aria-label="${name}" title="${name}" href="/destination/${index}" style="position:fixed;left:${10 + index % 8 * 140}px;top:${Math.floor(index / 8) * 13}px;width:120px;height:12px;overflow:hidden"><span>${name}</span></a>`;
  }).join('') + '</header>' + '<div></div>'.repeat(1700)
  + '<main><a id="addEmployeeButton" style="position:fixed;right:40px;top:105px;width:24px;height:24px;cursor:pointer" onclick="fetch(\'/added\',{method:\'POST\'}).then(()=>{const heading=document.createElement(\'h1\');heading.textContent=\'Employee form ready\';document.body.append(heading)})"><i>add</i></a></main>'
  + '<div></div>'.repeat(600);

test('64KB root capture preserves a late visible icon anchor with its actual role and same-native-node locator proof', { timeout: 30000 }, async t => {
  const app = Fastify(); app.get('/large', async (_request, reply) => reply.type('text/html').send(html));
  const base = await app.listen({ host: '127.0.0.1', port: 0 });
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}) });
  t.after(async () => { await browser.close(); await app.close(); });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }); await page.goto(base + '/large');
  const before = await page.content(), position = await page.locator('#addEmployeeButton').boundingBox();
  assert.ok(position && position.x >= 0 && position.x + position.width <= 1280 && position.y < 720);
  const subjects = new AutomationObservedSubjects(); await subjects.beginSnapshot();
  const snapshot = await captureAutomationBrowserSnapshot(page, undefined, Date.now() + 10000, subjects);
  assert.equal(snapshot.limits.response_bytes, 65536); assert.ok(Buffer.byteLength(JSON.stringify(snapshot)) <= 65536);
  assert.ok(snapshot.scanned_elements >= 57 && snapshot.scanned_elements <= 2000); assert.equal(snapshot.elements_truncated, true, 'the real response reached its evidence bounds');
  assert.ok(Buffer.byteLength(JSON.stringify(snapshot)) > 60000, 'the fixture exercises the64KB pruning boundary');
  const icon = snapshot.elements.find(row => row.attributes?.id === 'addEmployeeButton'); assert.ok(icon, 'late visible no-href anchor survives before header links');
  assert.equal(icon.tag, 'a'); assert.equal(icon.attributes.href, undefined); assert.equal(icon.attributes.role, undefined); assert.equal(icon.accessible_role, undefined);
  assert.equal(icon.displayed, true); assert.equal(icon.in_viewport, true); assert.equal(icon.locators_validated, true); assert.ok(icon.locator_candidates.includes('#addEmployeeButton'));
  const handle = await subjects.resolve(page, '#addEmployeeButton', Date.now() + 1000);
  assert.equal(await handle.evaluate(node => node === document.getElementById('addEmployeeButton')), true);
  assert.ok(snapshot.elements.some(row => row.attributes?.href && row.accessible_role === 'link'), 'native href anchors retain observed link semantics');
  assert.equal(await page.content(), before, 'capture and grounding do not mutate native DOM attributes or roles');
  await subjects.clear();
});

test('real host actor can assert and click the retained icon anchor exactly once within its original call allowance', { timeout: 60000 }, async t => {
  const previous = process.env.RECORDER_ALLOWED_PRIVATE_HOSTS; process.env.RECORDER_ALLOWED_PRIVATE_HOSTS = '127.0.0.1';
  t.after(() => { if (previous === undefined) delete process.env.RECORDER_ALLOWED_PRIVATE_HOSTS; else process.env.RECORDER_ALLOWED_PRIVATE_HOSTS = previous; });
  const app = Fastify(); let additions = 0;
  app.get('/large', async (_request, reply) => reply.type('text/html').send(html));
  app.post('/added', async () => { additions++; return { ok: true }; });
  await registerAutomationMcp(app, async () => {}); const base = await app.listen({ host: '127.0.0.1', port: 0 }); t.after(() => app.close());
  const browser = await connectAutomationBrowser({ integration: { base_url: base }, startUrl: base + '/large', allowBrowserActions: true }); t.after(() => browser.close());
  browser.tools = browser.tools.filter(tool => tool.name !== 'browser_screenshot');
  const calls = [], original = browser.call; browser.call = async (name, args, ...rest) => { calls.push({ name, args }); return original(name, args, ...rest); };
  let turns = 0, saves = 0;
  const action = 'Click the Add control';
  const result = await runAutomationBrowserAgent({ browser, startUrl: base + '/large', actorMode: true, parse: JSON.parse, prompt: 'Use the observed Add icon control to open the employee form once.', maxTurns: 4, maxCalls: 12,
    execution: { required: true, step_id: 'add', action, expected_result: 'Employee form ready is visible.', source_obligations: [{ id: 'add', action }] },
    onPartialBuild: async payload => { saves++; assert.equal(inspectExecutablePlan(payload.steps).length, 0); return { generation_complete: true }; },
    complete: async prompt => {
      turns++; const snapshot = JSON.parse(prompt.match(/^Current browser state and confirmed section progress .*?: (.+)$/m)[1]).current_snapshot;
      const envelope = (tool_calls, section_complete = false) => JSON.stringify({ stage: 'act', step_id: 'add', section_complete, tool_calls });
      if (turns === 1) {
        const icon = snapshot.targets.find(row => row.tag === 'a' && row.text === 'add'); assert.ok(icon, 'root snapshot exposes the real native icon target'); assert.equal(icon.role, undefined);
        return envelope([{ name: 'browser_assert', arguments: { assertion: 'visible', locator: icon.ref } }, { name: 'browser_click', arguments: { locator: icon.ref } }]);
      }
      if (turns === 2) return envelope([{ name: 'browser_snapshot', arguments: { locator: 'getByText("Employee form ready", {exact:true})' } }]);
      assert.equal(turns, 3); const ready = snapshot.targets.find(row => row.name === 'Employee form ready'); assert.ok(ready);
      return envelope([{ name: 'browser_assert', arguments: { assertion: 'visible', locator: ready.ref } }], true);
    } });
  assert.equal(saves, 1); assert.equal(turns, 3); assert.equal(additions, 1); assert.equal(calls.filter(row => row.name === 'browser_click').length, 1);
  assert.ok(calls.filter(row => row.name !== 'browser_screenshot').length - 2 <= 12, 'bootstrap is outside the unchanged section allowance');
  assert.match(result.steps[0].automation_code, /locator\("#addEmployeeButton"\)/); assert.equal((result.steps[0].automation_code.match(/\.click\(/g) || []).length, 1);
  assert.doesNotMatch(result.steps[0].automation_code, /getByRole\("button"/);
});
