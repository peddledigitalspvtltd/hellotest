import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { registerAutomationMcp } from '../../dist/lib/automationMcp.js';
import { runAutomationVerification } from '../../dist/lib/automationVerification.js';
import { runAutomationVerificationCli } from '../../dist/lib/automationVerificationCli.js';
import { createPrivilegedRunGuard, resolveTestEngineSharedSecret } from '../../dist/lib/testEngineSecurity.js';

const require = createRequire(import.meta.url);
const { connectAutomationBrowser } = require('../../../../services/automation/backend/lib/automationBrowserAgent');
const { prepareVerificationSections } = require('../../../../services/automation/backend/lib/automationVerificationPipeline');
const { compileRecordedProgram } = require('../../../../services/automation/backend/lib/automationRecordedProgram');
const rules = require('../../../../services/ai/backend/services/automationRepairRules');
const {nativeRepairProgramSummary}=require('../../../../services/automation/backend/lib/automationRepairProgramContract');
const op = (name, args) => ({ name, arguments: args });
const section = (id, order, operations) => ({ id, step_order: order, step_type: 'web',
  action: id, expected_result: id + ' confirmed', automation_code: compileRecordedProgram(operations).source });

// Model choices are deterministic. Locator discovery, focused source repair,
// assertion preservation and fresh native/Playwright CLI execution are real.
test('typed native repair uses an observed field and verifies every unchanged successor with fixed data', { timeout: 90_000 }, async t => {
  const previous = process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;
  process.env.RECORDER_ALLOWED_PRIVATE_HOSTS = '127.0.0.1';
  const directory = await mkdtemp(path.join(tmpdir(), 'qaira-typed-native-repair-'));
  const app = Fastify(); let reviews = 0;
  app.get('/form', async (_request, reply) => reply.type('text/html').send('<!doctype html><title>Password form</title><h1>Account</h1><label>Password<input id="password" type="password" required minlength="8"></label><button id="review" type="button" onclick="document.querySelector(\'#status\').textContent=\'Ready\';fetch(\'/reviewed\')">Review</button><p id="status">Waiting</p>'));
  app.get('/reviewed', async () => { reviews++; return { ok: true }; });
  await registerAutomationMcp(app, createPrivilegedRunGuard(resolveTestEngineSharedSecret()));
  const base = await app.listen({ host: '127.0.0.1', port: 0 }), url = base + '/form';
  const browser = await connectAutomationBrowser({ integration: { base_url: base }, startUrl: url, allowBrowserActions: true });
  t.after(async () => {
    await browser.close(); await app.close(); await rm(directory, { recursive: true, force: true });
    if (previous === undefined) delete process.env.RECORDER_ALLOWED_PRIVATE_HOSTS; else process.env.RECORDER_ALLOWED_PRIVATE_HOSTS = previous;
  });
  const steps = [
    section('open', 1, [op('browser_assert', { assertion: 'visible', locator: 'h1' })]),
    section('password', 2, [op('browser_fill', { locator: '#old-password', value: '@r.password' }), op('browser_assert', { assertion: 'value', locator: '#old-password', value: '@r.password' }), op('browser_assert', { assertion: 'field_valid', locator: '#old-password' })]),
    section('review', 3, [op('browser_click', { locator: '#review' }), op('browser_assert', { assertion: 'text_content', locator: '#status', value: 'Ready' })]),
    section('final', 4, [op('browser_assert', { assertion: 'title_normalized', value: 'Password form' })])
  ];
  const parameters = { 'r.password': 'Fixture-password-123' };
  const prepare = rows => prepareVerificationSections(rows, { resolve: (_name, args) => ({ ...args,
    ...(args.value === '@r.password' ? { value: parameters['r.password'] } : {}) }) });
  const request = prepared => ({ schema_version: 1, verification_id: randomUUID(), lease_token: randomUUID(), start_url: url,
    sections: prepared.sections.map(({step_id,automation_code,operations})=>({step_id,automation_code,operations})), parameters: prepared.parameters, replay_policy: { mode: 'authorized_run', allow_mutations: true }, timeout_ms: 15_000 });
  const original = await runAutomationVerification(request(prepare(steps)), { artifactRoot: directory });
  assert.equal(original.status, 'failed'); assert.equal(original.failure.step_id, 'password');
  assert.equal(original.failure.code, 'AUTOMATION_VERIFICATION_LOCATOR_UNRESOLVED'); assert.equal(reviews, 0);
  assert.ok(!(await browser.call('browser_navigate', { url })).isError);
  const snapshot = JSON.parse((await browser.call('browser_snapshot', {})).content[0].text);
  const target = snapshot.elements.find(element => element.attributes?.id === 'password');
  assert.equal(target.locators_validated, true); assert.ok(target.locator_candidates.includes('#password'));
  const baseContract = { source_hash: 'pinned-source', steps, failed_step_ids: ['password'] };
  const patch = rules.patch(baseContract, { kind: 'replace_locator', step_id: 'password', new_locator: '#password', rationale: 'The live MCP snapshot confirms this unique native password field.' });
  assert.equal(rules.validateStoredPatch(baseContract, patch), true); assert.equal(patch.assertion_count, 2);
  const repaired = steps.map(step => step.id === patch.step_id ? { ...step, automation_code: patch.after } : step);
  assert.equal(repaired[2].automation_code, steps[2].automation_code); assert.equal(repaired[3].automation_code, steps[3].automation_code);
  const verified = await runAutomationVerificationCli({ ...request(prepare(repaired)), execution_driver: 'playwright_test_cli' }, { temporaryRoot: directory, artifactRoot: directory });
  assert.equal(verified.status, 'passed', JSON.stringify(verified)); assert.equal(verified.completed_operations, 7);
  assert.equal(verified.assertion_count, 5); assert.equal(reviews, 1, 'the unchanged following action is executed once');
});

