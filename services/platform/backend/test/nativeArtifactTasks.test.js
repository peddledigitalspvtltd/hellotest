const test = require('node:test');
const assert = require('node:assert/strict');
const tasks = require('../../../agentic/backend/workflows/artifactTasks');
const permission = require('../services/permission.service');
const flags = require('../services/featureFlag.service');
const stories = require('../../../manual/backend/services/requirement.service');
const design = require('../../../manual/backend/services/requirementDesign.service');
const assurance = require('../../../ai/backend/services/artifactAssurance.service');
const nativeReviewArtifact = assurance.reviewArtifact;
const automation = require('../../../automation/backend/services/aiAutomationBuilder.service');
const story = { id: 'story-a', project_id: 'project', iteration_id: 'sprint', revision: 2, title: 'Read invoice', description: 'Read a saved invoice.', acceptance_criteria: ['The response status equals 200 and amount equals the saved invoice.'] };
const draft = () => ({ client_id: 'draft-1', title: 'Read the saved invoice', description: 'Read invoice one and compare its saved amount.', priority: 2, test_case_type: 'functional', authoring_mode: 'structured', requirement_ids: [story.id], parameter_values: {}, steps: [{action:'GET https://invoices.example/invoices/one',expected_result:'Response status equals 200 and amount equals 10',step_type:'api'}] });
const ready = () => ({status:'ready',summary:'The reviewed fixture and expected behavior supply the automation inputs.',evidence_refs:[`requirement:${story.id}`],missing_context:[]});
const review = summary => ({ assurance_review: { summary, dimensions: [], insights: [], limitations: [], automation_readiness:ready() }, verification: {status:'passed'}, generation_mode:'hybrid' });
function setup(t) {
  t.mock.method(permission, 'hasPermission', async () => true);
  t.mock.method(flags, 'areEnabled', async () => true);
  t.mock.method(stories, 'getRequirement', async () => structuredClone(story));
  t.mock.method(require('../public/applicationAccess'), 'getAppType', async () => ({id:'app',project_id:'project',type:'api'}));
}
const run = () => ({id:'workflow-run',project_id:'project',app_type_id:'app',input_payload:{sprint_id:'sprint',integration_id:'trigger-model',generation_instructions:'Trigger case objective'}});
const packet = () => ({story_id:story.id,story_revision:tasks.revision(story)});
const execute = async (task, input, {controller=new AbortController(),data={},onProgress=async()=>{}}={}) => (await tasks.execute({run:run(),node:{id:task,data:{artifactTask:task,...data}},user:{id:'actor'},sources:[],signal:controller.signal,onProgress,context:{input}})).__workflow_result.context;

test('default case assurance guidance assigns only the selected case to each model invocation',()=>{
 const defaults=require('../../../agentic/shared/workflowNativeTasks.json')['test-case-assurance'];
 assert.match(defaults.task,/single Test Case supplied in this model invocation/);
 assert.match(defaults.instructions,/one complete assessment object for only the supplied case/);
 assert.match(defaults.instructions,/workflow runtime owns iteration/);
 assert.match(defaults.instructions,/do not return a case collection or a results wrapper/);
});

test('per-case assurance requests include only the current draft and its selected Story context',async t=>{
 setup(t);
 const cases=[{...draft(),client_id:'case-one-only',title:'CASE_ONE_ONLY',description:'DESCRIPTION_ONE_ONLY'},
  {...draft(),client_id:'case-two-only',title:'CASE_TWO_ONLY',description:'DESCRIPTION_TWO_ONLY'}];
 const seen=[];
 t.mock.method(assurance,'reviewArtifact',async input=>{
  const index=cases.findIndex(item=>item.client_id===input.savedArtifact.client_id),other=cases[1-index];seen.push(index);
  assert.ok(index>=0);const serialized=JSON.stringify(input);
  assert.ok(serialized.includes(cases[index].title));
  for(const forbidden of [other.title,other.description,other.client_id,'STALE_SIBLING_ASSURANCE'])assert.ok(!serialized.includes(forbidden),forbidden);
  const context=JSON.parse(input.additionalContext);assert.equal(context.workflow_scope.story_id,story.id);
  assert.equal(context.cases,undefined);assert.equal(context.case_assurance,undefined);assert.equal(context.selected_story.content,undefined);
  assert.deepEqual(input.linkedEvidence,[{...story,kind:'requirement'}]);
  return review('Current case assessment');
 });
 const source={...packet(),cases,story_assurance:{...review('Pinned Story findings'),story_id:story.id},case_assurance:[review('STALE_SIBLING_ASSURANCE')]};
 const result=await execute('test-case-assurance',[source]);assert.deepEqual(seen,[0,1]);
 assert.deepEqual(result.data[0].case_assurance.map(item=>item.client_id),cases.map(item=>item.client_id));
});

