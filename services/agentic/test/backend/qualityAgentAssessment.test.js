const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createRequire}=require('node:module');
const original=require('../../backend/services/qualityAgentAssessment');
const request={project_id:'project-a',kind:'security',target_url:'https://app.example.test/',goal:'Assess the observed security headers',options:{mission:{max_actions:3,allow_form_submission:false}},context_scopes:[]};
const user={id:'actor-a'};
const engine={kind:'security',outcome:'findings',findings:[{id:'missing-header',severity:'low',category:'headers',title:'Missing header',description:'A response policy header is absent.',evidence:'X-Content-Type-Options was not present.'}],metrics:{http_status:200},artifacts:[{id:'screen-a',type:'screenshot',name:'Page.png',content_type:'image/png',sha256:'a'.repeat(64)}],limitations:['Passive browser evidence only.']};
const value=()=>({title:'Security posture observed',summary:'The observed response omits the reviewed header.',conclusion:'observed_findings',observations:[{finding_id:'missing-header',analysis:'Header absence was observed.',recommendation:'Review whether nosniff is appropriate.',artifact_ids:['screen-a']}],metric_notes:[{metric:'http_status',interpretation:'The observed main response was HTTP 200.'}],limitations:['No penetration test was performed.'],next_steps:['Review the response header policy.'],skill_reference_ids:[]});
function fixture(respond) {
  const filename=path.resolve(__dirname,'../../backend/services/qualityAgentAssessment.js'),native=createRequire(filename),calls=[],events=[];
  const module={exports:{}};
  const mocks={'./browserMissionPlanner':{resolveMissionModel:async()=>({id:'model-a',model:'configured-model',base_url:'https://model.example.test/v1',config:{}})},
    '@hellotest/platform/backend/src/utils/llmHttpClient':{fetchLlmWithRetry:async(url,init,options)=>{
      const payload=JSON.parse(init.body);calls.push({url,payload,options});await options.beforeDispatch({payload});await options.onTextDelta('{"title":"Observed',{});
      return Response.json(respond?respond(calls.length):{choices:[{finish_reason:'stop',message:{content:JSON.stringify(value())}}],usage:{prompt_tokens:40,completion_tokens:20}});
    }}};
  new Function('require','module','exports',fs.readFileSync(filename,'utf8'))(id=>mocks[id]||native(id),module,module.exports);
  return {calls,events,assess:(trace,scopedRequest=request)=>module.exports.assessQualityRun(scopedRequest,user,engine,{run_id:'quality-run',session_id:'quality-session',onEvent:async(type,data)=>events.push({type,data}),...trace})};
}
test('assessment retains actual evidence IDs and metrics without clearing the engine result',()=>{
  const report=original.validateAssessment(value(),request,engine);
  assert.equal(report.generation_mode,'llm');assert.equal(report.observed_outcome,'findings');assert.equal(report.review_required,true);
  for(const changed of [{...value(),conclusion:'no_findings_observed'},{...value(),observations:[{...value().observations[0],finding_id:'invented'}]},{...value(),metric_notes:[{metric:'invented-lcp',interpretation:'Fast.'}]},{...value(),skill_reference_ids:['uninstalled-private-scanner']},{...value(),observations:[]}])assert.throws(()=>original.validateAssessment(changed,request,engine),error=>error.code==='QUALITY_AGENT_ASSESSMENT_INVALID');
});
test('bounded assessment context discloses omitted findings and preserves full task data',()=>{
  const many={...engine,findings:Array.from({length:100},(_,index)=>({...engine.findings[0],id:`finding-${index}`,evidence:'e'.repeat(10000)}))};
  const packet=original.evidencePacket(request,many);
  assert.equal(packet.task_brief.goal,request.goal);assert.ok(Buffer.byteLength(JSON.stringify(packet))<=64000);assert.ok(packet.evidence_manifest.findings_omitted>0);assert.equal(packet.evidence_manifest.findings_available,100);
});

