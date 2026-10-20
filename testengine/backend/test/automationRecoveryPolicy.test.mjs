import test from 'node:test';
import assert from 'node:assert/strict';
import { automationRecoveryDecision, inspectReadOnlyAutomationProgram, transientReadFailure } from '../dist/lib/automationRecoveryPolicy.js';

const source = 'const status = page.getByRole("status");\nawait expect(status).toHaveText("Completed");';
const timeout = () => Object.assign(new Error('Timed out 200ms waiting for expect(locator).toHaveText(expected)'), { name: 'TimeoutError' });
const decide = overrides => automationRecoveryDecision({ source, error: timeout(), requestedAttempts: 2, completedRetries: 0, assertionTimeoutMs: 200, recoveryWaitMs: 100, remainingMs: 10_000, ...overrides });

test('bounded retries require a complete read-only assertion program and enough run time', () => {
  assert.deepEqual(inspectReadOnlyAutomationProgram(source, 200), { assertion_count: 1, maximum_wait_ms: 200 });
  assert.deepEqual(decide(), { retry: true, reason: 'read_only_assertion_timeout', delay_ms: 100, limit: 2 });
  assert.equal(decide({ requestedAttempts: 200 }).limit, 2);
  assert.equal(decide({ recoveryWaitMs: 30_000 }).delay_ms, 5_000);
  assert.equal(decide({ completedRetries: 1 }).delay_ms, 200);
  for (const requestedAttempts of [0, -1, NaN, Infinity]) assert.equal(decide({ requestedAttempts }).reason, 'disabled');
  assert.equal(decide({ completedRetries: 2 }).reason, 'retry_limit_reached');
  assert.equal(decide({ remainingMs: 299 }).reason, 'run_budget_exhausted');
  assert.equal(decide({ stopped: true }).reason, 'run_stopped');
  assert.equal(decide({ source: 'await expect(page.locator("output")).toHaveText("Done", { timeout: 2_000 });', remainingMs: 2_050 }).reason, 'run_budget_exhausted');
});

test('safe locator aliases, parameter values, native matcher options and simple polling reads retain timeout bounds', () => {
  for (const script of [
    'await expect(page.getByLabel("Email", { exact: true })).toHaveValue(params["t.email"]);',
    'const items = page.locator("li"); const last = items.last(); await expect(last).not.toHaveText(/Loading/);',
    'await expect.poll(() => page.url(), { timeout: 750 }).toContain("/done");',
    'await expect.poll(async () => await playwrightPage.title()).toBe("Complete");',
    'await expect(page).toHaveURL(/done/); await expect(page.locator("output")).toHaveText("Done", { timeout: 250 });'
  ]) assert.ok(inspectReadOnlyAutomationProgram(script, 200), script);
  assert.deepEqual(inspectReadOnlyAutomationProgram('await expect.poll(() => page.url(), { timeout: 750 }).toContain("/done");', 200), { assertion_count: 1, maximum_wait_ms: 750 });
  assert.deepEqual(inspectReadOnlyAutomationProgram('await expect(page).toHaveURL(/done/); await expect(page.locator("output")).toHaveText("Done", { timeout: 250 });', 200), { assertion_count: 2, maximum_wait_ms: 450 });
});

test('mutations, captures, navigation and hidden or dynamic work never grant a complete-section replay', () => {
  for (const script of [
    'await page.locator("button").click();\n' + source,
    'await page.locator("input").fill("data");\n' + source,
    'await page.goto("/");\n' + source,
    'capture("t.result", "Done");\n' + source,
    'const action = page.locator("button"); await action.click();\n' + source,
    'const value = await page.locator("output").textContent();\n' + source,
    'await expect(page.locator(selector())).toHaveText("Done");',
    'await expect(page.locator("output")).toHaveText(makeValue());',
    'await expect(page.locator("output")).toHaveText("Done", { get timeout() { changeApplication(); return 200; } });',
    'await expect.poll(() => page.evaluate(() => fetch("/submit"))).toBe(true);',
    'await expect.poll(() => { submit(); return page.url(); }).toContain("/done");',
    'const page = otherPage;\n' + source,
    'let target = page.locator("output"); await expect(target).toHaveText("Done");',
    'await expect(page.locator("output")).toHaveText("Done", { timeout: 0 });',
    'await expect(page.locator("output")).toHaveText("Done", { timeout: params["t.timeout"] });',
    source + '\nthrow new Error("retry me");',
    source.repeat(251),
    '{'
  ]) assert.equal(decide({ source: script }).reason, 'section_not_read_only', script.slice(0, 300));
});

test('lost authority, cancellation, unknown outcomes and permanent source/selector errors remain terminal', () => {
  for (const error of [
    Object.assign(timeout(), { name: 'AbortError' }), Object.assign(timeout(), { name: 'TypeError' }),
    Object.assign(timeout(), { statusCode: 403 }), Object.assign(timeout(), { code: 'BATCH_JOB_LEASE_LOST' }),
    Object.assign(timeout(), { code: 'BROWSER_NETWORK_POLICY_DENIED' }), Object.assign(timeout(), { code: 'BROWSER_TOOL_INVALID_ARGUMENTS' }),
    Object.assign(timeout(), { action_outcome: 'unknown' }), Object.assign(timeout(), { retry_safe: false }),
    Object.assign(timeout(), { nonRetryable: true }), Object.assign(timeout(), { message: 'strict mode violation: Timeout: 200ms' }),
    Object.assign(timeout(), { message: 'Target page, context or browser has been closed' }),
    new Error('The expected result cannot be executed as an instruction.'), new Error('Unexpected token: invalid selector'),
    new Error('Expected Completed but received Declined')
  ]) {
    assert.equal(transientReadFailure(error), false, error.message);
    assert.equal(decide({ error }).reason, 'non_transient_failure');
  }
  assert.equal(transientReadFailure(Object.assign(new Error('expect(locator).toHaveText(expected) failed'), { matcherResult: { pass: false, timeout: 200 } })), true);
  assert.equal(transientReadFailure(new Error('Timeout: 200ms\nCall log: waiting for locator')), true);
});
