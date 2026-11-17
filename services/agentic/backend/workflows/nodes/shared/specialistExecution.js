const execution=require('@hellotest/knowledge/backend/services/knowledgeExecution.service');
const agentContract=require('../../../agents/agentDefinition');
const {contextFor}=require('./values');
const text=value=>typeof value==='string'?value.trim():'';
const object=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};
const array=value=>Array.isArray(value)?value:[];
const error=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode,publicMessage:message});
const assistant=require('../../../services/agenticAssistant.service');
const {policy:specialistPolicy}=require('../../specialistPolicy');
const events=require('../../runtimeEvents');
const {collectReviews,specialistPrompt}=require('./reviewContext');
async function execute({run,node,sources,user,signal,onAttempt,onEvent,requireRunAccess}){const data=node.data||{},kind=data.kind||node.type;
const deadline = Date.now() + (Number(data.timeoutMs) || 150_000);
  const retries = kind === "loop" && data.loopAction === "customAI" ? 0 : Number(data.retryCount) || 0;
  const policy = specialistPolicy(data);
  // One ledger spans transport retries, JSON compatibility and output repairs for this node.
  const modelBudget = { used: 0, max: data.agentSnapshot?.definition?.limits?.max_model_calls || data.aiConfiguration?.agent_execution?.max_model_calls || 2 };
  const scopes = policy.context_scopes;
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    await requireRunAccess(user, run.project_id);
    if (signal.aborted) throw execution.abortError();
    await onAttempt(attempt + 1);
    try {
      const review = await execution.bounded((nodeSignal) => assistant.respond({ user, project_id: run.project_id, app_type_id: run.app_type_id,
        mode: "agent", agent_id: data.agentId, workflow_policy: { ...policy, model_budget: modelBudget, agent_definition: data.agentSnapshot, custom_task: data.customTask === true || Boolean(data.agentSnapshot), connected_input: { request: run.input_payload, input: contextFor(run, sources).input,
          provenance:{request:'user_supplied_task_data',input:'unverified_connected_node_data',...(collectReviews(sources).length?{upstream_reviews:'untrusted_model_analysis_not_source_evidence'}:{})} } }, prompt: specialistPrompt(run, node, sources), context_scopes: scopes,
        integration_id: text(data.llmIntegrationId) || undefined,
        smart_context: { query: text(data.knowledgeQuery) || text(data.prompt), source_ids: array(data.knowledgeSourceIds), source_kinds: array(data.knowledgeSourceKinds) },
        signal: nodeSignal
      }), { timeoutMs: deadline - Date.now(), signal });
      if (review.provenance?.generation_mode !== "llm") throw agentContract.fail("The AI node did not return a model-generated review.", "AGENT_OUTPUT_INVALID");
      return { session_id: review.transaction.id, specialist_id: data.agentId, ...review.result, provenance: review.provenance };
    } catch (failure) {
      lastError = failure;
      if (signal.aborted || modelBudget.used >= modelBudget.max || !events.retryable(failure) || attempt >= retries || Date.now() >= deadline) throw failure;
      const delay = Math.min(Number(data.retryDelayMs ?? 500) * (attempt + 1), deadline - Date.now());
      await onEvent({ level: "warning", event: "retry_scheduled", attempt: attempt + 1, retry_delay_ms: delay, status_code: failure.statusCode, message: `AI attempt ${attempt + 1} failed. Retrying in ${delay} ms.` });
      await execution.bounded(() => new Promise(resolve => setTimeout(resolve, delay)), { timeoutMs: deadline - Date.now(), signal });
    }
  }
  throw lastError;

}
module.exports={execute};
