// Application spending limits, not claims about a provider's context window.
// Feature services assemble bounded evidence; never slice serialized JSON here.
const { getCompletionContent } = require('./llmResponse');
const Ajv=require('ajv');
const schemaAjv=new Ajv({strict:false,validateFormats:false,ownProperties:true,allErrors:true});
const schemas=new Map();
const OUTPUT_LIMITS = {
  'requirement.generate': 6144,
  'requirement.optimize': 6144,
  'requirement.grooming': 6144,
  'requirement-design.generate': 8192,
  'case-authoring.generate': 6144,
  'case-authoring.step-rephrase': 1024,
  'quality-assurance.story': 4096,
  'quality-assurance.test-case': 4096,
  'bug-draft.generate': 4096,
  'bug-triage.refine-category': 2048,
  'automation.generate': 8192,
  'execution-analysis.generate': 4096,
  'execution-report.generate': 4096,
  'requirement-release.notes': 4096,
  'execution-planning.generate': 4096,
  'quality-dashboard.generate': 3072,
  'test-data.synthetic': 2048,
  'rich-text.rephrase': 4096
};

const policyError = (message, code, statusCode = 502) => Object.assign(new Error(message), {
  code, statusCode, publicMessage: message
});
function withCandidate(error,content){
 if(typeof content==='string'&&Buffer.byteLength(content,'utf8')<=64000)Object.defineProperty(error,'model_candidate',{value:content});
 else Object.defineProperty(error,'model_candidate_omitted',{value:true});
 return error;
}
const positiveInteger = (value) => Number.isFinite(Number(value)) && Number(value) > 0 ? Math.floor(Number(value)) : null;
const isReasoningModel = (model) => /^(?:gpt-[5-9](?:[.\-]|$)|o[1-9](?:[.\-]|$))/i.test(String(model || '').split('/').at(-1));
function validator(schema){
 const key=JSON.stringify(schema);let compiled=schemas.get(key);
 if(!compiled){try{compiled=schemaAjv.compile(schema);}catch{throw policyError('The configured output or tool schema is invalid. Correct the contract before generation.','AI_OUTPUT_SCHEMA_INVALID',422);}
  if(schemas.size>=100)schemas.clear();schemas.set(key,compiled);}
 return compiled;
}
const issues=validate=>(validate.errors||[]).slice(0,8).map(error=>({path:error.instancePath,keyword:error.keyword,message:error.message,required_property:error.params?.missingProperty}));
function strictProviderSchema(schema){
 const keywords=new Set(['type','properties','required','additionalProperties','items','enum','anyOf','description','title']);
 function inspect(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!keywords.has(key)))return false;
  if(value.type==='object'||value.properties){
   const keys=Object.keys(value.properties||{});
   if(value.additionalProperties!==false||!Array.isArray(value.required)||value.required.length!==keys.length||keys.some(key=>!value.required.includes(key)))return false;
   if(!Object.values(value.properties||{}).every(inspect))return false;
  }
  if(value.items&&!inspect(value.items))return false;
  if(value.anyOf&&!value.anyOf.every(inspect))return false;
  return true;
 }
 return schema?.type==='object'&&inspect(schema);
}
function assertInputBudget(payload,options={}){
 const textPayload=JSON.stringify({...payload,messages:payload.messages.map(message=>({...message,
  content:Array.isArray(message.content)?message.content.filter(part=>part.type!=='image_url'&&part.type!=='input_audio'):message.content}))});
 const maxInputBytes=Math.min(256_000,positiveInteger(options.maxInputBytes)||96_000);
 if(Buffer.byteLength(textPayload,'utf8')>maxInputBytes)throw policyError('AI context exceeds this feature’s input budget. Select fewer records or shorten the supporting context and try again.','AI_INPUT_BUDGET_EXCEEDED',422);
}
function ensureSchemaGuidance(payload,schema){
 const encoded=JSON.stringify(schema);
 if(!schema||payload.messages.some(message=>['system','developer'].includes(message.role)&&typeof message.content==='string'&&message.content.includes(encoded)))return;
 const index=payload.messages.findIndex(message=>!['system','developer'].includes(message.role));
 payload.messages.splice(index<0?payload.messages.length:index,0,{role:'system',content:`Output schema: ${encoded}`});
}

