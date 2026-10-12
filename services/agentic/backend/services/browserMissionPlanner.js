const { aiInstructionBlock } = require('@hellotest/platform/backend/src/utils/aiInstructionBlocks');
const C=require('./qualityAgentContracts');
const sanitize=value=>require('@hellotest/platform/backend/src/security/aiTextPolicy').sanitizeAiText(String(value||'')).text;
function observation(value,target) {
  if(!value||!Number.isSafeInteger(value.sequence)||value.sequence<1||value.sequence>12||!Array.isArray(value.elements)||value.elements.length>80||typeof value.text!=='string'||value.text.length>10000||typeof value.title!=='string'||value.title.length>300)throw C.fail('The browser returned an invalid observation.',502,'QUALITY_AGENT_OBSERVATION');
  const url=C.targetUrl(value.url);if(new URL(url).origin!==new URL(target).origin)throw C.fail('The browser observation left the authorized origin.',403);
  const ids=new Set();
  const elements=value.elements.map(e=>{if(!e||!/^element-[1-9][0-9]?$/.test(e.id)||ids.has(e.id)||typeof e.label!=='string'||e.label.length>160||typeof e.tag!=='string'||typeof e.sensitive!=='boolean')throw C.fail('The browser returned invalid observed elements.',502);ids.add(e.id);return {id:e.id,tag:C.text(e.tag,30),label:sanitize(e.label),type:C.text(e.type,40),sensitive:e.sensitive,...(e.href?{href:C.targetUrl(e.href)}:{})};});
  return {sequence:value.sequence,url,title:sanitize(value.title),text:sanitize(value.text),elements,...(value.previous_error?{previous_error:C.text(value.previous_error,500)}:{})};
}
function missionOutcome(value, observed, previous = []) {
  if (!value || typeof value.title !== 'string' || !value.title.trim() || value.title.length > 255 || typeof value.summary !== 'string' || !value.summary.trim() || value.summary.length > 4000 || !Array.isArray(value.columns) || value.columns.length > 6 || !value.columns.every(column => typeof column === 'string' && column.trim() && column.length <= 120) || !Array.isArray(value.rows) || value.rows.length > 20) throw C.fail('The browser outcome does not satisfy its review schema.',502,'QUALITY_AGENT_OUTCOME_INVALID');
  const sources = [...previous, observed];
  const rows = value.rows.map(row => {
    if (!row || !Array.isArray(row.cells) || !row.cells.length || row.cells.length !== value.columns.length || !row.cells.every(cell => typeof cell === 'string' && cell.length <= 600) || !Number.isSafeInteger(row.evidence?.sequence) || typeof row.evidence.quote !== 'string' || !row.evidence.quote.trim() || row.evidence.quote.length > 500) throw C.fail('The browser outcome contains an invalid evidence row.',502,'QUALITY_AGENT_OUTCOME_INVALID');
    const source = sources.find(item => item.sequence === row.evidence.sequence);
    const quote = sanitize(row.evidence.quote).trim();
    const content = source && [source.title,source.text,...(source.elements || []).map(element => element.label)].join('\n');
    if (!content || !content.includes(quote)) throw C.fail('The browser outcome cites text that was not observed.',502,'QUALITY_AGENT_OUTCOME_INVALID');
    return { cells: row.cells.map(sanitize), evidence: { sequence: source.sequence, quote, url: source.url } };
  });
  return { title: sanitize(value.title), summary: sanitize(value.summary), columns: value.columns.map(sanitize), rows, review_required: true };
}
function decision(value,observed,target,previous=[]) {
  if(!value||!['click','fill','select','press','navigate','extract','complete','blocked','scroll','hover','wait','back','assert_text'].includes(value.action)||typeof value.summary!=='string'||!value.summary.trim()||value.summary.length>1200)throw C.fail('The model returned an invalid browser decision.',502);
  const next={action:value.action,summary:sanitize(value.summary)};
  if(['click','fill','select','press','hover'].includes(value.action)){const e=observed.elements.find(e=>e.id===value.element_id);if(!e||e.sensitive)throw C.fail('The browser decision selected an unavailable or sensitive element.',502);next.element_id=e.id;}
  if(['fill','select'].includes(value.action)){if(typeof value.value!=='string'||value.value.length>500||C.hasSensitiveValue(value.value)||sanitize(value.value)!==value.value)throw C.fail('The browser decision must use non-secret input.',502);next.value=value.value;}
  if(value.action==='press'){if(!['Enter','Tab','Escape','ArrowDown','ArrowUp'].includes(value.key))throw C.fail('The browser decision used an unsupported key.',502);next.key=value.key;}
  if(value.action==='scroll'){if(!['up','down'].includes(value.direction))throw C.fail('Choose a supported scroll direction.',502);next.direction=value.direction;}
  if(value.action==='assert_text'){if(typeof value.text!=='string'||!value.text.trim()||value.text.length>500||C.hasSensitiveValue(value.text)||sanitize(value.text)!==value.text)throw C.fail('Choose non-secret text to verify.',502);next.text=value.text.trim();}
  if(value.action==='navigate'){next.url=C.targetUrl(value.url);if(new URL(next.url).origin!==new URL(target).origin)throw C.fail('The browser decision must stay on the approved origin.',502);}
  if(value.outcome != null) { if(!['extract','complete'].includes(value.action))throw C.fail('Outcome rows can accompany extraction or completion only.',502); next.outcome=missionOutcome(value.outcome,observed,previous); }
  return next;
}
async function resolveMissionModel(request,user) {
  if(request.llm_integration_id && !await require('@hellotest/platform/backend/services/permission.service').hasPermission(user,'integration.view',request.project_id))throw C.fail('Model selection requires integration access.',403);
  const integration=await require('@hellotest/integration/backend/services/aiLlmSelection.service').resolveLlmIntegrationForUsage({userId:user.id,projectId:request.project_id,usageKey:`ai.agentic.browser.${request.kind}`,integrationId:request.llm_integration_id||undefined,fallback:'project-scoped',allowMissing:true});
  if(!integration)throw C.fail('Configure an active project LLM in AI Settings before starting an autonomous mission.',503,'QUALITY_AGENT_MODEL_REQUIRED');
  if(integration.config?.project_id&&integration.config.project_id!==request.project_id)throw C.fail('The browser model belongs to another project.',403);
  return integration;
}
async function decideMission(request,user,raw,history=[],traceContext={}) {
  const observed=observation(raw,request.target_url);
  const previous = (traceContext.observations || []).filter(item => item.sequence !== observed.sequence).slice(-11).map(item => observation(item,request.target_url));
  const integration=await resolveMissionModel(request,user);
  const base=(integration.base_url||'https://api.openai.com/v1').replace(/\/+$/,'');
  const response=await require('@hellotest/platform/backend/src/utils/llmTraceContext').run({project_id:request.project_id,actor_id:user.id,session_id:traceContext.session_id},()=>require('@hellotest/platform/backend/src/utils/llmHttpClient').fetchLlmWithRetry(/\/chat\/completions$/.test(base)?base:`${base}/chat/completions`,{method:'POST',headers:{'Content-Type':'application/json',...(require('@hellotest/integration/backend/services/integration.service').isUsableApiCredential(integration.api_key)?{Authorization:`Bearer ${integration.api_key}`}:{})},body:JSON.stringify({model:integration.model,max_tokens:4096,response_format:{type:'json_object'},messages:[
    {role:'system',content:aiInstructionBlock(`ai.agentic.browser.${request.kind}`, "browserMissionPlanner.response.1")},
    {role:'user',content:JSON.stringify({goal:request.goal,kind:request.kind,origin:new URL(request.target_url).origin,allow_form_submission:request.options.mission.allow_form_submission,remaining_actions:request.options.mission.max_actions-observed.sequence+1,observation:observed,prior_observations:previous.map(({sequence,url,title,text})=>({sequence,url,title,text})),history:history.slice(-12),reviewed_context:request.smart_context?.reviewed_context||null,evidence_scope:request.evidence_scope||{},context_provenance:{reviewed_context:'user-reviewed task data',page_text:'observed browser evidence',action_receipts:'verified by browser observations'}})}
  ]})},{integration,featureKey:`ai.agentic.browser.${request.kind}`,operation:`agentic-browser.decide.${request.kind}`,timeoutMs:20000,maxOutputTokens:4096,maxAttempts:1,contextFallback:false,contextRetrievalQuery:`${request.goal}\nAgent intent: ${C.AGENTS.find(agent=>agent.id===request.kind)?.description || request.kind}\n${request.smart_context?.query || ''}`,mcpContextFilters:{agent_id:`browser-${request.kind}`,app_type_id:request.app_type_id,requested_scopes:request.context_scopes||require('@hellotest/platform/shared/agentContextPolicies.json')[`browser-${request.kind}`].scopes,evidence_scope:request.evidence_scope||{},source_ids:request.smart_context?.source_ids,source_kinds:request.smart_context?.source_kinds}}));
  if(!response.ok)throw C.fail('The browser model is unavailable.',503);
  const payload=await response.json(),choice=payload?.choices?.[0];
  if(!choice||choice.finish_reason==='length'||choice.finish_reason==='content_filter'||choice.message?.refusal||choice.message?.tool_calls?.length)throw C.fail('The model returned an incomplete browser decision.',502);
  let parsed;try{parsed=JSON.parse(choice.message.content);}catch{throw C.fail('The model returned an invalid browser action. No further action was performed; review the partial observations and retry with a clearer task.',502,'QUALITY_AGENT_DECISION_INVALID');}
  return decision(parsed,observed,request.target_url,previous);
}
module.exports={missionOutcome,resolveMissionModel,decideMission,observation,decision};
