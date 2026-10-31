const C = require('./qualityAgentContracts');
const skills = require('./qualityAgentSkills');
const envelope = require('@hellotest/platform/backend/src/utils/aiPromptEnvelope');
const sanitize = value => require('@hellotest/platform/backend/src/security/aiTextPolicy').sanitizeAiText(value).text;
const string = maxLength => ({ type: 'string', minLength: 1, maxLength });
const strings = (maxItems, maxLength) => ({ type: 'array', maxItems, items: string(maxLength) });
const object = properties => ({ type: 'object', additionalProperties: false, properties, required: Object.keys(properties) });
const SCHEMA = object({
  title: string(255), summary: string(4000), conclusion: { type: 'string', enum: ['observed_findings', 'no_findings_observed', 'needs_review'] },
  observations: { type: 'array', maxItems: 50, items: object({ finding_id: string(128), analysis: string(2000), recommendation: string(2000), artifact_ids: strings(10,128) }) },
  metric_notes: { type: 'array', maxItems: 20, items: object({ metric: string(128), interpretation: string(1000) }) },
  limitations: strings(20,1000), next_steps: strings(20,1000), skill_reference_ids: strings(10,128),
});
const Ajv = require('ajv');
const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false, ownProperties: true });
const validateSchema = ajv.compile(SCHEMA);
const finalValidators = new WeakMap();
function validateFinalConfiguration(request) {
  const custom=request.ai_configuration?.output_schema;
  if(!custom)return null;
  if(typeof custom!=='object'||Array.isArray(custom))throw C.fail('Choose a JSON object schema for additional final-output constraints.',422,'QUALITY_AGENT_FINAL_SCHEMA_CONFLICT');
  if(Array.isArray(custom.required)&&custom.required.some(key=>!Object.hasOwn(SCHEMA.properties,key)) || custom.additionalProperties===false&&!custom.patternProperties&&Object.keys(SCHEMA.properties).some(key=>!Object.hasOwn(custom.properties||{},key))) throw C.fail('The additional final-output schema conflicts with the Quality Agent report contract. Constrain the existing report fields instead of requiring new fields or excluding native fields.',422,'QUALITY_AGENT_FINAL_SCHEMA_CONFLICT');
  if(!finalValidators.has(custom))finalValidators.set(custom,ajv.compile(custom));
  return finalValidators.get(custom);
}
function evidencePacket(request, engine) {
  const packet = { task_brief: C.taskBrief(request), reviewed_context: request.smart_context?.reviewed_context || null,
    observed_outcome: engine.outcome, mission_report: engine.mission_report || null, metrics: engine.metrics,
    findings: [], artifacts: engine.artifacts.map(({id,type,name,content_type,sha256})=>({id,type,name,content_type,sha256})), limitations: engine.limitations,
    evidence_manifest: { findings_available: engine.findings.length, findings_included: 0, findings_omitted: 0, bounded: true } };
  const severity = { critical:0,high:1,medium:2,low:3,info:4 };
  for (const finding of [...engine.findings].sort((a,b)=>(severity[a.severity]??5)-(severity[b.severity]??5))) {
    if (packet.findings.length >= 50) break;
    packet.findings.push(finding);
    if (Buffer.byteLength(JSON.stringify(packet)) > 64000) { packet.findings.pop(); break; }
  }
  packet.evidence_manifest.findings_included = packet.findings.length;
  packet.evidence_manifest.findings_omitted = engine.findings.length - packet.findings.length;
  if (Buffer.byteLength(JSON.stringify(packet)) > 64000) throw C.fail('The full task and retained quality evidence exceed the assessment context budget. Narrow the review scope.',422,'QUALITY_AGENT_ASSESSMENT_BUDGET');
  return packet;
}
function validateAssessment(value, request, engine, packet = evidencePacket(request,engine)) {
  if (!validateSchema(value)) throw C.fail('The model assessment does not satisfy its output contract.',502,'QUALITY_AGENT_ASSESSMENT_INVALID');
  const validateFinal=validateFinalConfiguration(request);
  if(validateFinal&&!validateFinal(value))throw C.fail('The assessment does not satisfy the saved additional final-output constraints.',502,'QUALITY_AGENT_ASSESSMENT_INVALID');
  const findings = new Set(packet.findings.map(item=>item.id)), artifacts = new Set([...engine.artifacts.map(item=>item.id),...(packet.visual_evidence?.mode==='images'?(packet.visual_evidence.images||[]).map(item=>item.artifact_id):[])]), references = new Set(skills.profile(request.kind).references.map(item=>item.id));
  if (value.observations.some(item=>!findings.has(item.finding_id)||item.artifact_ids.some(id=>!artifacts.has(id))) || value.metric_notes.some(item=>!Object.hasOwn(engine.metrics,item.metric)) || value.skill_reference_ids.some(id=>!references.has(id))) throw C.fail('The model assessment cited evidence or a skill reference that was not supplied.',502,'QUALITY_AGENT_ASSESSMENT_INVALID');
  if (value.conclusion === 'no_findings_observed' && (engine.outcome !== 'passed' || engine.findings.length || packet.evidence_manifest.findings_omitted)) throw C.fail('The model assessment cannot clear findings or missing evidence from the observed run.',502,'QUALITY_AGENT_ASSESSMENT_INVALID');
  if (value.conclusion === 'observed_findings' && !engine.findings.length) throw C.fail('The model assessment cannot invent findings absent from the observed run.',502,'QUALITY_AGENT_ASSESSMENT_INVALID');
  if (value.conclusion === 'observed_findings' && !value.observations.length) throw C.fail('An assessment reporting findings must explain at least one supplied finding.',502,'QUALITY_AGENT_ASSESSMENT_INVALID');
  const cleaned = JSON.parse(JSON.stringify(value), (_key,item)=>typeof item==='string'?sanitize(item):item);
  return { ...cleaned, limitations:[...new Set([...cleaned.limitations,...(packet.visual_evidence?.limitations||[])])],schema_version: 1, generation_mode: 'llm', review_required: true, observed_outcome: engine.outcome,
    ...(packet.visual_evidence?{visual_evidence:packet.visual_evidence}:{}),
    evidence_manifest: packet.evidence_manifest, skill_profile: { id: skills.profile(request.kind).id, version: skills.version } };
}
async function assessQualityRun(request,user,engine,trace = {}) {
  const packet = evidencePacket(request,engine);
  const integration = await require('./browserMissionPlanner').resolveMissionModel(request,user);
  const visual = request.kind === 'visual' && trace.visualEvidence ? await trace.visualEvidence(integration) : null;
  if (request.kind === 'visual') packet.visual_evidence = visual?.manifest || { mode:'manifest_only', limitations:['No image pixels were supplied to the model. Interpret only the observed pixel metrics and artifact metadata; visual appearance has not been assessed by the model.'] };
  const featureKey = `ai.agentic.browser.${request.kind}`;
  const base = (integration.base_url || 'https://api.openai.com/v1').replace(/\/+$/,'');
  const endpoint = /\/chat\/completions$/.test(base) ? base : `${base}/chat/completions`;
  const configuredDeadline=Date.parse(trace.deadline_at);
  const deadline = Math.min(Date.now()+Math.min(25000,request.ai_configuration?.agent_execution?.timeout_ms??Infinity),Number.isFinite(configuredDeadline)?configuredDeadline:Infinity);
  const maxRevisions=Math.min(1,request.ai_configuration?.agent_execution?.max_revision_rounds??1);
  const task = envelope.taskMessage({ context: packet, task: 'Assess the completed observed quality evidence using the declared response schema. Keep unobserved checks as recommendations and state the evidence limitations.' });
  if(visual?.imageParts?.length)task.content=[{type:'text',text:task.content},...visual.imageParts];
  const messages = [{ role: 'system', content: skills.instructionBlock(request.kind,{phase:'assessment'}) }, task];
  let priorCandidate, validation;
  for (let revision = 0; revision <= maxRevisions; revision++) {
    if (trace.signal?.aborted) throw trace.signal.reason?.code==='QUALITY_AGENT_DEADLINE'?trace.signal.reason:C.fail('The quality assessment was cancelled.',409,'QUALITY_AGENT_CANCELLED');
    if(deadline-Date.now()<1000)throw C.fail('The final assessment reached its remaining run deadline before model dispatch.',504,'QUALITY_AGENT_DEADLINE');
    const call_id = `${trace.run_id || trace.session_id || 'quality'}:assessment:${revision}`;
    await trace.onProgress?.({phase:'assessing',message:revision?'Correcting the final assessment against retained evidence.':'Assessing the observed findings, measurements and artifacts.',revision});
    await trace.onEvent?.('model_start',{call_id,stage:'assessment',kind:request.kind,revision});
    let response;
    try { response = await require('@hellotest/platform/backend/src/utils/llmTraceContext').run({ project_id:request.project_id,actor_id:user.id,session_id:trace.session_id },()=>require('@hellotest/platform/backend/src/utils/llmHttpClient').fetchLlmWithRetry(endpoint,{
      method:'POST',signal:trace.signal,headers:{'Content-Type':'application/json',...(require('@hellotest/integration/backend/services/integration.service').isUsableApiCredential(integration.api_key)?{Authorization:`Bearer ${integration.api_key}`}:{})},
      body:JSON.stringify({model:integration.model,max_tokens:4096,response_format:{type:'json_object'},messages:validation?envelope.repairMessages(messages,{candidate:priorCandidate,issues:validation}):messages}),
    },{integration,featureKey,operation:`agentic-quality.assess.${request.kind}`,timeoutMs:Math.max(1000,deadline-Date.now()),maxOutputTokens:4096,maxAttempts:1,contextFallback:false,
      outputSchema:SCHEMA,outputSchemaName:'quality_agent_assessment',contextRetrievalQuery:request.goal,...(visual?.requestOptions||{}),
      beforeDispatch:meta=>trace.beforeDispatch?.({...meta,call_id,phase:'assessment',revision}),
      onTextDelta:(text,meta)=>trace.onEvent?.('text',{call_id,stage:'assessment',kind:request.kind,revision,text,...meta}),
      mcpContextFilters:{agent_id:`browser-${request.kind}`,app_type_id:request.app_type_id,requested_scopes:request.context_scopes,evidence_scope:request.evidence_scope,source_ids:request.smart_context?.source_ids,source_kinds:request.smart_context?.source_kinds},
    })); } catch(failure) {
      if(revision<maxRevisions&&!trace.signal?.aborted&&Date.now()<deadline-1000&&['AI_INVALID_JSON','AI_OUTPUT_SCHEMA_VIOLATION'].includes(failure.code)&&typeof failure.model_candidate==='string') {
        priorCandidate=failure.model_candidate;validation={code:failure.code,message:failure.publicMessage||failure.message,validation_errors:failure.validation_errors,actions_dispatched:0};
        await trace.onEvent?.('model_done',{call_id,stage:'assessment',kind:request.kind,revision,status:'invalid_output'});
        continue;
      }
      throw failure;
    }
    if (trace.signal?.aborted) throw trace.signal.reason?.code==='QUALITY_AGENT_DEADLINE'?trace.signal.reason:C.fail('The quality assessment was cancelled.',409,'QUALITY_AGENT_CANCELLED');
    if (!response.ok) throw C.fail('The quality assessment model is unavailable. Observed engine evidence is preserved.',503,'QUALITY_AGENT_MODEL_UNAVAILABLE');
    const payload = await response.json(), choice = payload?.choices?.[0];
    await trace.onUsage?.(payload.usage || null);
    if (!choice || !['stop','end_turn'].includes(choice.finish_reason) || choice.message?.refusal || choice.message?.tool_calls?.length || typeof choice.message?.content !== 'string') throw C.fail('The model assessment was refused, truncated or incomplete. Observed evidence is preserved.',502,'QUALITY_AGENT_ASSESSMENT_INCOMPLETE');
    await trace.onEvent?.('model_done',{call_id,stage:'assessment',kind:request.kind,revision,finish_reason:choice.finish_reason,...(payload.usage?{usage:payload.usage}:{})});
    try {
      const value = JSON.parse(choice.message.content);
      return validateAssessment(value,request,engine,packet);
    } catch (failure) {
      if (revision >= maxRevisions || Date.now() >= deadline - 1000) throw failure.code ? failure : C.fail('The model assessment was not valid JSON.',502,'QUALITY_AGENT_ASSESSMENT_INVALID');
      priorCandidate = choice.message.content;
      validation = { code:failure.code || 'QUALITY_AGENT_ASSESSMENT_INVALID',message:failure.publicMessage || 'Return a complete JSON assessment using the declared schema.',actions_dispatched:0 };
    }
  }
}
module.exports = { SCHEMA, validateFinalConfiguration, evidencePacket, validateAssessment, assessQualityRun:(request,user,engine,trace)=>require('../workflows/nodeAiConfiguration').runRequest({...request,session_id:trace?.session_id},`ai.agentic.browser.${request.kind}`,()=>assessQualityRun(request,user,engine,trace)) };