// JSON mode is a transport contract, independent of editable feature prompts.
// A serialized schema or the word in a user document is not a trusted output
// instruction. Preserve existing explicit trusted guidance and all task data.
function ensureJsonObjectGuidance(payload){
  if(payload.response_format?.type!=='json_object')return;
  const text=content=>typeof content==='string'?content:Array.isArray(content)
    ?content.filter(part=>part?.type==='text').map(part=>part.text||'').join('\n'):'';
  if(payload.messages.some(message=>['system','developer'].includes(message.role)&&/\bjson\b/i.test(text(message.content))))return;
  const index=payload.messages.findIndex(message=>!['system','developer'].includes(message.role));
  payload.messages.splice(index<0?payload.messages.length:index,0,{role:'system',content:'When returning text, return one valid JSON object that follows the supplied output contract. Do not wrap it in Markdown or add surrounding prose.'});
}

const prepareChatRequest = (init, options = {}) => {
  let payload;
  try { payload = JSON.parse(init.body); } catch { return { init }; }
  if (!payload || !Array.isArray(payload.messages)) return { init };
  if(options.outputSchema)validator(options.outputSchema);
  if(payload.response_format?.json_schema?.schema)validator(payload.response_format.json_schema.schema);
  for(const tool of payload.tools||[])if(tool?.type==='function'&&tool.function?.parameters)validator(tool.function.parameters);
  let official=false;try{official=new URL(options.providerUrl).origin==='https://api.openai.com';}catch{}
  const schemaModel=/^(?:gpt-(?:4o(?:-|$)|4\.[1-9]|[5-9](?:[.\-]|$))|o[3-9](?:[.\-]|$))/i.test(String(payload.model||''));
  if(options.structuredOutput!==false&&official&&schemaModel&&options.outputSchema&&strictProviderSchema(options.outputSchema)&&!payload.tools?.length&&payload.response_format?.type!=='json_schema'){
   payload.response_format={type:'json_schema',json_schema:{name:String(options.outputSchemaName||'hellotest_output').replace(/[^A-Za-z0-9_-]/g,'_').slice(0,64),strict:true,schema:options.outputSchema}};
  }
  if(options.outputSchema&&payload.response_format?.type!=='json_schema')ensureSchemaGuidance(payload,options.outputSchema);
  ensureJsonObjectGuidance(payload);
  payload = require('./aiReferenceImages').applyReferenceImagePolicy(payload, { integration: options.integration, policy: options.referenceImagePolicy });
  const maximum = Math.min(16_384, positiveInteger(options.maxOutputTokens) || OUTPUT_LIMITS[options.operation] || 4096);
  const requested = positiveInteger(payload.max_completion_tokens) || positiveInteger(payload.max_tokens) || maximum;
  const field = payload.max_completion_tokens !== undefined || isReasoningModel(payload.model) ? 'max_completion_tokens' : 'max_tokens';
  delete payload.max_tokens;
  delete payload.max_completion_tokens;
  payload[field] = Math.min(requested, maximum);
  // These models reject sampling controls; do not spend a failed round trip.
  if (isReasoningModel(payload.model)) {
    delete payload.temperature;
    delete payload.top_p;
  }
  assertInputBudget(payload,options);
  return { init: { ...init, body: JSON.stringify(payload) }, payload };
};

