const { sanitizeAiText } = require("@hellotest/platform/backend/src/security/aiTextPolicy");
const safeMessage = (value, fallback = "This node failed. Review its configuration and connection.") =>
  sanitizeAiText(typeof value === "string" && value ? value : fallback).text.slice(0, 2000);
const canRetry = (kind, data = {}) => ["agent", "llmAgent", "customAI"].includes(kind)
  || (kind === "loop" && data.loopAction === "customAI")
  || (["apiTool", "apiAgent", "webAgent"].includes(kind) && ["GET", "HEAD"].includes(kind === "webAgent" ? "GET" : String(data.apiMethod || "GET").trim().toUpperCase()));
// Once a node returns a terminal output-contract failure, its bounded format
// correction has finished. Replaying the unchanged node is not a transport retry.
const outputContractFailures = new Set(['AI_INVALID_JSON','AI_INVALID_TOOL_ARGUMENTS','AI_OUTPUT_SCHEMA_INVALID',
  'AI_OUTPUT_SCHEMA_VIOLATION','AI_MANAGED_SCHEMA_INVALID','AI_NATIVE_CONTRACT_INVALID',
  'AI_ASSURANCE_REVIEW_INVALID','AI_REVIEW_INVALID','AI_OUTPUT_TRUNCATED']);
const terminalFailures = new Set([...outputContractFailures,'AI_PROVIDER_REFUSAL','AI_BUDGET_EXCEEDED',
  'AGENT_BUDGET_EXCEEDED','AGENT_DEADLINE','NODE_TIMEOUT','DEADLINE_EXCEEDED','WORKFLOW_DEADLINE',
  'MCP_UNAUTHORIZED','MCP_ACCESS_DENIED','MCP_HOST_DENIED','MCP_ORIGIN_DENIED','CORS_ORIGIN_DENIED']);
