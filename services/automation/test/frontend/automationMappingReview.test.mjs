import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveStepAutomationCode, stepAutomationReviewIssues } from '../../frontend/lib/stepAutomation.ts';

const step = runtime => ({ step_order: 1, step_type: runtime, action: 'Enter the account', expected_result: 'Account is retained', automation_code: '', api_request: null });
test('unmapped browser and native actions produce structured repository review work without fabricated executable programs', () => {
  for (const runtime of ['web', 'android', 'ios']) {
    const input = step(runtime), issues = stepAutomationReviewIssues(input);
    assert.equal(resolveStepAutomationCode(input), '');assert.equal(issues.length, 1);
    assert.equal(issues[0].runtime, runtime);assert.equal(issues[0].kind, 'repository_review');assert.equal(issues[0].severity, 'blocking');
    assert.ok(issues[0].message.length > 20);
  }
});
test('API source preview requires a request contract and never manufactures a missing HTTP 200 assertion', () => {
  const empty = step('api');assert.equal(resolveStepAutomationCode(empty), '');assert.equal(stepAutomationReviewIssues(empty)[0].code, 'api_contract_required');
  const input = { ...empty, api_request: { method: 'POST', url: 'https://api.example.test/items', validations: [], captures: [] } };
  assert.deepEqual(stepAutomationReviewIssues(input), []);assert.match(resolveStepAutomationCode(input), /api\.request/);
  assert.doesNotMatch(resolveStepAutomationCode(input), /toBe\(200\)|TODO/);
  assert.match(resolveStepAutomationCode({ ...input, api_request: { ...input.api_request, validations: [{ kind: 'status', expected: '201' }] } }), /201/);
});
test('saved source remains authoritative and is preserved verbatim during review projection', () => {
  const input = { ...step('web'), automation_code: 'await page.getByLabel("Account", {exact:true}).fill("@t.account");' };
  assert.equal(resolveStepAutomationCode(input), input.automation_code);assert.deepEqual(stepAutomationReviewIssues(input), []);
});
