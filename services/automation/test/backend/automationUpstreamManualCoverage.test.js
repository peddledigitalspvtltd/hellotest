const test=require('node:test');
const assert=require('node:assert/strict');
const {buildAutomationCaseBlueprint}=require('../../../platform/backend/src/utils/automationCaseBlueprint');
const {groundedManualCoverage}=require('../../backend/lib/automationBuildCompletion');
const {reduceActivityProgress}=require('../../backend/lib/automationActivityProgress');
const {sectionPreview}=require('../../backend/lib/automationWorkspacePreview');
const {generationApplicability}=require('../../backend/lib/automationGenerationManifest');
const {parse}=require('acorn');
const fs=require('node:fs');
const {createRequire}=require('node:module');
const manual=[{id:'manual-open',step_order:1,step_type:'web',action:'Open login',expected_result:'Login visible'},{id:'manual-user',step_order:2,step_type:'web',action:'Enter @r.user',expected_result:'Username visible'}];
const blueprint=buildAutomationCaseBlueprint({source:{id:'manual-case',app_type_id:'app',title:'Login'},steps:manual,createdBy:'actor'});
const steps=blueprint.steps.map((step,index)=>({...step,id:`auto-${index+1}`}));
const lineage=()=>groundedManualCoverage(steps,[{id:'manual-case',steps:manual}]);

test('prepared linked manual cases retain exact step ownership and distinct automation IDs without positional guesses',()=>{
 const value=lineage();
 assert.deepEqual(value.manualCoverage,[{manual_step_id:'manual-open',manual_test_case_id:'manual-case',section_step_id:'auto-1'},{manual_step_id:'manual-user',manual_test_case_id:'manual-case',section_step_id:'auto-2'}]);
 assert.deepEqual(value.steps.map(step=>step.active_manual_step_ids),[['manual-open'],['manual-user']]);
 const changed=groundedManualCoverage([{...steps[0],expected_result:'Different requirement'},steps[1]],[{id:'manual-case',steps:manual}]);
 assert.deepEqual(changed.unmappedManualStepIds,['manual-open']);assert.equal(changed.manualCoverage.some(row=>row.manual_step_id==='manual-open'),false);
 assert.throws(()=>groundedManualCoverage([{...steps[1],step_order:1},{...steps[0],step_order:2}],[{id:'manual-case',steps:manual}]),{code:'AUTOMATION_MANUAL_ORDER_CONFLICT'});
});

test('saved native section previews bind the exact manual specification and their artifact references survive progress reduction',()=>{
 const value=lineage();let metadata={};
 const progress=(phase,details)=>{metadata={...metadata,...reduceActivityProgress(metadata,{phase,details:{test_case_id:'auto-case',...details}})};};
 progress('automation.agent.plan',{steps:steps.map(step=>({...step,step_id:step.id})),manual_steps:value.manualSteps.map(step=>({...step,manual_step_id:step.id,manual_test_case_id:step.test_case_id})),manual_coverage:value.manualCoverage,generation_mode:'sequential'});
 progress('automation.agent.section.started',{step_id:'auto-1',active_step_id:'auto-1',active_manual_step_ids:['manual-open']});
 assert.equal(metadata.manual_step_progress[0].status,'in_progress');assert.equal(metadata.manual_step_progress[1].status,'queued');
 const preview=sectionPreview({testCaseId:'auto-case',step:steps[0],update:{step_type:'web',automation_code:'await expect(page.getByRole("heading",{name:"Login"})).toBeVisible();'},attempt:1,manualCoverage:value.manualCoverage,manualSpecification:value.manualSpecification});
 assert.deepEqual(preview.manual_coverage,[value.manualCoverage[0]]);assert.equal(preview.generation_manifest.manual_specification_status,'bound');
 assert.equal(preview.generation_manifest.manual_specification[0].manual_step_id,'manual-open');
 assert.equal(generationApplicability({manifest:preview.generation_manifest,testCaseId:'auto-case',currentStep:{...steps[0],automation_code:preview.automation_code},currentManualSteps:value.manualSpecification}).status,'current');
 progress('automation.agent.section.saved',{step_id:'auto-1',active_step_id:'auto-1',active_manual_step_ids:['manual-open'],preview_artifact_id:'protected-preview',preview_created_at:'2026-11-06T10:00:00Z',development_status:'completed'});
 assert.equal(metadata.step_progress[0].preview_artifact_id,'protected-preview');assert.equal(metadata.manual_step_progress[0].instruction_status,'saved');
 progress('automation.agent.section.started',{step_id:'auto-2',active_step_id:'auto-2',active_manual_step_ids:['manual-user']});
 progress('automation.agent.browser.failed',{active_step_id:'auto-2',active_manual_step_ids:['manual-user'],error_code:'AUTOMATION_UPSTREAM_BUILD_INCOMPLETE',message:'The Username control was not found.'});
 assert.equal(metadata.manual_step_progress[0].status,'completed');assert.equal(metadata.manual_step_progress[1].status,'needs_attention');
 assert.equal(metadata.manual_step_progress[1].build_errors[0].code,'AUTOMATION_UPSTREAM_BUILD_INCOMPLETE');
});

