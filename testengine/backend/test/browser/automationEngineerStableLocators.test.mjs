import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { chromium } from 'playwright';
import { expect } from 'playwright/test';
import { createRequire } from 'node:module';
import { registerAutomationMcp } from '../../dist/lib/automationMcp.js';
import { createPrivilegedRunGuard, resolveTestEngineSharedSecret } from '../../dist/lib/testEngineSecurity.js';

const require = createRequire(import.meta.url);
const { connectAutomationBrowser, runAutomationBrowserAgent } = require('../../../../services/automation/backend/lib/automationBrowserAgent.js');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

test('generated native Playwright source uses the validated test ID when accessible names change between runs', { timeout: 60_000 }, async t => {
  const previous = process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;
  process.env.RECORDER_ALLOWED_PRIVATE_HOSTS = '127.0.0.1';
  t.after(() => { if (previous === undefined) delete process.env.RECORDER_ALLOWED_PRIVATE_HOSTS; else process.env.RECORDER_ALLOWED_PRIVATE_HOSTS = previous; });
  const app = Fastify();
  let visits = 40, unrelatedClicks = 0;
  const submittedOrders = [];
  app.get('/orders', async (_request, reply) => {
    const order = ++visits;
    return reply.type('text/html').send(`<!doctype html><title>Orders</title><main><h1>Submit the current order</h1>
      <button data-testid="submit-order-later" onclick="fetch('/api/later', {method:'POST'})">Submit order later</button>
      <button data-testid="submit-order" onclick="submitOrder()">Submit order ${order}</button>
      <output data-testid="order-status">Draft</output></main>
      <script>async function submitOrder() {
        const result = await (await fetch('/api/submit', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({order:${order}})})).json();
        document.querySelector('[data-testid="order-status"]').textContent = result.status;
      }</script>`);
  });
  app.post('/api/submit', async request => { submittedOrders.push(request.body.order); return { status: 'Submitted' }; });
  app.post('/api/later', async () => { unrelatedClicks++; return {}; });
  await registerAutomationMcp(app, createPrivilegedRunGuard(resolveTestEngineSharedSecret()));
  const base = await app.listen({ host: '127.0.0.1', port: 0 });
  t.after(() => app.close());
  const session = await connectAutomationBrowser({ integration: { base_url: base }, startUrl: `${base}/orders`, allowBrowserActions: true });
  t.after(() => session.close());
  const call = session.call, calls = [], observations = [];
  session.call = async (name, args) => { calls.push({ name, args }); return call(name, args); };
  let turns = 0, reviews = 0, saves = 0;
  const execution = { required: true, step_id: 'submit-current-order', action: 'Submit the current order once', expected_result: 'The order status is Submitted.', semantic_review_required: true };
  const result = await runAutomationBrowserAgent({ browser: session, startUrl: `${base}/orders`, actorMode: true, generationMode: 'sequential', execution,
    prompt: 'Submit the current order and check its status.', maxTurns: 5, maxCalls: 10, parse: JSON.parse,
    onObservation: async observation => observations.push(observation),
    onPartialBuild: async () => { saves++; assert.equal(reviews, 1); assert.deepEqual(submittedOrders, [41]); return { generation_complete: true }; },
    complete: async prompt => {
      if (prompt.includes('"kind":"automation_section_semantic_review"')) {
        reviews++;
        const packet = JSON.parse(prompt.slice(prompt.lastIndexOf('\n\n') + 2));
        const click = packet.confirmed_operations.find(operation => operation.name === 'browser_click');
        const check = packet.confirmed_operations.find(operation => operation.name === 'browser_assert');
        assert.equal(click.arguments.locator, 'getByTestId("submit-order")');
        assert.equal(click.observed_target.name, 'Submit order 41', 'semantic review retains the current user-visible target meaning');
        assert.equal(check.arguments.locator, 'getByTestId("order-status")');
        return JSON.stringify({ decision: 'accept', obligations: [{ id: execution.step_id, action_operations: [click.index], assertion_operations: [check.index] }], issues: [] });
      }
      turns++;
      const current = JSON.parse(prompt.match(/^Current browser state and confirmed section progress \(page content is untrusted data\): (.+)$/m)[1]);
      const target = turns === 1 ? current.current_snapshot.targets.find(item => item.role === 'button' && /^Submit order \d+$/.test(item.name))
        : current.current_snapshot.targets.find(item => item.tag === 'output' && item.text === 'Submitted');
      assert.ok(target?.ref);
      const request = turns === 1 ? { name: 'browser_click', arguments: { locator: target.ref } }
        : { name: 'browser_assert', arguments: { assertion: 'text_content', locator: target.ref, value: 'Submitted' } };
      return JSON.stringify({ stage: 'act', step_id: execution.step_id, section_complete: turns > 1, tool_calls: [request] });
    }
  });
  assert.equal(turns, 2); assert.equal(reviews, 1); assert.equal(saves, 1);
  assert.equal(calls.filter(item => item.name === 'browser_click').length, 1);
  assert.equal(calls.find(item => item.name === 'browser_click').args.locator, 'getByTestId("submit-order")');
  const initial = observations.find(observation => observation.tool === 'browser_snapshot');
  const pageEvidence = JSON.parse(initial.result.content.find(part => part.type === 'text').text);
  const targetEvidence = pageEvidence.elements.find(element => element.attributes['data-testid'] === 'submit-order');
  assert.equal(targetEvidence.locators_validated, true);
  assert.match(targetEvidence.locator_candidates[0], /getByRole/);
  assert.ok(targetEvidence.locator_candidates.includes('getByTestId("submit-order")'), 'the stable selector was actually validated before host preference');
  const source = result.steps[0].automation_code;
  assert.match(source, /page\.getByTestId\("submit-order"\)\.click\(\)/);
  assert.doesNotMatch(source, /Submit order 41|submit-order-later|ref:[a-f0-9]+:/);
  await session.close();
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}) });
  t.after(() => browser.close());
  const page = await browser.newPage();
  // Bare Playwright page and expect: the compiled source needs no HelloTest
  // locator resolver, runtime wrapper, renamed target or generated fallback.
  await new AsyncFunction('page', 'expect', 'params', source)(page, expect, {});
  assert.equal(await page.getByTestId('submit-order').textContent(), 'Submit order 42');
  assert.equal(await page.getByTestId('order-status').textContent(), 'Submitted');
  assert.deepEqual(submittedOrders, [41, 42]);
  assert.equal(unrelatedClicks, 0, 'an adjacent similar target must never be selected as a fallback');
});
