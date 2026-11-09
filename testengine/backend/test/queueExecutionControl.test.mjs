import test from 'node:test';
import assert from 'node:assert/strict';
import {createQueueExecutionControl} from '../dist/lib/queueExecutionControl.js';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

test('concurrent authority checks share one request and stop does not schedule more work',async()=>{
 let count=0,release;const held=new Promise(resolve=>release=resolve);
 const control=createQueueExecutionControl({authorize:async()=>{count++;await held;},onAbort(){},timeoutMs:10000,intervalMs:5});
 const first=control.check(),second=control.check();assert.equal(count,1);release();await Promise.all([first,second]);
 control.stop();await delay(12);assert.equal(count,1);assert.equal(control.signal.aborted,false);
});

test('denied ownership aborts once and cannot authorize another dispatch',async()=>{
 let calls=0,aborts=0;const control=createQueueExecutionControl({authorize:async()=>{calls++;throw new Error('Lease lost');},onAbort(){aborts++;},timeoutMs:10000});
 await assert.rejects(control.check(),/Lease lost/);await assert.rejects(control.check(),/Lease lost/);
 assert.equal(calls,1);assert.equal(aborts,1);assert.equal(control.authorityLost,true);control.stop();
});

test('the run deadline aborts active work without claiming that its owner was revoked',async()=>{
 let aborts=0;const control=createQueueExecutionControl({authorize:async()=>{},onAbort(){aborts++;},timeoutMs:15,intervalMs:1000});
 control.start();await delay(30);assert.equal(control.signal.aborted,true);assert.equal(control.authorityLost,false);assert.equal(aborts,1);control.stop();
});

test('an external stop aborts the active control request and removes future work',async()=>{
 const caller=new AbortController();let observed=false;
 const control=createQueueExecutionControl({signal:caller.signal,authorize:signal=>new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>{observed=true;reject(signal.reason);},{once:true});}),onAbort(){},timeoutMs:10000});
 const running=control.check();caller.abort(new Error('User cancelled'));await assert.rejects(running,/User cancelled/);assert.equal(observed,true);assert.equal(control.authorityLost,true);control.stop();
});