test('the actual upstream saved-section callback retains protected per-step artifacts with exact linked manual coverage',async()=>{
 const serviceFile=require.resolve('../../backend/services/aiAutomationBuilder.service'),source=fs.readFileSync(serviceFile,'utf8');
 let hook;
 const visit=node=>{if(!node||typeof node!=='object')return;
  if(node.type==='Property'&&node.key?.name==='onSection'&&source.slice(node.value.start,node.value.end).includes('manualLineage.manualCoverage'))hook=node.value;
  for(const value of Object.values(node))if(Array.isArray(value))value.forEach(visit);else if(value&&typeof value==='object')visit(value);
 };visit(parse(source,{ecmaVersion:'latest'}));assert.ok(hook);
 const activityFile=require.resolve('../../backend/services/automationAgentActivity.service'),activitySource=fs.readFileSync(activityFile,'utf8');
 const declaration=parse(activitySource,{ecmaVersion:'latest'}).body.find(node=>node.type==='FunctionDeclaration'&&node.id.name==='createSectionPreview');
 const artifacts=[],events=[],applied=[];
 const createPreview=new Function('transactions','require',`return (${activitySource.slice(declaration.start,declaration.end)});`)({createTransactionArtifact:async(id,input)=>{artifacts.push({id,...input});return {id:'preview-actual'};}},createRequire(activityFile));
 const context={steps,manualLineage:lineage(),require:name=>{assert.equal(name,'./automationAgentActivity.service');return {createSectionPreview:createPreview};},transaction_id:'activity',test_case_id:'auto-case',applyBuild:async input=>applied.push(input),buildIdentity:{},execution_guard:undefined,created_by:'actor',progressiveState:{},progress:async event=>events.push(event)};
 const callback=new Function(...Object.keys(context),`return (${source.slice(hook.start,hook.end)});`)(...Object.values(context));
 await callback({step:{id:'auto-1'},step_type:'web',automation_code:'await expect(page.getByRole("heading",{name:"Login"})).toBeVisible();'},{snapshot_artifact_id:'native-observation',active_step_id:'auto-1',active_manual_step_ids:['manual-open']});
 const preview=JSON.parse(artifacts[0].content);
 assert.equal(preview.step_id,'auto-1');assert.deepEqual(preview.manual_coverage,[lineage().manualCoverage[0]]);
 assert.equal(preview.generation_manifest.manual_specification[0].manual_test_case_id,'manual-case');assert.equal(preview.generation_manifest.manual_specification[0].manual_step_id,'manual-open');
 assert.equal(preview.evidence.snapshot_artifact_id,'native-observation');assert.deepEqual(events[0].details.active_manual_step_ids,['manual-open']);
 assert.equal(events[0].details.preview_artifact_id,'preview-actual');assert.equal(applied.length,1);
});
