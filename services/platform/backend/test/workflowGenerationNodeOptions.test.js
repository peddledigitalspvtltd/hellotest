const test = require('node:test');
const assert = require('node:assert/strict');
const tasks = require('../../../agentic/backend/workflows/artifactTasks');
const {generationOptions,pinnedGenerationOptions} = require('../../../agentic/backend/workflows/generationNodeOptions');
const permission = require('../services/permission.service');
const flags = require('../services/featureFlag.service');
const requirements = require('../../../manual/backend/services/requirement.service');
const design = require('../../../manual/backend/services/requirementDesign.service');

test('saved generator options override legacy trigger values and send the current Story title, description and user intent',async t=>{
  const story={id:'story',project_id:'project',iteration_id:'sprint',revision:3,title:'Customer downloads the reviewed invoice',description:'From the invoice screen download the selected invoice as PDF and preserve its saved amount.',acceptance_criteria:['PDF contains the selected invoice number and saved amount.']};
  t.mock.method(permission,'hasPermission',async()=>true);t.mock.method(flags,'areEnabled',async()=>true);
  t.mock.method(requirements,'getRequirement',async()=>structuredClone(story));
  t.mock.method(require('../public/applicationAccess'),'getAppType',async()=>({id:'app',project_id:'project',type:'web'}));
  let request;
  t.mock.method(design,'previewRequirementsTestCases',async input=>{
    request=input;
    return {cases:Array.from({length:6},(_,index)=>({client_id:`case-${index}`,title:`Download invoice flow ${index+1}`,description:'Read the reviewed invoice and download its PDF.',requirement_ids:['story'],authoring_mode:'structured',parameter_values:{invoice_id:`fixture-${index+1}`},steps:[{action:'Download the selected invoice',expected_result:'The PDF contains the selected invoice number and saved amount.'}]}))};
  });
  const node={id:'generate',data:{kind:'artifactTask',artifactTask:'test-case-generation',maxCasesPerStory:8,authoringMode:'structured',generationInstructions:'',task:'Author the reviewed invoice flow.',instructions:'Use the supplied account and make the PDF assertions explicit.',guardrails:''}};
  const run={id:'run',project_id:'project',app_type_id:'app',input_payload:{sprint_id:'sprint',max_cases_per_story:1,authoring_mode:'gherkin',generation_instructions:'LEGACY_GENERATION_GUIDANCE_SHOULD_NOT_OVERRIDE_NODE'},workflow_snapshot:{nodes:[node]}};
  const output=await tasks.execute({run,node,user:{id:'actor'},signal:new AbortController().signal,onProgress:async()=>{},context:{input:[{story_id:'story',story_revision:tasks.revision(story),story:{title:'Forged caller title',description:'Forged caller description'},story_assurance:{verification:{status:'passed'},assurance_review:{summary:'Keep the PDF amount assertion grounded.'},story_id:'story',story_revision:tasks.revision(story)}}]}});
  assert.equal(request.max_cases,8);assert.equal(request.authoring_mode,'structured');
  assert.equal(request.requirements[0].title,story.title);assert.equal(request.requirements[0].description,story.description);
  assert.deepEqual(request.requirements,[story]);
  const workflowContext=JSON.parse(request.additional_context.split('[HELLOTEST_SMART_CONTEXT_START]\n')[1].split('\n[HELLOTEST_SMART_CONTEXT_END]')[0]);
  assert.equal(workflowContext.selected_story.ref,`requirement:${story.id}`);assert.equal(workflowContext.selected_story.story_revision,tasks.revision(story));assert.equal(workflowContext.selected_story.content,undefined);assert.equal(workflowContext.selected_story.content_source,'native_artifact_input');assert.ok(!request.additional_context.includes(story.title)&&!request.additional_context.includes(story.description));
  assert.match(request.additional_context,/PDF assertions explicit/);assert.doesNotMatch(request.additional_context,/LEGACY_GENERATION|Forged caller/);
  assert.equal(output.__workflow_result.output.data[0].cases.length,6,'A node limit above the legacy trigger and old default remains authoritative');
  assert.equal(pinnedGenerationOptions(run).maxCases,8);
});

test('generator settings keep legacy compatibility without replacing intentional blanks or accepting invalid saved fields',()=>{
  assert.deepEqual(generationOptions({}, {max_cases_per_story:2,authoring_mode:'gherkin',generation_instructions:'Legacy context'}),{maxCases:2,authoringMode:'gherkin',instructions:'Legacy context'});
  assert.deepEqual(generationOptions({maxCasesPerStory:3,authoringMode:'structured',generationInstructions:''},{max_cases_per_story:99,authoring_mode:'invalid',generation_instructions:'Old context'}),{maxCases:3,authoringMode:'structured',instructions:''});
  for(const value of ['',0,11,1.5,null])assert.throws(()=>generationOptions({maxCasesPerStory:value}),{statusCode:422});
  assert.throws(()=>generationOptions({authoringMode:'unknown'}),{statusCode:422});
  assert.throws(()=>generationOptions({generationInstructions:'x'.repeat(12001)}),{statusCode:422});
});