test('native task chain preserves per-Story findings, guidance, exact scope and node model override', async t => {
  setup(t);
  const generated=[],reviewed=[],built=[];
  t.mock.method(assurance,'reviewArtifact',async input=>{reviewed.push(input);return review(input.artifactType==='story'?'Review only story-a':'Review only draft-1');});
  t.mock.method(design,'previewRequirementsTestCases',async input=>{generated.push(input);return{cases:[draft()]};});
  t.mock.method(automation,'previewAutomationDraft',async input=>{built.push(input);return{steps:input.draft.steps,validation:{status:'passed'},verification_status:'unverified'};});
  const stale={...packet(),cases:[draft()],case_assurance:[review('Old case review')],automation:[{summary:'Old automation'}]};
  const first=await execute('story-assurance',[stale]);
  assert.equal(first.data[0].cases,undefined);
  assert.equal(first.data[0].case_assurance,undefined);
  assert.equal(first.data[0].automation,undefined);
  const second=await execute('test-case-generation',first.data,{data:{prompt:'Node coverage objective',contextInstructions:'Invoice domain context',llmIntegrationId:'node-model'}});
  const third=await execute('test-case-assurance',second.data,{data:{contextInstructions:'Review assertion precision'}});
  const fourth=await execute('automation-engineer',third.data,{data:{prompt:'Preserve exact amount assertion',contextInstructions:'Use the declared invoice origin'}});
  assert.equal(generated[0].integration_id,'node-model');
  assert.deepEqual(generated[0].evidence_scope,{sprint_id:'sprint',story_id:'story-a'});
  assert.deepEqual(generated[0].requirements,[story]);
  const generationScope=JSON.parse(generated[0].additional_context.split('[HELLOTEST_SMART_CONTEXT_START]\n')[1].split('\n[HELLOTEST_SMART_CONTEXT_END]')[0]);
  assert.equal(generationScope.selected_story.content,undefined);assert.equal(generationScope.selected_story.content_source,'native_artifact_input');
  assert.match(generated[0].additional_context,/Trigger case objective[\s\S]*Node coverage objective[\s\S]*Invoice domain context[\s\S]*Review only story-a/);
  assert.match(reviewed[1].additionalContext,/Review assertion precision[\s\S]*Review only story-a/);
  assert.equal(reviewed[1].assessAutomationReadiness,true);
  assert.deepEqual(reviewed[1].linkedEvidence,[{...story,kind:'requirement'}]);assert.equal(JSON.parse(reviewed[1].additionalContext).selected_story.content,undefined);
  assert.match(built[0].additional_context,/Preserve exact amount assertion[\s\S]*Use the declared invoice origin[\s\S]*Review only draft-1/);
  assert.match(built[0].additional_context,/selected_story/);
  assert.ok(built[0].additional_context.includes(story.title));
  assert.ok(built[0].additional_context.includes(story.description));
  assert.ok(built[0].additional_context.includes(story.acceptance_criteria[0]));
  assert.equal(fourth.data[0].automation[0].verification_status,'unverified');
  assert.equal(fourth.data[0].story_assurance.story_revision,tasks.revision(story));
  assert.equal(fourth.requires_human_review,true);
});

test('every native task passes saved task, instructions and guardrails to its actual model entry point', async t => {
  setup(t);
  const guidance={task:'Assess the selected invoice intent',instructions:'Prefer explicit amount boundaries',guardrails:'Report unsupported tax behavior as an evidence gap',prompt:'Retired prompt must not override saved instructions'};
  const reviews=[],generations=[],builds=[];
  t.mock.method(assurance,'reviewArtifact',async input=>{reviews.push(input);return review('Grounded invoice assessment');});
  t.mock.method(design,'previewRequirementsTestCases',async input=>{generations.push(input);return {cases:[draft()]};});
  t.mock.method(automation,'previewAutomationDraft',async input=>{builds.push(input);return {steps:input.draft.steps,validation:{status:'passed'},verification_status:'unverified'};});
  const first=await execute('story-assurance',[packet()],{data:guidance});
  const second=await execute('test-case-generation',first.data,{data:guidance});
  const third=await execute('test-case-assurance',second.data,{data:guidance});
  await execute('automation-engineer',third.data,{data:guidance});
  for (const text of [...reviews.map(input=>input.promptGuidance),generations[0].additional_context,builds[0].additional_context]) {
    assert.match(text,/Task:\nAssess the selected invoice intent/);
    assert.match(text,/Instructions:\nPrefer explicit amount boundaries/);
    assert.match(text,/Guardrails:\nReport unsupported tax behavior as an evidence gap/);
    assert.doesNotMatch(text,/Retired prompt/);
  }
  assert.equal(builds[0].inspect_browser,true);
});

