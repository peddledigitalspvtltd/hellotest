function validate(node){const data=node.data||{},errors=[];if(!require('../../agents/catalog').AGENTS.some(agent=>agent.id===data.repositoryAgentType))errors.push('Choose a source analysis agent.');if(Number(data.retryCount)>0)errors.push('Source analysis uses its existing worker. Set retries to zero; review a failed analysis before starting a new execution.');return errors;}
const execution=require('@hellotest/knowledge/backend/services/knowledgeExecution.service');
const agentContract=require('../../agents/agentDefinition');
const {contextFor}=require('./shared/values');
const text=value=>typeof value==='string'?value.trim():'';
const object=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};
const array=value=>Array.isArray(value)?value:[];
const error=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode,publicMessage:message});
const {createHash}=require('node:crypto');
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const MAX_DURATION_MS=180_000;
async function execute({run,node,sources,user,signal,onAttempt,onProgress,requireRunAccess}){const data=node.data||{};
const repositoryAgents = require("../../agents/repositoryAgents.service");
    const connected = contextFor(run, sources).input;
    const source = object(connected?.source || run.input_payload.source);
    if (source.type !== "github" || !text(source.repository_url)) throw error("Supply source.type = github and source.repository_url in the workflow input. ZIP uploads are available in the source agent workspace.");
    await onAttempt(1);
    const job = await repositoryAgents.createRun({ project_id: run.project_id, app_type_id: run.app_type_id,
      agent_type: data.repositoryAgentType, llm_integration_id: text(data.llmIntegrationId) || undefined, source }, user, { requestKey: `workflow-${run.id}-${node.id}${run.iteration_path ? `-${hash(run.iteration_path).slice(0,16)}` : ''}`, workflowTrace: { run_id: run.id, node_id: node.id } });
    let lastProgress = "";
    try {
      return await execution.bounded(async childSignal => {
        while (!childSignal.aborted) {
          await requireRunAccess(user, run.project_id);
          const current = await repositoryAgents.getRun(job.id, user, "agentic_workflow.run");
          const progress = { repository_run_id: job.id, repository_agent_type: data.repositoryAgentType, status: current.status, percent: current.progress || 0, stages: current.stages || [] };
          const signature = JSON.stringify(progress);
          if (signature !== lastProgress) { await onProgress(progress); lastProgress = signature; }
          if (["failed", "cancelled"].includes(current.status)) throw error("Source analysis did not complete. Inspect the source agent execution for details.", 502);
          if (["completed", "partial"].includes(current.status)) {
            const review = current.result?.llm_review;
            const sourceFindings=current.result?.findings?.[require('../../agents/catalog').FINDING_KEYS[data.repositoryAgentType]];
            const noReviewTargets=current.status==='partial'&&Array.isArray(sourceFindings)&&!sourceFindings.length
              &&current.result?.summary?.model_calls===0&&current.stages?.some(stage=>stage.id==='model_review'&&stage.status==='skipped');
            if (data.llmIntegrationId && review?.provenance?.generation_mode !== "llm"&&!noReviewTargets) throw agentContract.fail("The requested source review did not complete.", "AGENT_OUTPUT_INVALID");
            return {
            repository_run_id: job.id, repository_agent_type: data.repositoryAgentType,
            session_id: review?.session_id, response: review?.response, citation_ids: review?.citation_ids,
            findings: current.result?.findings, review_findings: review?.findings, evidence_gaps: review?.evidence_gaps, verification: review?.verification,
            model_execution: review?.model_execution, provenance: review?.provenance || { generation_mode: "deterministic", compiler_version: current.compiler_version },
            source: current.source, stages: current.stages, warnings: current.warnings,
            readiness: { status: current.status === "partial" ? "limited_evidence" : "ready_for_review" },
            requires_human_review: true
          };
          }
          await execution.bounded(() => new Promise(resolve => setTimeout(resolve, 1_000)), { signal: childSignal, timeoutMs: 2_000 });
        }
        throw execution.abortError();
      }, { signal, timeoutMs: Number(data.timeoutMs) || MAX_DURATION_MS });
    } finally {
      const current = await repositoryAgents.getRun(job.id, user, "agentic_workflow.run").catch(() => null);
      if (current && ["queued", "running"].includes(current.status)) await repositoryAgents.cancelRun(job.id, user).catch(() => {});
    }
  
}
module.exports=require("./definition")("repositoryAgent",{timeoutMaxMs:()=>180000,preflight:{model:context=>context.node.data.llmIntegrationId?require('./shared/modelPreflight')(context):undefined},preflightFailure:(_phase,failure)=>failure.publicMessage||"Check this agent's version and model connection.",validate,execute});
