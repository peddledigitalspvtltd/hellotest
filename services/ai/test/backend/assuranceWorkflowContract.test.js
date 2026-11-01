const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const assurance = require('../../backend/services/artifactAssurance.service');
const selection = require('@hellotest/integration/backend/services/aiLlmSelection.service');
const nodes = require('../../../agentic/backend/workflows/nodeAiConfiguration');
const traces = require('@hellotest/platform/backend/src/utils/llmTraceContext');
const capture = require('@hellotest/platform/backend/src/utils/llmTraceCapture');
const policy = require('@hellotest/platform/backend/src/utils/llmRequestPolicy');
const events = require('../../../agentic/backend/workflows/runtimeEvents');
const db = require('@hellotest/platform/backend/src/db');
const obs = require('@hellotest/platform/backend/src/obsDb');
test.after(() => Promise.all([db.close(), obs.close()]));

const draft = {id:'case',title:'Read invoice',description:'Read the saved invoice.',steps:[{id:'draft-step-1',step_type:'api',action:'GET /invoice',expected_result:'HTTP 200 and the saved amount.'}]};
const story = {id:'story',kind:'requirement',title:'Read invoice',description:'GET /invoice returns HTTP 200 and its saved amount.'};
const packets = payload => payload.messages.flatMap(message => typeof message.content === 'string' ? message.content.split('\n').flatMap(line => {
  try { return [JSON.parse(line)]; } catch { return []; }
}) : []);
const completion = value => ({choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}]});
const review = ref => ({summary:'The supplied case traces to the invoice Story.',dimensions:[{id:'scenario-coverage',explanation:'The invoice read is observable.',evidence:[ref],recommendation:'Preserve the recorded amount assertion.'}],
  insights:[{id:'assertion-gap',priority:'medium',kind:'artifact_quality',title:'Name the exact amount field',explanation:'The outcome omits its exact field.',evidence:[ref],affected_fields:['steps'],step_refs:['step:1'],recommendation:'Name the returned amount field and compare its saved value.'}],limitations:[]});

async function fixture(t, respond, {artifact=draft,linked=[story]}={}) {
  const calls=[];
  const server=http.createServer(async(req,res)=>{
    try {
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      const payload=JSON.parse(Buffer.concat(chunks));calls.push(payload);
      const value=await respond(payload,calls.length);
      res.setHeader('content-type','application/json');res.end(JSON.stringify(completion(value)));
    } catch(error) {res.statusCode=500;res.end(JSON.stringify({error:{message:error.message}}));}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  const integration={id:'local-provider',type:'llm',name:'Controlled provider',model:'schema-fixture',base_url:`http://127.0.0.1:${server.address().port}/v1`,config:{project_id:'project'}};
  t.mock.method(selection,'resolveLlmIntegrationForUsage',async()=>integration);
  t.mock.method(selection,'recordSuccessfulLlmIntegration',async()=>{});
  t.mock.method(capture,'begin',async()=>null);t.mock.method(capture,'finish',async()=>{});t.mock.method(capture,'dispatch',()=>{});
  t.mock.method(db,'prepare',()=>assert.fail('Pinned node AI settings must not read administrator defaults.'));
  const run=()=>nodes.runNode({id:'test-case-assurance',data:{kind:'artifactTask',artifactTask:'test-case-assurance',
    // Reproduce plural saved guidance, which must not change response cardinality.
    task:'Assess every generated Test Case.',instructions:'Return a complete assessment for each case.',
    aiConfiguration:{context:{mode:'none',required:false,token_budget:1000,max_items:4,focus:''}}
  }},{revision:'fixture-v1'},()=>traces.run({project_id:'project',actor_id:'actor',run_id:'run',node_id:'test-case-assurance',mcp_context_depth:1,mcp_context:'supplied_native_evidence'},()=>
    assurance.reviewArtifact({artifactType:'test-case',savedArtifact:artifact,linkedEvidence:linked,assessAutomationReadiness:true,projectId:'project',user:{id:'actor'}})));
  return {calls,run};
}

test('real node/provider transport repairs the exact invalid finding enum once with the full output budget',async t=>{
  const f=await fixture(t,(payload,index)=>{
    const scope=packets(payload).find(value=>value.native_review_scope)?.native_review_scope;
    assert.equal(scope.artifact_count,1);assert.equal(scope.host_owns_case_and_story_iteration,true);
    assert.equal(scope.response_shape,'one_unwrapped_review_object');
    assert.equal(scope.target_ref,'draft:test-case:case');
    const result=review(scope.target_ref);if(index===1)result.insights[0].kind='data-reliability';
    return result;
  });
  const result=await f.run();
  assert.equal(f.calls.length,2);assert.equal(result.response_repaired,true);
  assert.equal(result.assurance_review.insights[0].kind,'artifact_quality');
  assert.deepEqual(result.model_execution,{model_calls:2,max_model_calls:2,deadline_ms:120000,format_repair_attempted:true});
  const outputLimit=payload=>payload.max_completion_tokens||payload.max_tokens;
  assert.equal(outputLimit(f.calls[1]),outputLimit(f.calls[0]),'A complete format repair retains the original managed output budget.');
  assert.match(JSON.stringify(f.calls[1]),/\/insights\/0\/kind/);
  assert.match(JSON.stringify(f.calls[1]),/enum/);
});

test('terminal schema failure retains exact safe issues and paid-generation flags without replaying the node',async t=>{
  const f=await fixture(t,payload=>{const value=review('draft:test-case:case');value.insights[0].kind='data_reliability';return value;});
  await assert.rejects(f.run(),error=>{
    assert.equal(error.code,'AI_OUTPUT_SCHEMA_VIOLATION');assert.equal(error.generation_received,true);
    assert.equal(error.retryable,false);assert.equal(error.nonRetryable,true);
    assert.ok(error.validation_errors.some(item=>item.path==='/insights/0/kind'&&item.keyword==='enum'));
    assert.equal(error.model_execution.model_calls,2);assert.equal(error.model_execution.format_repair_attempted,true);
    const projected=events.failureInfo(error);assert.equal(projected.category,'validation');assert.equal(projected.retryable,false);
    assert.doesNotMatch(JSON.stringify(projected),/model_candidate|The supplied case traces|Name the exact amount/);
    return true;
  });
  assert.equal(f.calls.length,2);
});

test('the advertised review example satisfies its own schema, including long field/source/step inventories',async t=>{
  let checked=0;
  const f=await fixture(t,payload=>{
    const data=packets(payload).find(value=>value.review_contract);
    assert.ok(data);assert.equal(Object.hasOwn(data.review_contract,'limits'),false);
    const advertised=payload.messages.find(message=>message.content.includes('Output schema:')).content;
    const schema=JSON.parse(advertised.slice(advertised.indexOf('Output schema:')+'Output schema:'.length));
    const body=JSON.stringify(completion(data.review_contract));
    return policy.validateChatResponse(new Response(body),payload,{outputSchema:schema}).then(()=>{checked++;return review('draft:test-case:case');});
  },{artifact:{...draft,steps:Array.from({length:25},(_,index)=>({...draft.steps[0],id:`step-${index+1}`}))},
    linked:Array.from({length:6},(_,index)=>({...story,id:index?'story-'+index:'story'}))});
  await f.run();assert.equal(checked,1);assert.equal(f.calls.length,1);
});
