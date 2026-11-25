// Shared specialist provider/structured-response boundary; native evidence verification remains with the feature.
module.exports=function createSpecialistModelBoundary(deps){
const {artifacts,normalizeText,integrationService,authorizeFreshEvidence,MODEL_TIMEOUT_MS,responseContract,dedupeInstructions,instructionFor,aiInstructionBlock,evidenceScopes,buildBoundedAgentPromptPayload,execution,agentContract,permissionService,agentError,fetchLlmWithRetry,resolveChatCompletionsUrl,appendEvent,providerUsage,JSON_MODE_FIELD,JSON_MODE_REJECTION,completionContent,extractJson,crypto}=deps;
function hasApiRepairContext(context) {
  try { return JSON.parse(context.automation_repair?.[0]?.content || '{}').focus?.runtime === 'api'; }
  catch { return false; }
}
return async ({ user, projectId, integration, agent, mode, prompt, context, citations, history, contextRoute, knowledgeRetrieval, promptPayload, assertEvidenceAccess, deadline = Date.now() + MODEL_TIMEOUT_MS, repair = false, budget = { used: 0, max: 2 }, toolSession, onSystemFrame }) => {
  if (Object.keys(evidenceScopes.normalize(contextRoute?.evidence_scope)).length) {
    const scopedEvidence = Object.values(context).flat().some(item => {
      const kind = item?.source_kind || item?.citation?.source_kind;
      if (!kind || ['task_input', 'workflow_input', 'task_context'].includes(kind)) return false;
      if (kind !== 'live_project') return Boolean(item.content?.trim());
      try {
        const snapshot = JSON.parse(item.content);
        return Boolean(snapshot.records?.length || snapshot.result_id || Number(snapshot.returned_records) > 0 || Number(snapshot.total_records) > 0);
      } catch { return false; }
    });
    if (!scopedEvidence) throw Object.assign(agentError('The selected evidence could not be retrieved in the current project and application. Refresh the scope or check source access before retrying.', 422), {
      code: 'AGENT_EVIDENCE_UNAVAILABLE', statusCode: 422
    });
  }
  const messages = [
    {
      role: "system",
      content: dedupeInstructions([
        // The shared boundary inserts the node-owned primary prompt once.
        // Keep native shape and successor-specific guidance in this frame.
        JSON.stringify({ agent_intent: { name: agent.name, objective: agent.objective }, response_schema: responseContract.schema }),
        agent.customObjective ? "" : agent.instructions || "",
        ...(agent.skills || []).map(skill => [aiInstructionBlock("ai.agentic.workflow", "agenticAssistant.service.js.messages.final.2"),String(skill.name),": ",String(instructionFor(skill,agent.configurationKey)),""].join('')),
        ...(agent.guardrailRules || []).map(rule => rule.text),
        agent.guardrails && agent.guardrails !== require('@hellotest/platform/backend/src/utils/aiExecutionConfiguration').current()?.config?.guardrails ? [aiInstructionBlock("ai.agentic.workflow", "agenticAssistant.service.js.messages.final.3"),String(agent.guardrails),""].join('') : "",
        [aiInstructionBlock("ai.agentic.workflow", "agenticAssistant.service.js.messages.final.4"),String(JSON.stringify(agent.acceptance || { require_evidence: true })),aiInstructionBlock("ai.agentic.workflow", "agenticAssistant.service.js.messages.final.5")].join(''),
        aiInstructionBlock("ai.agentic.workflow", "agenticAssistant.messages.1"),
        aiInstructionBlock("ai.agentic.workflow", "agenticAssistant.messages.2"),
        aiInstructionBlock("ai.agentic.workflow", "agenticAssistant.messages.33"),
        aiInstructionBlock("ai.agentic.workflow", "agenticAssistant.outcomes"),
        aiInstructionBlock("ai.agentic.workflow", "agenticAssistant.presentation"),
        aiInstructionBlock("ai.agentic.workflow", "agenticAssistant.evidenceScope"),
        artifacts.CONTRACT,
        aiInstructionBlock("ai.agentic.workflow", "agenticAssistant.messages.11"),
        ...(context.automation_repair && !hasApiRepairContext(context) ? [aiInstructionBlock("ai.agentic.workflow", "agenticAssistant.messages.38")] : []),
        ...(context.automation_repair ? ["Host-enforced automation repair contract: " + JSON.stringify(require("@hellotest/automation/repair").modelContract)] : []),
        aiInstructionBlock("ai.agentic.workflow", "agenticAssistant.messages.12"),
        ...(repair ? [aiInstructionBlock("ai.agentic.workflow", "agenticAssistant.messages.43")] : []),
        ...(repair ? [aiInstructionBlock("ai.agentic.workflow", "agenticAssistant.revision")] : []),
        aiInstructionBlock("ai.agentic.workflow", "agenticAssistant.messages.14")
      ]).join("\n\n")
    },
    ...(Array.isArray(history) ? history : []).filter((entry) => entry && ["user", "assistant"].includes(entry.role) && typeof entry.content === "string").slice(-6).map((entry) => ({
      role: entry.role === "assistant" ? "assistant" : "user",
      content: normalizeText(entry.content, 2_500)
    })),
    {
      role: "user",
      content: promptPayload || buildBoundedAgentPromptPayload({ mode, prompt, context, citations, contextRoute, knowledgeRetrieval })
    }
  ];

  const assembledPrompt=require('./specialistPrompt').versioned(messages[0].content,{primaryPrompt:require('@hellotest/platform/backend/src/utils/aiExecutionConfiguration').current()?.config?.prompt||'',outputInstructions:agent.outputInstructions||'',specialistId:agent.id||agent.configurationKey||agent.name});
  messages[0].content=assembledPrompt.content;
  const promptSession=require('@hellotest/platform/backend/src/utils/llmTraceContext').current().session_id;

  const toolMessages=[];
  const headers = { "Content-Type": "application/json" };
  if (integrationService.isUsableApiCredential(integration.api_key)) headers.Authorization = `Bearer ${integration.api_key}`;
  let effectiveMessages = messages, reducedEvidenceIds = null, currentCallRecord = null, preparedPromptHash = null;
  const request = async (jsonMode, reducedContent) => {
    effectiveMessages = reducedContent ? [...messages.filter(message => message.role !== "user"), {role:"user",content:reducedContent}] : messages;
    effectiveMessages=[...effectiveMessages,...toolMessages];
    execution.assertActive();
    if (budget.used >= budget.max) throw agentContract.fail("The model call budget is exhausted. Review the output contract or increase the permitted calls.", "AGENT_MODEL_BUDGET");
    const dispatchRecords=[];
    const beforeDispatch=async prepared=>{
    execution.assertActive();
    if (budget.used >= budget.max) throw agentContract.fail("The model call budget is exhausted. Review the output contract or increase the permitted calls.", "AGENT_MODEL_BUDGET");
    if (user && projectId) {
      if (!await permissionService.hasPermission(user, 'agentic_workflow.run', projectId)) throw agentError('Agent run access changed before the model call.',403);
      await assertEvidenceAccess?.();
      const evidence = Object.values(context).flat().filter(item => item.citation?.source_id).map(item => ({ ...item, source_id: item.source_id || item.citation.source_id, source_kind: item.source_kind || item.citation.source_kind, chunk_id: item.chunk_id || item.citation.chunk_id || item.id }));
      if (evidence.length) {
        const fresh = await authorizeFreshEvidence({projectId,user,hits:evidence});
        if (fresh.denied_ids.length) throw agentError('Evidence access changed before the model call. Start a fresh review.',403);
      }
    }
    if(deadline-Date.now()<1000)throw agentError("The model review deadline was reached.",504);
    if(prepared?.payload?.messages){
      preparedPromptHash=crypto.createHash('sha256').update(JSON.stringify(prepared.payload.messages)).digest('hex');
      assembledPrompt.hash=crypto.createHash('sha256').update(JSON.stringify({version:assembledPrompt.version,specialist_id:agent.id||agent.configurationKey||agent.name,system:prepared.payload.messages.filter(message=>['system','developer'].includes(message.role))})).digest('hex');
      onSystemFrame?.(prepared.payload.messages.filter(message=>['system','developer'].includes(message.role)).map(message=>message.content).join('\n\n'));
    }
    if(promptSession)await appendEvent(promptSession,{phase:'prompt.assembled',message:'Versioned specialist provider instructions assembled.',details:{prompt_template_version:assembledPrompt.version,system_message_hash:assembledPrompt.hash},metadata:{prompt_template_version:assembledPrompt.version,system_message_hash:assembledPrompt.hash}});
    budget.used+=1;
    dispatchRecords.push({name:agent.name,trace_id:null,status:'dispatched',attempt:budget.used,usage:null});
    };
    const onTrace=async record=>{
      if(record.dispatched){
        const observed=dispatchRecords.find(item=>item.trace_id===record.trace_id)||dispatchRecords.find(item=>!item.trace_id);
        if(observed){observed.trace_id=record.trace_id;if(record.status!=='running')observed.status=record.status==='succeeded'?'response_received':record.status;if(record.usage)observed.usage=providerUsage(record.usage);if(record.error_code)observed.error_code=record.error_code;}
      }
      const sessionId=require('@hellotest/platform/backend/src/utils/llmTraceContext').current().session_id;
      if(sessionId)await appendEvent(sessionId,require('@hellotest/platform/backend/src/utils/agentModelTrace').modelTraceEvent(record,{name:agent.name}));
    };
    const remaining = deadline - Date.now();
    if (remaining < 1_000) throw agentError("The model review deadline was reached.", 504);
    let response;
    try { response = await fetchLlmWithRetry(resolveChatCompletionsUrl(integration.base_url), {
    method: "POST",
    headers,
    signal: execution.current()?.signal,
    body: JSON.stringify({
      model: integration.model,
      max_tokens: agent.limits?.max_output_tokens || 4000,
      ...((toolSession && budget.max-budget.used>1 && toolSession.definitions().length) ? {tools:toolSession.definitions(),tool_choice:"auto"} : jsonMode ? { response_format: { type: "json_object" } } : {}),
      messages: effectiveMessages
    })
    }, {
      integration,
      beforeDispatch,
      featureKey: agent.configurationKey,
      // This request already carries the MCP packet selected for this agent.
      // Automatic enrichment must not widen user-selected sources or tool scopes.
      mcpContextHandled: { evidence_count: citations.filter(item => item.source_id).length },
      traceContext: { agent_system:require('@hellotest/platform/backend/src/utils/llmTraceContext').current().agent_system||'workflow', mcp_context_depth: 1, mcp_context: citations.some(item => item.source_id) ? 'retrieved' : 'unavailable',
        on_llm_trace:onTrace },
      compatibility: false,
      contextFallback: false,
      operation: jsonMode ? "agentic-assistant.respond" : "agentic-assistant.respond.json-mode-compatibility",
      timeoutMs: remaining,
      attemptTimeoutMs: remaining,
      maxAttempts: 1,
      // Read-only generation still incurs provider work and cost; do not replay on transport failures.
      idempotent: false,
      maxOutputTokens: agent.limits?.max_output_tokens || 4000,
      maxResponseBytes: 512 * 1024
    });
    currentCallRecord=dispatchRecords.at(-1)||null;
    if(currentCallRecord){currentCallRecord.trace_id ||= response.headers?.get?.('x-hellotest-llm-trace-id')||null;if(currentCallRecord.status==='dispatched')currentCallRecord.status=response.ok?'response_received':'failed';}
    } catch (error) {
      for(const record of dispatchRecords)if(record.status==='dispatched'){record.status='failed';record.error_code=error.code||'AGENT_PROVIDER_ERROR';}
      throw error;
    }finally{
      // Hidden native-output corrections still perform provider work. Report
      // every actual POST, and never label a blocked preflight as dispatched.
      if(budget.onCall)for(const record of dispatchRecords)await budget.onCall(record);
    }
    return response;
  };

  let response = await request(true);
  const providerFailure = (failed, detail) => {
    const failure = require('@hellotest/platform/backend/src/utils/upstreamLlmError').createLlmProviderError({status:failed.status,headers:failed.headers,detail});
    failure.provider_failure_code = failure.code;
    // Keep this public agent API code stable while retaining the shared
    // provider classification and safe diagnostics for the workflow node.
    failure.code = 'AGENT_PROVIDER_ERROR';
    return failure;
  };
  if (!response.ok && [400,413,422].includes(Number(response.status)) && budget.used < budget.max && require('@hellotest/platform/backend/src/utils/llmContextFallback').isContextSizeRejection(response.status, await response.clone().text())) {
    const originalPayload = JSON.parse(promptPayload || buildBoundedAgentPromptPayload({mode,prompt,context,citations,contextRoute,knowledgeRetrieval}));
    const reduced = require('./agentMinimalContext').minimalContext(originalPayload);
    const reducedContent=JSON.stringify(reduced.payload);
    if(Buffer.byteLength(reducedContent,'utf8')>=Buffer.byteLength(JSON.stringify(originalPayload),'utf8'))throw agentContract.fail('The provider cannot fit the complete required task input. Split the input or select a larger-context model; no repeated request was sent.','AGENT_CONTEXT_BUDGET');
    reducedEvidenceIds = reduced.ids;
    response = await request(true,reducedContent);
  }
  if (!response.ok) {
    const providerText = typeof response.text === "function" ? await response.text() : "";
    if ([400, 422].includes(Number(response.status)) && budget.used < budget.max && JSON_MODE_FIELD.test(providerText) && JSON_MODE_REJECTION.test(providerText)) response = await request(false, reducedEvidenceIds ? effectiveMessages.at(-1).content : undefined);
    else throw providerFailure(response,providerText);
  }
  if (!response.ok) throw providerFailure(response,typeof response.text === 'function' ? await response.text() : '');
  let payload = await response.json();
  while(payload.choices?.[0]?.message?.tool_calls?.length){
    if(!toolSession||budget.used>=budget.max)throw agentContract.fail('The specialist read-only tool/model budget is exhausted.','AGENT_TOOL_BUDGET');
    if(currentCallRecord&&!currentCallRecord.usage)currentCallRecord.usage=providerUsage(payload.usage);
    const proposal=payload.choices[0].message;
    toolMessages.push({role:'assistant',content:proposal.content||null,tool_calls:proposal.tool_calls});
    toolMessages.push(...await toolSession.execute(proposal.tool_calls));
    response=await request(true);
    if(!response.ok)throw providerFailure(response,typeof response.text==='function'?await response.text():'');
    payload=await response.json();
  }
  if (currentCallRecord&&!currentCallRecord.usage) currentCallRecord.usage = providerUsage(payload.usage);
  if (payload.choices?.[0]?.finish_reason === "length") throw agentContract.fail("The model output limit was reached. Reduce the requested scope or increase this agent's output limit.", "AGENT_OUTPUT_TRUNCATED", 422);
  const content = completionContent(payload);
  if (!content) throw new Error("Configured LLM returned an empty completion payload");
  const candidate = extractJson(content);
  if(reducedEvidenceIds)for(const evidenceId of toolSession?.evidenceIds||[])reducedEvidenceIds.add(evidenceId);
  if (reducedEvidenceIds) Object.defineProperty(candidate,"_suppliedEvidenceIds",{value:reducedEvidenceIds,enumerable:false});
  Object.defineProperty(candidate, "_model", { value: { effective_model: payload.model || integration.model,
    prompt_template_version:assembledPrompt.version, system_message_hash:assembledPrompt.hash, tool_calls:toolSession?.used||0,
    prompt_hash: preparedPromptHash || crypto.createHash("sha256").update(JSON.stringify(effectiveMessages)).digest("hex"),
    context_reduced: Boolean(reducedEvidenceIds),
    usage: providerUsage(payload.usage),
    trace_id: response.headers?.get?.("x-hellotest-llm-trace-id") || null,
    trace_capture: response.headers?.get?.("x-hellotest-llm-trace-status") || null,
    provider_request_id: response.headers?.get?.("x-request-id") || null }, enumerable: false });
  return candidate;
};

};
