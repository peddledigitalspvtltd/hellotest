// Bound read-only SDK/context work even when a dependency ignores cancellation.
async function withDeadline(task,{signal,timeoutMs=30000,timeoutMessage='MCP retrieval exceeded its request budget.'}={}){
 signal?.throwIfAborted();
 const controller=new AbortController();
 const cancel=()=>controller.abort(signal.reason);
 signal?.addEventListener('abort',cancel,{once:true});
 const timeout=setTimeout(()=>controller.abort(Object.assign(new Error(timeoutMessage),{code:'MCP_CONTEXT_TIMEOUT',statusCode:504,publicMessage:timeoutMessage})),timeoutMs);
 let rejectAbort;
 const aborted=new Promise((_,reject)=>{rejectAbort=()=>reject(controller.signal.reason);controller.signal.addEventListener('abort',rejectAbort,{once:true});});
 try{return await Promise.race([Promise.resolve().then(()=>task(controller.signal)),aborted]);}
 finally{clearTimeout(timeout);signal?.removeEventListener('abort',cancel);controller.signal.removeEventListener('abort',rejectAbort);}
}
module.exports={withDeadline};