test('a configured automation node supplies its guidance once while retaining complete Story context',async t=>{
 setup(t);t.mock.method(assurance,'reviewArtifact',async()=>review('Grounded invoice assessment'));
 t.mock.method(design,'previewRequirementsTestCases',async()=>({cases:[draft()]}));
 const first=await execute('story-assurance',[packet()]),second=await execute('test-case-generation',first.data),third=await execute('test-case-assurance',second.data);
 const data={kind:'artifactTask',artifactTask:'automation-engineer',task:'Configured automation task',instructions:'UNIQUE_NODE_AUTOMATION_GUIDANCE',guardrails:'UNIQUE_NODE_AUTOMATION_GUARDRAIL',contextInstructions:'Use the supplied invoice rules.'};
 t.mock.method(automation,'previewAutomationDraft',async input=>{
  const scope=require('../src/utils/aiExecutionConfiguration').current();assert.match(scope.config.prompt,/UNIQUE_NODE_AUTOMATION_GUIDANCE/);assert.equal(scope.config.guardrails,'UNIQUE_NODE_AUTOMATION_GUARDRAIL');
  assert.doesNotMatch(input.additional_context,/UNIQUE_NODE_AUTOMATION_GUIDANCE|UNIQUE_NODE_AUTOMATION_GUARDRAIL/);
  assert.ok(input.additional_context.includes(story.title));assert.ok(input.additional_context.includes(story.description));assert.ok(input.additional_context.includes(story.acceptance_criteria[0]));
  return {steps:input.draft.steps,validation:{status:'passed'},verification_status:'unverified'};
 });
 await require('../../../agentic/backend/workflows/nodeAiConfiguration').runNode({id:'configured-automation',data},{revision:1},()=>execute('automation-engineer',third.data,{data}));
 assert.equal(automation.previewAutomationDraft.mock.callCount(),1);
});

test('native public output owns only its stage while pinned lineage remains internal', async t => {
  setup(t);
  t.mock.method(assurance,'reviewArtifact',async()=>review('Review invoice draft'));
  const item=draft(),upstream={...packet(),story_assurance:{...review('Story review'),story_id:story.id},cases:[item],test_case_generation:{cases:[item],verification:{status:'passed'}}};
  const result=await tasks.execute({run:run(),node:{data:{artifactTask:'test-case-assurance'}},user:{id:'actor'},signal:new AbortController().signal,onProgress:async()=>{},context:{input:[upstream]}});
  const {output,context}=result.__workflow_result;
  assert.equal(output.data[0].cases,undefined);assert.equal(output.data[0].story_assurance,undefined);
  assert.equal(output.data[0].story.title,story.title);
  assert.equal(output.data[0].case_assurance[0].client_id,item.client_id);assert.equal(output.data[0].case_assurance[0].case_index,0);
  assert.deepEqual(context.data[0].cases,[item]);assert.equal(context.data[0].case_assurance[0].case_fingerprint,tasks.fingerprint(item));
});

test('every native stage attributes terminal failures to its Story and assurance/automation case without exposing draft contents',async t=>{
 setup(t);
 const first=draft(),second={...draft(),client_id:'draft-2',title:'PRIVATE_CASE_TITLE'};
 const source={...packet(),story_assurance:{...review('Story review'),story_id:story.id},cases:[first,second],
  case_assurance:[first,second].map(item=>({...review('Case review'),case_fingerprint:tasks.fingerprint(item)}))};
 let failing='story-assurance';
 const failure=()=>Object.assign(new Error('PRIVATE_REVIEW_CANDIDATE'),{code:'AI_OUTPUT_SCHEMA_VIOLATION',statusCode:502});
 t.mock.method(assurance,'reviewArtifact',async input=>{
  if(failing==='story-assurance'&&input.artifactType==='story'||failing==='test-case-assurance'&&input.savedArtifact.client_id==='draft-2')throw failure();
  return review('Reviewed case');
 });
 t.mock.method(design,'previewRequirementsTestCases',async()=>{throw failure();});
 t.mock.method(automation,'previewAutomationDraft',async input=>{
  if(input.draft.client_id==='draft-2')throw Object.assign(new Error('PRIVATE_PROVIDER_BODY'),{code:'LLM_PROVIDER_UNAVAILABLE',statusCode:503});
  return {steps:input.draft.steps,validation:{status:'passed'},verification_status:'unverified'};
 });
 for(const task of ['story-assurance','test-case-generation','test-case-assurance','automation-engineer']){
  failing=task;
  await assert.rejects(execute(task,[source]),error=>{
   const diagnostic=require('../../../agentic/backend/workflows/runtimeEvents').failureInfo(error);
   assert.deepEqual(diagnostic.artifact,{artifact_task:task,story_id:story.id,...(['test-case-assurance','automation-engineer'].includes(task)?{case_index:1,case_client_id:'draft-2'}:{})});
   assert.doesNotMatch(JSON.stringify(diagnostic),/PRIVATE/);
   return true;
  });
 }
});