const retryable = (failure = {}) => !failure.outcome_unknown && !failure.generation_received && failure.nonRetryable !== true
  && failure.retryable !== false && !terminalFailures.has(failure.code) && [408, 429, 500, 502, 503, 504].includes(failure.statusCode);
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,160}$/.test(value) && sanitizeAiText(value).text === value;
function withNode(input, run, node) {
  const failure = input && typeof input === 'object' ? input : new Error('A workflow node failed.');
  if (!failure.workflow_failure && Object.isExtensible(failure)) Object.defineProperty(failure, 'workflow_failure', { value: {
    node_id:node.id,node_name:node.data?.label || node.id,
    ...(run.loop_owner ? {loop_node_id:run.loop_owner,batch_index:run.iteration_index,iteration_path:run.iteration_path} : {})
  }, configurable:true });
  return failure;
}
function withArtifact(input, context) {
  const failure=input&&typeof input==='object'?input:new Error('A native workflow task failed.');
  if(!failure.workflow_artifact&&Object.isExtensible(failure))Object.defineProperty(failure,'workflow_artifact',{value:{
    artifact_task:context.artifact_task,story_id:context.story_id,
    ...(Number.isInteger(context.case_index)?{case_index:context.case_index,case_client_id:context.case_client_id}:{})
  },configurable:true});
  return failure;
}
function failureCode(failure) {
  if (failure.code === 'DEADLINE_EXCEEDED') return 'WORKFLOW_DEADLINE';
  if (failure.code === 'NODE_TIMEOUT') return 'NODE_TIMEOUT';
  if (failure.name === 'AbortError' || failure.statusCode === 499) return 'WORKFLOW_CANCELLED';
  if (/^(?:AGENT|MCP|AI|LLM|MODEL|WORKFLOW|AUTOMATION|TEST_CASE|KNOWLEDGE|CORS)_[A-Z0-9_]{1,90}$/.test(failure.code || '')) return failure.code;
  return failure.statusCode === 403 ? 'ACCESS_DENIED' : 'NODE_EXECUTION_FAILED';
}
function providerInfo(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const result = Object.fromEntries(['code','type'].flatMap(key => value[key] === null ? [[key,null]] : identifier(value[key]) ? [[key,value[key]]] : []));
  if (value.param === null) result.param = null;
  else if (typeof value.param === 'string' && /^(?:messages|response_format|model|temperature|top_p|max_tokens|max_completion_tokens|tools|tool_choice|stream|stop|n|seed)(?:[.\[\]A-Za-z0-9_-]){0,100}$/.test(value.param)) result.param = value.param;
  if (identifier(value.request_id)) result.request_id = value.request_id;
  return Object.keys(result).length ? result : undefined;
}
function failureInfo(input) {
 const failure = input && typeof input === 'object' ? input : {}, code = failureCode(failure);
 const provider = providerInfo(failure.provider_error);
 const origin = failure.workflow_failure && typeof failure.workflow_failure === 'object' ? failure.workflow_failure : {};
 const artifact=failure.workflow_artifact&&typeof failure.workflow_artifact==='object'?failure.workflow_artifact:{};
 const execution=failure.model_execution&&typeof failure.model_execution==='object'&&!Array.isArray(failure.model_execution)?failure.model_execution:{};
 const modelExecution=Object.fromEntries([
   ...[['model_calls',0,8],['max_model_calls',1,8],['deadline_ms',1,3600000]].filter(([key,min,max])=>Number.isInteger(execution[key])&&execution[key]>=min&&execution[key]<=max).map(([key])=>[key,execution[key]]),
   ...(typeof execution.format_repair_attempted==='boolean'?[['format_repair_attempted',execution.format_repair_attempted]]:[])
 ]);
 const providerCode = /^LLM_[A-Z0-9_]{1,90}$/.test(failure.provider_failure_code || '') ? failure.provider_failure_code : null;
 const classification = providerCode || code;
 const category = failure.outcome_unknown ? 'outcome_unknown' : classification === 'WORKFLOW_CANCELLED' ? 'cancelled'
   : /TIMEOUT|DEADLINE/.test(classification) ? 'timeout' : /AUTHENTICATION|UNAUTHORIZED|ACCESS_DENIED|FORBIDDEN|(?:HOST|ORIGIN)_DENIED/.test(classification) ? 'authorization'
     : /QUOTA/.test(classification) ? 'provider_quota' : /RATE_LIMIT/.test(classification) ? 'provider_capacity'
       : /^LLM_|^MODEL_/.test(classification)||classification==='AI_PROVIDER_REFUSAL' ? 'provider_request'
         : outputContractFailures.has(classification)||failure.statusCode === 422 || /INVALID|VALIDATION|INPUT/.test(classification) ? 'validation' : 'execution';
 const fallback = category === 'provider_request' ? 'The selected model rejected or could not complete this node request. Review its model connection and output configuration.'
   : category === 'provider_quota' ? 'The selected model provider has exhausted its quota. Check the integration usage and billing settings.'
     : category === 'provider_capacity' ? 'The selected model provider is limiting requests. Review capacity before starting a new execution.'
       : category === 'authorization' ? 'This node no longer has the required access. Check its current permissions or connection.'
         : category === 'timeout' ? 'This node reached its execution deadline. Completed results are preserved.'
           : category === 'cancelled' ? 'This node was cancelled. Completed results are preserved.'
             : category === 'validation' ? 'This node could not validate its input or generated output. Review its configuration and validation details.' : undefined;
 return {
  code, category,
  ...(providerCode ? {provider_failure_code:providerCode}:{}),
  ...(Number.isInteger(failure.statusCode) ? { status_code: failure.statusCode } : {}),
  ...(Number.isInteger(failure.upstreamStatusCode || failure.upstreamStatus) ? { upstream_status_code: failure.upstreamStatusCode || failure.upstreamStatus } : {}),
  ...(provider ? {provider_error:provider} : {}),
  ...(identifier(origin.node_id) ? {origin:{node_id:origin.node_id,node_name:safeMessage(origin.node_name).slice(0,255),
    ...(identifier(origin.loop_node_id)?{loop_node_id:origin.loop_node_id}:{}),
    ...(Number.isSafeInteger(origin.batch_index)&&origin.batch_index>=0&&origin.batch_index<100?{batch_index:origin.batch_index}:{}),
    ...(Array.isArray(origin.iteration_path)&&origin.iteration_path.length<=32?{iteration_path:origin.iteration_path.filter(value=>identifier(value)||Number.isSafeInteger(value)&&value>=0&&value<100)}:{})
  }} : {}),
  ...(identifier(failure.operation_id) ? { operation_id: failure.operation_id } : {}),
  ...(failure.outcome_unknown ? { outcome_unknown: true, reconciliation_required: true } : {}),
  ...(failure.generation_received ? { generation_received:true } : {}),
  ...(Object.keys(modelExecution).length?{model_execution:modelExecution}:{}),
  ...(failure.effect_dispatched===false&&!failure.outcome_unknown?{effect_dispatched:false}:{}),
  ...(identifier(artifact.story_id)&&['story-assurance','test-case-generation','test-case-assurance','automation-engineer'].includes(artifact.artifact_task)?{
    artifact:{artifact_task:artifact.artifact_task,story_id:artifact.story_id,
      ...(Number.isInteger(artifact.case_index)&&artifact.case_index>=0&&artifact.case_index<100?{case_index:artifact.case_index}:{}),
      ...(identifier(artifact.case_client_id)?{case_client_id:artifact.case_client_id}:{})}
  }:{}),
  ...(Number.isFinite(failure.retryAfterMs) && failure.retryAfterMs >= 0 ? {retry_after_ms:Math.min(failure.retryAfterMs,86400000)} : {}),
  ...(Array.isArray(failure.validation_errors) ? { validation_errors:failure.validation_errors.slice(0,8).filter(item=>item&&typeof item==='object').map(item=>({
    ...(typeof item.path==='string'?{path:safeMessage(item.path).slice(0,200)}:{}),
    ...(typeof item.keyword==='string'&&/^[A-Za-z][A-Za-z0-9_$-]{0,63}$/.test(item.keyword)&&identifier(item.keyword)?{keyword:item.keyword}:{}),
    ...(typeof item.required_property==='string'&&/^[A-Za-z_][A-Za-z0-9_.-]{0,99}$/.test(item.required_property)&&identifier(item.required_property)?{required_property:item.required_property}:{}),
    ...(typeof item.issue==='string'?{issue:safeMessage(item.issue).slice(0,500)}:{}),
    ...(typeof item.message==='string'?{message:safeMessage(item.message).slice(0,500)}:{})
  })).filter(item=>Object.keys(item).length) } : {}),
  ...(failure.code === "AUTOMATION_BUILD_INCOMPLETE" ? {
    ...Object.fromEntries(["completed_sections", "total_sections"].filter(key => Number.isInteger(failure[key]) && failure[key] >= 0 && failure[key] <= 200).map(key => [key, failure[key]])),
    validation_feedback: (Array.isArray(failure.validation_feedback) ? failure.validation_feedback : []).slice(0, 5)
      .filter(item => item && typeof item.message === "string").map(item => ({
        ...(typeof item.step_id === "string" && /^[\w:-]{1,255}$/.test(item.step_id) ? { step_id: item.step_id } : {}),
        ...(typeof item.code === "string" && /^[A-Z][A-Z0-9_]{0,79}$/.test(item.code) ? { code: item.code } : {}),
        message: safeMessage(item.message).slice(0, 500),
      })),
  } : {}),
  message: safeMessage(failure.publicMessage, fallback), retryable: retryable(failure),
 };
}
function log(result, event) {
  const entries = result.logs || (result.logs = []);
  entries.push({ at: new Date().toISOString(), level: "info", ...event, message: safeMessage(event.message, "Execution event") });
  if (entries.length > 150) entries.splice(0, entries.length - 150);
}
const duration = result => Math.max(0, Date.parse(result.completed_at) - Date.parse(result.started_at)) || 0;
module.exports = { safeMessage, canRetry, retryable, failureInfo, withNode, withArtifact, log, duration };
