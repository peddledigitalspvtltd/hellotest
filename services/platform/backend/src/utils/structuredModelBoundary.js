// One structured completion boundary for feature adapters. Managed instruction,
// schema validation and permitted corrections belong to llmHttpClient; adapters
// provide grounded messages and interpret the validated domain result.
const {parseAiJson}=require('./aiJsonResponse');
const {getCompletionContent}=require('./llmResponse');
const failure=(message,code,cause)=>Object.assign(new Error(message,{cause}),{code,statusCode:502,publicMessage:message});
function decodeStructuredCompletion(payload,{parse=parseAiJson,invalidCode='AI_INVALID_OUTPUT',invalidMessage='The model returned an unreadable structured response.',truncatedCode='AI_OUTPUT_TRUNCATED',truncatedMessage='The model reached its output limit before completing the response.'}={}){
  if(['length','max_tokens'].includes(payload?.choices?.[0]?.finish_reason))throw failure(truncatedMessage,truncatedCode);
  if(payload?.choices?.[0]?.message?.refusal||payload?.choices?.[0]?.finish_reason==='content_filter')throw failure('The model could not produce this structured response.','AI_MODEL_REFUSAL');
  try{
    const result=parse(getCompletionContent(payload));
    if(!result||typeof result!=='object'||Array.isArray(result))throw new Error('Expected a structured object.');
    return result;
  }catch(error){throw failure(invalidMessage,invalidCode,error);}
}
async function requestStructuredModel({integration,messages,operation,contextRetrievalQuery,signal,decode={},...options}){
  const base=String(integration.base_url||'https://api.openai.com/v1').replace(/\/+$/,'');
  const url=/\/chat\/completions$/i.test(base)?base:`${base}/chat/completions`;
  const response=await require('./llmHttpClient').fetchLlmWithRetry(url,{method:'POST',...(signal?{signal}:{}),headers:{'Content-Type':'application/json',...(integration.api_key?{Authorization:`Bearer ${integration.api_key}`}:{})},body:JSON.stringify({model:integration.model,response_format:{type:'json_object'},messages})},{integration,operation,contextRetrievalQuery,...options});
  if(!response.ok)throw require('./upstreamLlmError').createLlmProviderError({status:response.status,headers:response.headers,detail:await response.text()});
  let payload;try{payload=await response.json();}catch(error){throw failure(decode.invalidMessage||'The model returned an unreadable structured response.',decode.invalidCode||'AI_INVALID_OUTPUT',error);}
  return decodeStructuredCompletion(payload,decode);
}
module.exports={decodeStructuredCompletion,requestStructuredModel};
