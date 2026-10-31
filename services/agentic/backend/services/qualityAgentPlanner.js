const { aiInstructionBlock } = require('@hellotest/platform/backend/src/utils/aiInstructionBlocks');
const C=require('./qualityAgentContracts');
// Planning can suggest actions; only the separately reviewed, typed plan is executable.
// It never claims to have seen DOM, run checks, or produced findings.
async function proposePlan(input,user) {
  const permissions=require('@hellotest/platform/backend/services/permission.service');
  if(input.llm_integration_id&&!await permissions.hasPermission(user,'integration.view',input.project_id))throw C.fail('Permission required: integration.view',403);
  const selection=require('@hellotest/integration/backend/services/aiLlmSelection.service');
  const integration=await selection.resolveLlmIntegrationForUsage({integrationId:input.llm_integration_id,userId:user.id,projectId:input.project_id,usageKey:'ai.agentic.quality_plan',fallback:'project-scoped',allowMissing:true});
  if(!integration)return null;
  if(integration.config?.project_id&&integration.config.project_id!==input.project_id)throw C.fail('The model connection belongs to another project.',403);
  let locatorContext=[];
  if(await permissions.hasPermission(user,'automation.view',input.project_id)) {
    const rows=await require('@hellotest/automation/backend/services/aiAutomationBuilder.service').listLearningCache({project_id:input.project_id,app_type_id:input.app_type_id,limit:100});
    locatorContext=rows.filter(row=>{
      let origin;try{origin=new URL(row.page_url).origin;}catch{return false;}
      return origin===new URL(input.target_url).origin && row.metadata?.record_kind!=='screen' && row.locator_intent!=='__screen__' && row.metadata?.deprecated!==true && row.metadata?.is_active!==false && ['css','css selector','CSS'].includes(row.locator_kind||'css') && typeof row.locator==='string' && row.locator.length<=240;
    }).slice(0,40).map(row=>({id:row.id,name:C.text(row.metadata?.object_name||row.locator_intent,120),screen:C.text(row.metadata?.screen_name||row.page_key,120),selector:row.locator}));
  }
  const selectionContext=C.contextSelection(input),deadline=Date.now()+20000;
  let feedback;
  for(let revision=0;revision<2;revision++) {
  if(deadline-Date.now()<1000)throw C.fail('The bounded journey planning deadline elapsed.',504,'QUALITY_AGENT_PLAN_DEADLINE');
  const response=await require('@hellotest/platform/backend/src/utils/llmTraceContext').run({project_id:input.project_id,actor_id:user.id},()=>require('@hellotest/platform/backend/src/utils/llmHttpClient').fetchLlmWithRetry(`${(integration.base_url||'https://api.openai.com/v1').replace(/\/$/,'')}/chat/completions`,{
    method:'POST',headers:{'Content-Type':'application/json',...(require('@hellotest/integration/backend/services/integration.service').isUsableApiCredential(integration.api_key)?{Authorization:`Bearer ${integration.api_key}`}:{})},body:JSON.stringify({model:integration.model,max_tokens:2200,response_format:{type:'json_object'},messages:[
      {role:'system',content:require('./qualityAgentSkills').instructionBlock('web',{phase:'planning'})},
      {role:'system',content:aiInstructionBlock("ai.agentic.quality_plan", "qualityAgentPlanner.response.1")},
      ...(feedback?[{role:'system',content:aiInstructionBlock('ai.agentic.quality_plan','qualityAgentPlanner.revision')}]:[]),
      {role:'user',content:JSON.stringify({task_brief:C.taskBrief({...input,kind:'web'}),reviewed_context:selectionContext.smart_context.reviewed_context||null,authorized_locator_context:locatorContext,...(feedback?{validation_feedback:feedback}:{})})}
    ]})
  },{integration,featureKey:'ai.agentic.quality_plan',operation:'agentic-quality.plan',maxOutputTokens:2200,timeoutMs:Math.max(1000,deadline-Date.now()),maxAttempts:1,contextFallback:false,contextRetrievalQuery:input.goal,mcpContextFilters:{agent_id:'browser-web',app_type_id:input.app_type_id,requested_scopes:selectionContext.context_scopes,evidence_scope:selectionContext.evidence_scope,source_ids:selectionContext.smart_context.source_ids,source_kinds:selectionContext.smart_context.source_kinds}}));
  if(!response.ok)throw C.fail('Model planning is currently unavailable.',503);
  const payload=await response.json(),choice=payload?.choices?.[0];
  if(!choice||choice.finish_reason==='length'||choice.finish_reason==='content_filter'||choice.message?.refusal||choice.message?.tool_calls?.length||typeof choice.message?.content!=='string')throw C.fail('The model returned an incomplete or unsupported plan.',502);
  try {
  let parsed;try{parsed=JSON.parse(choice.message.content);}catch{throw C.fail('Return a complete JSON object with the typed steps array.',502,'QUALITY_AGENT_PLAN_INVALID');}
  if(!parsed||!Array.isArray(parsed.steps))throw C.fail('The model returned an invalid journey plan.',502);
  const steps=C.normalizeSteps(parsed.steps,input.target_url);
  if(steps.some(step=>step.selector&&!locatorContext.some(row=>row.selector===step.selector)&&!input.goal.includes(step.selector)))throw C.fail('The model proposed a selector outside its authorized planning context.',502);
  return {steps,grounding:locatorContext.filter(row=>steps.some(step=>step.selector===row.selector)).map(({id,name,screen,selector})=>({source:'object_repository',id,name,screen,selector}))};
  } catch(error) {
    if(revision||Date.now()>=deadline-1000||!['QUALITY_AGENT_INVALID','QUALITY_AGENT_PLAN_INVALID'].includes(error.code))throw error;
    feedback={code:error.code,message:error.publicMessage,steps_executed:0};
  }
  }
}
module.exports={proposePlan:(input,user)=>require('../workflows/nodeAiConfiguration').runRequest(input,'ai.agentic.quality_plan',()=>proposePlan(input,user))};
