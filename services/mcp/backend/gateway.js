const traces=require('@hellotest/platform/backend/src/utils/llmTraceContext');
const {principal}=require('./auth');
const {withDeadline}=require('./mcpDeadline');
const {MCP_CONTEXT_PREFIX,compactEvidenceText,retainMcpRelationships}=require('@hellotest/platform/backend/src/utils/llmContextFallback');
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
 const invalid=()=>Object.assign(new Error('MCP returned an invalid or mismatched context packet.'),{code:'MCP_CONTEXT_SCOPE_MISMATCH'});
 if(!packet||!Array.isArray(packet.evidence)||packet.project_id!==projectId||packet.evidence.length>30)throw invalid();
 const seen=new Set();
 for(const item of packet.evidence){
  if(!item||typeof item!=='object'||Array.isArray(item)||item.project_id&&item.project_id!==projectId||item.authorized===false||['DENIED','NONE'].includes(item.visibility?.state)||['DELETED','TOMBSTONED','UNAVAILABLE'].includes(item.state))throw invalid();
  const identity=item.evidence_id||item.citation?.id;
  if(identity){if(typeof identity!=='string'||seen.has(identity))throw invalid();seen.add(identity);}
 }
 if(packet.contract_type==='ContextPacket'){
  if(packet.authorization?.project_scope_enforced!==true||packet.authorization?.source_acl_enforced!==true)throw invalid();
  if(packet.evidence.some(item=>!item.evidence_id||!item.source_id||typeof item.content!=='string'))throw invalid();
 }
 return require('./packetDelivery').normalizePacket(packet);
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
  ...(input.intentPlan?{intent_plan:require('./contextRequest').intentPlan.parse(input.intentPlan)}:{}),
  ...(input.budgets?{budgets:require('./contextRequest').packetBudgets(input.budgets),token_budget:Math.max(256,Math.min(32000,input.budgets.max_context_tokens??6000))}:{})};
}
function contextFromPacket(packet,request){
 const hits=packet.evidence.map(item=>({...item,id:item.evidence_id,chunk_id:item.chunk_id||item.evidence_id,
  score:item.scores?.fused||0,source_version:item.freshness?.source_version,
  citation:{id:item.evidence_id,source_id:item.source_id,source_kind:item.source_kind,source_ref_id:item.source_ref_id,document_id:item.document_id,chunk_id:item.chunk_id,
   label:item.title,location:item.location||item.locator,source_hash:item.integrity?.source_hash,version_hash:item.integrity?.version_hash,chunk_hash:item.integrity?.chunk_hash,source_version:item.freshness?.source_version,is_current:item.freshness?.current}}));
 const snapshot=packet.budget||{};
 if(!Number.isSafeInteger(snapshot.used?.tool_calls)||snapshot.used.tool_calls<0)throw Object.assign(new Error('MCP omitted the retrieval budget receipt.'),{code:'MCP_CONTEXT_CONTRACT'});
 return {request,packet,hits,retrieval:{...packet.retrieval,context_packet:packet,context_transport:'mcp',returned_count:hits.length},
  budget:{...snapshot,tool_calls_used:Number(snapshot.used?.tool_calls)||0},
  projectScope:{project_id:packet.project_id,app_type_id:packet.applied_filters?.app_type_id||null,filters:packet.applied_filters||{},context_route:packet.interpreted_request||{}},route:packet.interpreted_request||{}};
}
function retrievalQuestion(value){
 const text=typeof value==='string'?value.trim():'';
 if(!text)return '';
 let data;try{data=JSON.parse(text);}catch{
  const blocks=[...text.matchAll(/<(context|documents|task)>\s*([\s\S]*?)\s*<\/\1>/g)];
  if(!blocks.length||text.replace(/<(context|documents|task)>\s*([\s\S]*?)\s*<\/\1>/g,'').trim())return text.slice(0,4000);
  try{data=Object.fromEntries(blocks.map(([,key,value])=>[key,JSON.parse(value)]));if(typeof data.task==='string')data.user_request=data.task;else data.request=data.task;delete data.task;}catch{return text.slice(0,4000);}
 }
 const objectives=[],facts=[];
 const objectiveKeys=new Set(['user_request','prompt_guidance','question','goal','objective','additional_context']);
 const factKeys=new Set(['id','title','description','acceptance_criteria','specification_content','action','expected_result','actual_result','error','message','summary','name']);
 const containers=new Set(['generation_request','stories','story','requirement','requirements','current_case','test_case','selected_step','step','saved','proposed','artifact','context','documents','input','request','record','records','evidence']);
 let visited=0;
 const walk=(item,depth=0)=>{
  if(++visited>120||depth>5||item==null)return;
  if(Array.isArray(item)){for(const row of item.slice(0,8))walk(row,depth+1);return;}
  if(typeof item!=='object')return;
  for(const [key,value] of Object.entries(item)){
   if(objectiveKeys.has(key)&&typeof value==='string'&&value.trim())objectives.push(`${key}: ${value.trim().slice(0,2800)}`);
   else if(factKeys.has(key)&&typeof value==='string'&&value.trim())facts.push(`${key}: ${value.trim().slice(0,700)}`);
   else if(factKeys.has(key)&&Array.isArray(value))facts.push(`${key}: ${value.filter(row=>typeof row==='string').slice(0,6).join(' ').slice(0,1400)}`);
   else if(containers.has(key))walk(value,depth+1);
  }
 };
 walk(data);
 // Schemas, enum scaffolding, guardrails and parameter/credential bags do not
 // express a retrieval objective. Never send them as a proxy user question.
 return require('@hellotest/platform/backend/src/security/aiTextPolicy').sanitizeAiText([...new Set([...objectives,...facts])].join('\n').slice(0,4000)).text;
}
async function retrieveContext(input){
 const remote=Boolean(process.env.HELLOTEST_MCP_INTERNAL_URL);
 const args=remote?packetArguments({projectId:input.request.project_id,query:input.request.query,appTypeId:input.request.filters?.app_type_id,
  integrationId:input.integration?.id,filters:input.request.filters,budgets:input.request.budgets,intentPlan:input.intentPlan}):{question:input.request.query};
 const result=await contextCall({userId:input.user.id,projectId:input.request.project_id,args,signal:input.signal,timeoutMs:retrievalTimeout(input),...(!remote?{privateInput:{retrievalInput:input}}:{})});
 const context=remote?contextFromPacket(verifyPacket(result.packet,input.request.project_id),input.request):result.result;verifyPacket(context?.packet,input.request.project_id);
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
 if(options.mcpContextHandled){
  options.mcpContextStatus=options.mcpContextHandled.status|| (options.mcpContextHandled.evidence_count?'retrieved':'empty');
  return init;
 }
 if(options.contextRetrievalQuery===null){
  options.mcpContextStatus='query_unavailable';
  if(policy?.required)throw Object.assign(new Error('This feature requires knowledge context. Add a written description or select a Story so relevant project evidence can be retrieved alongside the image.'),{statusCode:422,code:'AI_MCP_QUERY_REQUIRED'});
  return init;
 }
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
  const taskQuestion=retrievalQuestion(options.contextRetrievalQuery||question);
  if(!taskQuestion){
   options.mcpContextStatus='query_unavailable';
   if(policy?.required)throw Object.assign(new Error('No semantic retrieval objective is available.'),{code:'MCP_CONTEXT_QUERY_EMPTY'});
   return init;
  }
  const focus=policy?.focus?`Context focus: ${policy.focus.slice(0,400)}\n`:'';
  const scopedQuestion=(`Task: ${trace.feature || options.operation || 'project assistance'}\n${focus}${taskQuestion}`).slice(0,4000);
  const selectedApp=options.mcpContextFilters?.app_type_id;
  if(trace.app_type_id&&selectedApp&&trace.app_type_id!==selectedApp)throw Object.assign(new Error('MCP application selectors do not match the active task.'),{code:'MCP_CONTEXT_SCOPE_MISMATCH',statusCode:403});
  const packetInput={projectId:trace.project_id,appTypeId:trace.app_type_id||selectedApp,query:scopedQuestion,filters:options.mcpContextFilters,integrationId:options.integration?.id,
   budgets:{max_context_tokens:policy?.token_budget||2000,max_evidence_items:policy?.max_items||12,deadline_ms:Math.max(0,timeoutMs-500)}};
  const result=await contextCall({userId:trace.actor_id,projectId:trace.project_id,args:packetArguments(packetInput),signal,timeoutMs,
    ...(options.mcpContextFilters&&!process.env.HELLOTEST_MCP_INTERNAL_URL?{privateInput:{packetInput}}:{})});
  const packet=verifyPacket(result.packet,trace.project_id);
  const evidence=packet.evidence;
  if(policy?.required && !evidence.length)throw Object.assign(new Error('Required evidence is missing.'),{code:'MCP_CONTEXT_EMPTY'});
  const context={project_id:trace.project_id,packet_id:packet.packet_id,observed_at:result.observed_at||packet.created_at,evidence:evidence.slice(0,policy?.max_items||12),relationships:[],limitations:packet.limitations,authorization:packet.authorization,applied_filters:packet.applied_filters,coverage:packet.coverage,evidence_quality:packet.evidence_quality,retrieval_status:evidence.length?packet.retrieval?.status:'NO_AUTHORIZED_EVIDENCE',intent_planning_mode:packet.retrieval?.intent_planning_mode,information_needs:packet.retrieval?.model_context_plan?.information_needs,context_transport:'mcp'};
  // Bound whole evidence items, never chop JSON or discard provenance strings.
  // Match the native packet's conservative UTF-8 estimate. Character counts
  // otherwise undercount non-Latin text and omit protocol metadata costs.
  const byteBudget=Math.min(96000,(policy?.token_budget||2000)*3);
  const bytes=()=>Buffer.byteLength(JSON.stringify(context),'utf8');
  const returnedCount=context.evidence.length;
  context.omitted_evidence_count=Math.max(0,evidence.length-returnedCount);
  const refreshRelationships=()=>{
    context.relationships=retainMcpRelationships(packet.relationships,context.evidence);
    context.omitted_relationship_count=(packet.relationships?.length||0)-context.relationships.length;
    if(context.omitted_evidence_count||context.omitted_relationship_count){
     const gap='Additional evidence or relationship witnesses were omitted to fit the configured context budget; omitted facts are unknown.';
     context.delivery_gaps=[gap];
     context.limitations=Array.isArray(packet.limitations)?[...packet.limitations,gap]:packet.limitations&&typeof packet.limitations==='object'?{...packet.limitations,delivery_gaps:[gap]}:[gap];
    }
  };
  refreshRelationships();
  if(bytes()>byteBudget)context.evidence=context.evidence.map(item=>{
    const compact={...item};
    const itemBudget=Math.max(180,Math.floor(byteBudget/Math.max(3,Math.min(returnedCount,5))));
    for(const key of ['content','text','snippet','summary'])if(typeof compact[key]==='string'&&Buffer.byteLength(compact[key],'utf8')>itemBudget){
     const ratio=itemBudget/Buffer.byteLength(compact[key],'utf8');
     compact[key]=compactEvidenceText(compact[key],Math.max(80,Math.floor(compact[key].length*ratio)));compact.excerpt_truncated=true;
    }
    if(compact.excerpt_truncated&&compact.content_scope){compact.source_content_scope=compact.content_scope;delete compact.content_scope;}
    return compact;
  });
  refreshRelationships();
  while(bytes()>byteBudget&&context.evidence.length){context.evidence.pop();context.omitted_evidence_count++;refreshRelationships();}
  if(bytes()>byteBudget)throw Object.assign(new Error('MCP metadata exceeds the configured context budget.'),{code:'MCP_CONTEXT_BUDGET'});
  if(policy?.required && !context.evidence.length)throw Object.assign(new Error('Required evidence exceeds the context budget.'),{code:'MCP_CONTEXT_BUDGET'});
  const messages=[...body.messages];messages.splice(questionIndex,0,{role:'user',content:MCP_CONTEXT_PREFIX+JSON.stringify(context)});
  options.mcpContextStatus=context.evidence.length?'retrieved':'empty';
  traces.update({mcp_context:options.mcpContextStatus});
  return {...init,body:JSON.stringify({...body,messages})};
 }catch(error){
  options.signal?.throwIfAborted();init.signal?.throwIfAborted();
  if(error.code==='MCP_CONTEXT_SCOPE_MISMATCH'&&error.statusCode===403)throw error;
  options.mcpContextStatus='unavailable';
  if(policy?.required)throw Object.assign(new Error('Required MCP evidence is unavailable. Retry after restoring the context connection.'),{statusCode:503,code:'AI_MCP_CONTEXT_REQUIRED'});
  traces.update({mcp_context:'unavailable',mcp_context_error:error.code||'MCP_CONTEXT_UNAVAILABLE'});
  const messages=[...body.messages];messages.splice(questionIndex,0,{role:'user',content:'Additional HelloTest MCP context is unavailable for this request. Treat missing evidence as a gap; do not claim access, certainty or successful actions.'});
  return {...init,body:JSON.stringify({...body,messages})};
 }
}
module.exports={retrievalTimeout,packetArguments,retrievalQuestion,contextFromPacket,verifyPacket,installTransport,contextCall,retrieveContext,retrievePacket,enrichChatRequest};
