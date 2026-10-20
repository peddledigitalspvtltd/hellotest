const test=require('node:test'),assert=require('node:assert/strict');
const {createBatchJobLease}=require('../../backend/services/batchJobLease');
test('durable agent leases renew while active and stop polling when the handler finishes',async()=>{
 let tick,renewals=0,cancelled=false;
 const guard=createBatchJobLease({renew:async()=>{renewals++;return {changes:1};},schedule:callback=>{tick=callback;return {unref(){}};},cancel:()=>{cancelled=true;}});
 await guard.ensureOwnership();assert.equal(renewals,1);tick();await new Promise(resolve=>setImmediate(resolve));assert.equal(renewals,2);assert.equal(guard.signal.aborted,false);
 guard.stop();assert.equal(cancelled,true);await assert.rejects(guard.ensureOwnership(),{code:'BATCH_JOB_LEASE_LOST'});
});
test('lost ownership or an unavailable lease store cancels in-flight work and prevents more writes',async()=>{
 for(const failure of ['lost','database']){
  let calls=0;const guard=createBatchJobLease({renew:async()=>{calls++;if(failure==='database')throw new Error('Connection unavailable');return {changes:0};},schedule:()=>({unref(){}}),cancel:()=>{}});
  await assert.rejects(guard.ensureOwnership(),{code:'BATCH_JOB_LEASE_LOST'});assert.equal(guard.signal.aborted,true);assert.throws(()=>guard.assertActive(),{code:'BATCH_JOB_LEASE_LOST'});await assert.rejects(guard.ensureOwnership(),{code:'BATCH_JOB_LEASE_LOST'});assert.equal(calls,1);guard.stop();
 }
});
