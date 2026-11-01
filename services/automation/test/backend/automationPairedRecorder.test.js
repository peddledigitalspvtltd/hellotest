const test = require('node:test');
const assert = require('node:assert/strict');
const { validatePairedRecording } = require('../../backend/lib/automationPairedRecorder');
const fixture = () => ({ transaction: { created_by: 'user', project_id: 'project' }, metadata: { local_transport: 'paired-agent', test_case_id: 'case', recorder_session_id: 'prepare', recorder_case_revision: 3 }, testCase: { id: 'case', project_id: 'project', revision: 3 }, sessionId: 'session', recordingId: 'prepare', userId: 'user', capture: { id: 'session', purpose: 'automation-recording', status: 'stopped', start_url: 'https://app.test/login', actions: [{ index: 1, type: 'fill', value: '  exact  ' }], network: [], automation_code: 'untrusted()', test_case: { id: 'other' } } });
test('paired recording imports only captured evidence and preserves exact input for the existing compiler', () => {
  const result = validatePairedRecording(fixture());
  assert.equal(result.actions[0].value, '  exact  ');
  assert.equal(result.automation_code, undefined);
  assert.equal(result.test_case, undefined);
});
test('recordings reject another principal/project/case, a running browser or unbound capture before plan writes', () => {
  for (const mutate of [f => f.transaction.created_by='other', f => f.transaction.project_id='other', f => f.metadata.test_case_id='other', f => f.recordingId='other', f => f.capture.id='other', f => f.capture.status='running', f => f.metadata.local_transport='server', f => f.capture.purpose='repository-inspect']) {
    const input=fixture();mutate(input);assert.throws(()=>validatePairedRecording(input),{code:'AUTOMATION_RECORDER_SCOPE_MISMATCH'});
  }
});
test('concurrent case edits, oversized capture and unsafe targets remain explicit failures', () => {
  const changed=fixture();changed.testCase.revision=4;assert.throws(()=>validatePairedRecording(changed),{code:'AUTOMATION_RECORDER_CASE_CHANGED'});
  const huge=fixture();huge.capture.actions[0].value='x'.repeat(4*1024*1024);assert.throws(()=>validatePairedRecording(huge),{code:'AUTOMATION_RECORDER_SCOPE_MISMATCH'});
  for(const url of ['file:///tmp/file','javascript:alert(1)','https://name:password@app.test']) {const input=fixture();input.capture.start_url=url;assert.throws(()=>validatePairedRecording(input),{code:'AUTOMATION_RECORDER_INPUT_INVALID'});}
});
test('actual paired recorder preparation authorizes and freezes context without resolving or contacting a server-local runner', async () => {
  const fs=require('node:fs');const source=fs.readFileSync(require.resolve('../../backend/services/aiAutomationBuilder.service'),'utf8');
  const body=source.slice(source.indexOf('exports.startRecorderSession ='),source.indexOf('exports.finishRecorderSession ='));
  let transactionInput;
  const deps={exports:{},normalizeText:value=>String(value||'').trim(),selectCaseWithScope:{get:async()=>({id:'case',project_id:'project',app_type_id:'app',app_type_kind:'web',revision:4,title:'Private flow'})},selectStepsForCase:{all:async()=>[]},resolveAutomationCaseSteps:()=>({automation_case_type:'web',allowed_step_types:['web'],steps:[]}),resolveBuildContext:async()=>({}),resolveTestEngineIntegration:()=>assert.fail('A paired recorder cannot depend on remote integration'),isMobileRecorderTarget:()=>false,isMobileAppType:()=>false,normalizeLocalEngineBaseUrl:()=>assert.fail('No API localhost address'),resolveMobileEngineBaseUrl:()=>'',resolveRecorderPublicBaseUrl:()=>'',uuid:()=> 'prepare',summarizeStep:step=>step,workspaceTransactionService:{createTransaction:async input=>{transactionInput=input;return{id:'transaction'};}},appendEvent:async()=>{},buildEngineUrl:()=>assert.fail('Browser attaches the paired local URL'),readEngineJson:()=>assert.fail('API must never call localhost')};
  new Function(...Object.keys(deps),body)(...Object.values(deps));
  const result=await deps.exports.startRecorderSession({test_case_id:'case',start_url:'https://private.test/login',recorder_mode:'local',recorder_target:'web',local_transport:'paired-agent',created_by:'user'});
  assert.equal(result.transaction_id,'transaction');assert.equal(result.paired_recording_id,'prepare');assert.equal(result.paired_session_payload.start_url,'https://private.test/login');assert.equal(transactionInput.metadata.recorder_case_revision,4);assert.equal(transactionInput.metadata.local_transport,'paired-agent');
});
