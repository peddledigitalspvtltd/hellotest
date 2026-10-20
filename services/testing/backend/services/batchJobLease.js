function createBatchJobLease({renew,intervalMs=30000,schedule=setInterval,cancel=clearInterval}) {
 const controller=new AbortController();let stopped=false,pending;
 const lost=cause=>Object.assign(new Error('The background agent no longer owns this job lease. Further model calls and case changes were stopped.'),{code:'BATCH_JOB_LEASE_LOST',cause});
 const assertActive=()=>{controller.signal.throwIfAborted();if(stopped)throw lost();};
 const ensureOwnership=async()=>{
  assertActive();
  if(!pending)pending=(async()=>{try{const result=await renew();if(result.changes!==1)throw lost();}catch(error){const reason=error.code==='BATCH_JOB_LEASE_LOST'?error:lost(error);controller.abort(reason);throw reason;}finally{pending=null;}})();
  await pending;assertActive();
 };
 const timer=schedule(()=>{void ensureOwnership().catch(()=>{});},intervalMs);timer?.unref?.();
 return {signal:controller.signal,assertActive,ensureOwnership,stop:()=>{stopped=true;cancel(timer);}};
}
module.exports={createBatchJobLease};
