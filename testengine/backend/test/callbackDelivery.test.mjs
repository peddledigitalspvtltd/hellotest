import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash, createHmac } from 'node:crypto';
const root = await mkdtemp(path.join(tmpdir(), 'callback-delivery-'));
process.env.ARTIFACT_ROOT = root;
const secret = 'callback-delivery-fixture-secret-with-more-than-32-characters';
process.env.TESTENGINE_SHARED_SECRET = secret;
const { deliverRunCallback, retryRunCallbacks } = await import('../dist/lib/callbackDelivery.js');
const { saveRun, getRun } = await import('../dist/lib/runStore.js');
const envelope = id => ({ engine_run_id:id, callback:{ url:'https://fixture.example/api/testengine/callbacks/runs',signing_secret:secret } });
const payload = id => ({ event:'run.completed',engine_run_id:id,hellotest_run_id:'run',hellotest_test_case_id:'case',state:'completed',summary:'Passed',case_result:{status:'passed',logs:{stepStatuses:{s:'passed'},stepEvidence:{s:{dataUrl:'data:image/png;base64,aW1hZ2U='}}}},step_outcomes:[{step_id:'s',status:'passed',evidence_image:{data_url:'data:image/png;base64,aW1hZ2U='}}],artifact_bundle:{screenshot_paths:[]},patch_proposals:[],emitted_at:'2026-10-08T00:00:00Z' });
test.after(()=>rm(root,{recursive:true,force:true}));
test('transient callback failures retry an identical signed result without changing a passed run', async t=>{
 saveRun({id:'transient',state:'completed'},envelope('transient'));const calls=[];
 t.mock.method(globalThis,'fetch',async(url,init)=>{calls.push(init);return new Response('{}',{status:calls.length===1?503:200})});
 const delivery=await deliverRunCallback(envelope('transient'),payload('transient'));
 assert.equal(delivery.status,'delivered');assert.equal(delivery.attempts,2);assert.equal(delivery.error_code,undefined);assert.equal(getRun('transient').state,'completed');assert.equal(calls[0].body,calls[1].body);
 assert.equal(calls[0].headers['x-testengine-signature'],createHmac('sha256',secret).update(calls[0].body).digest('hex'));
 const transmitted=JSON.parse(calls[0].body);assert.equal(transmitted.step_outcomes[0].evidence_image,null);assert.ok(transmitted.case_result.logs.stepEvidence.s.dataUrl);
 const retained=await readFile(path.join(root,'.callbacks',createHash('sha256').update('transient').digest('hex')+'.json'),'utf8');assert.ok(!retained.includes(secret));
});
test('permanent delivery failures preserve results and reporting-only retry delivers the retained payload',async t=>{
 saveRun({id:'permanent',state:'completed'},envelope('permanent'));let calls=0,available=false;
 t.mock.method(globalThis,'fetch',async()=>{calls++;return new Response('{}',{status:available?200:401})});
 const first=await deliverRunCallback(envelope('permanent'),payload('permanent'));assert.equal(first.status,'failed');assert.equal(first.http_status,401);assert.equal(calls,1);assert.equal(getRun('permanent').state,'completed');
 available=true;const recovered=await retryRunCallbacks('permanent');assert.equal(recovered.status,'delivered');assert.equal(calls,2);assert.equal(getRun('permanent').state,'completed');
 await retryRunCallbacks('permanent');assert.equal(calls,2,'Already delivered payloads are not posted again');
});
test('retained final callbacks can be recovered without an in-memory run using only the original configured credential',async t=>{
 let available=false;t.mock.method(globalThis,'fetch',async()=>new Response('{}',{status:available?200:404}));
 await deliverRunCallback(envelope('restart'),payload('restart'));assert.equal(getRun('restart'),null);
 const original=process.env.TESTENGINE_SHARED_SECRET;process.env.TESTENGINE_SHARED_SECRET='different-secret-with-more-than-32-characters';
 await assert.rejects(retryRunCallbacks('restart'),/credential/);process.env.TESTENGINE_SHARED_SECRET=original;
 available=true;assert.equal((await retryRunCallbacks('restart')).status,'delivered');
});
