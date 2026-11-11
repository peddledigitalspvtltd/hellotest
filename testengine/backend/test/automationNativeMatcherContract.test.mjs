import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { assertAutomationAsyncOwnership } from '../dist/lib/automationAsyncOwnership.js';
import { inspectReadOnlyAutomationProgram } from '../dist/lib/automationRecoveryPolicy.js';

const require = createRequire(import.meta.url);
const { normalizeGeneratedProgram, hasExecutableAssertion, joinGeneratedAssertions, preserveGeneratedAssertions } = require('../../../services/automation/backend/lib/automationGeneratedProgram');
const { inspectExecutablePlan } = require('../../../services/automation/backend/services/automationReadiness.service');
const { stampObservation, reconcileAction } = require('../../../services/automation/backend/lib/automationActionReconciliation');
const argumentsByMatcher = {
  toBeAttached: '', toBeChecked: '', toBeDisabled: '', toBeEditable: '', toBeEmpty: '', toBeEnabled: '', toBeFocused: '', toBeHidden: '', toBeInViewport: '', toBeVisible: '',
  toContainClass: '"active"', toContainText: '"Ready"', toHaveAccessibleDescription: '"Search the catalog"', toHaveAccessibleErrorMessage: '"Enter a code"', toHaveAccessibleName: '"Search"',
  toHaveAttribute: '"data-state", "ready"', toHaveClass: '"active"', toHaveCount: '1', toHaveCSS: '"display", "block"', toHaveId: '"search"', toHaveJSProperty: '"value", ""',
  toHaveRole: '"searchbox"', toHaveText: '"Ready"', toHaveValue: '""', toHaveValues: '["one"]', toHaveTitle: '"Ready"', toHaveURL: '"https://fixture.test/"'
};

test('independently packaged CJS admission and TS runtime matcher catalogs stay identical to the pinned native contract',()=>{
 // Services and paired TestEngine ship independently. This contract check
 // prevents catalog drift without requiring either runtime to load the other
 // deployment's source tree or adding generated build-time copies.
 const matcherSet=(relative,name)=>{
  const source=fs.readFileSync(new URL(relative,import.meta.url),'utf8');
  const literal=new RegExp(`const\\s+${name}\\s*=\\s*new Set\\(\\s*(\\[[\\s\\S]*?\\])\\s*\\)`).exec(source)?.[1];
  assert.ok(literal,`Locate the declared ${name} contract in ${relative}`);
  return [...literal.matchAll(/['"](to[A-Z]\w*)['"]/g)].map(match=>match[1]).sort();
 };
 const native=Object.keys(argumentsByMatcher).sort();
 assert.deepEqual(matcherSet('../../../services/automation/backend/lib/automationGeneratedProgram.js','locatorMatchers'),native);
 assert.deepEqual(matcherSet('../src/lib/automationAsyncOwnership.ts','locatorMatchers'),native);
 assert.deepEqual(matcherSet('../src/lib/automationRecoveryPolicy.ts','matchers'),[...native,'toBe','toEqual','toContain','toMatch'].sort());
});

test('all pinned native locator/page matchers share source admission, action proof, promise ownership and read-only recovery contracts', () => {
  const types = fs.readFileSync(new URL('../node_modules/playwright/types/test.d.ts', import.meta.url), 'utf8');
  const methods = name => [...types.slice(types.indexOf(`interface ${name} {`), types.indexOf(`not: ${name};`)).matchAll(/^  (to[A-Z]\w*)\(/gm)].map(match => match[1]);
  const runnerOnly = new Set(['toMatchAriaSnapshot', 'toHaveScreenshot']);
  const nativeMethods = [...new Set([...methods('LocatorAssertions'), ...methods('PageAssertions')])].filter(name => !runnerOnly.has(name)).sort();
  assert.deepEqual(Object.keys(argumentsByMatcher).sort(), nativeMethods, 'A pinned Playwright upgrade must explicitly review every added or removed native matcher.');
  const request = { name: 'browser_click', arguments: { locator: '#continue' } };
  const proof = stampObservation({ tool: 'browser_click', execution_step_id: 'section', action_id: 'native-click',
    result: { content: [{ type: 'text', text: JSON.stringify({ source: 'playwright', action_outcome: 'completed' }) }] } }, request);
  for (const method of nativeMethods) {
    for (const polarity of ['', 'not.']) {
      const subject = ['toHaveTitle', 'toHaveURL'].includes(method) ? 'page' : 'page.locator("#search")';
      const detached = `expect(${subject}).${polarity}${method}(${argumentsByMatcher[method]});`;
      const source = `await ${detached}`;
      assert.equal(hasExecutableAssertion(source), true, source);
      assert.deepEqual(inspectExecutablePlan([{ id: 'section', step_order: 1, step_type: 'web', expected_result: 'The authored state holds.', automation_code: source }]), [], source);
      assert.throws(() => normalizeGeneratedProgram(detached), /promise/, detached);
      assert.equal(hasExecutableAssertion(detached), false, detached);
      assert.deepEqual(joinGeneratedAssertions(detached), { source, joined: 1 });
      assert.doesNotThrow(() => assertAutomationAsyncOwnership(source));
      assert.throws(() => assertAutomationAsyncOwnership(detached), /promise/, detached);
      assert.throws(() => assertAutomationAsyncOwnership(`const pending = ${detached}`), /retained browser promise/, detached);
      assert.deepEqual(inspectReadOnlyAutomationProgram(source, 200), { assertion_count: 1, maximum_wait_ms: 200 });
      const actionSource = `await page.locator("#continue").click();\n${source}`;
      assert.equal(inspectReadOnlyAutomationProgram(actionSource, 200), null, 'A valid new matcher cannot grant permission to repeat a click.');
      assert.equal(reconcileAction({ payload: { steps: [{ step_id: 'section', automation_code: actionSource }] }, execution: { required: true, step_id: 'section' }, request, observations: [proof] })?.action_id, 'native-click', method);
      const changed = source.replace(`.${polarity}${method}(`, `.${polarity ? '' : 'not.'}${method}(`);
      assert.throws(() => preserveGeneratedAssertions(source, changed), { code: 'AUTOMATION_GENERATED_ASSERTION_NOT_PRESERVED' });
    }
  }
  for (const matcher of [...runnerOnly, 'toMatchSnapshot']) {
    assert.throws(() => normalizeGeneratedProgram(`await expect(page.locator("#search")).${matcher}("baseline");`), { code: 'AUTOMATION_RUNNER_MATCHER_UNSUPPORTED' });
  }
});
