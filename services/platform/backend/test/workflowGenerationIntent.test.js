const test = require('node:test');
const assert = require('node:assert/strict');
const tasks = require('../../../agentic/backend/workflows/artifactTasks');
const permission = require('../services/permission.service');
const flags = require('../services/featureFlag.service');
const requirements = require('../../../manual/backend/services/requirement.service');
const design = require('../../../manual/backend/services/requirementDesign.service');
const story = {id:'story-current',project_id:'project',iteration_id:'sprint',revision:4,title:'Complete a documented invoice payment',description:'A signed-in customer pays the saved invoice and sees the recorded receipt.',acceptance_criteria:['Show the paid invoice amount and receipt.']};
const draft = {client_id:'draft-positive',title:'Pay the saved invoice and confirm the receipt',description:'A signed-in customer with a payable invoice completes the payment.',requirement_ids:[story.id],parameter_values:{invoice_id:'reviewed-invoice'},steps:[{action:'Open invoice @t.invoice_id',expected_result:'The saved invoice and payable amount are displayed.'},{action:'Complete the documented payment',expected_result:'The invoice is paid and its recorded receipt is displayed.'}]};

for(const custom of [false,true]) test(`native generator uses current Story content and ${custom?'honors saved custom coverage':'defaults to detailed positive end-to-end coverage'}`,async t=>{
  t.mock.method(permission,'hasPermission',async()=>true);t.mock.method(flags,'areEnabled',async()=>true);
  t.mock.method(requirements,'getRequirement',async()=>structuredClone(story));
  t.mock.method(require('../public/applicationAccess'),'getAppType',async()=>({id:'app',project_id:'project',type:'web'}));
  const requests=[];
  t.mock.method(design,'previewRequirementsTestCases',async input=>{requests.push(input);return{cases:[structuredClone(draft)]};});
  const data={artifactTask:'test-case-generation',...(custom?{task:'Generate only documented declined-payment cases',instructions:'Exercise the provided rejection path with detailed recovery steps',guardrails:'Use the supplied decline fixture only'}:{})};
  const result=await tasks.execute({run:{id:'r',project_id:'project',app_type_id:'app',input_payload:{sprint_id:'sprint',max_cases_per_story:3}},node:{id:'generate',data},user:{id:'actor'},sources:[],signal:new AbortController().signal,onProgress:async()=>{},context:{input:[{story_id:story.id,story_revision:tasks.revision(story),story:{title:'Stale HTTP title',description:'Stale HTTP description'},story_assurance:{verification:{status:'passed'},assurance_review:{summary:'Use documented successful payment behavior.'}}}]}});
  const input=requests[0];
  assert.deepEqual(input.requirements,[story]);assert.equal(input.max_cases,3);
  assert.deepEqual(input.evidence_scope,{sprint_id:'sprint',story_id:story.id});
  assert.ok(input.additional_context.includes(story.title));assert.ok(input.additional_context.includes(story.description));
  assert.doesNotMatch(input.additional_context,/Stale HTTP/);
  if(custom){assert.match(input.additional_context,/Task:\nGenerate only documented declined-payment cases/);assert.match(input.additional_context,/Instructions:\nExercise the provided rejection path/);assert.doesNotMatch(input.additional_context,/Default to positive end-to-end coverage/);}
  else {assert.match(input.additional_context,/distinct positive end-to-end/);assert.match(input.additional_context,/observable expected result per step/);assert.match(input.additional_context,/parameter_values/);}
  assert.deepEqual(result.__workflow_result.output.data[0].cases[0].parameter_values,{invoice_id:'reviewed-invoice'});
});
