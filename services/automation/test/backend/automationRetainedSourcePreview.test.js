const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {previewRetainedSource,sourcePacket,permissions}=require('../../backend/services/automationRetainedSourcePreview.service');
const {createGenerationManifest}=require('../../backend/lib/automationGenerationManifest');
const {inspectExecutablePlan}=require('../../backend/services/automationReadiness.service');
const clone=value=>structuredClone(value);
const action='Fill Event Name with @r.first_name and click Search.';
const expected='The exact @r.template for @r.first_name @r.last_name is Onboarding and Activated.';
const native='await page.frameLocator("#noncoreIframe").getByRole("textbox", { name: "Event Name" }).fill("OldSample");\nawait page.frameLocator("#noncoreIframe").getByRole("button", { name: "Search" }).click();';
const candidate='await page.frameLocator("#noncoreIframe").getByRole("textbox", { name: "Event Name" }).fill(params["r.first_name"]);\nawait page.frameLocator("#noncoreIframe").getByRole("button", { name: "Search" }).click();\nawait expect(page.frameLocator("#noncoreIframe").getByRole("row").filter({ hasText: params["r.template"] + " for " + params["r.first_name"] + " " + params["r.last_name"] })).toHaveCount(1);';
function fixture({crossBuild=true,source=candidate}={}){
 const step={id:'step',test_case_id:'case',step_order:14,step_type:'web',action,expected_result:expected,automation_code:'await expect(page.locator("#old")).toBeVisible();'};
 const manual={id:'manual-step',test_case_id:'manual-case',manual_test_case_id:'manual-case',manual_step_id:'manual-step',step_order:14,step_type:'web',action,expected_result:expected};
 const coverage=[{manual_step_id:'manual-step',manual_test_case_id:'manual-case',section_step_id:'step'}];
 const data={test_case_id:'case',steps:[{step_id:'step',action:'Fill Event Name with OldSample and click Search.',expected_result:'The exact Onboard for OldSample Person is Onboarding and Activated.'}],manual_steps:[{manual_step_id:'manual-step',manual_test_case_id:'manual-case',action:'Fill Event Name with OldSample and click Search.',expected_result:'The exact Onboard for OldSample Person is Onboarding and Activated.'}],parameter_values:{'r.first_name':'OldSample','r.last_name':'Person','r.template':'Onboard'},parameter_references:['r.first_name','r.last_name','r.template'],private_parameter_references:[]};
 const state={testCase:{id:'case',app_type_id:'app',project_id:'project',automated:'yes',parameter_values:{'r.first_name':'CurrentSample'}},steps:[step],manualCases:[{id:'manual-case',steps:[manual]}],parameter_source_key:'stable-data'};
 const metadata={output_test_case_ids:['case'],build_data_artifacts:{case:'data'},step_progress:[{test_case_id:'case',step_id:'step',step_order:14,action,expected_result:expected,...(crossBuild?{preview_artifact_id:'preview'}:{})}],manual_step_progress:[{test_case_id:'case',manual_step_id:'manual-step',section_step_id:'step',step_order:14,action,expected_result:expected}]};
 const target={id:'target',category:'automation_build',project_id:'project',app_type_id:'app',status:'failed',metadata},evidence={...target,id:crossBuild?'evidence':'target',status:'completed'};
 const packet={task:'Save this section as executable Playwright JavaScript. Use native authority.',step:{id:'step',step_order:14,action,expected_result:expected},interactive:true,native_emitted_code:native,parameters:data.parameter_values,private_parameter_tokens:{},final_observation:{tool:'browser_verify_element_visible',result:{isError:false,content:[{type:'text',text:'Observed exact Onboard for OldSample Person Onboarding Activated inside #noncoreIframe.'}]}},observations:[],observation_delivery:{historical_page_text_omitted:true}};
 const trace={id:'trace',session_id:evidence.id,status:'succeeded',capture:{test_case_id:'case',request_truncated:false,response_truncated:false},request_payload:{messages:[{role:'user',content:JSON.stringify(packet)}]}};
 const manifest=createGenerationManifest({testCaseId:'case',step,update:{...step,automation_code:'await expect(page.locator("#previous")).toBeVisible();'},manualCoverage:coverage,manualSpecification:[manual]});
 const calls=[];let allowed=true;
 const ports={access:async()=>Object.fromEntries(permissions.map(key=>[key,allowed])),transaction:async id=>clone(id==='target'?target:evidence),current:async()=>clone(state),data:async()=>clone(data),trace:async()=>clone(trace),preview:async()=>({generation_manifest:clone(manifest)}),validate:inspectExecutablePlan,complete:async input=>{calls.push(input);await input.beforeDispatch();if(input.phase==='upstream_source')return {automation_code:source};const payload=JSON.parse(input.prompt.slice(input.prompt.lastIndexOf('\n')+1));return {schema:'hellotest.playwrightInstructionMapping.v1',steps:payload.steps.map(row=>({step_id:row.step_id,source_sha256:row.source_sha256,instructions:row.operations.map(op=>({operation_id:op.operation_id,kind:op.kind,depth:op.depth,label:op.kind==='assertion'?'Verify':'Use native action',args:[]}))}))};}};
 const request={transactionId:'target',input:{test_case_id:'case',step_id:'step',source_call_id:'trace',...(crossBuild?{evidence_transaction_id:'evidence'}:{})},user:{id:'admin',role:'admin'}};
 return {ports,request,calls,state,data,packet,trace,target,evidence,manifest,revoke:()=>{allowed=false;},syncPacket:()=>{trace.request_payload.messages[0].content=JSON.stringify(packet);}};
}

