// Trusted composition-root configuration for a separate durable worker.
// The model cannot choose this endpoint or forward an application credential.
const {issue,fail}=require('./auth');
const db=require('@hellotest/platform/backend/src/db');
const {readBoundedResponseJson}=require('@hellotest/platform/backend/src/utils/boundedResponse');
async function call(actor,name,args,signal){
 const url=new URL(process.env.HELLOTEST_MCP_INTERNAL_URL);
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash||!url.pathname.endsWith('/mcp'))throw fail('Configure a fixed internal MCP endpoint.',500,'MCP_CONFIGURATION');
 if(actor.retrievalInput||actor.packetInput)throw fail('Private retrieval callbacks require the API-process transport.',500,'MCP_CONFIGURATION');
 const credential=await issue(actor.user,actor.projectId,actor.clientId);
 try{
  const payload={jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args,_meta:{'io.modelcontextprotocol/protocolVersion':'2026-07-28','io.modelcontextprotocol/clientCapabilities':{}}}};
  const response=await fetch(url,{method:'POST',redirect:'error',signal:AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(require('./contextRequest').requestTimeoutMs(payload))]),headers:{'Content-Type':'application/json',Authorization:'Bearer '+credential.token,Accept:'application/json, text/event-stream','MCP-Protocol-Version':'2026-07-28','Mcp-Method':'tools/call','Mcp-Name':name},body:JSON.stringify(payload)});
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
 }finally{
  await db.prepare('UPDATE mcp_credentials SET revoked_at=NOW() WHERE id=?').run(credential.id);
 }
}
module.exports={call};
