const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const workspace=require('../../backend/lib/automationWorkspacePreview');
const {completeAutomationBuild}=require('../../backend/lib/automationBuildCompletion');
const {reduceActivityProgress}=require('../../backend/lib/automationActivityProgress');
const step={id:'email',step_order:2,step_type:'web',action:'Enter email',expected_result:'Email populated'};
const repository=[{id:'field',page_key:'Signup',locator_intent:'Email',locator:'getByRole("textbox", {name:"Email", exact:true})',metadata:{screen_name:'Signup',object_name:'Email',reference_aliases:['Account.Email']}}];
function activityService({currentStep,manualSteps=[],comparisonError}={}){
 const artifacts=new Map(),events=[];let count=0;
 const queries=[];
 const planDb={prepare:sql=>({get:async(...args)=>{queries.push({sql,args});if(comparisonError)throw comparisonError;return currentStep;},all:async(...args)=>{queries.push({sql,args});if(comparisonError)throw comparisonError;return manualSteps;}})};
 const transactions={createTransactionArtifact:async(transaction_id,input)=>{const value={id:`artifact-${++count}`,transaction_id,...input};artifacts.set(value.id,value);return value;},getTransactionArtifact:async id=>artifacts.get(id)};
 const module={exports:{}};new Function('require','module','Buffer',fs.readFileSync(require.resolve('../../backend/services/automationAgentActivity.service'),'utf8'))(id=>id==='../lib/automationProgressDiagnostics'?require('../../backend/lib/automationProgressDiagnostics'):id.endsWith('/obsDb')?{}:id.endsWith('/src/db')?planDb:id==='../lib/automationWorkspacePreview'?workspace:id==='../lib/automationGenerationManifest'?require('../../backend/lib/automationGenerationManifest'):transactions,module,Buffer);
 return {service:module.exports,artifacts,events,queries};
}
test('protected normalized previews bind real native semantic locators and actual parameter namespaces, without name guessing',()=>{
 const source="await playwrightPage.getByRole('textbox', { exact: true, name: 'Email' }).fill(params['t.email']); await page.locator('Account.Email').fill('@r.[User name]'); await expect(page.getByRole('textbox', {name:'Email',exact:true})).toHaveValue('@s.email');";
 const value=workspace.sectionPreview({testCaseId:'case',step,update:{automation_code:source},attempt:1,repositoryRows:repository,manualCoverage:[{manual_step_id:'m',section_step_id:'email'}]});
 assert.equal(value.automation_code,source);assert.deepEqual(value.object_references,[{reference:'Signup.Email',entry_id:'field',locator:repository[0].locator}]);assert.deepEqual(value.parameter_references.sort(),['@r.[user name]','@s.email','@t.email']);assert.equal(value.manual_coverage[0].manual_step_id,'m');assert.equal(value.save_status,'draft');assert.equal(value.verification_status,'unverified');
 for(const code of ['// page.getByRole("textbox", {name:"Email",exact:true})',"console.log('getByRole(\"textbox\", {name:\"Email\", exact:true})');",'await anotherPage.getByRole("textbox", {name:"Email",exact:true}).fill("x");','await page.getByRole("textbox", {name:"Email",exact:false}).fill("x");'])assert.equal(workspace.sectionPreview({testCaseId:'case',step,attempt:1,update:{automation_code:code},repositoryRows:repository}).object_references.length,0,code);
 const prefixed=[{...repository[0],metadata:{...repository[0].metadata,object_name:'Signup.Email'}}];assert.equal(workspace.sectionPreview({testCaseId:'case',step,attempt:1,update:{automation_code:"await page.locator('signup.email').fill('@t.email');"},repositoryRows:prefixed}).object_references[0].reference,'Signup.Email');
 const duplicate={...repository[0],id:'another',metadata:{screen_name:'Other',object_name:'Email'}};assert.equal(workspace.sectionPreview({testCaseId:'case',step,attempt:1,update:{automation_code:"await page.getByRole('textbox', {name:'Email',exact:true}).fill('test');"},repositoryRows:[...repository,duplicate]}).object_references.length,0,'an ambiguous locator is not assigned to an arbitrary screen');
});

