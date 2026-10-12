const configuration = require('../../services/aiConfiguration.service');
const context = require('./llmTraceContext');
const { getCompletionContent } = require('./llmResponse');
const Ajv = require('ajv');
const validators = new Map();
const ajv = new Ajv({strict:true,validateFormats:false,ownProperties:true});

function composeMessages(messages,config) {
  const native=messages.filter(message=>['system','developer'].includes(message.role));
  const instruction=[
    ...native.map(message=>typeof message.content==='string'&&message.content.trim()?`Configured request guidance and application format: ${message.content}`:''),
    `Role: ${config.role}`,`Domain: ${config.domain}`,`Task: ${config.task}`,config.prompt,
    ...(config.output_schema?[`Additional output constraint (native application schema must still be satisfied): ${JSON.stringify(config.output_schema)}`]:[]),
    `Guardrails: ${config.guardrails}`
  ].filter(Boolean).join('\n\n');
  return [{role:'system',content:instruction},...messages.filter(message=>!['system','developer'].includes(message.role))];
}

async function apply(init, options={}) {
  if(typeof init.body!=='string')return {init,options};
  let payload;try{payload=JSON.parse(init.body);}catch{return {init,options};}
  const scope=context.current(options.integration);
  const id=(options.featureKey && configuration.featureId(options.featureKey,null)) || configuration.featureId(options.operation,scope.feature);
  if(!id&&init.body.includes('⟦HELLOTEST_AI:'))throw Object.assign(new Error('This AI operation needs a registered feature mapping.'),{statusCode:503,code:'AI_FEATURE_UNMAPPED'});
  if(!id){return {init,options:{...options,traceContext:{...options.traceContext,feature:scope.feature||'unmapped',configuration_status:'unmapped'}}};}
  const profile=await configuration.resolve(id);
  const profiles=new Map([[id,profile]]);
  const encoded=JSON.stringify({messages:payload.messages||[],fallback:options.contextFallbackContent||'',recovery:options.contextFallbackInstructions||''});
  const referenced=[...encoded.matchAll(/⟦HELLOTEST_AI:([^:⟧]+):([^⟧]+)⟧/g)];
  // Retrieve from task data before expanding managed scaffolding. Otherwise a
  // long schema/instruction prefix can consume the entire retrieval question.
  if (referenced.length && Array.isArray(payload.messages)) {
    const explicitQuery = typeof options.contextRetrievalQuery === 'string' ? options.contextRetrievalQuery.trim() : '';
    const task = explicitQuery || payload.messages.filter(message => message.role === 'user').map(message =>
      typeof message.content === 'string' ? message.content : Array.isArray(message.content)
        ? message.content.filter(part => part?.type === 'text').map(part => part.text || '').join('\n') : ''
    ).join('\n').replace(/⟦HELLOTEST_AI:[^⟧]+⟧/g, '').trim();
    options = { ...options, contextRetrievalQuery: task.length > 3500 ? `${task.slice(0, 2700)}\n${task.slice(-800)}` : task };
  }
  if(referenced.length>1500 || new Set(referenced.map(match=>match[1])).size>8)throw Object.assign(new Error('Too many AI instruction references.'),{statusCode:422,code:'AI_INSTRUCTION_BUDGET'});
  for(const match of referenced)if(!Object.hasOwn(profile.config.instruction_blocks,match[2]) && !profiles.has(match[1]))profiles.set(match[1],await configuration.resolve(match[1]));
  function expand(text){return typeof text!=='string'?text:text.replace(/⟦HELLOTEST_AI:([^:⟧]+):([^⟧]+)⟧/g,(_,feature,key)=>{
    const block=profile.config.instruction_blocks?.[key] ?? profiles.get(feature)?.config.instruction_blocks?.[key];
    if(typeof block!=='string')throw Object.assign(new Error('An AI instruction block is missing from the published configuration.'),{statusCode:503,code:'AI_INSTRUCTION_MISSING'});
    return block;
  });}
  if(Array.isArray(payload.messages))payload.messages=payload.messages.map(message=>({...message,content:Array.isArray(message.content)?message.content.map(part=>part.type==='text'?{...part,text:expand(part.text)}:part):expand(message.content)}));
  if(typeof options.contextFallbackContent==='string')options={...options,contextFallbackContent:expand(options.contextFallbackContent)};
  if(typeof options.contextFallbackInstructions==='string')options={...options,contextFallbackInstructions:expand(options.contextFallbackInstructions)};
  const config=profile.config;
  if (options.mcpContextHandled && config.context?.required && !options.mcpContextHandled.evidence_count) throw Object.assign(new Error('This feature requires authorized MCP evidence before generating its outcome.'), {statusCode:503,code:'AI_MCP_CONTEXT_REQUIRED'});
  let url;
  if(profile.transport==='chat' && config.integration_id && options.integration && config.integration_id!==options.integration.id && !scope.integration_explicit) {
    const integration=await require('@hellotest/integration/backend/services/aiLlmSelection.service').resolveLlmIntegrationForUsage({
      integrationId:config.integration_id,userId:scope.actor_id,projectId:scope.project_id,usageKey:id,fallback:scope.integration_fallback||'none'
    });
    if(scope.integration_fallback==='project-scoped' && integration.config?.project_id!==scope.project_id)throw Object.assign(new Error('This feature requires a project-scoped model.'),{statusCode:403,code:'LLM_PROJECT_SCOPE_DENIED'});
    const base=String(integration.base_url||'https://api.openai.com/v1').replace(/\/+$/,'');
    url=/\/chat\/completions$/.test(base)?base:`${base}/chat/completions`;
    require('./knowledgeModelRetry').validateModelEndpoint(url);
    const headers=new Headers(init.headers);headers.delete('Authorization');
    if(require('@hellotest/integration/backend/services/integration.service').isUsableApiCredential(integration.api_key))headers.set('Authorization',`Bearer ${integration.api_key}`);
    init={...init,headers};payload.model=integration.model;options={...options,integration};
  }

  const traceContext={...options.traceContext,feature:id,feature_group:profile.group,configuration_version:profile.published_version,configuration_hash:profile.fingerprint,instruction_versions:Object.fromEntries([...profiles].map(([key,value])=>[key,{version:value.published_version,hash:value.fingerprint,...(value.inherited_from ? {inherited_from:value.inherited_from} : {})}]))};
  if(!Array.isArray(payload.messages))return {init,options:{...options,traceContext}};
  // Native contracts carry runtime field IDs, permitted enum values and specialist
  // schemas. They complement the managed task instructions; they never grant access.
  payload.messages=composeMessages(payload.messages,config);
  if(options.sampling!==false){payload.temperature=config.temperature;if(config.top_p!=null)payload.top_p=config.top_p;else delete payload.top_p;}
  else {delete payload.temperature;delete payload.top_p;}
  // Provider model stays bound to the permission-checked integration. Do not let
  // prompt JSON choose a credential or override a project's provider restriction.
  const nativeBound=Math.min(16384,Number(options.maxOutputTokens)||16384);
  const requested=Number(payload.max_completion_tokens||payload.max_tokens)||16384;
  const limit=Math.min(config.max_output_tokens,nativeBound,requested);
  const field=payload.max_completion_tokens!==undefined?'max_completion_tokens':'max_tokens';
  delete payload.max_tokens;delete payload.max_completion_tokens;payload[field]=limit;
  return {init:{...init,body:JSON.stringify(payload)},options:{...options,maxOutputTokens:limit,mcpContextPolicy:config.context,traceContext},profile,url};
}
async function validateResponse(response, profile) {
  if(!response?.ok||!profile?.config.output_schema)return;
  const key=profile.fingerprint;
  let validate=validators.get(key);
  if(!validate){validate=ajv.compile(profile.config.output_schema);if(validators.size>=100)validators.clear();validators.set(key,validate);}
  let parsed;try{parsed=JSON.parse(getCompletionContent(await response.clone().json()).trim().replace(/^```(?:json)?\s*/i,'').replace(/```\s*$/,''));}catch{parsed=null;}
  if(!validate(parsed))throw Object.assign(new Error('The model response did not satisfy the published AI output contract.'),{statusCode:502,code:'AI_MANAGED_SCHEMA_INVALID'});
}
module.exports={apply,validateResponse,composeMessages};
