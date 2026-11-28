const test=require('node:test'),assert=require('node:assert/strict');
const {verifyRecordedAutomation}=require("../../backend/lib/verification/automationVerificationClient");
const integration={base_url:'https://worker.test/',config:{shared_secret:'fixture-shared-secret'}};

test('worker HTTP authorization survives an HTML response and dispatch is never retried',async t=>{
 const previous=global.fetch;t.after(()=>{global.fetch=previous;});
 for(const status of [401,403,429]){
  let calls=0;global.fetch=async()=>{calls++;return new Response('<html>PRIVATE_GATEWAY_DIAGNOSTIC</html>',{status});};
  await assert.rejects(()=>verifyRecordedAutomation({integration,request:{}}),error=>error.statusCode===status&&error.code==='AUTOMATION_VERIFICATION_UNAVAILABLE'&&!error.message.includes('PRIVATE_GATEWAY_DIAGNOSTIC'));
  assert.equal(calls,1);
 }
});

test('malformed or oversized worker JSON has a safe typed receipt error without retry',async t=>{
 const previous=global.fetch;t.after(()=>{global.fetch=previous;});
 for(const body of ['PRIVATE_INVALID_JSON','"'+'x'.repeat(512*1024)+'"']){
  let calls=0;global.fetch=async()=>{calls++;return new Response(body,{status:200});};
  await assert.rejects(()=>verifyRecordedAutomation({integration,request:{}}),error=>error.code==='AUTOMATION_VERIFICATION_INVALID_RECEIPT'&&error.statusCode===502&&!error.message.includes('PRIVATE_INVALID_JSON'));
  assert.equal(calls,1);
 }
});

test('one authenticated dispatch preserves a bounded receipt and the caller cancellation signal',async t=>{
 const previous=global.fetch;t.after(()=>{global.fetch=previous;});
 const request={schema_version:1,verification_id:'fixture-attempt'},result={schema_version:1,status:'passed'},controller=new AbortController();let calls=0;
 global.fetch=async(url,options)=>{calls++;assert.equal(url,'https://worker.test/api/v1/automation/verify');assert.equal(options.redirect,'error');assert.equal(options.headers['x-hellotest-testengine-secret'],'fixture-shared-secret');assert.deepEqual(JSON.parse(options.body),request);assert.equal(options.signal.aborted,false);controller.abort();assert.equal(options.signal.aborted,true);return new Response(JSON.stringify(result));};
 assert.deepEqual(await verifyRecordedAutomation({integration,request,signal:controller.signal}),result);assert.equal(calls,1);
});

test('draft verification uses the selected CLI driver once and retains an uncertain receipt', async t => {
 const { compileRecordedProgram } = require('../../backend/lib/browser/automationRecordedProgram');
 const { verifyDraft } = require('../../backend/lib/verification/automationDraftVerification');
 const operations = [
  { name: 'browser_click', arguments: { locator: '#save' } },
  { name: 'browser_assert', arguments: { assertion: 'text', locator: '#result', value: 'Saved' } },
 ];
 const source = compileRecordedProgram(operations).source;
 for (const status of ['passed', 'unknown']) {
  const dispatch = t.mock.method(global, 'fetch', async (_url, options) => {
   const request = JSON.parse(options.body);
   assert.equal(request.execution_driver, 'playwright_test_cli');
   assert.equal(request.sections[0].automation_code, source);
   const passed = status === 'passed';
   return Response.json({
    schema_version:1, verification_id:request.verification_id, execution_driver:'playwright_test_cli',
    browser:'chromium', status, verification_status:passed ? 'verified' : 'unverified', replay_safe:false,
    completed_operations:passed ? 2 : 0, completed_interactions:passed ? 1 : 0, assertion_count:passed ? 1 : 0, duration_ms:12,
    ...(!passed ? { failure:{ step_id:'step', operation_index:1, operation_kind:'browser_click', action_outcome:'unknown', code:'AUTOMATION_VERIFICATION_UNCERTAIN' } } : {}),
   });
  });
  const result = await verifyDraft({
   steps:[{ id:'step', step_type:'web', automation_code:source }], resolver:{}, startUrl:'https://app.test/',
   engine:integration, executionDriver:'playwright_test_cli', assertAccess:async () => {}, onProgress:async () => {},
  });
  assert.equal(result.status, status === 'passed' ? 'passed' : 'blocked');
  assert.equal(result.outcome_unknown, status === 'unknown');
  assert.equal(result.execution_driver, 'playwright_test_cli');
  assert.equal(dispatch.mock.callCount(), 1);
  dispatch.mock.restore();
 }
});

test('draft locator recovery publishes only a replayed locator and retains an unacknowledged rerun', async t => {
 const { compileRecordedProgram } = require('../../backend/lib/browser/automationRecordedProgram');
 const { verifyDraft } = require('../../backend/lib/verification/automationDraftVerification');
 const operations = [
  { name: 'browser_click', arguments: { locator: '#save' } },
  { name: 'browser_assert', arguments: { assertion: 'text', locator: '#result', value: 'Saved' } }
 ];
 const source = compileRecordedProgram(operations).source;
 for (const loseReceipt of [false, true]) {
  let calls = 0;
  const dispatch = t.mock.method(global, 'fetch', async (_url, options) => {
   const request = JSON.parse(options.body);
   const receipt = { schema_version: 1, verification_id: request.verification_id, browser: 'chromium', duration_ms: 12 };
   calls++;
   if (calls === 1) {
    assert.equal(request.sections[0].automation_code, source);
    return Response.json({ ...receipt,
     status: 'failed', verification_status: 'unverified', replay_safe: true, completed_operations: 0, completed_interactions: 0, assertion_count: 0,
     failure: { step_id: 'step', operation_index: 1, operation_kind: 'browser_click',
      action_outcome: 'not_attempted', code: 'AUTOMATION_VERIFICATION_LOCATOR_UNRESOLVED' },
     snapshot: { elements: [{ locators_validated: true, locator_candidates: ['#save-new'] }] }
    });
   }
   assert.equal(request.sections[0].operations[0].arguments.locator, '#save-new');
   assert.deepEqual(request.sections[0].operations[1], operations[1]);
   if (loseReceipt) throw new Error('connection lost after dispatch');
   return Response.json({ ...receipt,
    status: 'passed', verification_status: 'verified', replay_safe: false, completed_operations: 2, completed_interactions: 1, assertion_count: 1
   });
  });
  const committed = [];
  const result = await verifyDraft({
   steps: [{ id: 'step', step_type: 'web', automation_code: source, expected_result: 'Saved' }],
   resolver: {}, startUrl: 'https://app.test/', mode: 'verify_repair', engine: integration,
   assertAccess: async () => {}, onProgress: async () => {},
   repair: {
    diagnose: async () => ({ step_id: 'step', operation_index: 1, locator: '#save-new' }),
    commitRepair: async ({ after }) => { committed.push(after[0].automation_code); }
   }
  });
  assert.equal(calls, 2);
  assert.equal(result.first_attempt_status, 'failed');
  assert.equal(result.outcome_unknown, loseReceipt);
  assert.equal(result.status, loseReceipt ? 'blocked' : 'passed');
  if (loseReceipt) {
   assert.deepEqual(committed, []);
   assert.equal(result.execution_status, undefined);
  } else {
   assert.equal(committed.length, 1);
   assert.match(committed[0], /#save-new/);
   assert.equal(result.repair_count, 1);
  }
  dispatch.mock.restore();
 }
});