test('native stages bind the exact Story scope and supplied evidence without generic gateway retrieval or scope leakage', async t => {
  setup(t);
  const trace=require('../src/utils/llmTraceContext'),gateway=require('../../../mcp/backend/gateway');
  const observed=[];
  const inspect=async stage=>{
    const current=trace.current();observed.push({stage,...current});
    assert.equal(current.project_id,'project');assert.equal(current.app_type_id,'app');assert.equal(current.actor_id,'actor');
    assert.equal(current.mcp_context_depth,1);assert.equal(current.mcp_context,'supplied_native_evidence');
    assert.deepEqual(current.evidence_scope,{sprint_id:'sprint',story_id:story.id});
    assert.equal(current.native_evidence.story_revision,tasks.revision(story));
    const request={body:JSON.stringify({messages:[{role:'user',content:'Exact supplied Story and case evidence'}]})};
    const options={mcpContextPolicy:{mode:'mcp',required:true}};
    assert.equal(await gateway.enrichChatRequest(request,options),request,'No broad enrichment or intent planning can alter the scoped request');
    assert.equal(options.mcpContextStatus,'supplied_native_evidence');
  };
  t.mock.method(assurance,'reviewArtifact',async input=>{await inspect(input.artifactType);return review('Exact scoped review');});
  t.mock.method(design,'previewRequirementsTestCases',async input=>{await inspect('generation');assert.deepEqual(input.evidence_scope,{sprint_id:'sprint',story_id:story.id});return {cases:[draft()]};});
  t.mock.method(automation,'previewAutomationDraft',async input=>{await inspect('automation');return {steps:input.draft.steps,validation:{status:'passed'},verification_status:'unverified'};});
  await trace.run({run_id:'parent-run',node_id:'parent-node',evidence_scope:{story_id:'wrong-previous-story'}},async()=>{
    const first=await execute('story-assurance',[packet()]);
    const second=await execute('test-case-generation',first.data);
    const third=await execute('test-case-assurance',second.data);
    await execute('automation-engineer',third.data);
    assert.deepEqual(trace.current().evidence_scope,{story_id:'wrong-previous-story'},'Per-Story context cannot leak into its parent or next stage');
  });
  assert.equal(observed.length,4);assert.ok(observed.every(item=>item.run_id==='parent-run'&&item.node_id==='parent-node'));
});

test('native stages reject forged success, wrong Story cases, duplicate packets and incomplete automation', async t => {
  setup(t);
  let reviewed={verification:{status:'passed'}};
  t.mock.method(assurance,'reviewArtifact',async()=>reviewed);
  await assert.rejects(execute('story-assurance',[packet()]),/complete evidence-grounded native review/);
  reviewed=review('Grounded review');
  await assert.rejects(execute('story-assurance',[packet(),packet()]),/duplicate Story/);
  const initial=await execute('story-assurance',[packet()]);
  t.mock.method(design,'previewRequirementsTestCases',async()=>({cases:[{...draft(),requirement_ids:['other-story']}]}));
  await assert.rejects(execute('test-case-generation',initial.data),/trace only to its selected Story/);
  const assessed={...packet(),cases:[draft()],case_assurance:[{...review('Assessed'),case_fingerprint:tasks.fingerprint(draft())}]};
  t.mock.method(automation,'previewAutomationDraft',async()=>({steps:[],validation:{status:'passed'}}));
  const incomplete=await execute('automation-engineer',[assessed]);
  assert.equal(incomplete.verification.status,'needs_input');
  assert.equal(incomplete.data[0].automation[0],null);
  assert.match(incomplete.data[0].automation_failures[0].message,/complete validated draft/);
});

test('native task cancellation cannot publish a late provider result and empty Sprint does not claim model verification', async t => {
  setup(t);
  const controller=new AbortController(),progress=[];
  t.mock.method(assurance,'reviewArtifact',async()=>{controller.abort();return review('Late result');});
  await assert.rejects(execute('story-assurance',[packet()],{controller,onProgress:async value=>progress.push(value)}),{statusCode:499});
  assert.ok(progress.every(item=>!item.completed_items.length));
  const empty=await execute('story-assurance',[]);
  assert.equal(empty.outcome,'no_stories');
  assert.equal(empty.verification.status,'not_required');
  assert.deepEqual(empty.data,[]);
});

test('native workflow assurance fails when no real model is configured', async t => {
  setup(t);
  t.mock.method(assurance,'reviewArtifact',nativeReviewArtifact);
  t.mock.method(require('../../../integration/backend/services/aiLlmSelection.service'),'resolveLlmIntegrationForUsage',async()=>null);
  await assert.rejects(execute('story-assurance',[packet()]),{code:'AI_MODEL_REQUIRED',statusCode:422});
});

