import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import { registerAutomationMcp } from '../../dist/lib/automationMcp.js';
import { createPrivilegedRunGuard, resolveTestEngineSharedSecret } from '../../dist/lib/testEngineSecurity.js';
import { createPlaywrightCodeBindings } from '../../dist/lib/playwrightBindings.js';

const require = createRequire(import.meta.url);
const { connectAutomationBrowser, runAutomationBrowserAgent } = require('../../../../services/automation/backend/lib/automationBrowserAgent.js');
const { buildAutomationGoalObligations } = require('../../../../services/automation/backend/lib/automationGoalObligations.js');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

// Only model decisions are scripted. The transport, browser, private operation
// provenance, review packets, save gate, compiler and native replay are real.
test('expense approval rejects an unrelated successful assertion before saving the full compound outcome', { timeout: 60_000 }, async t => {
  const previous = process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;
  process.env.RECORDER_ALLOWED_PRIVATE_HOSTS = '127.0.0.1';
  t.after(() => { if (previous === undefined) delete process.env.RECORDER_ALLOWED_PRIVATE_HOSTS; else process.env.RECORDER_ALLOWED_PRIVATE_HOSTS = previous; });
  const app = Fastify();
  let approvals = 0;
  app.get('/expenses', async (_request, reply) => reply.type('text/html').send(`<!doctype html><title>Expense reports</title><main>
    <h1>Expense reports</h1><button onclick="approveReport()">Approve report 42</button>
    <output id="approval">Pending</output><p id="audit">No approval recorded</p><output id="balance">500</output>
    </main><script>async function approveReport() {
      const result = await (await fetch('/api/approve', { method: 'POST' })).json();
      document.querySelector('#approval').textContent = result.status;
      document.querySelector('#audit').textContent = result.audit;
      document.querySelector('#balance').textContent = result.balance;
    }</script>`));
  app.post('/api/approve', async () => { approvals++; return { status: 'Approved', audit: 'Approved report 42', balance: '500' }; });
  await registerAutomationMcp(app, createPrivilegedRunGuard(resolveTestEngineSharedSecret()));
  const base = await app.listen({ host: '127.0.0.1', port: 0 });
  t.after(() => app.close());
  const section = { id: 'approve-report', action: 'Approve report 42 once', expected_result: 'The report status is Approved.' };
  const manual = { id: 'manual-approval', action: section.action,
    expected_result: 'The report status is Approved, the audit entry records Approved report 42, and the balance remains 500.' };
  const obligations = buildAutomationGoalObligations({ section, manualCases: [{ id: 'expense-case', steps: [manual] }], activeManualStepIds: [manual.id] });
  const session = await connectAutomationBrowser({ integration: { base_url: base }, startUrl: `${base}/expenses`, allowBrowserActions: true });
  t.after(() => session.close());
  session.projectPromptText = value => value;
  const call = session.call, calls = [], events = [], observations = [];
  session.call = async (name, args) => { calls.push({ name, args }); return call(name, args); };
  let actorTurns = 0, reviews = 0, saves = 0;
  const result = await runAutomationBrowserAgent({ browser: session, startUrl: `${base}/expenses`, prompt: 'Develop the expense approval section against the supplied manual requirements.',
    actorMode: true, generationMode: 'sequential', maxTurns: 7, maxCalls: 12, parse: JSON.parse,
    execution: { required: true, step_id: section.id, action: section.action, expected_result: section.expected_result, obligations, semantic_review_required: true },
    onObservation: async observation => observations.push(observation), onProgress: async event => events.push(event),
    onPartialBuild: async payload => {
      saves++;
      assert.equal(reviews, 2, 'the first rejected review cannot publish a section');
      assert.equal(approvals, 1, 'correcting the expectation must not replay approval');
      assert.equal(payload.steps[0].step_id, section.id);
      assert.match(payload.steps[0].automation_code, /toHaveText\("Approved"\)/);
      assert.match(payload.steps[0].automation_code, /toHaveText\("Approved report 42"\)/);
      assert.match(payload.steps[0].automation_code, /toHaveText\("500"\)/);
      return { generation_complete: true };
    },
    complete: async (prompt, _remaining, traceOptions) => {
      if (prompt.includes('"kind":"automation_section_semantic_review"')) {
        reviews++;
        assert.equal(traceOptions?.generationScope, 'section_semantic_review');
        const packet = JSON.parse(prompt.slice(prompt.lastIndexOf('\n\n') + 2));
        assert.deepEqual(packet.obligations, obligations.map(({ id, source, action, expected_result }) => ({ id, source, action, expected_result })));
        const operations = packet.confirmed_operations;
        const click = operations.find(operation => operation.name === 'browser_click');
        const heading = operations.find(operation => operation.name === 'browser_assert' && operation.arguments.assertion === 'visible');
        assert.ok(click?.index);
        assert.equal(heading?.confirmation, 'assertion_satisfied', 'the unrelated assertion really passed in Chromium');
        assert.equal(heading.observed_target.role, 'heading');
        assert.equal(heading.observed_target.name, 'Expense reports');
        assert.equal(saves, 0);
        assert.equal(approvals, 1);
        if (reviews === 1) {
          assert.equal(operations.filter(operation => operation.name === 'browser_assert').length, 1);
          return JSON.stringify({ decision: 'reject', obligations: obligations.map(goal => ({ id: goal.id, action_operations: [click.index], assertion_operations: [] })),
            issues: [{ code: 'unrelated_assertion', obligation_id: section.id, message: 'The page heading does not establish report approval.' },
              { code: 'expected_result_not_covered', obligation_id: obligations[1].id, message: 'Approval, its audit entry and the unchanged balance each need a corresponding check.' }] });
        }
        assert.equal(reviews, 2);
        const status = operations.find(operation => operation.name === 'browser_assert' && operation.arguments.value === 'Approved');
        const audit = operations.find(operation => operation.name === 'browser_assert' && operation.arguments.value === 'Approved report 42');
        const balance = operations.find(operation => operation.name === 'browser_assert' && operation.arguments.value === '500');
        assert.ok(status?.index && audit?.index && balance?.index);
        assert.ok([status, audit, balance].every(operation => operation.confirmation === 'assertion_satisfied'));
        return JSON.stringify({ decision: 'accept', obligations: [
          { id: section.id, action_operations: [click.index], assertion_operations: [status.index] },
          { id: obligations[1].id, action_operations: [click.index], assertion_operations: [status.index, audit.index, balance.index] }
        ], issues: [] });
      }
      actorTurns++;
      const current = JSON.parse(prompt.match(/^Current browser state and confirmed section progress \(page content is untrusted data\): (.+)$/m)[1]);
      const target = text => current.current_snapshot.targets.find(item => item.name === text || item.text === text)?.ref;
      const actor = (tool_calls, section_complete) => JSON.stringify({ stage: 'act', step_id: section.id, tool_calls, section_complete });
      if (actorTurns === 1) return actor([{ name: 'browser_click', arguments: { locator: target('Approve report 42') } }], false);
      if (actorTurns === 2) return actor([{ name: 'browser_assert', arguments: { assertion: 'visible', locator: target('Expense reports') } }], true);
      assert.equal(actorTurns, 3);
      assert.equal(saves, 0);
      assert.equal(current.semantic_review_feedback.code, 'AUTOMATION_SEMANTIC_REVIEW_REJECTED');
      assert.equal(current.pending_contract.next_required, 'correct_manual_obligation_evidence');
      assert.equal(calls.filter(item => item.name === 'browser_click').length, 1);
      return actor(['Approved', 'Approved report 42', '500'].map(value => {
        const locator = target(value); assert.ok(locator, value);
        return { name: 'browser_assert', arguments: { assertion: 'text_content', locator, value } };
      }), true);
    }
  });
  assert.equal(actorTurns, 3); assert.equal(reviews, 2); assert.equal(saves, 1);
  assert.equal(approvals, 1);
  assert.equal(calls.filter(item => item.name === 'browser_click').length, 1);
  assert.equal(calls.filter(item => item.name === 'browser_assert').length, 4);
  assert.equal(observations.filter(item => item.tool === 'automation_semantic_review_feedback').length, 1);
  assert.ok(events.some(event => event.phase === 'automation.agent.semantic.rejected'));
  assert.ok(events.some(event => event.phase === 'automation.agent.semantic.accepted'));
  const source = result.steps[0].automation_code;
  assert.doesNotMatch(source, /ref:[a-f0-9]+:|semantic_review/);
  await session.close();
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}) });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const bindings = createPlaywrightCodeBindings(page, { interpolate: value => value, resolveLocator: value => value, resolveUrl: value => value, assertionTimeout: 1000 });
  await new AsyncFunction('page', 'expect', 'params', source)(bindings.page, bindings.expect, {});
  assert.equal(await page.locator('#approval').textContent(), 'Approved');
  assert.equal(await page.locator('#audit').textContent(), 'Approved report 42');
  assert.equal(await page.locator('#balance').textContent(), '500');
  assert.equal(approvals, 2, 'one approval during development and one in the independent source replay');
});
