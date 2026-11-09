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

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function clockLease(renew,options={}){
 let clock=1_000,interval,intervalCancelled=0,next=0;const timers=new Map(),allTimers=[];
 const guard=createBatchJobLease({renew,...options,now:()=>clock,schedule:callback=>{interval=callback;return 'interval';},cancel:()=>intervalCancelled++,
  scheduleTimeout:(callback,ms)=>{const id=++next,row={callback,at:clock+ms};timers.set(id,row);allTimers.push(row);return id;},cancelTimeout:id=>timers.delete(id)});
 return {guard,timers,allTimers,tick:()=>interval?.(),cancelled:()=>intervalCancelled,advance:async(ms,fire=true)=>{clock+=ms;if(fire)for(const [id,row]of [...timers])if(row.at<=clock){timers.delete(id);row.callback();}await flush();}};
}

test('one stalled renewal loses authority for every joined waiter within ten seconds and ignores a late success',async()=>{
 const pending=deferred();let calls=0,renewalSignal;
 const clock=clockLease(({signal})=>{calls++;renewalSignal=signal;return pending.promise;});
 const waits=Promise.allSettled([clock.guard.ensureOwnership(),clock.guard.ensureOwnership(),clock.guard.ensureOwnership()]);await flush();
 assert.equal(calls,1);assert.equal(renewalSignal,clock.guard.signal);await clock.advance(9_999);assert.equal(clock.guard.signal.aborted,false);
 await clock.advance(1);const results=await waits;assert.ok(results.every(row=>row.status==='rejected'&&row.reason===clock.guard.signal.reason));
 assert.equal(clock.guard.signal.reason.code,'BATCH_JOB_LEASE_LOST');assert.equal(clock.guard.signal.reason.lease_code,'BATCH_JOB_LEASE_RENEWAL_TIMEOUT');assert.equal(clock.timers.size,0);assert.ok(clock.cancelled()>0);
 pending.resolve({changes:1});await flush();await assert.rejects(clock.guard.ensureOwnership(),error=>error===clock.guard.signal.reason);assert.equal(calls,1);clock.guard.stop();
});

test('a delayed watchdog callback cannot let a late database acknowledgement resume work',async()=>{
 const pending=deferred(),clock=clockLease(()=>pending.promise),wait=clock.guard.ensureOwnership();const settled=Promise.allSettled([wait]);await flush();
 await clock.advance(10_000,false);pending.resolve({changes:1});const [result]=await settled;
 assert.equal(result.status,'rejected');assert.equal(result.reason.lease_code,'BATCH_JOB_LEASE_RENEWAL_TIMEOUT');clock.guard.stop();
});

test('stop and a linked caller cancellation reject an in-flight renewal permanently and remove timers',async()=>{
 for(const mode of ['stop','cancel']){
  const parent=new AbortController(),pending=deferred(),clock=clockLease(()=>pending.promise,{signal:parent.signal});
  const settled=Promise.allSettled([clock.guard.ensureOwnership(),clock.guard.ensureOwnership()]);await flush();
  if(mode==='stop')clock.guard.stop();else parent.abort(new Error('Caller stopped the job'));
  const results=await settled;assert.ok(results.every(row=>row.status==='rejected'&&row.reason===clock.guard.signal.reason));
  assert.equal(clock.guard.signal.reason.lease_code,mode==='stop'?'BATCH_JOB_LEASE_STOPPED':'BATCH_JOB_LEASE_CANCELLED');assert.equal(clock.timers.size,0);
  pending.resolve({changes:1});await flush();assert.throws(()=>clock.guard.assertActive(),{code:'BATCH_JOB_LEASE_LOST'});clock.guard.stop();
 }
 const parent=new AbortController();parent.abort();let calls=0;const clock=clockLease(()=>{calls++;return {changes:1};},{signal:parent.signal});
 await assert.rejects(clock.guard.ensureOwnership(),{code:'BATCH_JOB_LEASE_LOST'});assert.equal(calls,0);assert.equal(clock.timers.size,0);clock.guard.stop();
});

test('successful renewal waiters share one request and a later check starts a fresh bounded renewal',async()=>{
 const first=deferred(),second=deferred();let calls=0;const clock=clockLease(()=>++calls===1?first.promise:second.promise);
 const joined=Promise.all([clock.guard.ensureOwnership(),clock.guard.ensureOwnership()]);await flush();assert.equal(calls,1);first.resolve({changes:1});await joined;
 assert.equal(clock.timers.size,0);const next=clock.guard.ensureOwnership();await flush();assert.equal(calls,2);second.resolve({changes:1});await next;
 assert.equal(clock.guard.signal.aborted,false);assert.equal(clock.timers.size,0);clock.guard.stop();
});
