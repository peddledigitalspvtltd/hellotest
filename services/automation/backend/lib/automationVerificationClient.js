const {resolveTestEngineSecret}=require('@hellotest/platform/backend/src/security/runtimeSecrets');
const {readBoundedResponseJson}=require('@hellotest/platform/backend/src/utils/boundedResponse');

/** One dispatch only: a lost response is an unknown run, never an HTTP retry. */
async function verifyRecordedAutomation({integration,request,signal}) {
 const endpoint=`${integration.base_url.replace(/\/+$/,'')}/api/v1/automation/verify`;
 const response=await fetch(endpoint,{method:'POST',redirect:'error',headers:{'content-type':'application/json','x-hellotest-testengine-secret':resolveTestEngineSecret(integration.config?.shared_secret)},body:JSON.stringify(request),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(70_000)]):AbortSignal.timeout(70_000)});
 if(!response.ok){
  await response.body?.cancel?.().catch(()=>undefined);
  throw Object.assign(new Error('The isolated verification worker could not accept this run.'),{code:'AUTOMATION_VERIFICATION_UNAVAILABLE',statusCode:response.status});
 }
 let receipt;
 try{receipt=await readBoundedResponseJson(response,{maxBytes:512*1024,label:'Isolated verification response'});}
 catch(error){
  if(signal?.aborted||error?.name==='AbortError')throw error;
  throw Object.assign(new Error('The isolated verification worker returned an invalid execution receipt.'),{code:'AUTOMATION_VERIFICATION_INVALID_RECEIPT',statusCode:502});
 }
 return receipt;
}
module.exports={verifyRecordedAutomation};