test('new confirmed repository fields bind exact compiler locators and shorthand in section previews',()=>{
 const rows=[{id:'new-email',page_key:'Login',locator_intent:'Email',locator:'getByLabel("Email")',metadata:{screen_name:'Login',object_name:'Email'}},
  {id:'new-submit',page_key:'Login',locator_intent:'Submit',locator:'role=button[name="Sign In"]',metadata:{screen_name:'Login',object_name:'Submit'}}];
 const source='await page.getByLabel("Email", {"exact":true}).fill("@r.email");await page.getByRole("button", {"name":"Sign In","exact":true}).click();';
 const preview=workspace.sectionPreview({testCaseId:'case',step,update:{automation_code:source},attempt:1,repositoryRows:rows});
 assert.deepEqual(preview.object_references.map(row=>[row.entry_id,row.reference]),[['new-email','Login.Email'],['new-submit','Login.Submit']]);
 assert.equal(workspace.sectionPreview({testCaseId:'case',step,update:{automation_code:'await page.getByLabel("Email", {exact:false}).fill("x");'},attempt:1,repositoryRows:rows}).object_references.length,0);
});

test('fresh host-confirmed field IDs disambiguate identical locators on different routes in the saved section preview',()=>{
 const rows=['route-a','route-b'].map(id=>({id,page_key:id,locator_intent:'Email',locator:'#email',metadata:{screen_name:id,object_name:'Email',observed_route_sha256:id==='route-a'?'a'.repeat(64):'b'.repeat(64)}}));
 const input={testCaseId:'case',step,update:{automation_code:'await page.locator("#email").fill("@r.email");'},attempt:1,repositoryRows:rows};
 assert.equal(workspace.sectionPreview(input).object_references.length,0);
 assert.deepEqual(workspace.sectionPreview({...input,confirmedRepositoryIds:['route-b']}).object_references.map(row=>row.entry_id),['route-b']);
 assert.equal(workspace.sectionPreview({...input,confirmedRepositoryIds:['unrelated']}).object_references.length,0);
 assert.equal(workspace.sectionPreview({...input,repositoryRows:[rows[0]],confirmedRepositoryIds:[]}).object_references.length,0,'even one stale route field requires current confirmed provenance');
 assert.deepEqual(workspace.sectionPreview({...input,update:{automation_code:'await web.fill("route-a.Email","@r.email");'},confirmedRepositoryIds:[]}).object_references.map(row=>row.entry_id),['route-a'],'explicit qualified references remain unambiguous');
});
test('validated drafts publish progressively without returning or saving an incomplete case; artifact failures never retry accepted work',async()=>{
 const {service,artifacts}=activityService(),events=[];let metadata={},calls=0;
 const steps=[step,{id:'submit',step_order:3,action:'Submit',expected_result:'Saved'}];
 await assert.rejects(completeAutomationBuild({steps,maxAttempts:2,generate:async()=>{calls++;return {steps:[{step_id:'email',automation_code:'RAW_WRAPPER'}]};},validate:(payload,required)=>({updates:required.map(item=>({step:item,automation_code:'await page.getByLabel("Email").fill("@t.email");'}))}),onValidatedSection:({step,normalized,attempt})=>service.createSectionPreview('activity',{testCaseId:'case',step,update:normalized.updates[0],attempt}),onProgress:async event=>{events.push(event);metadata={...metadata,...reduceActivityProgress(metadata,{...event,details:{test_case_id:'case',...event.details}})};}}),error=>error.code==='AUTOMATION_BUILD_INCOMPLETE');
 assert.equal(calls,2);assert.equal(artifacts.size,1);const ready=events.find(event=>event.phase==='automation.agent.section.ready');assert.ok(ready.details.preview_artifact_id);assert.doesNotMatch(JSON.stringify({metadata,events}),/RAW_WRAPPER|automation_code|page\.getByLabel/);
 const preview=await service.preview({id:'activity',metadata},ready.details.preview_artifact_id);assert.match(preview.automation_code,/await page.getByLabel/);assert.equal(preview.save_status,'draft');
 let attempted=0;const result=await completeAutomationBuild({steps:[step],generate:async()=>{attempted++;return {steps:[{step_id:step.id}]};},validate:()=>({updates:[]}),onValidatedSection:async()=>{throw new Error('Storage unavailable');}});assert.equal(result.completion_attempts,1);assert.equal(attempted,1);
 for(const error of [Object.assign(new Error('Access revoked'),{statusCode:403}),Object.assign(new Error('Lease lost'),{code:'BATCH_LEASE_LOST'})])await assert.rejects(completeAutomationBuild({steps:[step],generate:async()=>({steps:[{step_id:step.id}]}),validate:()=>({updates:[]}),onValidatedSection:async()=>{throw error;}}),error);
});
test('actual browser evidence stays protected, bounded, case scoped and separate from generation or execution claims',async()=>{
 const {service,artifacts}=activityService();
 const observation={tool:'browser_snapshot',result:{content:[{type:'text',text:JSON.stringify({observation_id:'observation',captured_at:'2026-10-16T10:01:00.000Z',url:'https://private:secret@app.test/signup?token=SECRET#private',title:'Sign up',accessibility:'textbox Email\nbutton Submit',elements:[{role:'textbox',name:'Email',value:'PRIVATE',password:'PRIVATE'}],partial:true,warnings:['ARIA unavailable']})}]}};
 const summary=await service.createBrowserEvidence('activity',{observation,testCaseId:'case',attempt:2,interactionMode:'read_only'});assert.equal(summary.url,'https://app.test/signup');assert.equal(summary.screenshot_artifact_id,null);assert.ok(summary.snapshot_artifact_id);assert.doesNotMatch(JSON.stringify(summary),/SECRET|PRIVATE|textbox|secret/);
 const data=await service.evidence({id:'activity',metadata:{input_test_case_ids:['case']}},summary.snapshot_artifact_id);assert.equal(data.source,'playwright');assert.equal(data.partial,true);assert.equal(data.observed_at,'2026-10-16T10:01:00.000Z');assert.equal(data.elements[0].value,undefined);assert.equal(data.elements[0].password,undefined);assert.equal(data.verification_status,'unverified');
 await assert.rejects(service.evidence({id:'other',metadata:{input_test_case_ids:['case']}},summary.snapshot_artifact_id),error=>error.statusCode===404);await assert.rejects(service.evidence({id:'activity',metadata:{input_test_case_ids:['foreign']}},summary.snapshot_artifact_id),error=>error.statusCode===404);
 assert.equal(await service.createBrowserEvidence('activity',{observation:{...observation,result:{...observation.result,isError:true}},testCaseId:'case',attempt:2}),null);
 assert.equal(artifacts.size,1);assert.throws(()=>workspace.artifactJson({accessibility:'x'.repeat(300000)}),/bounded size/);
 const mixed={...observation,result:{content:[...observation.result.content,{type:'image',mimeType:'image/jpeg',data:Buffer.from('not an image').toString('base64')}]}};
 const retained=await service.createBrowserEvidence('activity',{observation:mixed,testCaseId:'case',attempt:2,interactionMode:'read_only'});assert.ok(retained.snapshot_artifact_id);assert.equal(retained.screenshot_unavailable,true);assert.equal((await service.evidence({id:'activity',metadata:{input_test_case_ids:['case']}},retained.snapshot_artifact_id)).partial,true);
});
test('browser evidence retains bounded field validation declarations while excluding control values and arbitrary attributes',()=>{
 const value=workspace.browserEvidence({testCaseId:'case',attempt:1,observation:{tool:'browser_snapshot',result:{content:[{type:'text',text:JSON.stringify({elements:[{
  tag:'input',attributes:{id:'password','aria-invalid':'true','aria-errormessage':'error-id','aria-describedby':'hint-id',value:'PRIVATE_CONTROL_VALUE','data-secret':'PRIVATE_ATTRIBUTE'},value:'PRIVATE_CONTROL_VALUE'
 },{tag:'input',attributes:{'aria-errormessage':'x'.repeat(2000)},truncated_attributes:['aria-errormessage']} ]})}]}}});
 assert.deepEqual(value.evidence.elements[0].attributes,{id:'password','aria-invalid':'true','aria-errormessage':'error-id','aria-describedby':'hint-id'});
 assert.equal(value.evidence.elements[1].attributes['aria-errormessage'].length,1000);assert.deepEqual(value.evidence.elements[1].truncated_attributes,['aria-errormessage']);
 assert.doesNotMatch(JSON.stringify(value),/PRIVATE_CONTROL_VALUE|PRIVATE_ATTRIBUTE|data-secret/);
});
test('section evidence uses only its generation attempt, and new snapshots clear stale screenshots without leaking artifact payloads',()=>{
 const value=workspace.sectionPreview({testCaseId:'case',step,update:{automation_code:'await page.getByLabel("Email").fill("@t.email");'},attempt:2});assert.equal(value.evidence,undefined);
 let metadata={workspace_application:{test_case_id:'case',screenshot_artifact_id:'old',snapshot_artifact_id:'old-snapshot'},step_progress:[{test_case_id:'case',step_id:'email'}]};
 metadata={...metadata,...reduceActivityProgress(metadata,{phase:'automation.agent.observation',details:{test_case_id:'case',snapshot_artifact_id:'new',screenshot_artifact_id:null,observed_at:'2026-10-16T10:02:00Z',accessibility:'SECRET',automation_code:'SECRET',attempt:2}})};
 assert.equal(metadata.workspace_application.screenshot_artifact_id,null);assert.equal(metadata.workspace_application.snapshot_artifact_id,'new');assert.doesNotMatch(JSON.stringify(metadata),/SECRET|automation_code|accessibility/);
 const other=reduceActivityProgress(metadata,{phase:'automation.agent.observation',details:{test_case_id:'another',snapshot_artifact_id:'other',attempt:1}});assert.equal(other.workspace_application.test_case_id,'another');assert.equal(other.workspace_application.screenshot_artifact_id,undefined);
});
test('preview model call linkage accepts bounded server-supplied IDs and never reads them from generated updates',()=>{
 const input={testCaseId:'case',step,attempt:1,update:{automation_code:'await page.goto("https://app.test");',model_call_ids:['model-invented']}};
 assert.equal(workspace.sectionPreview(input).model_call_ids,undefined);
 const value=workspace.sectionPreview({...input,modelCallIds:['actual-call','actual-call','bad id','<private>',42]});assert.deepEqual(value.model_call_ids,['actual-call']);assert.equal(value.model_call_scope,'case_attempt');
});
test('preview reads require the exact activity step/artifact mapping and missing artifacts are unavailable without hiding storage errors',async()=>{
 const {service,artifacts}=activityService(),preview=await service.createSectionPreview('activity',{testCaseId:'case',step,attempt:1,update:{automation_code:'await page.goto("https://app.test");'}});
 const transaction={id:'activity',metadata:{input_test_case_ids:['case'],step_progress:[{test_case_id:'case',step_id:'foreign',preview_artifact_id:preview.preview_artifact_id}]}};
 await assert.rejects(service.preview(transaction,preview.preview_artifact_id),error=>error.statusCode===404);transaction.metadata.step_progress[0].step_id=step.id;assert.equal((await service.preview(transaction,preview.preview_artifact_id)).step_id,step.id);
 const artifact=artifacts.get(preview.preview_artifact_id),original=artifact.mime_type;artifact.mime_type='text/plain';await assert.rejects(service.preview(transaction,artifact.id),error=>error.statusCode===404);artifact.mime_type=original;
 const module={exports:{}};let failure=new Error('Workspace transaction artifact not found');new Function('require','module','Buffer',fs.readFileSync(require.resolve('../../backend/services/automationAgentActivity.service'),'utf8'))(id=>id.endsWith('/obsDb')?{}:id==='../lib/automationWorkspacePreview'?workspace:{getTransactionArtifact:async()=>{throw failure;}},module,Buffer);
 for(const method of ['preview','evidence','screenshot'])await assert.rejects(module.exports[method](transaction,'missing'),error=>error.statusCode===404);
 failure=Object.assign(new Error('Database unavailable'),{code:'ECONNRESET'});await assert.rejects(module.exports.evidence(transaction,'missing'),error=>error===failure);
});