test('normal engine compact-source traces distinguish failed input from the protected negative assertion', { timeout: 90_000 }, async t => {
  const {createWebRunSession}=await import('../../dist/lib/webEngine.js');
  const app=Fastify();
  app.get('/form',async(_request,reply)=>reply.type('text/html').send('<!doctype html><h1>Account</h1><label>Password<input id="password" type="password" required minlength="8"></label>'));
  const base=await app.listen({host:'127.0.0.1',port:0});t.after(()=>app.close());
  const originalSteps=[section('open',1,[op('browser_assert',{assertion:'visible',locator:'h1'})]),
    section('password',2,[op('browser_fill',{locator:'#old-password',value:'@r.password'}),op('browser_assert',{assertion:'value',locator:'#old-password',value:'@r.password'}),op('browser_assert',{assertion:'field_valid',locator:'#old-password'})])];
  const patch=rules.patch({source_hash:'pinned-source',steps:originalSteps,failed_step_ids:['password']},{kind:'replace_locator',step_id:'password',new_locator:'#password',rationale:'The observed native field now has this stable password ID.'});
  const repairedSteps=originalSteps.map(step=>step.id==='password'?{...step,automation_code:patch.after}:step);
  const summary=nativeRepairProgramSummary(repairedSteps[1]);
  assert.deepEqual(summary.operation_lines.map(row=>row.assertion),[false,true,true]);
  const manifest={},receipts={},outcomes={};
  for(const phase of ['original','patched','negative']){
    const rows=phase==='original'?originalSteps:repairedSteps;
    const steps=rows.map(step=>({...step,order:step.step_order}));
    const payload={engine_run_id:`trace-repair-${phase}`,browser:'chromium',headless:true,web_engine:{active:'playwright'},environment:{base_url:base+'/form'},
      session_policy:{web:{mode:'new'}},run_timeout_seconds:20,max_repair_attempts:0,parameters_frozen:true,parameter_scope_default:'r',
      data_set:{id:phase==='negative'?'negative':'positive',name:'Password fixture',mode:'key_value',rows:[{key:'r.password',value:phase==='negative'?'short':'Fixture-password-123'}]},
      timeouts:{action_timeout_ms:1000,assertion_timeout_ms:1000},
      artifact_policy:{trace_mode:'off',video_mode:'off',screenshot_on_success:false,screenshot_on_failure:false,capture_console:false,capture_network:false},steps};
    const session=createWebRunSession(payload),logs={stepStatuses:{},stepAutomationDetails:{}};
    let status='completed';
    try{
      await session.start();
      for(const step of steps){
        const outcome=await session.runStep(step);
        logs.stepStatuses[step.id]=outcome.status;
        logs.stepAutomationDetails[step.id]={line_results:outcome.line_results};
        if(step.id==='password')outcomes[phase]=outcome;
        if(outcome.status!=='passed'){status='failed';break;}
      }
    }finally{await session.stop(status==='completed'?'passed':'failed');}
    manifest[phase]={hash:phase,case_ids:['case']};
    receipts[phase]={hash:phase,steps:rows.map(step=>({...step,test_case_id:'case',snapshot_step_id:step.id})),
      jobs:[{id:phase,test_case_id:'case',status,completed_at:'2026-10-19',payload,runtime_state:{logs}}]};
  }
  process.stdout.write(JSON.stringify({normal_engine_repair_trace:Object.fromEntries(Object.entries(outcomes).map(([phase,outcome])=>[phase,{status:outcome.status,line_results:outcome.line_results,note:outcome.note}]))})+'\n');
  assert.equal(outcomes.original.status,'failed');assert.equal(outcomes.patched.status,'passed',outcomes.patched.note);assert.equal(outcomes.negative.status,'failed');
  const actionFailure=outcomes.original.line_results.find(row=>row.status==='failed');
  const assertionFailure=outcomes.negative.line_results.find(row=>row.status==='failed');
  assert.equal(actionFailure.line,nativeRepairProgramSummary(originalSteps[1]).operation_lines[0].line);
  assert.equal(assertionFailure.line,summary.operation_lines[2].line,`${outcomes.negative.note}\n${JSON.stringify(outcomes.negative.line_results)}`);
  assert.ok(summary.operation_lines.slice(0,2).every(expected=>outcomes.negative.line_results.some(actual=>actual.line===expected.line&&actual.status==='passed'&&actual.attempt===1)));
  assert.equal(rules.evaluate(manifest,receipts,2,2).status,'verified');
  receipts.negative.jobs[0].runtime_state.logs.stepAutomationDetails.password.line_results=outcomes.original.line_results;
  assert.notEqual(rules.evaluate(manifest,receipts,2,2).status,'verified','the same failed section status cannot turn an input failure into protected assertion evidence');
});
