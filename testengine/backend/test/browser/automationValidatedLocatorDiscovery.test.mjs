import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import Fastify from 'fastify';
import { registerAutomationMcp } from '../../dist/lib/automationMcp.js';
const require = createRequire(import.meta.url);
const { connectAutomationBrowser, runAutomationBrowserAgent } = require('../../../../services/automation/backend/lib/automationBrowserAgent.js');
const { inspectExecutablePlan } = require('../../../../services/automation/backend/services/automationReadiness.service.js');
const html = hidden => '<!doctype html><title>Partial target fixture</title>' + Array.from({ length: 130 }, (_, index) => `<input aria-label="Earlier field ${index}" style="position:fixed;left:${index % 13 * 50}px;top:${Math.floor(index / 13) * 20}px;width:40px;height:15px">`).join('')
  + `<a id="addEmployeeButton" style="position:fixed;left:700px;top:105px;width:25px;height:25px;${hidden ? 'display:none' : ''}"><i>add</i></a>`;
test('real validation count obtains native scoped aliases without proving visibility or dispatching an action', { timeout: 90000 }, async t => {
  const previous = process.env.RECORDER_ALLOWED_PRIVATE_HOSTS; process.env.RECORDER_ALLOWED_PRIVATE_HOSTS = '127.0.0.1';
  t.after(() => { if (previous === undefined) delete process.env.RECORDER_ALLOWED_PRIVATE_HOSTS; else process.env.RECORDER_ALLOWED_PRIVATE_HOSTS = previous; });
  const app = Fastify(); app.get('/late', async (_req, reply) => reply.type('text/html').send(html(false))); app.get('/hidden', async (_req, reply) => reply.type('text/html').send(html(true)));
  app.get('/shell', async (_req, reply) => reply.type('text/html').send('<!doctype html><title>Outer fixture</title><button>Parent control</button><iframe id="child" src="/late" style="width:1100px;height:500px"></iframe>'));
  await registerAutomationMcp(app, async () => {}); const base = await app.listen({ host: '127.0.0.1', port: 0 }); t.after(() => app.close());
  for (const mode of ['main', 'frame', 'hidden']) await t.test(mode, async () => {
    const browser = await connectAutomationBrowser({ integration: { base_url: base }, startUrl: base + (mode === 'frame' ? '/shell' : mode === 'hidden' ? '/hidden' : '/late'), allowBrowserActions: true });
    try {
      browser.tools = browser.tools.filter(tool => tool.name !== 'browser_screenshot'); browser.projectPromptText = value => value;
      await browser.call('browser_navigate', { url: browser.startUrl }); const root = await browser.call('browser_snapshot', {});
      const initial = mode === 'frame' ? await browser.call('browser_snapshot', { frame: ['#child'] }) : root;
      const nativePage = JSON.parse(initial.content.find(row => row.type === 'text').text); assert.ok(nativePage.partial||nativePage.truncated); assert.equal(nativePage.elements.some(row => row.attributes?.id === 'addEmployeeButton'), false, 'the root evidence really omits the late target');
      const calls = [], observations = [], original = browser.call; browser.call = async (name, args, ...rest) => { calls.push({ name, args: structuredClone(args) }); return original(name, args, ...rest); };
      let actors = 0, reviews = 0, saves = 0;
      const goal = { id: 'current', source: 'section', action: 'Verify the Add control is visible.', expected_result: 'The Add control is visible.' };
      const run = runAutomationBrowserAgent({ browser, actorMode: true, parse: JSON.parse, prompt: 'Verify only the authored Add visibility.', maxTurns: 2, maxCalls: 12,
        execution: { required: true, step_id: 'current', action: goal.action, expected_result: goal.expected_result, source_obligations: [goal], obligations: [goal], semantic_review_required: true },
        initialObservations: [{ tool: 'browser_snapshot', execution_step_id: 'current', result: initial }], onObservation: row => observations.push(row), onPartialBuild: async payload => { saves++; assert.equal(inspectExecutablePlan(payload.steps).length, 0); return { generation_complete: true }; },
        complete: async prompt => {
          if (prompt.includes('"kind":"automation_section_semantic_review"')) { reviews++; assert.equal(saves, 0); const packet = JSON.parse(prompt.split('\n').at(-1)); return JSON.stringify({ decision: 'accept', obligations: packet.obligations.map(row => ({ id: row.id, action_operations: [], assertion_operations: [1] })), issues: [] }); }
          actors++; const current = JSON.parse(prompt.match(/^Current browser state and confirmed section progress .*?: (.+)$/m)[1]).current_snapshot;
          const envelope = (tool_calls, section_complete = false) => JSON.stringify({ stage: 'act', step_id: 'current', section_complete, tool_calls });
          if (actors === 1) return envelope([{ name: 'browser_validate_locator', arguments: { locator: '#addEmployeeButton' } }, { name: 'browser_assert', arguments: { assertion: 'visible', locator: '#addEmployeeButton' } }]);
          assert.equal(actors, 2); assert.deepEqual(calls.map(row => row.name), ['browser_validate_locator', 'browser_snapshot']); assert.equal(current.scope, '#addEmployeeButton');
          const target = current.targets.find(row => row.tag === 'a' && row.text === 'add'); assert.ok(target); assert.equal(target.visible, mode !== 'hidden'); assert.equal(target.role, undefined);
          if (mode === 'frame') assert.deepEqual(current.frame_path, ['#child']);
          return envelope([{ name: 'browser_assert', arguments: { assertion: 'visible', locator: target.ref } }], true);
        } });
      if (mode === 'hidden') { await assert.rejects(run, error => error.code === 'AUTOMATION_BROWSER_EXECUTION_INCOMPLETE' || error.code === 'AUTOMATION_BROWSER_MODEL_BUDGET_EXHAUSTED'); assert.equal(saves, 0); assert.equal(reviews, 0);
        assert.ok(observations.some(row => row.tool === 'browser_assert' && row.result.isError)); }
      else { const result = await run; assert.equal(saves, 1); assert.equal(reviews, 1); assert.match(result.steps[0].automation_code, /toBeVisible/); }
      assert.equal(calls.filter(row => row.name === 'browser_snapshot' && row.args.locator === '#addEmployeeButton').length, 1);
      assert.equal(calls.filter(row => row.name === 'browser_assert').length, 1); assert.equal(calls.filter(row => ['browser_click', 'browser_fill', 'browser_navigate'].includes(row.name)).length, 0);
      assert.ok(calls.length<=12,'native discovery and assertion retain the original call allowance');
      if (mode === 'frame') assert.ok(calls.every(row => JSON.stringify(row.args.frame) === '["#child"]'));
    } finally { await browser.close(); }
  });
});