test('cross-build source proposal normalizes OLD public samples, preserves exact native actions and maps the marked source without saving',async()=>{
 const f=fixture();const result=await previewRetainedSource(f.request,f.ports);
 assert.equal(result.save_status,'not_saved');assert.equal(result.verification_status,'unverified');assert.deepEqual(result.side_effects,{browser_actions:0,cases_saved:0});
 assert.match(result.automation_code,/^\/\/ @hellotest-parameter-bindings expressions-v1/);assert.match(result.automation_code,/params\["r.first_name"\]/);assert.doesNotMatch(result.automation_code,/OldSample|CurrentSample/);
 const {automationSourceSha256}=await import('../../shared/automationInstructionMapping.mjs');
 assert.equal(result.proposed_source_sha256,automationSourceSha256(result.automation_code));
 assert.equal(result.automation_instructions.source_sha256,result.proposed_source_sha256);
 const structured=createGenerationManifest({testCaseId:'case',step:f.state.steps[0],update:{step_type:'web',automation_code:result.automation_code,api_request:null}});
 assert.equal(result.generation_manifest.source_sha256,structured.source_sha256);
 assert.notEqual(result.generation_manifest.source_sha256,result.proposed_source_sha256);
 assert.equal(result.generation_manifest.manual_specification.length,1);assert.equal(f.calls.filter(call=>call.phase==='upstream_source').length,1);assert.deepEqual(f.calls.map(call=>call.phase),['upstream_source','upstream_instruction_mapping']);
 assert.equal(JSON.parse(f.calls[0].prompt).parameters['r.first_name'],'OldSample');assert.equal(f.state.steps[0].automation_code,'await expect(page.locator("#old")).toBeVisible();');
});

test('failed current section needs no saved preview when its exact same-build native source packet and grounded manual data exist',async()=>{const f=fixture({crossBuild:false});const result=await previewRetainedSource(f.request,f.ports);assert.equal(result.evidence_transaction_id,'target');assert.equal(result.source_call_id,'trace');});

test('source and mapping use the builder model allowance inside one cancellable proposal deadline',async()=>{
 const f=fixture(),controller=new AbortController();f.request.signal=controller.signal;
 await previewRetainedSource(f.request,f.ports);
 assert.ok(f.calls.every(call=>call.timeoutMs>30000&&call.timeoutMs<=90000));
 assert.ok(f.calls.every(call=>call.signal instanceof AbortSignal&&call.signal!==controller.signal&&!call.signal.aborted));
 controller.abort();assert.ok(f.calls.every(call=>call.signal.aborted));
});

test('caller cancellation fences a completed source response before mapping or returning it',async()=>{
 const f=fixture(),controller=new AbortController(),complete=f.ports.complete;f.request.signal=controller.signal;
 f.ports.complete=async input=>{const response=await complete(input);controller.abort();return response;};
 await assert.rejects(previewRetainedSource(f.request,f.ports),{name:'AbortError'});assert.equal(f.calls.length,1);
});

