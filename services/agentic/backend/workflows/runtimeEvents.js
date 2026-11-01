const { sanitizeAiText } = require("@hellotest/platform/backend/src/security/aiTextPolicy");
const safeMessage = (value, fallback = "This node failed. Review its configuration and connection.") =>
  sanitizeAiText(typeof value === "string" && value ? value : fallback).text.slice(0, 2000);
const canRetry = (kind, data = {}) => ["agent", "llmAgent", "customAI"].includes(kind)
  || (kind === "loop" && data.loopAction === "customAI")
  || (["apiTool", "apiAgent", "webAgent"].includes(kind) && ["GET", "HEAD"].includes(kind === "webAgent" ? "GET" : String(data.apiMethod || "GET").trim().toUpperCase()));
const retryable = (failure = {}) => !failure.outcome_unknown && !failure.generation_received && failure.nonRetryable !== true
  && failure.retryable !== false && [408, 429, 500, 502, 503, 504].includes(failure.statusCode) && failure.code !== "NODE_TIMEOUT";
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,160}$/.test(value) && sanitizeAiText(value).text === value;
function withNode(input, run, node) {
  const failure = input && typeof input === 'object' ? input : new Error('A workflow node failed.');
  if (!failure.workflow_failure && Object.isExtensible(failure)) Object.defineProperty(failure, 'workflow_failure', { value: {
    node_id:node.id,node_name:node.data?.label || node.id,
    ...(run.loop_owner ? {loop_node_id:run.loop_owner,batch_index:run.iteration_index,iteration_path:run.iteration_path} : {})
  }, configurable:true });
  return failure;
}
function failureCode(failure) {
  if (failure.code === 'DEADLINE_EXCEEDED') return 'WORKFLOW_DEADLINE';
  if (failure.code === 'NODE_TIMEOUT') return 'NODE_TIMEOUT';
  if (failure.name === 'AbortError' || failure.statusCode === 499) return 'WORKFLOW_CANCELLED';
  if (/^(?:AGENT|MCP|AI|LLM|MODEL|WORKFLOW|AUTOMATION|TEST_CASE|KNOWLEDGE)_[A-Z0-9_]{1,90}$/.test(failure.code || '')) return failure.code;
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
 const providerCode = /^LLM_[A-Z0-9_]{1,90}$/.test(failure.provider_failure_code || '') ? failure.provider_failure_code : null;
 const classification = providerCode || code;
 const category = failure.outcome_unknown ? 'outcome_unknown' : classification === 'WORKFLOW_CANCELLED' ? 'cancelled'
   : /TIMEOUT|DEADLINE/.test(classification) ? 'timeout' : /AUTHENTICATION|ACCESS_DENIED|FORBIDDEN/.test(classification) ? 'authorization'
     : /QUOTA/.test(classification) ? 'provider_quota' : /RATE_LIMIT/.test(classification) ? 'provider_capacity'
       : /^LLM_|^MODEL_/.test(classification) ? 'provider_request' : failure.statusCode === 422 || /INVALID|VALIDATION|INPUT/.test(classification) ? 'validation' : 'execution';
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
  ...(Number.isFinite(failure.retryAfterMs) && failure.retryAfterMs >= 0 ? {retry_after_ms:Math.min(failure.retryAfterMs,86400000)} : {}),
  ...(Array.isArray(failure.validation_errors) ? { validation_errors:failure.validation_errors.slice(0,8).filter(item=>item&&typeof item==='object').map(item=>({
    ...(typeof item.path==='string'?{path:safeMessage(item.path).slice(0,200)}:{}),
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
module.exports = { safeMessage, canRetry, retryable, failureInfo, withNode, log, duration };
