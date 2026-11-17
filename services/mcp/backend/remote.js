// Trusted composition-root configuration for a separate durable worker.
// The model cannot choose this endpoint or forward an application credential.
const {issue,fail}=require('./auth');
const toolSets=require('./toolSets');
const db=require('@hellotest/platform/backend/src/db');
const {readBoundedResponseJson}=require('@hellotest/platform/backend/src/utils/boundedResponse');

// One short-lived credential serves every call of a turn instead of one being minted
// and revoked per call (three or four writes and several reads each time).
//
// What bounds it: the credential is internal (it draws on the capacity reserved for
// the platform's own calls), carries only the tool set the call needs (a retrieval
// call gets `knowledge`, read only), is bound to one user, project and the trace
// attribution of the turn, and expires after TURN_TTL_SECONDS, which outlasts the
// 120 s turn cap and nothing more. Calls with a different user, project, tool set or
// attribution never share one. Each request is still authenticated and authorized
// server side, so a disabled account or a revoked membership stops working at once.
const TURN_TTL_SECONDS=180;
// Never start a call on a credential that is about to expire.
const REUSE_MARGIN_MS=20_000;
const MAX_CACHED=256;
const credentials=new Map();

const keyOf=(actor,scopes,attribution)=>JSON.stringify([actor.user.id,actor.projectId,actor.clientId,scopes,attribution]);
const evict=(key,entry)=>{if(credentials.get(key)===entry)credentials.delete(key);};
function credentialFor(actor,scopes,attribution){
 const key=keyOf(actor,scopes,attribution),now=Date.now();
 for(const [stale,entry] of credentials)if(entry.reuseUntil<=now)credentials.delete(stale);
 const cached=credentials.get(key);
 if(cached)return {key,entry:cached};
 const entry={reuseUntil:now+TURN_TTL_SECONDS*1000-REUSE_MARGIN_MS};
 // Calls made at the same time (the planner and the first read run in parallel) share one issuance.
 // A failed issuance is dropped so the next call tries again.
 entry.promise=issue(actor.user,actor.projectId,actor.clientId,{contextAttribution:attribution,scopes,internal:true,ttlSeconds:TURN_TTL_SECONDS})
  .catch(error=>{evict(key,entry);throw error;});
 credentials.set(key,entry);
 while(credentials.size>MAX_CACHED)credentials.delete(credentials.keys().next().value);
 return {key,entry};
}

async function call(actor,name,args,signal){
 const url=new URL(process.env.HELLOTEST_MCP_INTERNAL_URL);
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash||!url.pathname.endsWith('/mcp'))throw fail('Configure a fixed internal MCP endpoint.',500,'MCP_CONFIGURATION');
 // The credential carries exactly the tool set this call needs (plus what that set requires).
 const scopes=toolSets.scopesFor(name);
 if(!scopes)throw fail('This MCP tool is not published in any tool set.',404,'MCP_TOOL_NOT_FOUND');
 // Async-local task/session context does not cross HTTP. Bind only trusted
 // host correlation labels into this signed credential;
 // model-supplied tool arguments and protocol metadata cannot set them.
 const contextAttribution=require('./contextAttribution').select(require('@hellotest/platform/backend/src/utils/llmTraceContext').current());
 const payload={jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args,_meta:{'io.modelcontextprotocol/protocolVersion':'2026-07-28','io.modelcontextprotocol/clientCapabilities':{}}}};
 const send=async()=>{
  const {key,entry}=credentialFor(actor,scopes,contextAttribution);
  const credential=await entry.promise;
  const response=await fetch(url,{method:'POST',redirect:'error',signal:AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(require('./contextRequest').requestTimeoutMs(payload))]),headers:{'Content-Type':'application/json',Authorization:'Bearer '+credential.token,Accept:'application/json, text/event-stream','MCP-Protocol-Version':'2026-07-28','Mcp-Method':'tools/call','Mcp-Name':name},body:JSON.stringify(payload)});
  return {key,entry,response};
 };
 let attempt=await send();
 // A credential can stop being valid mid-turn (revoked, or the clock moved). Authentication runs before any
 // tool, so a 401 means nothing ran and one retry on a fresh credential cannot repeat an effect.
 if(attempt.response.status===401){
  evict(attempt.key,attempt.entry);
  await attempt.response.body?.cancel?.().catch(()=>{});
  attempt=await send();
 }
 const {response}=attempt;
 const body=await readBoundedResponseJson(response,{maxBytes:512000,label:'Internal MCP response'});
 if(body.result?.isError){
  let detail;try{detail=JSON.parse(body.result.content?.find(item=>item.type==='text')?.text);}catch{}
  const status=Number.isInteger(detail?.status_code)&&detail.status_code>=400&&detail.status_code<=599?detail.status_code:502;
  throw fail(detail?.message||'The internal MCP call could not be completed.',status,detail?.code||'MCP_TOOL_FAILED');
 }
 if(!response.ok||body.error)throw fail('The internal MCP call could not be completed.',502,'MCP_TOOL_FAILED');
 const result=body.result?.structuredContent;
 if(result?.scope?.project_id!==actor.projectId||result?.scope?.subject!==actor.user.id)throw fail('MCP response identity mismatch.');
 return result.data;
}

/** Revoke every credential this process still holds and forget them. For shutdown and tests; a turn's own credential also simply expires. */
async function release(){
 const entries=[...credentials.values()];
 credentials.clear();
 const ids=(await Promise.all(entries.map(entry=>entry.promise.then(credential=>credential.id,()=>null)))).filter(Boolean);
 for(const id of ids)await db.prepare('UPDATE mcp_credentials SET revoked_at=NOW() WHERE id=?').run(id);
 return ids.length;
}
module.exports={call,release};