test('proposal exposes the exact editor source hash separately from the whole-context stale-check hash',async()=>{
 const {automationSourceSha256}=await import('../../shared/automationInstructionMapping.mjs');
 for(const source of ['', ' \n// retained source bytes\n']){
  const f=fixture();f.state.steps[0].automation_code=source;
  const result=await previewRetainedSource(f.request,f.ports);
  assert.equal(result.baseline_source_sha256,automationSourceSha256(source));
  assert.match(result.baseline_sha256,/^[a-f0-9]{64}$/);assert.notEqual(result.baseline_sha256,result.baseline_source_sha256);
  assert.notEqual(result.baseline_source_sha256,automationSourceSha256(result.automation_code));
  assert.equal(result.proposed_source_sha256,automationSourceSha256(result.automation_code));
  assert.notEqual(result.proposed_source_sha256,result.generation_manifest.source_sha256);
 }
});

test('configured retained-source adapter records the actual source and mapping phases with exact case/section metadata',async()=>{
 const builder=fs.readFileSync(require.resolve('../../backend/services/aiAutomationBuilder.service'),'utf8');
 const adapter=builder.slice(builder.indexOf('exports.completeRetainedSourceProposal = async'));
 const exports={},scopes=[],requests=[];let checks=0;
 new Function('exports','resolveLlmIntegration','requestChatCompletion','require',adapter)(exports,async()=>({id:'selected-llm'}),async request=>{requests.push(request);await request.beforeDispatch();return 'configured model response';},id=>{
  assert.equal(id,'@hellotest/platform/backend/src/utils/llmTraceContext');return{run:(scope,callback)=>{scopes.push(scope);return callback();}};
 });
 for(const phase of ['upstream_source','upstream_instruction_mapping'])assert.equal(await exports.completeRetainedSourceProposal({projectId:'project',userId:'author',integrationId:'selected-llm',prompt:'Native evidence',phase,caseId:'case',sectionId:'section',sessionId:'activity',timeoutMs:30000,beforeDispatch:async()=>{checks++;}}),'configured model response');
 assert.deepEqual(scopes.map(scope=>scope.generation_scope),['upstream_source','upstream_instruction_mapping']);
 assert.ok(scopes.every(scope=>scope.test_case_id==='case'&&scope.session_id==='activity'&&scope.generation_section_ids.length===1&&scope.generation_section_ids[0]==='section'));
 assert.deepEqual(requests.map(request=>request.upstreamPhase),['upstream_source','upstream_instruction_mapping']);assert.equal(checks,4);
});

test('source proposals cannot add, remove or translate native writes and never retry browser actions',async()=>{
 const f=fixture({source:candidate.replace('.click();','.click();\nawait page.locator("#save").click();')});await assert.rejects(previewRetainedSource(f.request,f.ports),{code:'AUTOMATION_UPSTREAM_SOURCE_CHANGED'});assert.equal(f.calls.length,3);assert.ok(f.calls.every(call=>call.phase==='upstream_source'));
});

for(const change of ['request_truncated','response_truncated','latest_truncated','wrong_step','wrong_case','wrong_session'])test(`protected native packet rejects ${change} before any model request`,async()=>{
 const f=fixture();if(change.endsWith('_truncated')&&change!=='latest_truncated')f.trace.capture[change]=true;
 if(change==='latest_truncated'){f.packet.final_observation.result.text_truncated=true;f.syncPacket();}
 if(change==='wrong_step'){f.packet.step.id='other';f.syncPacket();}
 if(change==='wrong_case')f.trace.capture.test_case_id='other';if(change==='wrong_session')f.trace.session_id='other';
 await assert.rejects(previewRetainedSource(f.request,f.ports),{code:'AUTOMATION_SOURCE_PROPOSAL_UNAVAILABLE'});assert.equal(f.calls.length,0);
});

for(const change of ['manual_specification','native_public_samples','case_scope','missing_preview','changed_order'])test(`historical evidence rejects ${change} before model dispatch`,async()=>{
 const f=fixture();if(change==='manual_specification')f.manifest.manual_specification[0].specification_sha256='a'.repeat(64);
 if(change==='native_public_samples')f.data.parameter_values['r.first_name']='DifferentOldSample';if(change==='case_scope')f.evidence.app_type_id='other';if(change==='missing_preview')delete f.evidence.metadata.step_progress[0].preview_artifact_id;if(change==='changed_order')f.evidence.metadata.step_progress[0].step_order=15;
 await assert.rejects(previewRetainedSource(f.request,f.ports),{code:'AUTOMATION_SOURCE_PROPOSAL_UNAVAILABLE'});assert.equal(f.calls.length,0);
});

test('source/content permissions and admin trace policy are enforced before evidence is exposed',async()=>{
 const f=fixture();await assert.rejects(previewRetainedSource({...f.request,user:{id:'author',role:'user'}},f.ports),{statusCode:403});f.revoke();await assert.rejects(previewRetainedSource(f.request,f.ports),{statusCode:403});assert.equal(f.calls.length,0);
});

