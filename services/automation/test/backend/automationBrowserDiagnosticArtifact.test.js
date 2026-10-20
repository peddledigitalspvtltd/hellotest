const test = require('node:test');
const assert = require('node:assert/strict');
const { browserBootstrapFailure } = require('../../backend/lib/automationBrowserBootstrapFailure');
const { buildFailureProgress } = require('../../backend/lib/automationBuildFailureProgress');
const { retainBrowserDiagnostic, DIAGNOSTIC_MIME } = require('../../backend/lib/automationBrowserDiagnosticArtifact');

const launchFailure = message => browserBootstrapFailure({isError:true,content:[{type:'text',text:JSON.stringify({
  code:'BROWSER_LAUNCH_FAILED',launch_phase:'startup',startup_stage:'browser',action_outcome:'not_attempted',retry_safe:true,message
})}]});

test('startup support diagnostics are redacted, bounded including Unicode, and separate from public errors', () => {
  const error=launchFailure(`browserType.launch: --proxy-server=http://operator:proxycredential@localhost\npassword=privatepassword\nAuthorization: Bearer privateruntimetoken\nhttps://proxy.example/?token=privatequerytoken\n${'界'.repeat(3000)}\nFATAL: sandbox unavailable`);
  assert.equal(error.browser_diagnostic.launch_phase,'startup');
  assert.equal(error.browser_diagnostic.startup_stage,'browser');
  assert.ok(Buffer.byteLength(JSON.stringify(error.browser_diagnostic),'utf8')<=2048);
  assert.match(error.browser_diagnostic.message,/browserType\.launch/);
  assert.match(error.browser_diagnostic.message,/FATAL: sandbox unavailable/);
  assert.doesNotMatch(JSON.stringify(error.browser_diagnostic),/proxycredential|privatepassword|privateruntimetoken|privatequerytoken/);
  assert.doesNotMatch(JSON.stringify(error),/browser_diagnostic|sandbox unavailable|proxy-server/);
  assert.doesNotMatch(JSON.stringify(buildFailureProgress(error)),/sandbox unavailable|proxy-server/);
  const other=browserBootstrapFailure({isError:true,content:[{type:'text',text:JSON.stringify({code:'BROWSER_LAUNCH_FAILED',launch_phase:'navigation',message:'not a confirmed startup failure'})}]});
  assert.equal(other.browser_diagnostic,undefined);
});

test('only the protected artifact contains diagnostics and current access is checked before storage', async () => {
  const error=launchFailure('browserType.launch: FATAL: sandbox unavailable');
  const calls=[],artifacts=[],events=[];
  const artifact=await retainBrowserDiagnostic({error,transactionId:'activity',assertAccess:async()=>{calls.push('access');},
    createArtifact:async(id,input)=>{calls.push('artifact');artifacts.push({id,input});return{id:'protected'};},
    appendEvent:async(id,event)=>{calls.push('event');events.push(event);}});
  assert.equal(artifact.id,'protected');
  assert.deepEqual(calls,['access','artifact','event']);
  assert.equal(artifacts[0].input.mime_type,DIAGNOSTIC_MIME);
  assert.match(artifacts[0].input.content,/sandbox unavailable/);
  assert.deepEqual(events[0].details,{artifact_id:'protected'});
  assert.doesNotMatch(JSON.stringify(events),/sandbox unavailable|browserType\.launch/);
});

test('optional diagnostic storage and event failures cannot replace the original browser failure', async () => {
  const error=launchFailure('browserType.launch: unavailable');
  for(const stage of ['access','artifact','event']){
    const fail=async current=>{if(current===stage)throw Object.assign(new Error('Optional storage unavailable'),{statusCode:503});};
    assert.equal(await retainBrowserDiagnostic({error,transactionId:'activity',assertAccess:()=>fail('access'),
      createArtifact:async()=>{await fail('artifact');return{id:'protected'};},appendEvent:()=>fail('event')}),null);
    assert.equal(error.code,'AUTOMATION_BROWSER_STARTUP_FAILED');
  }
});

test('revoked access, cancellation and lost leases stay fatal and block diagnostic writes', async () => {
  const error=launchFailure('browserType.launch: unavailable');
  for(const failure of [Object.assign(new Error('Forbidden'),{statusCode:403}),Object.assign(new Error('Cancelled'),{name:'AbortError'}),
    Object.assign(new Error('Lease lost'),{code:'BATCH_JOB_LEASE_LOST'})]){
    let writes=0;
    await assert.rejects(retainBrowserDiagnostic({error,transactionId:'activity',assertAccess:async()=>{throw failure;},
      createArtifact:async()=>{writes++;},appendEvent:async()=>{}}),value=>value===failure);
    assert.equal(writes,0);
  }
});

test('malformed optional diagnostics cannot replace the original build failure or write unbounded artifacts', async () => {
  let writes = 0, access = 0;
  const retain = error => retainBrowserDiagnostic({ error, transactionId: 'activity', assertAccess: async () => { access++; },
    createArtifact: async () => { writes++; }, appendEvent: async () => {} });
  const circular = { launch_phase: 'startup' }; circular.self = circular;
  assert.equal(await retain({ browser_diagnostic: circular }), null);
  assert.equal(await retain({ browser_diagnostic: { launch_phase: 'startup', message: 'x'.repeat(3000) } }), null);
  assert.equal(access, 2);
  assert.equal(writes, 0);
});