test('preview applicability checks current Plan source in the artifact project and application while retaining historical contents',async()=>{
 const source='await page.getByLabel("Email").fill("@t.email");';
 const {service,queries}=activityService({currentStep:{...step,automation_code:source+' await page.locator("#next").click();',api_request:null}});
 const saved=await service.createSectionPreview('activity',{testCaseId:'case',step,attempt:1,update:{automation_code:source,api_request:null}});
 const transaction={id:'activity',project_id:'project',app_type_id:'app',metadata:{input_test_case_ids:['case'],step_progress:[{test_case_id:'case',step_id:step.id,preview_artifact_id:saved.preview_artifact_id}]}};
 const value=await service.preview(transaction,saved.preview_artifact_id);
 assert.equal(value.automation_code,source);assert.deepEqual(value.applicability,{status:'historical',reasons:['source_changed']});
 assert.match(queries[0].sql,/JOIN app_types/);assert.deepEqual(queries[0].args,[step.id,'case','project','app','app']);
});

test('preview comparison uses still-linked exact manual specifications and does not return edited live content',async()=>{
 const manual={manual_test_case_id:'manual',manual_step_id:'source',step_order:1,step_type:'web',action:'Enter email',expected_result:'Email populated'};
 const {service,queries}=activityService({currentStep:{...step,automation_code:'await page.locator("#email").fill("@t.email");'},manualSteps:[{...manual,expected_result:'PRIVATE_NEW_REQUIREMENT'}]});
 const saved=await service.createSectionPreview('activity',{testCaseId:'case',step,attempt:1,update:{automation_code:'await page.locator("#email").fill("@t.email");'},manualCoverage:[{manual_test_case_id:'manual',manual_step_id:'source',section_step_id:step.id}],manualSpecification:[manual]});
 const transaction={id:'activity',project_id:'project',app_type_id:'app',metadata:{input_test_case_ids:['case'],step_progress:[{test_case_id:'case',step_id:step.id,preview_artifact_id:saved.preview_artifact_id}]}};
 const value=await service.preview(transaction,saved.preview_artifact_id);
 assert.deepEqual(value.applicability,{status:'historical',reasons:['manual_specification_changed']});assert.doesNotMatch(JSON.stringify(value),/PRIVATE_NEW_REQUIREMENT/);
 assert.match(queries[1].sql,/automation_case_links/);assert.deepEqual(queries[1].args,['case','project','source']);
});

test('a temporary Plan comparison outage preserves protected history and marks the current version unknown',async()=>{
 const {service}=activityService({comparisonError:Object.assign(new Error('Current database unavailable'),{code:'ECONNRESET'})});
 const saved=await service.createSectionPreview('activity',{testCaseId:'case',step,attempt:1,update:{automation_code:'await page.goto("https://app.test");'}});
 const transaction={id:'activity',project_id:'project',app_type_id:'app',metadata:{input_test_case_ids:['case'],step_progress:[{test_case_id:'case',step_id:step.id,preview_artifact_id:saved.preview_artifact_id}]}};
 const value=await service.preview(transaction,saved.preview_artifact_id);assert.ok(value.automation_code);assert.deepEqual(value.applicability,{status:'unknown',reasons:['current_plan_unavailable']});
});
