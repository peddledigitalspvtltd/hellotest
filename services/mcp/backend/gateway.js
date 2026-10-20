const traces=require('@hellotest/platform/backend/src/utils/llmTraceContext');
const {principal}=require('./auth');
const {withDeadline}=require('./mcpDeadline');
const {MCP_CONTEXT_PREFIX,compactEvidenceText}=require('@hellotest/platform/backend/src/utils/llmContextFallback');
let transport;
const installTransport=call=>{transport=call;};
async function contextCall({userId,projectId,args,signal,privateInput,timeoutMs=30000}){
 return withDeadline(async boundedSignal=>{
  const actor=await principal(userId,projectId,'hellotest-internal');
  if(privateInput)Object.assign(actor,privateInput);
  if(!transport)throw Object.assign(new Error('MCP context transport is not initialized.'),{code:'MCP_CONTEXT_UNAVAILABLE'});
  return traces.run({mcp_context_depth:1},()=>transport(actor,'hellotest_context_build',args,boundedSignal));
 },{signal,timeoutMs});
}
function verifyPacket(packet,projectId){
 if(!packet||!Array.isArray(packet.evidence)||packet.project_id!==projectId)throw Object.assign(new Error('MCP returned an invalid or mismatched context packet.'),{code:'MCP_CONTEXT_SCOPE_MISMATCH'});
 return packet;
}
function retrievalTimeout(input) {
 const configured=Number((input.request?.budgets||input.budgets)?.deadline_ms);
 const retrievalMs=Number.isFinite(configured)&&configured>=0?Math.min(60000,configured):30000;
 const callerMs=Number(input.timeoutMs);
 // The principal/protocol exchange shares the turn budget, with a small
 // assembly allowance; a normalized 60s retrieval must not hit a 30s bridge.
 return Math.max(1,Math.min(retrievalMs+2000,Number.isFinite(callerMs)?callerMs:62000));
}
function packetArguments(input){
 const selected=input.filters||{};
 if(input.appTypeId&&selected.app_type_id&&input.appTypeId!==selected.app_type_id)throw Object.assign(new Error('MCP application selectors do not match.'),{code:'MCP_CONTEXT_SCOPE_MISMATCH',statusCode:403});
 const filters=Object.fromEntries(['requested_scopes','evidence_scope','collection_ids','source_ids','source_kinds','agent_id','as_of'].filter(key=>selected[key]!==undefined).map(key=>[key,selected[key]]));
 return {question:input.query,app_type_id:input.appTypeId||selected.app_type_id,integration_id:input.integrationId||input.integration?.id,filters,
  ...(input.budgets?{budgets:require('./contextRequest').packetBudgets(input.budgets),token_budget:Math.max(256,Math.min(32000,input.budgets.max_context_tokens??6000))}:{})};
}
async function retrieveContext(input){
 const result=await contextCall({userId:input.user.id,projectId:input.request.project_id,args:{question:input.request.query},signal:input.signal,timeoutMs:retrievalTimeout(input),privateInput:{retrievalInput:input}});
 const context=result.result;verifyPacket(context?.packet,input.request.project_id);
 traces.update({mcp_context:'retrieved'});context.retrieval={...context.retrieval,context_transport:'mcp'};return context;
}
async function retrievePacket(input){
 const result=await contextCall({userId:input.user.id,projectId:input.projectId,args:packetArguments(input),signal:input.signal,timeoutMs:retrievalTimeout(input),
  ...(!process.env.HELLOTEST_MCP_INTERNAL_URL?{privateInput:{packetInput:input}}:{})});
 const packet=verifyPacket(result.packet,input.projectId);
 traces.update({mcp_context:'retrieved'});return {...packet,retrieval:{...packet.retrieval,context_transport:'mcp'}};
}
async function enrichChatRequest(init,options={}){
 const trace={...traces.current(options.integration),...options.traceContext};
 const policy=options.mcpContextPolicy;
 if(policy?.mode==='none'){options.mcpContextStatus='not_required';return init;}
 if(trace.mcp_context_depth||String(options.operation||'').startsWith('knowledge.')){options.mcpContextStatus=trace.mcp_context||'handled_by_context_pipeline';return init;}
 if(!trace.actor_id||!trace.project_id){options.mcpContextStatus='scope_missing';if(policy?.required)throw Object.assign(new Error('Required MCP context needs a verified project and user.'),{statusCode:422,code:'AI_MCP_SCOPE_REQUIRED'});return init;}
 if(typeof init.body!=='string')return init;
 let body;try{body=JSON.parse(init.body);}catch{return init;}
 if(!Array.isArray(body.messages))return init;
 const textContent=content=>typeof content==='string'?content:Array.isArray(content)?content.filter(part=>part?.type==='text'&&typeof part.text==='string').map(part=>part.text).join('\n'):'';
 const questionIndex=body.messages.findLastIndex(message=>message.role==='user'&&textContent(message.content).trim());
 const question=questionIndex<0?'':textContent(body.messages[questionIndex].content);
 if(!question)return init;
 try{
  const timeoutMs=Math.max(1,Math.min(8000,Math.floor(Number(options.timeoutMs||90000)/3),Number(options.mcpContextTimeoutMs||8000)));
  const signal=options.signal&&init.signal?AbortSignal.any([options.signal,init.signal]):options.signal||init.signal;
  const taskQuestion=options.contextRetrievalQuery||question;
  const focus=policy?.focus?`Context focus: ${policy.focus.slice(0,400)}\n`:'';
  const scopedQuestion=(`Task: ${trace.feature || options.operation || 'project assistance'}\n${focus}${taskQuestion}`).slice(0,4000);
  const packetInput={projectId:trace.project_id,appTypeId:options.mcpContextFilters?.app_type_id,query:scopedQuestion,filters:options.mcpContextFilters,integrationId:options.integration?.id,
   budgets:{max_context_tokens:policy?.token_budget||2000,max_evidence_items:policy?.max_items||12,deadline_ms:Math.max(0,timeoutMs-500)}};
  const result=await contextCall({userId:trace.actor_id,projectId:trace.project_id,args:packetArguments(packetInput),signal,timeoutMs,
    ...(options.mcpContextFilters&&!process.env.HELLOTEST_MCP_INTERNAL_URL?{privateInput:{packetInput}}:{})});
  const packet=verifyPacket(result.packet,trace.project_id);
  const evidence=packet.evidence;
  if(policy?.required && !evidence.length)throw Object.assign(new Error('Required evidence is missing.'),{code:'MCP_CONTEXT_EMPTY'});
  const context={project_id:trace.project_id,observed_at:result.observed_at,evidence:evidence.slice(0,policy?.max_items||12),limitations:packet.limitations,coverage:packet.coverage,evidence_quality:packet.evidence_quality,retrieval_status:packet.retrieval?.status,intent_planning_mode:packet.retrieval?.intent_planning_mode,information_needs:packet.retrieval?.model_context_plan?.information_needs,context_transport:'mcp'};
  // Bound whole evidence items, never chop JSON or discard provenance strings.
  const charBudget=Math.min(32000,(policy?.token_budget||2000)*4);
  const returnedCount=context.evidence.length;
  context.omitted_evidence_count=Math.max(0,evidence.length-returnedCount);
  if(JSON.stringify(context).length>charBudget)context.evidence=context.evidence.map(item=>{
    const compact={...item};
    const itemBudget=Math.max(500,Math.floor(charBudget/Math.max(2,Math.min(returnedCount,4))));
    for(const key of ['content','text','snippet','summary'])if(typeof compact[key]==='string'&&compact[key].length>itemBudget){compact[key]=compactEvidenceText(compact[key],itemBudget);compact.excerpt_truncated=true;}
    return compact;
  });
  while(JSON.stringify(context).length>charBudget&&context.evidence.length){context.evidence.pop();context.omitted_evidence_count++;}
  if(context.omitted_evidence_count)context.limitations=[...(Array.isArray(packet.limitations)?packet.limitations:[]),'Additional evidence was omitted to fit the configured context budget; omitted facts are unknown.'];
  if(policy?.required && !context.evidence.length)throw Object.assign(new Error('Required evidence exceeds the context budget.'),{code:'MCP_CONTEXT_BUDGET'});
  const messages=[...body.messages];messages.splice(questionIndex,0,{role:'user',content:MCP_CONTEXT_PREFIX+JSON.stringify(context)});
  options.mcpContextStatus='retrieved';
  traces.update({mcp_context:'retrieved'});
  return {...init,body:JSON.stringify({...body,messages})};
 }catch(error){
  options.signal?.throwIfAborted();init.signal?.throwIfAborted();
  options.mcpContextStatus='unavailable';
  if(policy?.required)throw Object.assign(new Error('Required MCP evidence is unavailable. Retry after restoring the context connection.'),{statusCode:503,code:'AI_MCP_CONTEXT_REQUIRED'});
  traces.update({mcp_context:'unavailable',mcp_context_error:error.code||'MCP_CONTEXT_UNAVAILABLE'});
  const messages=[...body.messages];messages.splice(questionIndex,0,{role:'user',content:'Additional HelloTest MCP context is unavailable for this request. Treat missing evidence as a gap; do not claim access, certainty or successful actions.'});
  return {...init,body:JSON.stringify({...body,messages})};
 }
}
module.exports={retrievalTimeout,packetArguments,installTransport,contextCall,retrieveContext,retrievePacket,enrichChatRequest};
