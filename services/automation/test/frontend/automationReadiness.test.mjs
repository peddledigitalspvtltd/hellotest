import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { parseApiRequestSource } from '../../frontend/lib/apiRequestSource.ts';
import { isAutomationStepMapped } from '../../frontend/lib/automationStepPersistence.ts';
import { assertAutomationDispatchAccepted, AutomationStartError, retrySavedAutomationRun, startRemoteAutomationRun, verifyCreatedAutomationRun } from '../../frontend/lib/automationRunDispatch.ts';

const lib = {};
const code = ts.transpileModule(fs.readFileSync(new URL('../../frontend/lib/automationReadiness.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
new Function('require', 'exports', code)(name => name.includes('apiRequestSource') ? { parseApiRequestSource } : { isAutomationStepMapped }, lib);
const item = { id: 'one', app_type_id: 'app', title: 'Checkout', automated: 'yes', status: 'active', revision: 3, automation_status: 'ready' };
const step = { id: 's1', test_case_id: 'one', step_order: 1, step_type: 'web', action: 'Open checkout', expected_result: 'Checkout is visible', automation_code: 'await page.goto("https://app.test");' };

test('run readiness uses saved executable plans, treats skips explicitly, and preserves source-hidden run roles', () => {
  assert.equal(lib.assessAutomationReadiness(item, [step]).ready, true);
  const blank = lib.assessAutomationReadiness(item, [{ ...step, automation_code: '// pending' }]);
  assert.equal(blank.ready, false); assert.match(blank.issues[0].message, /executable/);
  assert.equal(lib.assessAutomationReadiness(item, [{ ...step, automation_code: '' }], 'build').ready, true);
  assert.equal(lib.assessAutomationReadiness(item, [step], 'run', ['s1']).ready, false);
  assert.equal(lib.assessAutomationReadiness(item, [{ ...step, automation_code: '// @hellotest-options skip' }]).ready, false);
  assert.equal(lib.assessAutomationReadiness(item, [{ ...step, automation_code: '' }], 'run', [], false).ready, true);
  assert.equal(lib.assessAutomationReadiness({ ...item, automation_status: 'incomplete' }, [step], 'run', [], false).ready, false);
  assert.equal(lib.assessAutomationReadiness(item, []).ready, false);
  assert.equal(lib.assessAutomationReadiness({ ...item, automated: 'no' }, [step]).ready, false);
});

test('request readiness rejects malformed API requests and detects source changes without a case revision bump', () => {
  const api = { ...step, step_type: 'api', automation_code: '', api_request: { url: '/orders', method: 'FETCH' } };
  assert.equal(lib.assessAutomationReadiness(item, [api]).ready, false);
  assert.notEqual(lib.assessAutomationReadiness(item, [step]).planSignature, lib.assessAutomationReadiness(item, [{ ...step, automation_code: 'await page.reload();' }]).planSignature);
  assert.throws(() => lib.requireReadyAutomation([lib.assessAutomationReadiness(item, [api])]), /Checkout/);
});

test('preflight checks exact deduplicated targets and enforces application and step scope with bounded requests', async () => {
  const calls = []; let active = 0; let peak = 0;
  const reader = {
    getCase: async id => { calls.push(id); active++; peak = Math.max(peak, active); await new Promise(resolve => setTimeout(resolve, 5)); active--; return { ...item, id }; },
    getSteps: async id => [{ ...step, test_case_id: id }]
  };
  const results = await lib.inspectAutomationTargets(['one', 'one', 'two', 'three', 'four', 'five'], 'app', reader);
  assert.deepEqual(results.map(result => result.id), ['one', 'two', 'three', 'four', 'five']);
  assert.equal(calls.length, 5); assert.ok(peak <= 4);
  await assert.rejects(lib.inspectAutomationTargets([], 'app', reader), /Select/);
  await assert.rejects(lib.inspectAutomationTargets(['one'], 'other', reader), /outside/);
  await assert.rejects(lib.inspectAutomationTargets(['one'], 'app', { ...reader, getSteps: async () => [{ ...step, test_case_id: 'another' }] }), /outside/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(lib.inspectAutomationTargets(['one'], 'app', reader, 'run', [], controller.signal), /cancelled/);
});

test('remote start failures preserve the durable execution and retries start the same ID', async () => {
  const receipt = { id: 'saved-run', caseIds: ['one'], projectId: 'p', appTypeId: 'app', mode: 'remote' };
  let captured;
  await assert.rejects(startRemoteAutomationRun(receipt, async id => { assert.equal(id, 'saved-run'); throw new Error('Engine offline'); }), error => {
    captured = error; assert.ok(error instanceof AutomationStartError); assert.equal(error.receipt, receipt); return true;
  });
  const calls = [];
  const result = await startRemoteAutomationRun(captured.receipt, async id => calls.push(id));
  assert.deepEqual(calls, ['saved-run']); assert.equal(result, receipt);
});

test('recovery reads durable state and cannot start an execution twice after a lost successful response', async () => {
  const receipt = { id: 'saved-run', caseIds: ['one'], projectId: 'p', appTypeId: 'app', mode: 'remote' };
  let starts = 0;
  const alreadyStarted = await retrySavedAutomationRun(receipt, async id => ({ id, project_id: 'p', app_type_id: 'app', status: 'running' }), async () => { starts++; });
  assert.equal(alreadyStarted.alreadyStarted, true); assert.equal(starts, 0);
  const started = await retrySavedAutomationRun(receipt, async id => ({ id, project_id: 'p', app_type_id: 'app', status: 'queued' }), async () => { starts++; return { queued_for_engine_count: 1 }; });
  assert.equal(started.alreadyStarted, false); assert.equal(starts, 1);
  await assert.rejects(retrySavedAutomationRun(receipt, async id => ({ id, project_id: 'other', app_type_id: 'app', status: 'running' }), async () => {}), /outside/);
  await assert.rejects(retrySavedAutomationRun(receipt, async id => ({ id, project_id: 'p', app_type_id: 'app', status: null }), async () => { starts++; }), /no current status/);
  assert.equal(starts, 1);
});

test('zero or partial automated handoff retains the run as evidence instead of inventing a successful start', async () => {
  const receipt = { id: 'saved-run', caseIds: ['one'], projectId: 'p', appTypeId: 'app', mode: 'remote' };
  assert.throws(() => assertAutomationDispatchAccepted({ started: true, queued_for_engine_count: 0, warnings: ['Engine offline'] }, receipt), error => error instanceof AutomationStartError && error.receipt.retryAllowed === false && /Engine offline/.test(error.message));
  await assert.rejects(startRemoteAutomationRun(receipt, async () => ({ queued_for_engine_count: 1, unsupported_automated_case_count: 1 })), error => error.receipt.retryAllowed === false);
  assert.doesNotThrow(() => assertAutomationDispatchAccepted({ queued_for_engine_count: 2, unsupported_automated_case_count: 0 }, receipt));
});

test('creation acknowledgement is verified by reading scope and state without a second start', async () => {
 const receipt = { id:'created',caseIds:['one'],projectId:'p',appTypeId:'app',mode:'remote' };
 const started = await verifyCreatedAutomationRun(receipt, async id => ({id,project_id:'p',app_type_id:'app',status:'running'}));assert.equal(started,receipt);
 await assert.rejects(verifyCreatedAutomationRun(receipt,async id=>({id,project_id:'p',app_type_id:'app',status:'queued'})),error=>error instanceof AutomationStartError&&error.receipt.id==='created');
 await assert.rejects(verifyCreatedAutomationRun(receipt,async()=>{throw new Error('Read receipt unavailable')}),error=>error.receipt.retryAllowed===false);
 await assert.rejects(verifyCreatedAutomationRun(receipt,async id=>({id,project_id:'foreign',app_type_id:'app',status:'running'})),error=>error.receipt.retryAllowed===false);
});
