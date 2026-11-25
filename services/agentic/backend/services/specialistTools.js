const gateway=require('@hellotest/mcp/backend/gateway');
const registry=require('@hellotest/mcp/backend/registry');
const {sanitizeAiEvidence}=require('@hellotest/platform/backend/src/security/aiTextPolicy');
const denied=message=>Object.assign(new Error(message),{code:'AGENT_TOOL_DENIED',statusCode:403});
const kinds={stories:'requirement','test-cases':'test_case',runs:'execution',bugs:'bug'};
const paths={requirement:'/requirements/:id',test_case:'/test-cases/:id',execution:'/executions/:id',bug:'/issues/:id'};
const scopeFields={requirement:'story_id',test_case:'test_case_id',execution:'execution_id',bug:'bug_id'};
const recordScopes=Object.fromEntries(Object.entries(kinds).map(([scope,kind])=>[kind,scope]));
function createSpecialistTools({user,projectId,appTypeId,context,requestedScopes,policy,smartContext={},evidenceScope={},deadline,signal,onEvent,onEvidence,assertAccess,maxCalls=4,call=gateway.callSpecialistReadTool}){
  let used=0;const records=new Map(),ids=new Set();
  const allowed=new Set(policy.allowed_tools||[]),selected=new Set(requestedScopes||[]);
  const configuredScopes = new Set(policy.context_scopes || requestedScopes);
  const canUseAuxiliary = name => allowed.has(name) || !policy.explicit_tool_selection && allowed.has('project_evidence');
  const remember=(kind,ref)=>{if(!paths[kind]||typeof ref!=='string'||ref.length>255||records.size>=100
    || policy.explicit_tool_selection && !configuredScopes.has(recordScopes[kind]))return;const pinned=evidenceScope[scopeFields[kind]];if(pinned&&pinned!==ref)return;records.set(kind+':'+ref,{kind,id:ref});};
  function observeRecords(){
    for(const[scope,items]of Object.entries(context||{}))for(const item of Array.isArray(items)?items:[]){
      let body;try{body=JSON.parse(item.content||'{}');}catch{body={};}
      const kind=kinds[scope]||item.citation?.record_kind;
      for(const row of body.records||[])remember(kind,row.id||row.ref_id);
      if(paths[kind]&&item.ref_id)remember(kind,item.ref_id);
    }
    for(const[kind,field]of Object.entries(scopeFields))if(evidenceScope[field])remember(kind,evidenceScope[field]);
  }
  observeRecords();
  const constrained=Boolean(Object.keys(evidenceScope).length||smartContext.source_ids?.length||smartContext.source_kinds?.length);
  const definitions=()=>{
    const values=[];
    if(allowed.has('project_evidence')&&[...selected].some(scope=>scope!=='knowledge'))values.push({name:'project_evidence',description:'Fetch one missing piece of current project evidence inside the saved application, selected record scope and permissions. Read only.',parameters:{type:'object',properties:{question:{type:'string',minLength:1,maxLength:700}},required:['question'],additionalProperties:false}});
    if(allowed.has('knowledge_search')&&selected.has('knowledge'))values.push({name:'knowledge_search',description:'Search authorized indexed evidence within the saved source selection. Cite only returned evidence IDs.',parameters:{type:'object',properties:{question:{type:'string',minLength:1,maxLength:700}},required:['question'],additionalProperties:false}});
    if(canUseAuxiliary('record_read')&&records.size)values.push({name:'record_read',description:'Read an exact record already observed in selected evidence; cannot enumerate arbitrary record identifiers.',parameters:{type:'object',properties:{record_ref:{type:'string',enum:[...records.keys()]}},required:['record_ref'],additionalProperties:false}});
    if(canUseAuxiliary('graph_read')&&!constrained&&configuredScopes.has('knowledge')&&records.size)values.push({name:'graph_read',description:'Read witnessed graph relationships around one observed record. A relationship is evidence, not an executed effect.',parameters:{type:'object',properties:{record_ref:{type:'string',enum:[...records.keys()]}},required:['record_ref'],additionalProperties:false}});
    return used>=maxCalls?[]:values.map(value=>({type:'function',function:value}));
  };
  const ingest=async value=>{
    const packet=value?.contract_type==='ContextPacket'?value:value?.context_packet||value;
    if(packet?.project_id&&packet.project_id!==projectId)throw denied('Tool evidence belongs to another project.');
    if(appTypeId&&packet?.app_type_id&&packet.app_type_id!==appTypeId)throw denied('Tool evidence belongs to another application.');
    for(const evidence of packet?.evidence||[]){
      if(!evidence||evidence.authorized===false||['DENIED','NONE'].includes(evidence.visibility?.state)||['DELETED','TOMBSTONED','UNAVAILABLE'].includes(evidence.state)||evidence.project_id&&evidence.project_id!==projectId)throw denied('Tool evidence belongs to another scope.');
      const citation=evidence.citation||{id:evidence.evidence_id,source_id:evidence.source_id,source_kind:evidence.source_kind,chunk_id:evidence.chunk_id,document_id:evidence.document_id};
      if(!citation.id||ids.has(citation.id))continue;ids.add(citation.id);
      await onEvidence?.({...evidence,id:citation.id,citation,content:evidence.content||''});
    }
    observeRecords();
  };
  return {get used(){return used;},get evidenceIds(){return [...ids];},definitions,
    async execute(calls){
      if(!Array.isArray(calls)||!calls.length||calls.length>maxCalls-used)throw Object.assign(new Error('The specialist read-only tool budget was exceeded.'),{code:'AGENT_TOOL_BUDGET',statusCode:422});
      const messages=[];
      for(const toolCall of calls){
        signal?.throwIfAborted();await assertAccess?.();
        if(Date.now()>=deadline)throw Object.assign(new Error('The specialist tool deadline was reached.'),{code:'AGENT_DEADLINE',statusCode:504});
        const name=toolCall?.function?.name,definition=definitions().find(item=>item.function.name===name);
        if(!definition||typeof toolCall.id!=='string'||!/^[A-Za-z0-9_.:-]{1,160}$/.test(toolCall.id))throw denied('The model requested an unavailable specialist tool.');
        let args;try{args=JSON.parse(toolCall.function.arguments);}catch{throw denied('Tool arguments must be valid JSON.');}
        if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).some(key=>!Object.hasOwn(definition.function.parameters.properties,key)))throw denied('Tool arguments attempted to change the host scope.');
        let tool,argumentsValue;
        if(['project_evidence','knowledge_search'].includes(name)){
          if(typeof args.question!=='string'||!args.question.trim()||args.question.length>700)throw denied('Supply a bounded evidence question.');
          tool='hellotest_context_build';argumentsValue={question:args.question, ...(appTypeId?{app_type_id:appTypeId}:{}),token_budget:3000,planning_mode:'deterministic',filters:{requested_scopes:name==='knowledge_search'?['knowledge']:[...selected],...(Object.keys(evidenceScope).length?{evidence_scope:evidenceScope}:{}),...(smartContext.source_ids?.length?{source_ids:smartContext.source_ids}:{}),...(smartContext.source_kinds?.length?{source_kinds:smartContext.source_kinds}:{})},budgets:{deadline_ms:Math.min(10000,Math.max(1,deadline-Date.now())),max_tool_calls:4,max_queries:2,max_evidence_items:8,max_context_tokens:3000,max_query_cost_usd:0}};
        }else{
          const record=records.get(args.record_ref);if(!record)throw denied('Only observed record identities may be read.');
          if(name==='graph_read'){tool='hellotest_graph_context';argumentsValue={seeds:[{kind:record.kind,ref_id:record.id}],...(appTypeId?{app_type_id:appTypeId}:{}),hops:1,max_nodes:20,max_edges:20,max_evidence:8,token_budget:3000,timeout_ms:Math.min(10000,Math.max(1,deadline-Date.now()))};}
          else{const operation=registry.all().find(op=>op.method==='GET'&&op.path===paths[record.kind]&&op.exposure==='read');if(!operation)throw denied('This record has no registered read contract.');tool='hellotest_operation_read';argumentsValue={operation_id:operation.id,arguments:{path:{id:record.id}}};}
        }
        used++;const started=Date.now();await onEvent?.({phase:'tool.started',message:`Read-only ${name} requested.`,details:{
          tool:name,effect:'read',arguments:JSON.parse(sanitizeAiEvidence(args).text),call:used,max_calls:maxCalls
        }});
        try{
          const value=await call({userId:user.id,projectId,name:tool,args:argumentsValue,signal,timeoutMs:Math.min(10000,Math.max(1,deadline-Date.now()))});
          const data=value?.data||value;if(data?.project_id&&data.project_id!==projectId)throw denied('The record is outside the selected project.');if(appTypeId&&data?.app_type_id&&data.app_type_id!==appTypeId)throw denied('The record is outside the selected application.');
          const sanitized=JSON.parse(sanitizeAiEvidence(data).text);await ingest(sanitized);
          const content=JSON.stringify(sanitized);if(Buffer.byteLength(content,'utf8')>64000)throw Object.assign(new Error('Tool evidence exceeded the specialist response budget.'),{code:'AGENT_TOOL_RESPONSE_BUDGET',statusCode:422});
          messages.push({role:'tool',tool_call_id:toolCall.id,content});
          await onEvent?.({phase:'tool.completed',message:`Read-only ${name} returned evidence.`,details:{tool:name,call:used,duration_ms:Date.now()-started}});
        }catch(error){await onEvent?.({phase:'tool.failed',level:'warning',message:`Read-only ${name} did not return usable evidence.`,details:{tool:name,call:used,code:error.code||'AGENT_TOOL_FAILED',duration_ms:Date.now()-started}});throw error;}
      }
      return messages;
    }};
}
module.exports={createSpecialistTools};
