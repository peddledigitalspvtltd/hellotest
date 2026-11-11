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

async function fixture(t, respond, {artifact=draft,linked=[story],official=false}={}) {
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
  const localUrl=`http://127.0.0.1:${server.address().port}/v1`;
  const integration={id:'local-provider',type:'llm',name:'Controlled provider',model:official?'gpt-4.1':'schema-fixture',base_url:official?'https://api.openai.com/v1':localUrl,config:{project_id:'project'}};
  // Exercise the real official-origin request policy and HTTP parser without
  // spending a provider call or sending any fixture data outside this process.
  if(official){const fetch=globalThis.fetch;t.mock.method(globalThis,'fetch',(url,init)=>fetch(String(url).replace('https://api.openai.com/v1',localUrl),init));}
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

test('a capable official model receives constrained assurance fields and citations on the actual HTTP request',async t=>{
  const f=await fixture(t,payload=>{
    assert.equal(payload.response_format.type,'json_schema');
    const schema=payload.response_format.json_schema.schema;
    assert.equal(payload.response_format.json_schema.strict,true);
    assert.equal(policy.strictProviderSchema(schema),true);
    assert.equal(Object.hasOwn(schema,'anyOf'),false);
    const finding=schema.properties.insights.items;
    assert.deepEqual(finding.properties.kind.enum,['business_ambiguity','missing_context','artifact_quality','traceability','change_impact','automation_input']);
    assert.deepEqual(finding.properties.evidence.items.enum,['draft:test-case:case','requirement:story']);
    assert.equal(finding.additionalProperties,false);
    assert.ok(schema.required.includes('automation_readiness'));
    assert.deepEqual(schema.properties.automation_readiness.anyOf[1],{type:'null'});
    const value={...review('draft:test-case:case'),automation_readiness:null};
    const validate=new(require('ajv'))({strict:false}).compile(schema);
    assert.ok(validate(value),JSON.stringify(validate.errors));
    return value;
  },{official:true});
  const result=await f.run();
  assert.equal(f.calls.length,1);assert.equal(result.response_repaired,false);
  assert.equal(result.assurance_review.automation_readiness.status,'unknown');
});

test('custom workflow guidance still receives native fixed-oracle and optional-environment boundaries with resolved case inputs',async t=>{
  const artifact={id:'case',title:'Verify the product offer',description:'Use a fresh guest session and the selected public offer.',
    parameter_values:{'r.product_code':'9000017248','r.expected_price':'353','r.expected_discount':'12','t.quantity':'1'},
    steps:[{id:'draft-step-1',step_type:'web',action:'Search @r.product_code and add @t.quantity unit.',expected_result:'Price equals @r.expected_price and discount equals @r.expected_discount; a mismatch fails.'}]};
  const linked=[{id:'story',kind:'requirement',title:'Verify a fixed product offer',description:'In a fresh guest session, search product code 9000017248. Require price INR 353, discount 12% and quantity 1. A changed live offer is an assertion mismatch; never adopt it as the expectation.',
    acceptance_criteria:['Price is exactly INR 353 and discount exactly 12%; quantity is 1.']}];
  const f=await fixture(t,payload=>{
    const text=payload.messages.map(message=>message.content).join('\n');
    assert.match(text,/Resolve every referenced runtime parameter, including @r and @t/);
    assert.match(text,/fixed expected price, discount, quantity or other threshold is a decided contract/);
    assert.match(text,/Do not recommend replacing it with observed values or weaker consistency checks/);
    assert.match(text,/Delivery location, seller selection, locale or additional fixtures are not mandatory/);
    assert.match(text,/Use needs_input only for an absent, unresolved or contradictory required action/);
    assert.match(text,/same-tab\/new-tab requirements, popup prohibitions, invented buttons or expandable panels as unsupported additions/);
    assert.match(text,/Preserve explicit navigation and UI constraints/);
    for(const [key,value]of Object.entries(artifact.parameter_values))assert.ok(text.includes(JSON.stringify(key)+':'+JSON.stringify(value)),key);
    assert.match(text,/changed live offer is an assertion mismatch/);
    const result=review('draft:test-case:case');result.insights=[];
    result.automation_readiness={status:'ready',summary:'The linked Story supplies the exact offer assertions and guest context.',evidence_refs:['requirement:story'],missing_context:[]};
    return result;
  },{artifact,linked});
  const result=await f.run();
  assert.equal(result.assurance_review.automation_readiness.status,'ready');
  assert.equal(f.calls.length,1);
});

test('clarified advisory-risk guidance does not force readiness when a required protected input is missing',async t=>{
  const f=await fixture(t,()=>{
    const result=review('draft:test-case:case');
    result.automation_readiness={status:'needs_input',summary:'The required authenticated account is not configured.',evidence_refs:['requirement:story'],
      missing_context:[{kind:'authentication',reason:'The Story requires signing in, but no protected password reference is supplied.',evidence_refs:['requirement:story'],step_refs:['step:1']}]};
    return result;
  },{artifact:{...draft,steps:[{id:'draft-step-1',step_type:'web',action:'Sign into the required account.',expected_result:'The authenticated page is shown.'}]},
    linked:[{...story,description:'The page requires an authorized customer account and password; anonymous access is unsupported.'}]});
  const result=await f.run();
  assert.equal(result.assurance_review.automation_readiness.status,'needs_input');
  assert.equal(result.assurance_review.automation_readiness.missing_context[0].kind,'authentication');
  assert.equal(f.calls.length,1);
});

test('manual browser readiness does not require implementation fixtures or claim lifecycle execution on the actual request',async t=>{
  const description='Use a fresh private guest session. Wait on observable page readiness without fixed sleeps. Navigate to the matching product, capture its displayed confirmation, then inspect the cart.';
  const artifact={id:'case',title:'Review the public product journey',description,parameter_values:{product_code:'9000017248',quantity:'1'},steps:[
    {id:'draft-step-1',step_type:'web',action:'Start a fresh private guest session.',expected_result:'The journey uses an isolated guest session.'},
    {id:'draft-step-2',step_type:'web',action:'Open the public application and wait until its search field is ready without fixed sleeps.',expected_result:'The search field is usable.'},
    {id:'draft-step-3',step_type:'web',action:'Search @t.product_code and open the matching result.',expected_result:'The selected product details are displayed.'},
    {id:'draft-step-4',step_type:'web',action:'Add @t.quantity unit and capture the displayed confirmation.',expected_result:'The cart confirmation identifies the selected product and quantity 1.'},
    {id:'draft-step-5',step_type:'web',action:'Navigate to the cart.',expected_result:'The cart contains the selected product with quantity 1.'}
  ]};
  const linked=[{id:'story',kind:'requirement',title:'Public product journey',description,
    acceptance_criteria:['Search model 9000017248 as a guest and add quantity 1. The confirmation and cart must identify the selected product.']}];
  const f=await fixture(t,payload=>{
    const text=payload.messages.map(message=>message.content).join('\n');
    assert.match(text,/A manual case or Story need not embed Playwright code, fixture declarations, configured tool names, fixed sleeps or screenshot mechanics/);
    assert.match(text,/Absence of implementation declarations in a manual specification is not evidence that the configured platform lacks a capability/);
    assert.match(text,/Assess platform support only from trusted supplied host\/tool context/);
    assert.match(text,/do not invent capability claims or claim a browser\/context was created or an action ran/);
    assert.match(text,/Preserve explicit user or Story infrastructure constraints/);
    assert.ok(text.includes(description),'The explicit private-session, readiness and capture constraints remain in source evidence.');
    assert.match(text,/The journey uses an isolated guest session/);
    const result=review('draft:test-case:case');result.insights=[];
    result.automation_readiness={status:'ready',summary:'The Story supplies the required guest journey, product input and observable outcomes; missing implementation declarations are not input gaps.',evidence_refs:['requirement:story'],missing_context:[]};
    return result;
  },{artifact,linked});
  const result=await f.run();
  assert.equal(result.assurance_review.automation_readiness.status,'ready');
  assert.equal(Object.hasOwn(result,'browser_context'),false,'Assurance must not manufacture a lifecycle receipt.');
  assert.equal(f.calls.length,1);
});

test('manual readiness guidance preserves an explicit unresolved nonstandard browser fixture',async t=>{
  const constraint='Use the dedicated hardware-backed client-certificate browser profile attached to the private test network. Ordinary guest contexts cannot access this application.';
  const f=await fixture(t,payload=>{
    const text=payload.messages.map(message=>message.content).join('\n');
    assert.ok(text.includes(constraint));
    assert.match(text,/Keep genuinely required nonstandard capabilities, authorizations, real accounts and external fixtures unresolved/);
    assert.match(text,/rather than waiving it or assuming support/);
    const result=review('draft:test-case:case');result.insights=[];
    result.automation_readiness={status:'needs_input',summary:'The explicitly required hardware-backed profile and private network are not supplied.',evidence_refs:['requirement:story'],
      missing_context:[{kind:'fixture',reason:'The Story requires a dedicated hardware-backed client-certificate profile on its private test network; no trusted fixture or availability evidence is supplied.',evidence_refs:['requirement:story'],step_refs:['step:1']}]};
    return result;
  },{artifact:{...draft,description:constraint,steps:[{id:'draft-step-1',step_type:'web',action:'Open the application in its required certificate profile.',expected_result:'The private application is accessible.'}]},
    linked:[{...story,description:constraint}]});
  const result=await f.run();
  assert.equal(result.assurance_review.automation_readiness.status,'needs_input');
  assert.equal(result.assurance_review.automation_readiness.missing_context[0].kind,'fixture');
  assert.equal(f.calls.length,1);
});

for(const [name,change,path,keyword] of [
  ['duplicate citations',value=>{value.dimensions[0].evidence.push(value.dimensions[0].evidence[0]);},'/dimensions/0/evidence','uniqueItems'],
  ['oversized review text',value=>{value.summary='x'.repeat(1201);},'/summary','maxLength'],
  ['empty assessment',value=>{value.dimensions=[];value.insights=[];},'','anyOf'],
  ['unsupported finding category',value=>{value.insights[0].kind='data-reliability';},'/insights/0/kind','enum'],
  ['unsupported citation',value=>{value.insights[0].evidence=['requirement:foreign'];},'/insights/0/evidence/0','enum']
])test(`constrained assurance retains full local validation for ${name}`,async t=>{
  const f=await fixture(t,payload=>{
    assert.equal(payload.response_format.type,'json_schema');
    const advertised=payload.messages.find(message=>message.content.startsWith('Output schema:'));
    assert.ok(advertised,'The full native contract must remain visible with the provider projection.');
    const local=JSON.parse(advertised.content.slice('Output schema:'.length));
    assert.equal(local.properties.summary.maxLength,1200);
    assert.equal(local.properties.dimensions.items.properties.evidence.uniqueItems,true);
    assert.ok(local.anyOf);
    const value=review('draft:test-case:case');change(value);return value;
  },{official:true});
  await assert.rejects(f.run(),error=>{
    assert.equal(error.code,'AI_OUTPUT_SCHEMA_VIOLATION');
    assert.ok(error.validation_errors.some(item=>item.path===path&&item.keyword===keyword),JSON.stringify(error.validation_errors));
    assert.equal(error.model_execution.model_calls,2);assert.equal(error.retryable,false);return true;
  });
  assert.equal(f.calls.length,2,'A rejected result receives one format repair, never a fresh node replay.');
});