test('permission revocation is rechecked at the actual model transport boundary',async()=>{
 const f=fixture();f.ports.complete=async input=>{f.revoke();await input.beforeDispatch();assert.fail('provider request dispatched after permission revocation');};await assert.rejects(previewRetainedSource(f.request,f.ports),{statusCode:403});
});

test('case data/source edits while the model responds fence the proposal before mapping or return',async()=>{
 for(const edit of ['source','data']){const f=fixture(),complete=f.ports.complete;f.ports.complete=async input=>{const value=await complete(input);if(edit==='source')f.state.steps[0].automation_code+='\n// changed';else f.state.parameter_source_key='changed-data';return value;};await assert.rejects(previewRetainedSource(f.request,f.ports),{code:'AUTOMATION_SOURCE_PROPOSAL_STALE'});assert.equal(f.calls.length,1);}
});

test('source-only route keeps explicit project/content gates and rejects caller-authored authority payloads',()=>{
 const routes=fs.readFileSync(require.resolve('../../../testing/backend/routes/testCases.routes.js'),'utf8');const section=routes.slice(routes.indexOf('fastify.post("/test-cases/automation/jobs/:transactionId/source-proposal"'),routes.indexOf('fastify.post("/test-cases/automation/build-batch"'));
 assert.match(section,/await fastify\.authenticate\(req\)/);assert.match(section,/projectService\.getProject/);assert.match(section,/requirePermission\(code/);assert.match(section,/Only recorded section evidence identifiers/);assert.match(section,/cache-control/);
 assert.equal(require('../../../platform/backend/src/security/permissions.catalog').ROUTE_PERMISSIONS.get('POST /test-cases/automation/jobs/:transactionId/source-proposal'),'automation.build');
 assert.equal(require('../../../automation/package.json').exports['./backend/services/automationRetainedSourcePreview.service'],'./backend/services/automationRetainedSourcePreview.service.js');
 assert.equal(require('../../../trace/package.json').exports['./backend/services/llmTraceQuery.service'],'./backend/services/llmTraceQuery.service.js');
});

test('real HTTP source-proposal admission rechecks project and all content permissions before model preview; caller source is rejected',async t=>{
 const Fastify=require('fastify'),app=Fastify();
 t.after(async()=>{await app.close();await Promise.all([require('@hellotest/platform/backend/src/db').close(),require('@hellotest/platform/backend/src/obsDb').close()]);});
 const projects=require('@hellotest/platform/backend/public/projectAccess'),transactions=require('@hellotest/platform/backend/services/workspaceTransaction.service'),previewService=require('../../backend/services/automationRetainedSourcePreview.service');
 let denied=false,previews=0;const checked=[];
 t.mock.method(projects,'getProject',async(id,user)=>{checked.push(['project',id,user]);return{id};});
 t.mock.method(transactions,'getTransaction',async id=>({id,category:'automation_build',project_id:'project',app_type_id:'app',status:'failed'}));
 t.mock.method(previewService,'previewRetainedSource',async request=>{previews++;assert.equal(request.input.source_call_id,'trace');assert.equal(request.transactionId,'target');assert.equal(request.user.role,'admin');return{save_status:'not_saved',side_effects:{browser_actions:0,cases_saved:0}};});
 app.decorate('authenticate',async req=>{req.user={id:'author',role:'admin'};});app.decorate('validate',()=>{});
 app.decorate('requirePermission',(code,scope)=>async()=>{checked.push([code,scope.projectId]);if(denied&&code==='data.view')throw Object.assign(new Error('Forbidden'),{statusCode:403});});
 await app.register(require('../../../testing/backend/routes/testCases.routes'));
 const input={method:'POST',url:'/test-cases/automation/jobs/target/source-proposal',payload:{test_case_id:'case',step_id:'step',source_call_id:'trace'}};
 denied=true;assert.equal((await app.inject(input)).statusCode,403);assert.equal(previews,0);
 denied=false;assert.equal((await app.inject({...input,payload:{...input.payload,native_emitted_code:'invented browser action'}})).statusCode,400);assert.equal(previews,0);
 const response=await app.inject(input);assert.equal(response.statusCode,200);assert.equal(response.headers['cache-control'],'no-store');assert.equal(previews,1);
 assert.deepEqual(response.json().side_effects,{browser_actions:0,cases_saved:0});assert.ok(permissions.every(permission=>checked.some(([code,project])=>code===permission&&project==='project')));
});