test('visual assessment may cite an approved baseline only when verified image preparation supplied it',()=>{
  const visual={...request,kind:'visual'},packet=original.evidencePacket(visual,engine),candidate=value();
  candidate.observations[0].artifact_ids=['screen-a','approved-baseline'];
  assert.throws(()=>original.validateAssessment(candidate,visual,engine,packet),error=>error.code==='QUALITY_AGENT_ASSESSMENT_INVALID');
  packet.visual_evidence={mode:'images',images:[{artifact_id:'screen-a'},{artifact_id:'approved-baseline'}],limitations:['The diff image was not supplied.']};
  const report=original.validateAssessment(candidate,visual,engine,packet);
  assert.deepEqual(report.observations[0].artifact_ids,['screen-a','approved-baseline']);assert.ok(report.limitations.includes('The diff image was not supplied.'));
});
test('assessment streams genuine provider deltas with a structured validated final outcome and one counted dispatch',async()=>{
  let admissions=0;const usage=[],f=fixture();const report=await f.assess({beforeDispatch:async()=>admissions++,onUsage:async value=>usage.push(value)});
  assert.equal(admissions,1);assert.equal(f.calls.length,1);assert.equal(report.observations[0].finding_id,'missing-header');
  assert.deepEqual(f.calls[0].options.outputSchema,original.SCHEMA);assert.equal(f.calls[0].options.maxAttempts,1);assert.equal(f.calls[0].options.contextFallback,false);
  assert.match(f.calls[0].payload.messages[0].content,/OWASP/);assert.match(f.calls[0].payload.messages[1].content,/<context>/);
  assert.deepEqual(f.events.map(event=>event.type),['model_start','text','model_done']);assert.equal(f.events[1].data.text,'{"title":"Observed');assert.equal(usage[0].completion_tokens,20);
});
test('unsupported evidence gets one user-authority correction, while truncated output is never repaired',async()=>{
  const f=fixture(call=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(call===1?{...value(),observations:[{...value().observations[0],finding_id:'invented'}]}:value())}}]}));
  const report=await f.assess();assert.equal(report.observed_outcome,'findings');assert.equal(f.calls.length,2);assert.equal(f.calls[1].payload.messages.at(-1).role,'user');assert.match(f.calls[1].payload.messages.at(-1).content,/validation/);assert.equal(f.calls[1].payload.messages.at(-2).role,'assistant');
  const truncated=fixture(()=>({choices:[{finish_reason:'length',message:{content:JSON.stringify(value())}}]}));await assert.rejects(truncated.assess(),error=>error.code==='QUALITY_AGENT_ASSESSMENT_INCOMPLETE');assert.equal(truncated.calls.length,1);
});

test('shared transport schema failures carry their prior candidate into one read-only repair',async()=>{
  const f=fixture(call=>{
    if(call===1)throw Object.assign(new Error('Schema mismatch'),{code:'AI_OUTPUT_SCHEMA_VIOLATION',model_candidate:'{"title":"Incomplete"}',validation_errors:[{path:'summary',message:'is required'}]});
    return {choices:[{finish_reason:'stop',message:{content:JSON.stringify(value())}}]};
  });
  let admitted=0;const report=await f.assess({beforeDispatch:async()=>admitted++});
  assert.equal(report.conclusion,'observed_findings');assert.equal(admitted,2);assert.equal(f.calls.length,2);assert.equal(f.calls[1].payload.messages.at(-2).content,'{"title":"Incomplete"}');assert.match(f.calls[1].payload.messages.at(-1).content,/AI_OUTPUT_SCHEMA_VIOLATION/);
  const network=fixture(()=>{throw Object.assign(new Error('Connection failed'),{code:'ECONNRESET',generation_received:true,nonRetryable:true});});
  await assert.rejects(network.assess(),error=>error.code==='ECONNRESET');assert.equal(network.calls.length,1);
});

test('final native evidence contract and additional saved report constraints both remain enforced',()=>{
  const scoped={...request,ai_configuration:{output_schema:{type:'object',required:['summary'],properties:{summary:{type:'string',minLength:20}}}}};
  const report=original.validateAssessment(value(),scoped,engine);assert.equal(report.observed_outcome,'findings');
  assert.throws(()=>original.validateAssessment({...value(),summary:'Short'},scoped,engine),error=>error.code==='QUALITY_AGENT_ASSESSMENT_INVALID');
  assert.throws(()=>original.validateAssessment({...value(),observations:[{...value().observations[0],finding_id:'fabricated'}]},scoped,engine),error=>error.code==='QUALITY_AGENT_ASSESSMENT_INVALID');
  assert.throws(()=>original.validateFinalConfiguration({...request,ai_configuration:{output_schema:{type:'object',required:['invented_field']}}}),error=>error.code==='QUALITY_AGENT_FINAL_SCHEMA_CONFLICT');
});

test('zero saved revision rounds prevents assessment repairs and remaining run time caps model requests',async()=>{
  const scoped={...request,ai_configuration:{agent_execution:{max_model_calls:3,max_revision_rounds:0,max_followups:0,timeout_ms:10000}}};
  for(const sharedFailure of [false,true]) {
    const f=fixture(()=>{
      if(sharedFailure)throw Object.assign(new Error('Invalid schema'),{code:'AI_OUTPUT_SCHEMA_VIOLATION',model_candidate:'{}'});
      return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({...value(),observations:[{...value().observations[0],finding_id:'invented'}]})}}]};
    });
    await assert.rejects(f.assess({},scoped));assert.equal(f.calls.length,1);
  }
  const bounded=fixture();await bounded.assess({deadline_at:new Date(Date.now()+4200).toISOString()},scoped);
  assert.ok(bounded.calls[0].options.timeoutMs>0&&bounded.calls[0].options.timeoutMs<=4200);
  const expired=fixture();await assert.rejects(expired.assess({deadline_at:new Date(Date.now()-1).toISOString()},scoped),error=>error.code==='QUALITY_AGENT_DEADLINE');assert.equal(expired.calls.length,0);
});