// Only adapt requests the provider explicitly rejected before generation.
const compatibleChatRequest = (init, status, detail) => {
  if (![400, 422].includes(status)) return null;
  let payload;
  try { payload = JSON.parse(init.body); } catch { return null; }
  if (!payload || !Array.isArray(payload.messages)) return null;
  const text = String(detail || '');
  if (/max_tokens/i.test(text) && /max_completion_tokens/i.test(text)
      && /unsupported|not supported|does not support|unknown|unrecognized|not permitted|must use|use.{0,60}instead|replace/i.test(text)) {
    const current = payload.max_completion_tokens !== undefined ? 'max_completion_tokens' : 'max_tokens';
    const next = current === 'max_tokens' ? 'max_completion_tokens' : 'max_tokens';
    payload[next] = payload[current];
    delete payload[current];
  } else if (/temperature|top_p/i.test(text) && /unsupported|not supported|does not support|only.{0,20}default/i.test(text)
      && (payload.temperature !== undefined || payload.top_p !== undefined)) {
    delete payload.temperature;
    delete payload.top_p;
  } else if (/response_format|json_schema|structured.?outputs?/i.test(text)&&/unsupported|not supported|does not support/i.test(text)&&payload.response_format?.type==='json_schema'){
    const schema=payload.response_format.json_schema?.schema;ensureSchemaGuidance(payload,schema);
    payload.response_format={type:'json_object'};
  } else if (/response_format|json_object/i.test(text) && /unsupported|not supported|does not support/i.test(text)
      && payload.response_format?.type === 'json_object') {
    // Keep the feature's schema instructions and local response validation.
    delete payload.response_format;
  } else return null;
  ensureJsonObjectGuidance(payload);
  return { ...init, body: JSON.stringify(payload) };
};

const validateChatResponse = async (response, payload, options={}) => {
  if (!response.ok || !payload || payload.stream) return false;
  let result;
  try { result = await response.clone().json(); } catch {
    throw policyError('The LLM returned an unreadable response. Check the selected integration and try again.', 'AI_INVALID_RESPONSE');
  }
  const choice = result?.choices?.[0];
  if (choice?.finish_reason === 'length') {
    throw policyError('The LLM reached the output limit before finishing. Request fewer items or a smaller scope and try again.', 'AI_OUTPUT_TRUNCATED');
  }
  if (choice?.finish_reason === 'content_filter' || choice?.message?.refusal) {
    throw policyError('The LLM declined this request. Revise the supplied content or choose another configured model.', 'AI_PROVIDER_REFUSAL');
  }
  if (choice?.message?.tool_calls?.length) {
    const allowedTools = new Map((Array.isArray(payload.tools) ? payload.tools : [])
      .filter(tool => tool?.type === 'function').map(tool => [tool.function?.name,tool.function?.parameters]));
    for (const call of choice.message.tool_calls) {
      if (call?.type !== 'function' || !allowedTools.has(call.function?.name)) {
        throw policyError('The LLM returned an unexpected tool call instead of the requested output. Check the selected model and try again.', 'AI_UNEXPECTED_TOOL_CALL');
      }
      let argumentsValue;
      try {
        argumentsValue = JSON.parse(call.function.arguments);
        if (!argumentsValue || typeof argumentsValue !== 'object' || Array.isArray(argumentsValue)) throw new Error('object required');
      } catch {
        throw policyError('The LLM returned incomplete tool arguments. Try again with a smaller scope.', 'AI_INVALID_TOOL_ARGUMENTS');
      }
      const schema=allowedTools.get(call.function.name),validate=schema&&validator(schema);
      if(validate&&!validate(argumentsValue))throw Object.assign(policyError('The LLM returned tool arguments that do not satisfy the declared tool contract.','AI_INVALID_TOOL_ARGUMENTS'),{validation_errors:issues(validate)});
    }
    return true;
  }
  const content = getCompletionContent(result);
  if (typeof content !== 'string' || !content.trim()) {
    throw policyError('The LLM returned no usable content. Check the selected model and try again.', 'AI_EMPTY_RESPONSE');
  }
  if (payload.response_format?.type === 'json_object' || payload.response_format?.type === 'json_schema' || options.outputSchema) {
    let parsed;
    try {
      parsed = JSON.parse(content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('object required');
    } catch {
      throw withCandidate(policyError('The LLM did not return the required JSON object. Try again with a model that supports structured output.', 'AI_INVALID_JSON'),content);
    }
    const schema=options.outputSchema||payload.response_format?.json_schema?.schema,validate=schema&&validator(schema);
    if(validate&&!validate(parsed))throw withCandidate(Object.assign(policyError('The LLM response did not satisfy the declared output schema.','AI_OUTPUT_SCHEMA_VIOLATION'),{validation_errors:issues(validate)}),content);
  }
  return true;
};

module.exports = { OUTPUT_LIMITS, prepareChatRequest, compatibleChatRequest, validateChatResponse,assertInputBudget,strictProviderSchema,isReasoningModel };