test('known missing automation inputs preserve assessed manual drafts and bounded sanitized per-case gaps', async t => {
  setup(t);
  const first=draft(), second={...draft(),client_id:'draft-2',title:'Read another saved invoice'};
  const assessed={...packet(),cases:[first,second],case_assurance:[first,second].map(item=>({...review('Assessed case'),case_fingerprint:tasks.fingerprint(item)})),automation_input_required:[{message:'Stale blocker'}]};
  const failure=Object.assign(new Error('PRIVATE_PROVIDER_BODY must not be exposed'),{code:'AUTOMATION_DEPENDENCY_MISSING',statusCode:422,stack:'PRIVATE_STACK',blocked_steps:[{step_id:'draft-step-1',reason:'Supply the authorized fixture. Bearer fixture-private-token',required_context:['Authentication endpoint and HTTP method','password=fixture-secret'],required_parameters:['@r.api_token'],provider_body:'PRIVATE_PROVIDER_BODY'}]});
  t.mock.method(automation,'previewAutomationDraft',async input=>{if(input.draft.client_id==='draft-1')throw failure;return{steps:input.draft.steps,validation:{status:'passed'},verification_status:'unverified'};});
  const output=await execute('automation-engineer',[assessed]);
  assert.equal(output.verification.status,'needs_input');
  assert.equal(output.outcome,'automation_input_required');
  assert.equal(output.input_required_count,1);
  assert.equal(output.data[0].automation[0],null);
  assert.equal(output.data[0].automation[1].verification_status,'unverified');
  assert.deepEqual(output.data[0].cases,assessed.cases);
  assert.deepEqual(output.data[0].case_assurance,assessed.case_assurance);
  const gap=output.data[0].automation_input_required[0];
  assert.equal(gap.case_index,0);assert.equal(gap.client_id,first.client_id);assert.equal(gap.case_fingerprint,tasks.fingerprint(first));
  assert.deepEqual(gap.required_parameters,['@r.api_token']);
  assert.match(gap.blocked_steps[0].reason,/authorized fixture/);
  assert.doesNotMatch(JSON.stringify(output),/fixture-private-token|fixture-secret|PRIVATE_PROVIDER_BODY|PRIVATE_STACK|Stale blocker/);
});

test('explicit missing draft parameter markers stop automation before model dispatch and retain assessed case lineage', async t => {
  setup(t);
  const item={...draft(),parameter_values:{Endpoint:'[Missing: PRIVATE_ENDPOINT_DETAILS]',fixture:'  [required: PRIVATE_FIXTURE_CONTRACT]  ','@R.Auth':'[Missing: PRIVATE_AUTH_DETAILS]'}};
  const assessed={...packet(),cases:[item],case_assurance:[{...review('Assessed case'),case_fingerprint:tasks.fingerprint(item)}]};
  const build=t.mock.method(automation,'previewAutomationDraft',async()=>{throw new Error('A missing declared input must not reach the provider');});
  const output=await execute('automation-engineer',[assessed]);
  assert.equal(build.mock.callCount(),0);
  assert.equal(output.verification.status,'needs_input');
  assert.equal(output.input_required_count,1);
  assert.deepEqual(output.data[0].automation,[null]);
  assert.deepEqual(output.data[0].cases,assessed.cases);
  assert.deepEqual(output.data[0].case_assurance,assessed.case_assurance);
  const gap=output.data[0].automation_input_required[0];
  assert.equal(gap.case_fingerprint,tasks.fingerprint(item));
  assert.deepEqual(gap.required_parameters,['@r.auth','@t.endpoint','@t.fixture']);
  assert.doesNotMatch(JSON.stringify(gap),/PRIVATE_/,'only parameter names, not placeholder descriptors or input values, are exposed in the gap');
  const changed=structuredClone(assessed);changed.cases[0].description='Changed after assessment';
  await assert.rejects(execute('automation-engineer',[changed]),{statusCode:409});
  assert.equal(build.mock.callCount(),0,'input gaps must not bypass assessed case lineage');
});

