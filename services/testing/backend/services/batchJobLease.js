const RENEWAL_TIMEOUT_MS = 10_000;

function createBatchJobLease({renew,signal,intervalMs=30_000,schedule=setInterval,cancel=clearInterval,
 scheduleTimeout=setTimeout,cancelTimeout=clearTimeout,now=Date.now,renewalTimeoutMs=RENEWAL_TIMEOUT_MS}) {
 const controller=new AbortController();let stopped=false,pending,timer;
 const timeoutMs=Number.isFinite(renewalTimeoutMs)?Math.max(250,Math.min(30_000,renewalTimeoutMs)):RENEWAL_TIMEOUT_MS;
 const lost=(leaseCode,cause)=>{
  const error=Object.assign(new Error('The background agent no longer owns this job lease. Further model calls and case changes were stopped.'),{
   code:'BATCH_JOB_LEASE_LOST',lease_code:leaseCode,nonRetryable:true
  });
  if(cause)Object.defineProperty(error,'cause',{value:cause});
  return error;
 };
 const clearPending=(attempt,error)=>{
  if(!attempt||attempt.settled)return;
  attempt.settled=true;cancelTimeout(attempt.timer);
  if(pending===attempt)pending=null;
  if(error)attempt.reject(error);else attempt.resolve();
 };
 const abortLinked=()=>lose('BATCH_JOB_LEASE_CANCELLED',signal.reason);
 const lose=(leaseCode,cause)=>{
  const reason=controller.signal.aborted?controller.signal.reason:lost(leaseCode,cause);
  if(!controller.signal.aborted)controller.abort(reason);
  if(timer!==undefined)cancel(timer);
  signal?.removeEventListener('abort',abortLinked);
  clearPending(pending,reason);
  return reason;
 };
 const assertActive=()=>{controller.signal.throwIfAborted();if(stopped)throw lost('BATCH_JOB_LEASE_STOPPED');};
 const ensureOwnership=async()=>{
  assertActive();
  if(!pending){
   let resolve,reject;
   const attempt={promise:new Promise((yes,no)=>{resolve=yes;reject=no;}),resolve,reject,deadline:now()+timeoutMs,settled:false,timer:undefined};
   pending=attempt;
   attempt.timer=scheduleTimeout(()=>lose('BATCH_JOB_LEASE_RENEWAL_TIMEOUT'),timeoutMs);attempt.timer?.unref?.();
   // A late original result can neither restore authority nor clear a newer
   // attempt after cancellation or the finite renewal watchdog.
   void Promise.resolve().then(()=>{assertActive();return renew({signal:controller.signal});}).then(result=>{
    if(attempt.settled)return;
    if(now()>=attempt.deadline){lose('BATCH_JOB_LEASE_RENEWAL_TIMEOUT');return;}
    if(controller.signal.aborted||stopped){clearPending(attempt,controller.signal.reason||lost('BATCH_JOB_LEASE_STOPPED'));return;}
    if(result?.changes!==1){lose('BATCH_JOB_LEASE_NOT_OWNED');return;}
    clearPending(attempt);
   },error=>{if(!attempt.settled)lose('BATCH_JOB_LEASE_RENEWAL_FAILED',error);});
  }
  const attempt=pending;
  await attempt.promise;assertActive();
 };
 signal?.addEventListener('abort',abortLinked,{once:true});
 if(signal?.aborted)abortLinked();
 if(!controller.signal.aborted){timer=schedule(()=>{void ensureOwnership().catch(()=>{});},intervalMs);timer?.unref?.();}
 return {signal:controller.signal,assertActive,ensureOwnership,stop:()=>{if(stopped)return;stopped=true;lose('BATCH_JOB_LEASE_STOPPED');}};
}

module.exports={createBatchJobLease,RENEWAL_TIMEOUT_MS};
