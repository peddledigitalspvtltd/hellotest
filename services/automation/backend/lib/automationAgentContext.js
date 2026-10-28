const { sanitizeAiText } = require('@hellotest/platform/backend/src/security/aiTextPolicy');
const { reviewedContextForPacket } = require('./automationKnowledgeContext');
const scopes = new Set(['stories','test-cases','automation','runs','bugs','knowledge']);
const fields = new Set(require('@hellotest/platform/shared/agentEvidenceScopeFields.json').map(field => field.key));
function normalizeAgentContext(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Object.assign(new Error('Agent context must be an object.'),{statusCode:400});
  const text=(value,max)=>sanitizeAiText(String(value || '').slice(0,max)).text;
  const invalid=()=>Object.assign(new Error('Evidence selectors must be bounded strings without control characters.'),{statusCode:400});
  const selector=(input,max=255)=>{
    if(typeof input!=='string')throw invalid();
    const result=input.trim();
    if(result.length>max||/[\u0000-\u001f\u007f-\u009f]/.test(result))throw invalid();
    return result;
  };
  const list=(value,max,itemLength=255)=>[...new Set((Array.isArray(value)?value:[]).map(item=>selector(item,itemLength)).filter(Boolean))].slice(0,max);
  const inputs=value.inputs || {},smart=value.smart_context || {};
  if(typeof inputs!=='object'||Array.isArray(inputs)||typeof smart!=='object'||Array.isArray(smart))throw Object.assign(new Error('Evidence scope and Smart Context must be objects.'),{statusCode:400});
  return {context_scopes:Array.isArray(value.context_scopes)?list(value.context_scopes,6).filter(scope=>scopes.has(scope)):['automation','test-cases','stories','runs','knowledge'],
    // Scope IDs must remain exact and cleared fields must not reach MCP.
    inputs:Object.fromEntries(Object.entries(inputs).filter(([key])=>fields.has(key)).map(([key,input])=>[key,selector(input)]).filter(([,input])=>input)),
    smart_context:{query:text(smart.query,2000),source_ids:list(smart.source_ids,100),source_kinds:list(smart.source_kinds,20,80),reviewed_context:text(smart.reviewed_context,12000)}};
}
async function retrieveAgentContext({testCase,userId,selection,prompt,signal,policy={mode:"mcp",required:false,token_budget:2000,max_items:12,focus:""}}) {
  signal?.throwIfAborted();
  const options=normalizeAgentContext(selection);
  if(policy.mode === "none")return {knowledge:[],context_transport:"not_required",context_scopes:[],limitations:["Additional MCP retrieval is disabled in AI Controls."]};
  if(!options.context_scopes.length && policy.required)throw Object.assign(new Error("AI Controls requires MCP context; select at least one context source."),{statusCode:422,code:"AI_MCP_CONTEXT_REQUIRED"});
  if(!options.context_scopes.length)return {knowledge:[],context_scopes:[],limitations:['Additional context sources were deselected. The pinned case and its sections remain the task input.']};
  try {
    const packet=await require('@hellotest/mcp/backend/gateway').retrievePacket({user:{id:userId},projectId:testCase.project_id,appTypeId:testCase.app_type_id,signal,
      budgets:{max_context_tokens:policy.token_budget,max_evidence_items:policy.max_items,deadline_ms:20000},
      query:[prompt,testCase.title,policy.focus,options.smart_context.query].filter(Boolean).join('\n').slice(0,4000),
      filters:{app_type_id:testCase.app_type_id,agent_id:'automation-engineer',requested_scopes:options.context_scopes,
        evidence_scope:{...options.inputs,test_case_id:testCase.id},source_ids:options.smart_context.source_ids,source_kinds:options.smart_context.source_kinds}});
    if(policy.required && !packet.evidence?.length)throw Object.assign(new Error("Required MCP evidence is missing."),{code:"AI_MCP_CONTEXT_REQUIRED"});
    const knowledge=(packet.evidence || []).slice(0,policy.max_items).map(item=>({...item,title:item.title || item.citation?.label,content:item.content || item.text || item.snippet}));
    const reviewed=reviewedContextForPacket({selection:options,policy,knowledge});
    return {knowledge,...(reviewed.reviewed_context?{reviewed_context:reviewed.reviewed_context}:{}),
      context_transport:'mcp',context_scopes:options.context_scopes,limitations:packet.limitations || [],supplemental_limitations:reviewed.limitations || [],coverage:packet.coverage};
  } catch(error) {
    signal?.throwIfAborted();
    if(policy.required)throw Object.assign(new Error("Required MCP context is unavailable. Restore the context service or review AI Controls."),{statusCode:503,code:"AI_MCP_CONTEXT_REQUIRED",cause:error});
    return {knowledge:[],context_transport:'mcp',context_scopes:options.context_scopes,limitations:[`Additional MCP context is unavailable (${error.code || 'retrieval failed'}). Only the pinned case and authorized direct context are available; missing context is unknown.`]};
  }
}
module.exports={normalizeAgentContext,retrieveAgentContext};