test('concrete values, intentional empty inputs, JSON and embedded marker text continue to native automation', async t => {
  setup(t);
  const item={...draft(),parameter_values:{endpoint:'https://invoices.example/invoices/one',empty:'',blank:' ',json_object:'{"description":"[Missing: literal note]"}',json_array:'["[Required: literal note]"]',embedded:'Keep [Missing: sample] as literal test data',bracket_literal:'[Not missing: a real value]'}};
  const assessed={...packet(),cases:[item],case_assurance:[{...review('Assessed case'),case_fingerprint:tasks.fingerprint(item)}]};
  const build=t.mock.method(automation,'previewAutomationDraft',async input=>({steps:input.draft.steps,validation:{status:'passed'},verification_status:'unverified'}));
  const output=await execute('automation-engineer',[assessed]);
  assert.equal(build.mock.callCount(),1);
  assert.deepEqual(build.mock.calls[0].arguments[0].draft.parameter_values,item.parameter_values);
  assert.equal(output.verification.status,'passed');
  assert.deepEqual(output.data[0].automation_input_required,[]);
  assert.equal(output.data[0].automation[0].verification_status,'unverified');
});

test('native reference grammar blocks self references, cycles and missing static bindings before automation', async t => {
  setup(t);
  const cases=[
    {...draft(),client_id:'self',parameter_values:{Order_ID:'@t.order_id','@T.[Line Item ID]':'params["t.[Line Item ID]"]'}},
    {...draft(),client_id:'cycle',parameter_values:{one:'@t.two',two:'params["t.three"]',three:'@one'}},
    {...draft(),client_id:'missing-target',parameter_values:{primary:'@t.absent'}},
    {...draft(),client_id:'missing-authored',steps:[{action:'Read @t.[Customer ID] using @s.region and capture @r.future_id',expected_result:'The saved amount is returned',step_type:'api'}]}
  ];
  const assessed={...packet(),cases,case_assurance:cases.map(item=>({...review('Assessed case'),case_fingerprint:tasks.fingerprint(item)}))};
  const build=t.mock.method(automation,'previewAutomationDraft',async()=>{throw new Error('Unresolved static inputs must not reach the provider');});
  const output=await execute('automation-engineer',[assessed]);
  assert.equal(build.mock.callCount(),0);
  assert.equal(output.verification.status,'needs_input');
  assert.deepEqual(output.data[0].automation,[null,null,null,null]);
  assert.deepEqual(output.data[0].automation_input_required.map(item=>item.required_parameters),[
    ['@t.[line item id]','@t.order_id'],['@t.one','@t.three','@t.two'],['@t.absent','@t.primary'],['@s.region','@t.[customer id]']
  ]);
  assert.ok(output.data[0].automation_input_required.every((gap,index)=>gap.case_fingerprint===tasks.fingerprint(cases[index])));
  assert.doesNotMatch(JSON.stringify(output.data[0].automation_input_required),/params\[/,'gap messages include names rather than configured reference expressions');
});

test('finite aliases preserve native literal values, normalized key precedence and future run captures', async t => {
  setup(t);
  const item={...draft(),parameter_values:{first:'@t.second',second:'@t.third',third:'concrete-fixture-id',legacy:'@third','@T.[Full Name]':'params["t.third"]',empty:'',empty_alias:'@t.empty',future:'@r.later_capture','@T.ID':'@t.id','t.id':'concrete-id'},steps:[{action:'Read @t.first and capture @r.future_id',expected_result:'The invoice is returned',step_type:'api'}]};
  const assessed={...packet(),cases:[item],case_assurance:[{...review('Assessed case'),case_fingerprint:tasks.fingerprint(item)}]};
  const build=t.mock.method(automation,'previewAutomationDraft',async input=>({steps:input.draft.steps,validation:{status:'passed'},verification_status:'unverified'}));
  const output=await execute('automation-engineer',[assessed]);
  assert.equal(build.mock.callCount(),1);
  assert.deepEqual(build.mock.calls[0].arguments[0].draft.parameter_values,item.parameter_values);
  assert.equal(output.verification.status,'passed');
  const resolver=require('../../../automation/backend/lib/automationBrowserParameters').createBrowserParameterResolver({caseValues:item.parameter_values,materialize:false});
  assert.equal(resolver.projectText('Use @t.first'),'Use @t.second','workflow preflight must not introduce recursive runtime substitution');
});

test('require-ready policy preserves the explicit evidence-grounded upstream readiness gate', async t => {
  setup(t);
  const item=draft(), assessed={...packet(),cases:[item],case_assurance:[{...review('Assessed case'),case_fingerprint:tasks.fingerprint(item)}]};
  const build=t.mock.method(automation,'previewAutomationDraft',async input=>({steps:input.draft.steps,validation:{status:'passed'},verification_status:'unverified'}));
  const missing={kind:'api_contract',reason:'Supply the reviewed invoice endpoint and response contract.',evidence_refs:['draft:test-case:fixture'],step_refs:['step:1']};
  for(const readiness of [undefined,{status:'unknown',summary:'No readiness conclusion was available.',evidence_refs:[],missing_context:[]},{status:'not_applicable',summary:'Manual review only.',evidence_refs:[],missing_context:[]},{status:'needs_input',summary:'The API contract is absent.',evidence_refs:[],missing_context:[missing]},{status:'ready'}]) {
    assessed.case_assurance[0].assurance_review.automation_readiness=readiness;
    const output=await execute('automation-engineer',[assessed],{data:{readinessPolicy:'require-ready'}});
    assert.equal(output.verification.status,'needs_input');
    assert.deepEqual(output.data[0].automation,[null]);
    assert.deepEqual(output.data[0].cases,[item]);
    if(readiness?.status==='needs_input') {
      const blocker=output.data[0].automation_input_required[0].blocked_steps[0];
      assert.equal(blocker.step_id,'step:1');assert.match(blocker.reason,/reviewed invoice endpoint/);assert.deepEqual(blocker.required_context,['api_contract']);
    }
  }
  assert.equal(build.mock.callCount(),0);
  assessed.case_assurance[0].assurance_review.automation_readiness=ready();
  const output=await execute('automation-engineer',[assessed],{data:{readinessPolicy:'require-ready'}});
  assert.equal(output.verification.status,'passed');assert.equal(build.mock.callCount(),1);
  assessed.cases[0]={...item,title:'Changed after review'};
  await assert.rejects(execute('automation-engineer',[assessed]),{statusCode:409});
  assert.equal(build.mock.callCount(),1);
});

test('verify-inputs lets the successor assess uncertain upstream findings against exact pinned source while retaining real dependency failures', async t => {
  setup(t);
  const item=draft(),assessed={...packet(),cases:[item],case_assurance:[{...review('Uncertain upstream'),case_fingerprint:tasks.fingerprint(item)}]};
  assessed.case_assurance[0].assurance_review.automation_readiness={status:'unknown',summary:'The endpoint might be missing.',evidence_refs:[`requirement:${story.id}`],missing_context:[]};
  let blocked=false;
  const build=t.mock.method(automation,'previewAutomationDraft',async input=>{
    assert.match(input.additional_context,/"readiness_policy":"verify-inputs"/);
    assert.match(input.additional_context,/"status":"unknown"/);
    const evidence=JSON.parse(input.additional_context.split('\n\n').at(-1)).selected_story;
    assert.equal(evidence.ref,`requirement:${story.id}`);assert.equal(evidence.story_revision,tasks.revision(story));
    assert.equal(evidence.content.title,story.title);assert.equal(evidence.content.description,story.description);
    assert.deepEqual(evidence.content.acceptance_criteria,story.acceptance_criteria);
    if(blocked)throw Object.assign(new Error('A genuine fixture contract is absent'),{statusCode:422,code:'AUTOMATION_DEPENDENCY_MISSING',blocked_steps:[{step_id:'draft-step-1',reason:'Supply the invoice fixture contract.',required_context:['Invoice fixture contract'],required_parameters:[]}]});
    return {steps:input.draft.steps,validation:{status:'passed'},verification_status:'unverified'};
  });
  const generated=await execute('automation-engineer',[assessed]);
  assert.equal(build.mock.callCount(),1);assert.equal(generated.verification.status,'passed');assert.equal(generated.readiness_policy,'verify-inputs');
  assert.equal(generated.data[0].case_assurance[0].assurance_review.automation_readiness.status,'unknown','The successor does not rewrite upstream model findings into ready');
  blocked=true;const missing=await execute('automation-engineer',[assessed]);
  assert.equal(build.mock.callCount(),2);assert.equal(missing.verification.status,'needs_input');assert.equal(missing.data[0].automation[0],null);
  assert.match(missing.data[0].automation_input_required[0].blocked_steps[0].reason,/invoice fixture contract/);
  await assert.rejects(execute('automation-engineer',[assessed],{data:{readinessPolicy:'always-ready'}}),/Choose verify-inputs or require-ready/);
});

test('declared native input errors become gaps and per-case incomplete builds are retained; provider, access and cancellation still stop', async t => {
  setup(t);
  const item=draft(), assessed={...packet(),cases:[item],case_assurance:[{...review('Assessed'),case_fingerprint:tasks.fingerprint(item)}]};
  let failure;
  t.mock.method(automation,'previewAutomationDraft',async()=>{throw failure;});
  for(const code of ['AUTOMATION_START_URL_REQUIRED','AUTOMATION_START_URL_INVALID']) {
    failure=Object.assign(new Error('Untrusted error detail'),{code,statusCode:400});
    const output=await execute('automation-engineer',[assessed]);
    assert.equal(output.verification.status,'needs_input');
    assert.equal(output.data[0].automation_input_required[0].code,code);
    assert.doesNotMatch(JSON.stringify(output),/Untrusted error detail/);
  }
  failure=Object.assign(new Error('A case needs another assertion'),{code:'AUTOMATION_BUILD_INCOMPLETE',statusCode:422,publicMessage:'Complete the requested assertion.'});
  const incomplete=await execute('automation-engineer',[assessed]);
  assert.equal(incomplete.data[0].automation_failures[0].code,'AUTOMATION_BUILD_INCOMPLETE');
  assert.match(incomplete.data[0].automation_failures[0].message,/requested assertion/);
  for(const [code,statusCode] of [['AI_MODEL_REQUIRED',422],['MODEL_UNAVAILABLE',503],['AUTOMATION_DEPENDENCY_MISSING',403],['AUTOMATION_DEPENDENCY_MISSING',499],['AUTOMATION_DEPENDENCY_MISSING',503]]) {
    failure=Object.assign(new Error('Must propagate'),{code,statusCode});
    await assert.rejects(execute('automation-engineer',[assessed]),error=>error===failure);
  }
  assert.throws(()=>tasks.checkInput({...run(),input_payload:{...run().input_payload,automation_start_url:'https://user:password@example.test'}}),{code:'AUTOMATION_START_URL_INVALID'});
  assert.doesNotThrow(()=>tasks.checkInput(run()),'API-only workflows do not require a browser Start URL');
});

test('workflow runtime retains the output for native automation input gaps while only assessed manual drafts can be accepted', async t => {
  setup(t);
  const runtime=require('../../../agentic/backend/services/agenticWorkflowExecution.service');
  const rows=new Map();
  t.mock.method(require('../../../agentic/backend/agents/agentRegistry.service'),'resolveModel',async()=>({id:'model'}));
  t.mock.method(runtime._internals.store,'get',async id=>structuredClone(rows.get(id)||null));
  t.mock.method(runtime._internals.store,'insert',async row=>{rows.set(row.id,structuredClone(row));return{id:row.id};});
  t.mock.method(runtime._internals.store,'save',async(id,status,nodes,output)=>{const old=rows.get(id);if(old?.status!=='running')return null;rows.set(id,structuredClone({...old,status,node_results:nodes,output_payload:output}));return{id};});
  t.mock.method(assurance,'reviewArtifact',async()=>review('Assessed native artifact'));
  t.mock.method(design,'previewRequirementsTestCases',async()=>({cases:[{...draft(),parameter_values:{endpoint:'@t.endpoint'}}]}));
  const build=t.mock.method(automation,'previewAutomationDraft',async()=>{throw new Error('Known missing inputs must not dispatch an automation model call');});
  const node=(id,kind,data={})=>({id,type:'agenticStep',data:{label:id,kind,...data}});
  const nodes=[node('request','trigger'),node('each','loop',{loopAction:'storyPackets',loopSourceKey:'input.items',loopMaxIterations:100}),...['story-assurance','test-case-generation','test-case-assurance','automation-engineer'].map(task=>node(task,'artifactTask',{artifactTask:task})),node('finish','output')];
  const workflow={id:'native-input-workflow',project_id:'project',app_type_id:'app',name:'Native input review',trigger_kind:'manual',status:'draft',nodes,edges:nodes.slice(1).map((item,index)=>({source:nodes[index].id,target:item.id}))};
  const started=await runtime.start(workflow,{request_id:'native-input-review',input_payload:{sprint_id:'sprint',items:[{story_id:story.id}]}},{id:'actor'});
  await runtime._internals.active.get(started.id)?.promise;
  const saved=rows.get(started.id);
  assert.equal(saved.status,'needs_review');
  assert.equal(build.mock.callCount(),0);
  const result=saved.node_results.find(item=>item.node_id==='automation-engineer');
  assert.equal(result.status,'completed');assert.equal(result.output.verification.status,'needs_input');
  assert.equal(saved.node_results.find(item=>item.node_id==='finish').status,'completed');
  assert.equal(saved.output_payload.results.length,1);
  const db=require('../src/db'),writes=[];
  t.mock.method(db,'transaction',operation=>async()=>operation());
  t.mock.method(db,'prepare',()=>({get:async()=>null,run:async()=>{}}));
  const app={inject:async input=>{writes.push(input);return{statusCode:201,json:()=>({id:'saved-manual'})};}};
  const req={user:{id:'actor'},body:{node_id:'automation-engineer',story_index:0,case_index:0,kind:'manual'}};
  const accept=require('../../../agentic/backend/workflows/acceptDraft').accept;
  const receipt=await accept(app,req,saved);
  assert.equal(receipt.id,'saved-manual');assert.equal(writes.length,1);
  await assert.rejects(accept(app,{...req,body:{...req.body,kind:'automation'}},saved),{statusCode:409});
  const unassessed=structuredClone(saved);unassessed.node_results.find(item=>item.node_id==='automation-engineer').execution_context.data[0].case_assurance[0].verification.status='needs_input';
  await assert.rejects(accept(app,req,unassessed),{statusCode:409});
  assert.equal(writes.length,1);
});
