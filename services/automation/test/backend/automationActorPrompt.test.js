const test=require('node:test'),assert=require('node:assert/strict');
const {buildAutomationActorPrompt,projectAutomationActorFeedback}=require('../../backend/lib/automationActorPrompt');
test('interactive task carries pinned manual data and evidence without mixing the source-only request template',()=>{
 const task={case:{id:'at'},current_section:{id:'s2',action:'Enter fixed@example.test',expected_result:'Input retains fixed@example.test'},build_context:{linked_manual_cases:[{id:'tc',steps:[{id:'m1',action:'Open signup'},{id:'m2',action:'Enter fixed@example.test'}]}],retrieval:{reviewed_context:{trust:'untrusted_user_input',content:'Review email format'}}},user_request:'Cover this signup flow'};
 const result=buildAutomationActorPrompt({featureKey:'ai.agentic.automation-engineer',task});
 assert.doesNotMatch(result,/HELLOTEST_AI|aiAutomationBuilder\.prompt|automationBuild\.completionFeedback/);
 const projected=JSON.parse(result);
 assert.equal(projected.kind,'automation_actor_task');assert.deepEqual(projected.current_section,task.current_section);
 assert.deepEqual(projected.build_context.linked_manual_cases,task.build_context.linked_manual_cases);
 assert.deepEqual(projected.build_context.retrieval,task.build_context.retrieval);assert.equal(projected.user_request,task.user_request);
});

test('actor context excludes stale repository selectors and source while preserving task, provenance and frozen data',()=>{
 const stale='getByRole("textbox", {name:"Email *",exact:true})';
 const task={case:{id:'at',title:'Signup',parameter_values:{'t.email':'fixed@example.test','t.password':'@t.password'},internal_build_history:'x'.repeat(5000)},current_section:{id:'s1',action:'Open signup',expected_result:'Email input is visible',automation_code:stale},
  user_request:'Use the supplied URL and verify the Email input; do not submit.',build_context:{case_metadata:{id:'at',automation_code:stale},parameter_data:{values:{'t.email':'fixed@example.test','t.password':'@t.password'}},story_context:{stories:[{id:'story',acceptance_criteria:'Email is required'}]},retrieval:{transport:'mcp',scopes:['stories']}},
  knowledge:[{evidence_id:'e1',source_id:'story',citation:{id:'e1',source_id:'story'},content:'Signup supports email'}],repository:[{screen_name:'Signup',page_url:'https://app.test',object_name:'Email',intent:'enter email',locator:stale,target_criteria:[stale],usage_keywords:[stale]}],screens:[{fields:[{locator:stale}]}]};
 const result=buildAutomationActorPrompt({task}),projected=JSON.parse(result);
 assert.doesNotMatch(result,/getByRole|target_criteria|usage_keywords|automation_code|internal_build_history|case_metadata/);
 assert.deepEqual(projected.parameter_data,task.build_context.parameter_data);assert.deepEqual(projected.knowledge,task.knowledge);
 assert.equal(projected.repository_screens[0].fields[0].object_name,'Email');assert.equal(projected.user_request,task.user_request);
 assert.deepEqual(projected.build_context.story_context,task.build_context.story_context);
 assert.ok(result.length<JSON.stringify(task).length/2);
});

test('actor feedback preserves coverage and validation obligations without repeating manual prose',()=>{
 const feedback={generation_mode:'sequential',active_step_id:'s',active_manual_step_ids:['m'],required_sections:[{step_id:'s',action:'Repeated action',expected_result:'Repeated outcome'}],required_manual_steps:[{manual_step_id:'m',manual_test_case_id:'tc',action:'Repeated action'}],validation_errors:[{step_id:'s',message:'Expected assertion required'}],available_parameters:['t.email']};
 const projected=projectAutomationActorFeedback(feedback);
 assert.deepEqual(projected.required_section_ids,['s']);assert.deepEqual(projected.required_manual_steps,[{manual_step_id:'m',manual_test_case_id:'tc'}]);
 assert.deepEqual(projected.validation_errors,feedback.validation_errors);assert.deepEqual(projected.available_parameters,['t.email']);
 assert.doesNotMatch(JSON.stringify(projected),/Repeated/);
});

test('managed actor contracts explicitly request JSON for providers requiring JSON-mode message guidance',()=>{
 const catalog=require('../../../platform/shared/aiFeatureCatalog.json');
 for(const key of ['ai.agentic.automation-engineer','ai.automation.keyword_generation','ai.agentic.automation-repair']){
  const instructions=catalog.find(item=>item.id===key).defaults.instruction_blocks['automationBrowserAgent.actor'];
  assert.match(instructions,/\bJSON\b/);
 }
});
