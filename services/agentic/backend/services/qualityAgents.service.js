const { randomUUID } = require('node:crypto');
const C = require('./qualityAgentContracts');
const terminal = status => ['completed','failed','cancelled'].includes(status);
const iso = value => value instanceof Date ? value.toISOString() : value || null;
const runDeadline = metadata => Date.parse(metadata.queued_at) + Math.min(metadata.request.options.timeout_ms + 90000,
  metadata.request.ai_configuration?.agent_execution?.timeout_ms ?? Infinity);
const deadlineFailure = () => C.fail('The Quality Agent reached its saved run deadline. Partial observed evidence is preserved; no further browser action or model request was dispatched.',504,'QUALITY_AGENT_DEADLINE');
function createQualityAgentService(deps) {
  const {store,scope,integration,workerUser,http,secret,proposePlan,decideMission,resolveMissionModel,assessQualityRun}=deps;
  let processing=false,accepting=true;
  const activeDecisions=new Map();
  const progress=(phase,message,extra={})=>({phase,message,...extra,updated_at:new Date().toISOString()});
  const publicRun=row=>{
    const m=row.metadata,r=m.request;
    return {id:m.id,transaction_id:row.id,project_id:row.project_id,app_type_id:row.app_type_id||null,kind:r.kind,target_url:r.target_url,goal:r.goal,execution_mode:r.execution_mode||'checks',agent_runtime:r.execution_mode==='agent'?{mode:'llm_observation_action_loop',tools:'typed_browser_actions',schema_version:1}:null,agent_assessment:m.agent_assessment||null,model_usage:m.model_usage||null,...require('../workflows/nodeAiConfiguration').requestSettings(r),task_brief:C.taskBrief(r),options:r.options,mission_progress:m.mission_progress,mission_outcome:m.mission_outcome,mission_report:m.mission_report,reviewed_plan:r.reviewed_plan,plan:r.reviewed_plan,status:m.run_status,outcome:m.outcome||null,created_at:iso(row.created_at),updated_at:iso(row.updated_at),started_at:iso(m.started_at||row.started_at),completed_at:iso(m.completed_at||row.completed_at),stages:m.stages||[],findings:m.findings||[],metrics:m.metrics||{},limitations:m.limitations||[],error:m.error||null,cancellation_requested:Boolean(m.cancellation_requested),baseline_id:r.baseline_id,artifacts:(m.artifacts||[]).map(a=>({...a,download_path:`/agentic-quality/runs/${m.id}/artifacts/${a.id}`}))};
  };
  const publicBaseline=row=>{
    const m=row.metadata;
    return {id:m.id,source_run_id:m.source_run_id,artifact_id:m.source_artifact_id,project_id:row.project_id,app_type_id:row.app_type_id||null,target_url:m.target_url,label:m.label,viewport:m.viewport,masks:m.masks,sha256:m.sha256,created_at:iso(row.created_at),reviewed_by:m.reviewed_by,download_path:`/agentic-quality/baselines/${m.id}/artifact`};
  };
  async function findRun(id,user,permission='agentic_workflow.view') {
    if (typeof id!=='string' || !/^[a-zA-Z0-9_-]{8,128}$/.test(id)) throw C.fail('Quality run not found.',404);
    const row=await store.findRun(id); if (!row) throw C.fail('Quality run not found.',404);
    await scope(row.project_id,row.app_type_id,user,permission);return row;
  }
  async function findBaseline(id,user,permission='agentic_workflow.view') {
    if (typeof id!=='string' || !/^[a-zA-Z0-9_-]{8,128}$/.test(id)) throw C.fail('Reviewed baseline not found.',404);
    const row=await store.findBaseline(id); if (!row) throw C.fail('Reviewed baseline not found.',404);
    await scope(row.project_id,row.app_type_id,user,permission);return row;
  }
  async function engineRequest(connection,path,body,{bytes=false,operation='quality-agent',deadlineMs=10000,signal}={}) {
    const base=C.targetUrl(connection.base_url).replace(/\/$/,'');
    const response=await http(`${base}/api/v1/quality-agents${path}`,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','x-hellotest-testengine-secret':secret(connection)},...(signal?{signal}:{}),...(body===undefined?{}:{body:JSON.stringify(body)})},{dependency:'testengine',operation,deadlineMs,maxAttempts:1,maxResponseBytes:bytes?C.LIMITS.max_artifact_bytes:768*1024,redirect:'error'});
    if (!response.ok) {
      if(response.status===404)throw C.fail('The Test Engine no longer has this run or artifact.',502,'QUALITY_AGENT_ENGINE_NOT_FOUND');
      if(response.status>=400&&response.status<500&&![408,429].includes(response.status))throw C.fail('The Test Engine rejected this review. Verify the bounded settings, approved journey and runtime policy.',422,'QUALITY_AGENT_ENGINE_REJECTED');
      throw C.fail('The Test Engine could not complete this request.',503,'QUALITY_AGENT_ENGINE_UNAVAILABLE');
    }
    if (bytes) return {bytes:Buffer.from(await response.arrayBuffer()),content_type:(response.headers.get('content-type')||'').split(';')[0]};
    try {return await response.json();} catch {throw C.fail('The Test Engine returned malformed or truncated evidence.',502,'QUALITY_AGENT_ENGINE_CONTRACT');}
  }
  async function catalog(input,user) {
    await scope(input.project_id,input.app_type_id,user);
    let connection;try {connection=await integration(null,input.project_id,user);} catch(error) {if(error.statusCode!==503) throw error;}
    let available=false,reason='Configure an active Test Engine integration for this project.',capabilities;
    if(connection) {
      try {
        capabilities=await engineRequest(connection,'/capabilities',undefined,{operation:'quality-agent.capabilities',deadlineMs:3000});
        if(capabilities?.contract_version!=='1.0'||typeof capabilities.available!=='boolean'||typeof capabilities.browser?.available!=='boolean'||!C.AGENTS.every(a=>typeof capabilities.checks?.[a.id]==='string')) throw C.fail('The configured Test Engine does not support this quality agent contract.',502);
        available=capabilities.available&&capabilities.browser.available;
        reason=available?undefined:'The Test Engine browser is unavailable. Install Chromium or configure its executable path.';
      } catch {reason='The configured Test Engine is unavailable or does not support quality agents.';capabilities=undefined;}
    }
    return {agents:C.AGENTS.map(a=>({...a,kind:a.id,available})),limits:C.LIMITS,runtime:{configured:Boolean(connection),available,integration_name:connection?.name||null,missions:capabilities?.missions||{supported:false},reason,detail:available?'The Test Engine reports its browser binary is present. Each run still verifies launch and target access.':reason,...(capabilities?{checks:capabilities.checks,limitations:capabilities.limitations||[]}:{} )}};
  }
  async function plan(input,user) {
    if (!C.KINDS.has(input.kind)) throw C.fail('Choose a supported quality agent.');
    await scope(input.project_id,input.app_type_id,user,'agentic_workflow.run');
    const target_url=C.targetUrl(input.target_url),goal=C.text(input.goal,1500),options=C.normalizeOptions(input.options,input.kind);
    if(typeof input.goal==='string'&&input.goal.length>1500)throw C.fail('Keep the review goal within 1,500 characters.');
    if(C.hasSensitiveValue(goal))throw C.fail('Remove authentication tokens and private keys from the review goal.');
    let steps=[],source='preset',generation_mode='deterministic',grounding=[];
    const limitations=['No live application DOM has been inspected during planning. Review selectors and assertions before execution.'];
    if (input.kind==='web') {
      if (Array.isArray(input.steps)) steps=C.normalizeSteps(input.steps,target_url);
      else if (goal && !options.mission) {
        if (!proposePlan) throw C.fail('Configure an AI model for browser goal planning, or supply explicit reviewed steps.',503,'QUALITY_AGENT_MODEL_REQUIRED');
        const proposed=await proposePlan({...input,target_url,goal,options},user);
        if (!proposed) throw C.fail('The model did not return a browser plan. No fallback plan was produced.',422,'QUALITY_AGENT_PLAN_INVALID');
        steps=C.normalizeSteps(proposed.steps,target_url);grounding=proposed.grounding||[];source='model';generation_mode='llm';
      }
      if (!goal && !steps.length) steps=[{id:'step-1',label:'Verify the selected page',action:'assert_url',url:target_url}];
      if (goal && !steps.length && !options.mission) limitations.push('This goal has no executable steps yet. Add concrete selectors and observable assertions before running.');
    } else if (!options.mission) limitations.push('This preset executes its published bounded checks. The goal provides review context and does not add arbitrary browser actions.');
    if(grounding.length)limitations.push('Suggestions use authorized saved Object Repository locators. Their current DOM matches remain unverified.');
    if(options.mission) {limitations.splice(0,limitations.length,'The agent observes the current browser before each action. Review the target, credential reference, submission policy and execution limits.');}
    return {...C.contextSelection(input),kind:input.kind,target_url,goal,steps,options,source,generation_mode,grounding,limitations,review_required:true};
  }
  async function createRun(input,user,{requestKey}={}) {
    if(!C.KINDS.has(input?.kind))throw C.fail('Choose a supported quality agent.');
    if(input.options!=null&&(!input.options||typeof input.options!=='object'||Array.isArray(input.options)))throw C.fail('Choose valid agent settings.');
    const execution_mode=input.execution_mode||'agent';
    if(!['agent','checks'].includes(execution_mode))throw C.fail('Choose AI agent mode or explicit checks-only execution.');
    if(execution_mode==='checks'&&input.options?.mission)throw C.fail('Browser missions require AI agent mode.');
    if(input.reviewed_plan&&input.options?.mission)throw C.fail('Choose a reviewed journey or an observed browser mission, not both.');
    const launch=execution_mode==='agent'?{...input,goal:input.goal||input.reviewed_plan?.goal||require('./qualityAgentSkills').defaultGoal(input.kind),options:{...input.options,...(!input.reviewed_plan?{mission:input.options?.mission||{max_actions:6,allow_form_submission:false}}:{})}}:input;
    const request={...C.normalizeLaunch(launch),execution_mode};
    if(execution_mode==='agent'&&request.options.mission&&request.ai_configuration?.agent_execution?.max_model_calls===1)throw C.fail('A browser mission needs at least two model calls: one observed decision and one final assessment. Increase the model-call budget or supply a reviewed journey for assessment-only execution.',422,'QUALITY_AGENT_MODEL_BUDGET');
    await scope(request.project_id,request.app_type_id,user,'agentic_workflow.run');
    const connection=await integration(request.integration_id,request.project_id,user);
    request.integration_id=connection.id;
    if(request.execution_mode==='agent')require('./qualityAgentAssessment').validateFinalConfiguration(request);
    if(request.execution_mode==='agent'&&resolveMissionModel)await resolveMissionModel(request,user);
    else if(request.execution_mode==='agent'&&!decideMission&&!assessQualityRun)throw C.fail('Configure an AI model before starting a Quality Agent.',503,'QUALITY_AGENT_MODEL_REQUIRED');
    if(request.options.mission){const capabilities=await engineRequest(connection,'/capabilities',undefined,{operation:'quality-agent.mission-preflight',deadlineMs:3000});if(capabilities?.missions?.supported!==true)throw C.fail('Update the configured browser engine to support autonomous missions.',503,'QUALITY_AGENT_MISSION_UNAVAILABLE');}
    let baseline;
    if (request.baseline_id) {
      if (request.kind!=='visual') throw C.fail('Baselines apply to visual regression only.');
      baseline=await findBaseline(request.baseline_id,user);
      const m=baseline.metadata;
      if (baseline.project_id!==request.project_id || (baseline.app_type_id||null)!==request.app_type_id || m.target_url!==request.target_url || m.integration_id!==connection.id || C.hash(m.viewport)!==C.hash(request.options.viewport) || C.hash(m.masks||[])!==C.hash(request.options.masks||[])) throw C.fail('Choose a reviewed baseline matching this project, application, URL, viewport, masks and Test Engine.',409,'QUALITY_AGENT_BASELINE_SCOPE');
    }
    if(requestKey&&input.idempotency_key&&requestKey!==input.idempotency_key)throw C.fail('The header and body idempotency keys must match.');
    const key=requestKey||input.idempotency_key||null;
    if (key && (typeof key!=='string' || key.length>160 || !/^[\w.:/-]+$/.test(key))) throw C.fail('Use an idempotency key within 160 characters.');
    const metadata={schema_version:1,id:randomUUID(),request,request_key:key,request_hash:C.hash(request),run_status:'queued',outcome:null,engine_run_id:null,engine_baseline_id:baseline?.metadata.engine_baseline_id||null,queued_at:new Date().toISOString(),stages:[],findings:[],artifacts:[],metrics:{},limitations:[],...(execution_mode==='agent'?{model_usage:{calls:0,max_calls:Math.min(26,request.ai_configuration?.agent_execution?.max_model_calls??((request.options.mission?.max_actions||1)*2+2)),reserved_output_tokens:0,max_output_tokens:65536,prompt_tokens:0,completion_tokens:0,usage_available:false}}:{})};
    if(execution_mode==='agent')metadata.deadline_at=new Date(runDeadline(metadata)).toISOString();
    const result=await store.create(request,user,metadata,key);
    if (result.busy) throw C.fail('Three reviews are already active for this project. Wait for a review to finish or stop one.',429,'QUALITY_AGENT_QUEUE_FULL');
    if (result.existing && result.row.metadata.request_hash!==metadata.request_hash) throw C.fail('This request key already belongs to a different review.',409,'QUALITY_AGENT_IDEMPOTENCY_CONFLICT');
    if (!result.existing) await store.event(result.row,{phase:'queued',message:'Quality review queued on the configured Test Engine.'});
    return publicRun(result.row);
  }
  async function getRun(id,user) {return publicRun(await findRun(id,user));}
  async function listStreamEvents(id,user,{after=0,limit=200}={}) {
    const row=await findRun(id,user);
    if(!Number.isSafeInteger(Number(after))||Number(after)<0||!Number.isSafeInteger(Number(limit))||Number(limit)<1||Number(limit)>500)throw C.fail('Use a valid event cursor and page limit.');
    return store.listStreamEvents(row,Number(after),Number(limit));
  }
  async function listRuns(input,user) {await scope(input.project_id,input.app_type_id,user);return {items:(await store.listRuns({project_id:input.project_id,app_type_id:input.app_type_id})).map(publicRun)};}
  async function remoteStop(row,user) {
    try {
      const connection=await integration(row.metadata.request.integration_id,row.project_id,user,{worker:true});
      const path=row.metadata.engine_run_id?`/runs/${row.metadata.engine_run_id}/cancel`:`/runs/by-client/${row.metadata.id}/cancel`;
      await engineRequest(connection,path,{scope:{project_id:row.project_id,app_type_id:row.app_type_id||null}}, {operation:'quality-agent.cancel',deadlineMs:5000});
    } catch { /* Persisted cancellation remains authoritative; engine runs also have a bounded deadline. */ }
  }
  async function cancelRun(id,user) {
    const row=await findRun(id,user,'agentic_workflow.run');
    if (terminal(row.metadata.run_status)) return publicRun(row);
    const cancelled=await store.cancel(row); if (!cancelled) return publicRun(await findRun(id,user));
    activeDecisions.get(id)?.abort();
    await store.event(cancelled,{phase:'cancelled',level:'warning',message:'Review cancelled. Late engine responses cannot change this result.'});
    await remoteStop(row,user);
    return publicRun(cancelled);
  }
  function modelTrace(row,actor,controller,stage,sequence=0) {
    const usage={calls:0,max_calls:26,reserved_output_tokens:0,max_output_tokens:65536,prompt_tokens:0,completion_tokens:0,usage_available:false,...row.metadata.model_usage};
    const pending=new Map();
    const redactors=new Map();
    let heartbeat;
    const deadline=runDeadline(row.metadata);
    const timeout=setTimeout(()=>controller.abort(deadlineFailure()),Math.max(1,deadline-Date.now()));timeout.unref?.();
    const guard=async()=>{
      if(Date.now()>=deadline){controller.abort(deadlineFailure());throw controller.signal.reason;}
      if(controller.signal.aborted)throw controller.signal.reason?.code==='QUALITY_AGENT_DEADLINE'?controller.signal.reason:C.fail('The Quality Agent was stopped.',409,'QUALITY_AGENT_CANCELLED');
      const current=await store.findRun(row.metadata.id);
      if(!current||terminal(current.metadata.run_status)||current.metadata.lease_token!==row.metadata.lease_token){controller.abort();throw C.fail('The Quality Agent is no longer active.',409,'QUALITY_AGENT_CANCELLED');}
      return current;
    };
    const append=async(type,data)=>{
      await guard();
      if(store.appendStreamEvent&&!await store.appendStreamEvent(row,{type,data,at:new Date().toISOString()},{lease_token:row.metadata.lease_token})) {controller.abort();throw C.fail('The Quality Agent stream is no longer active.',409,'QUALITY_AGENT_CANCELLED');}
    };
    const addText=(data,text)=>{
      const value=pending.get(data.call_id)||{text:'',at:Date.now(),data:{...data,text:undefined}};
      value.text+=text;pending.set(data.call_id,value);return value;
    };
    const flushPending=async(call_id)=>{
      for(const [id,value] of pending)if(!call_id||id===call_id){pending.delete(id);if(value.text)await append('text',{...value.data,text:value.text});}
    };
    const flush=async(call_id)=>{
      for(const [id,value] of redactors)if(!call_id||id===call_id){redactors.delete(id);addText(value.data,value.redactor.finish());}
      await flushPending(call_id);
    };
    const onEvent=async(type,data)=>{
      if(type==='text'){
        const existing=redactors.get(data.call_id)||{data:{...data,text:undefined},redactor:require('./qualityAgentEvents').createTextRedactor()};
        redactors.set(data.call_id,existing);
        const value=addText(data,existing.redactor.push(String(data.text||'')));
        if(value.text.length>=512||Date.now()-value.at>=500)await flushPending(data.call_id);
      }else{if(['model_done','error'].includes(type))await flush(data?.call_id);else await flushPending(data?.call_id);await append(type,data);}
    };
    return {run_id:row.metadata.id,session_id:row.id,signal:controller.signal,deadline_at:new Date(deadline).toISOString(),onEvent,
      onProgress:async update=>{
        await guard();
        if(!await store.checkpoint(row,{mission_progress:progress(update.phase,update.message,{sequence,revision:update.revision||0})})){controller.abort();throw C.fail('The Quality Agent is no longer active.',409,'QUALITY_AGENT_CANCELLED');}
      },
      beforeDispatch:async({payload,call_id,phase,revision})=>{
        await guard();await scope(row.project_id,row.app_type_id,await workerUser(row.created_by),'agentic_workflow.run');
        const reserved=Number(payload?.max_completion_tokens??payload?.max_tokens??4096);
        if(!Number.isSafeInteger(reserved)||reserved<1||usage.calls>=usage.max_calls||usage.reserved_output_tokens+reserved>usage.max_output_tokens)throw C.fail('The Quality Agent reached its saved model-call or output-token budget. Partial evidence is preserved.',422,'QUALITY_AGENT_MODEL_BUDGET');
        usage.calls++;usage.reserved_output_tokens+=reserved;
        if(!await store.checkpoint(row,{model_usage:{...usage},model_dispatch:{call_id,phase:phase||stage,sequence,revision:revision||0,state:'in_flight',started_at:new Date().toISOString()}})){controller.abort();throw C.fail('The Quality Agent stopped before model dispatch.',409,'QUALITY_AGENT_CANCELLED');}
        if(!heartbeat){heartbeat=setInterval(()=>{void guard().then(()=>store.checkpoint(row,{})).then(saved=>{if(!saved)controller.abort();}).catch(()=>controller.abort());},5000);heartbeat.unref?.();}
      },
      onUsage:async value=>{
        if(value&&Number.isFinite(value.prompt_tokens)&&value.prompt_tokens>=0&&Number.isFinite(value.completion_tokens)&&value.completion_tokens>=0){usage.prompt_tokens+=value.prompt_tokens;usage.completion_tokens+=value.completion_tokens;usage.usage_available=true;}
        if(!await store.checkpoint(row,{model_usage:{...usage}})){controller.abort();throw C.fail('The Quality Agent stopped before its model usage was recorded.',409,'QUALITY_AGENT_CANCELLED');}
      },flush,dispose:()=>{clearInterval(heartbeat);clearTimeout(timeout);}};
  }
  async function advance(row) {
    const m=row.metadata,r=m.request;
    const deadline=runDeadline(m);
    let patch,status;
    try {
      if (Date.now()>=deadline) throw deadlineFailure();
      const actor=await workerUser(row.created_by);await scope(row.project_id,row.app_type_id,actor,'agentic_workflow.run');
      const connection=await integration(r.integration_id,row.project_id,actor,{worker:true});
      if(m.model_dispatch)throw C.fail('The worker stopped before recording a model result. Its generation may already have been billed; inspect the saved trace and start a new run after review. No model call was repeated.',409,'QUALITY_AGENT_MODEL_OUTCOME_UNKNOWN');
      const {timeout_ms,max_pages,...engineOptions}=r.options;
      if(!m.engine_run_id&&deadline-Date.now()<5000)throw deadlineFailure();
      const engine=m.engine_run_id
        ?await engineRequest(connection,`/runs/${m.engine_run_id}`,undefined,{operation:'quality-agent.poll',deadlineMs:Math.max(100,Math.min(10000,deadline-Date.now()))})
        :await engineRequest(connection,'/runs',{client_run_id:m.id,kind:r.kind,target_url:r.target_url,scope:{project_id:row.project_id,app_type_id:row.app_type_id||null},options:{...engineOptions,...(r.options.mission?{mission:{...r.options.mission,goal:r.goal}}:{}),...(r.kind==='web'&&!r.options.mission?{approved_steps:r.reviewed_plan?.steps?.map(({id,label,...s})=>s)||[]} : {}),...(m.engine_baseline_id?{baseline_id:m.engine_baseline_id}:{})},limits:{max_pages,max_duration_ms:Math.min(timeout_ms,Math.floor(deadline-Date.now()))}},{operation:'quality-agent.start',deadlineMs:Math.max(100,Math.min(10000,deadline-Date.now()))});
      C.validateEngineRun(engine,{id:m.id,...r,engine_run_id:m.engine_run_id});
      const receipts=(engine.mission_report?.actions||[]).filter(item=>item.sequence>(m.last_tool_sequence||0));
      for(const receipt of receipts) {
        if(store.appendStreamEvent&&!await store.appendStreamEvent(row,{type:'tool_result',data:{tool_call_id:`${m.id}:browser:${receipt.sequence}`,name:`browser.${receipt.action}`,sequence:receipt.sequence,status:receipt.status,summary:receipt.summary,observed_url:receipt.url},at:new Date().toISOString()},{lease_token:m.lease_token}))return;
      }
      if(receipts.length&&!await store.checkpoint(row,{last_tool_sequence:Math.max(...receipts.map(item=>item.sequence))}))return;
      if(engine.decision_request) {
        if(!r.options.mission||!decideMission)throw C.fail('This browser run is not authorized for autonomous decisions.',403);
        // Recheck identity/scope after model latency and before releasing the browser action.
        const sequence=engine.decision_request.sequence;
        if(!await store.checkpoint(row,{engine_run_id:engine.id,run_status:engine.state,stages:engine.stages,mission_report:engine.mission_report,metrics:engine.metrics,findings:engine.findings,artifacts:engine.artifacts,limitations:engine.limitations,mission_progress:progress('observing','Current browser evidence received.',{sequence})}))return;
        const observations = [...(m.mission_observations || []).filter(item => item.sequence !== sequence), require('./browserMissionPlanner').observation(engine.decision_request,r.target_url)].slice(-12);
        let decision=m.last_decision?.sequence===sequence?m.last_decision.decision:null;
        if(!decision) {
          const controller=new AbortController();activeDecisions.set(m.id,controller);
          const trace=modelTrace(row,actor,controller,'decision',sequence);
          try {decision=await decideMission(r,actor,engine.decision_request,engine.mission_report?.actions||[],{...trace,observations});await trace.flush();} finally {trace.dispose();if(!controller.signal.aborted)try{await trace.flush();}catch{controller.abort();}if(activeDecisions.get(m.id)===controller)activeDecisions.delete(m.id);}
        }
        if(!await store.checkpoint(row,{last_decision:{sequence,decision},model_dispatch:null,mission_observations:observations,mission_progress:progress('dispatching',decision.summary,{sequence}),...(decision.outcome?{mission_outcome:decision.outcome}:{})}))return;
        const current=await store.findRun(m.id);if(!current||terminal(current.metadata.run_status))return;
        const activeActor=await workerUser(row.created_by);await scope(row.project_id,row.app_type_id,activeActor,'agentic_workflow.run');
        if(Date.now()>=deadline)throw deadlineFailure();
        const {outcome:reviewedOutcome,...browserDecision} = decision;
        if(m.last_dispatched_sequence!==sequence) {
          if(store.appendStreamEvent&&!await store.appendStreamEvent(row,{type:'tool_start',data:{tool_call_id:`${m.id}:browser:${sequence}`,name:`browser.${decision.action}`,sequence,summary:decision.summary},at:new Date().toISOString()},{lease_token:m.lease_token}))return;
          if(!await store.checkpoint(row,{last_dispatched_sequence:sequence}))return;
        }
        await engineRequest(connection,`/runs/${engine.id}/decision`,{sequence:engine.decision_request.sequence,scope:{project_id:row.project_id,app_type_id:row.app_type_id||null},decision:browserDecision},{operation:'quality-agent.decision',deadlineMs:Math.max(100,Math.min(10000,deadline-Date.now()))});
      }
      if(r.execution_mode==='agent'&&engine.state==='completed'&&!m.agent_assessment) {
        if(!assessQualityRun)throw C.fail('The Quality Agent assessment adapter is unavailable. Observed browser evidence is preserved.',503,'QUALITY_AGENT_MODEL_REQUIRED');
        if(!await store.checkpoint(row,{engine_run_id:engine.id,run_status:'running',engine_status:'completed',stages:engine.stages,mission_report:engine.mission_report,metrics:engine.metrics,findings:engine.findings,artifacts:engine.artifacts,limitations:engine.limitations,mission_progress:progress('assessing','Interpreting the completed quality evidence.')}))return;
        const controller=new AbortController();activeDecisions.set(m.id,controller);
        const trace=modelTrace(row,actor,controller,'assessment');
        try {
          const assessment=await assessQualityRun(r,actor,engine,{...trace,visualEvidence:integration=>require('./qualityAgentVisualEvidence').prepareVisualEvidence({request:r,engine,integration,user:actor,run_id:m.id,signal:controller.signal,getArtifact:id=>verifiedArtifact(row,id,actor,{signal:controller.signal}),getBaseline:()=>getBaselineArtifact(r.baseline_id,actor)})});await trace.flush();
          if(Date.now()>=deadline)throw deadlineFailure();
          if(!await store.checkpoint(row,{agent_assessment:assessment,model_dispatch:null,mission_progress:progress('completed','Observed evidence and the final AI assessment are ready for review.')}))return;
        }finally {trace.dispose();if(!controller.signal.aborted)try{await trace.flush();}catch{controller.abort();}if(activeDecisions.get(m.id)===controller)activeDecisions.delete(m.id);}
      }
      patch={engine_run_id:engine.id,run_status:engine.state,outcome:engine.outcome,stages:engine.stages,findings:engine.findings,metrics:engine.metrics,artifacts:engine.artifacts,mission_report:engine.mission_report,limitations:engine.limitations,started_at:engine.started_at||null,completed_at:engine.finished_at||null,error:engine.error?{code:C.text(engine.error.code,100),message:C.text(engine.error.message,1000)}:null};
      if(r.options.mission&&terminal(engine.state))patch.mission_progress=progress(engine.mission_report?.status||engine.state,engine.mission_report?.summary||'Browser mission stopped.');
      status=engine.state==='cancelled'?'failed':engine.state;
    } catch(error) {
      if(Date.now()>=deadline)error=deadlineFailure();
      // A lost POST acknowledgement is safely retried with the same durable client_run_id.
      const retryable=error?.retryable===true || ['QUALITY_AGENT_ENGINE_UNAVAILABLE'].includes(error?.code);
      if (retryable && Date.now()<deadline) {patch={last_poll_error:'Test Engine temporarily unavailable; the saved review will retry.'};status=row.status;}
      else {patch={run_status:'failed',outcome:'error',completed_at:new Date().toISOString(),error:{code:C.text(error?.code,100)||'QUALITY_AGENT_FAILED',message:error.publicMessage||'The review could not complete safely. Check the Test Engine connection and retry.'}};status='failed';if(r.options.mission)patch.mission_progress=progress('failed',patch.error.message);const current=await store.findRun(m.id);patch.stages=(current?.metadata.stages||m.stages||[]).map(stage=>stage.status==='running'?{...stage,status:'failed'}:stage);if(current?.metadata.mission_report)patch.mission_report={...current.metadata.mission_report,status:'blocked',summary:patch.error.message};if(m.engine_run_id||r.options.mission||error?.code==='QUALITY_AGENT_DEADLINE')await remoteStop(current||row,{id:row.created_by});}
    }
    const updated=await store.updateClaim(row,patch,status);
    if(!updated&&patch.engine_run_id){const current=await store.findRun(m.id);if(current?.metadata.run_status==='cancelled')await remoteStop({...current,metadata:{...current.metadata,engine_run_id:patch.engine_run_id}},{id:row.created_by});}
    if (updated && terminal(updated.metadata.run_status) && !terminal(m.run_status)) {
      await store.event(updated,{phase:updated.metadata.run_status,level:updated.metadata.run_status==='completed'?'success':'error',message:updated.metadata.run_status==='completed'?'Observed quality evidence is ready for review.':updated.metadata.error?.message||'Quality review stopped.'});
      if(store.appendStreamEvent&&!store.terminalStreamEvents)await store.appendStreamEvent(updated,{type:updated.metadata.run_status==='completed'?'done':'error',data:{status:updated.metadata.run_status,outcome:updated.metadata.outcome,...(updated.metadata.error?{error:updated.metadata.error}:{})},at:new Date().toISOString()},{allow_terminal:true});
    }
  }
  async function processQueuedRuns() {
    if (processing||!accepting) return;processing=true;
    try {const rows=[];for(let i=0;i<3;i++){const row=await store.claim();if(!row)break;rows.push(row);}await Promise.allSettled(rows.map(advance));} finally {processing=false;}
  }
  async function verifiedArtifact(row,artifactId,user,{signal}={}) {
    const artifact=row.metadata.artifacts?.find(a=>a.id===artifactId);
    if (!artifact || !row.metadata.engine_run_id) throw C.fail('Quality artifact not found.',404);
    const connection=await integration(row.metadata.request.integration_id,row.project_id,user,{worker:true});
    const result=await engineRequest(connection,`/runs/${row.metadata.engine_run_id}/artifacts/${artifact.id}`,undefined,{bytes:true,operation:'quality-agent.artifact',signal,deadlineMs:signal?Math.max(100,Math.min(10000,runDeadline(row.metadata)-Date.now())):10000});
    if(result.content_type!==artifact.content_type || result.bytes.length!==artifact.bytes || C.hash(result.bytes)!==artifact.sha256) throw C.fail('Artifact integrity verification failed. The evidence was not returned.',502,'QUALITY_AGENT_ARTIFACT_INTEGRITY');
    return {...result,artifact};
  }
  async function getArtifact(id,artifactId,user) {const row=await findRun(id,user);return {project_id:row.project_id,...await verifiedArtifact(row,artifactId,user)};}
  async function listBaselines(input,user) {await scope(input.project_id,input.app_type_id,user);return {items:(await store.listBaselines({project_id:input.project_id,app_type_id:input.app_type_id})).map(publicBaseline)};}
  async function approveBaseline(id,input,user) {
    const row=await findRun(id,user,'agentic_workflow.manage');
    if(row.metadata.request.kind!=='visual'||row.metadata.run_status!=='completed') throw C.fail('Review a completed visual capture before approving its baseline.',409);
    const {artifact,bytes}=await verifiedArtifact(row,input.artifact_id,user);
    if(artifact.type!=='screenshot'||artifact.content_type!=='image/png') throw C.fail('Select the captured screenshot as a baseline.');
    const r=row.metadata.request,connection=await integration(r.integration_id,row.project_id,user,{worker:true});
    const result=await engineRequest(connection,'/baselines',{scope:{project_id:row.project_id,app_type_id:row.app_type_id||null},source_run_id:row.metadata.engine_run_id,artifact_id:artifact.id,reviewed_by:user.id},{operation:'quality-agent.baseline'});
    if(!result || !/^[a-zA-Z0-9_-]{8,128}$/.test(result.id)||result.source_run_id!==row.metadata.engine_run_id||result.artifact_id!==artifact.id||result.scope?.project_id!==row.project_id||(result.scope?.app_type_id||null)!==(row.app_type_id||null)||result.sha256!==artifact.sha256||result.target_url!==r.target_url||C.hash(result.viewport)!==C.hash(r.options.viewport)||C.hash(result.masks||[])!==C.hash(r.options.masks||[])) throw C.fail('The Test Engine returned an incorrectly scoped baseline.',502,'QUALITY_AGENT_ENGINE_CONTRACT');
    const saved=await store.saveBaseline(row,{id:randomUUID(),source_run_id:id,source_artifact_id:artifact.id,engine_baseline_id:result.id,integration_id:connection.id,target_url:r.target_url,viewport:r.options.viewport,masks:r.options.masks||[],sha256:artifact.sha256,label:C.text(input.label,120)||'Reviewed visual baseline',reviewed_by:user.id},bytes);
    return publicBaseline(saved);
  }
  async function getBaselineArtifact(id,user) {
    const row=await findBaseline(id,user),artifact=await store.artifact(row.metadata.stored_artifact_id);
    if(artifact.transaction_id!==row.id||artifact.mime_type!=='image/png'||typeof artifact.content!=='string'||artifact.content.length>C.LIMITS.max_artifact_bytes*1.4) throw C.fail('Reviewed image integrity verification failed.',502);
    const bytes=Buffer.from(artifact.content,'base64');if(C.hash(bytes)!==row.metadata.sha256) throw C.fail('Reviewed image integrity verification failed.',502);
    return {bytes,content_type:'image/png',artifact:{id:row.metadata.id,name:'reviewed-baseline.png',sha256:row.metadata.sha256,target_url:row.metadata.target_url,viewport:row.metadata.viewport,masks:row.metadata.masks,project_id:row.project_id,app_type_id:row.app_type_id||null,reviewed_by:row.metadata.reviewed_by,source_run_id:row.metadata.source_run_id}};
  }
  return {catalog,plan,createRun,getRun,listRuns,listStreamEvents,cancelRun,processQueuedRuns,getArtifact,listBaselines,approveBaseline,getBaselineArtifact,shutdown:async()=>{accepting=false;for(const controller of activeDecisions.values())controller.abort();},_advance:advance};
}
let singleton;
function defaults() {
  const platform='@hellotest/platform/backend';
  const db=require(`${platform}/src/db`),obsDb=require(`${platform}/src/obsDb`),workspace=require(`${platform}/services/workspaceTransaction.service`),permissions=require(`${platform}/services/permission.service`),integrations=require('@hellotest/integration/backend/services/integration.service');
  const scope=async(projectId,appId,user,permission='agentic_workflow.view')=>{
    if(!C.text(projectId,255)||!user?.id) throw C.fail('Select a project for this quality review.',400);
    await require(`${platform}/public/projectAccess`).getProject(projectId,user.id);
    if(!await permissions.hasPermission(user,permission,projectId)) throw C.fail(`Permission required: ${permission}`,403);
    const features=require(`${platform}/services/featureFlag.service`);if(!await features.areEnabled(features.getFeatureKeysForPermission(permission),{user}))throw C.fail('Quality agents are disabled for this workspace.',403);
    if(appId){const app=await db.prepare('SELECT id,project_id FROM app_types WHERE id = ?').get(appId);if(!app||app.project_id!==projectId)throw C.fail('The application must belong to this project.',403);}
  };
  const integration=async(id,projectId,user,{worker=false}={})=>{
    if(id&&!worker&&!await permissions.hasPermission(user,'integration.view',projectId)) throw C.fail('Permission required: integration.view',403);
    let connection;try {connection=id?await integrations.getIntegration(id):await integrations.getActiveIntegrationByTypeForProject('testengine',projectId);} catch {throw C.fail('Configure an active Test Engine integration for this project.',503);}
    if(!connection||connection.type!=='testengine'||!connection.is_active||!connection.base_url)throw C.fail('Configure an active Test Engine integration for this project.',503);
    if(connection.config?.project_id&&connection.config.project_id!==projectId)throw C.fail('This Test Engine belongs to another project.',403);
    C.targetUrl(connection.base_url);return connection;
  };
  return {store:require('./qualityAgentStore').createQualityAgentStore({db:obsDb,workspace}),scope,integration,http:require(`${platform}/src/utils/resilientHttpClient`).resilientHttpRequest,secret:c=>require(`${platform}/src/security/runtimeSecrets`).resolveTestEngineSecret(c.config?.shared_secret),workerUser:async id=>{const actor=await db.prepare('SELECT id,email,name,status,is_workspace_admin FROM users WHERE id = ?').get(id);if(!actor||actor.status!=='active')throw C.fail('The account that started this review is no longer active.',403);return {...actor,role:actor.is_workspace_admin?'admin':'member'};},proposePlan:require('./qualityAgentPlanner').proposePlan,decideMission:require('./browserMissionPlanner').decideMission,resolveMissionModel:require('./browserMissionPlanner').resolveMissionModel,assessQualityRun:require('./qualityAgentAssessment').assessQualityRun};
}
const exported={createQualityAgentService};
for(const name of ['catalog','plan','createRun','getRun','listRuns','listStreamEvents','cancelRun','processQueuedRuns','getArtifact','listBaselines','approveBaseline','getBaselineArtifact','shutdown']) exported[name]=(...args)=>(singleton||(singleton=createQualityAgentService(defaults())))[name](...args);
module.exports=exported;
