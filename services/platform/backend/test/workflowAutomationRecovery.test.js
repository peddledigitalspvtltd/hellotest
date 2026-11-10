const test = require('node:test');
const assert = require('node:assert/strict');
const tasks = require('../../../agentic/backend/workflows/artifactTasks');
const inputs = require('../../../agentic/backend/workflows/automationNodeInputs');
const permission = require('../services/permission.service');
const flags = require('../services/featureFlag.service');
const requirements = require('../../../manual/backend/services/requirement.service');
const automation = require('../../../automation/backend/services/aiAutomationBuilder.service');
const connections = require('../../../agentic/backend/workflows/connections');
const settings = require('../../../agentic/backend/workflows/connectionSettings');
const story = {id:'story',project_id:'project',iteration_id:'sprint',revision:4,title:'Read saved invoices',description:'Read the selected saved invoice using its documented API.'};
const caseDraft = index => ({client_id:`case-${index}`,title:`Read invoice ${index}`,description:`Read saved invoice ${index} and assert its response.`,priority:2,test_case_type:'functional',authoring_mode:'structured',requirement_ids:['story'],parameter_values:{},steps:[{action:`GET https://application.example/invoices/${index}`,expected_result:'HTTP 200 with the saved invoice',step_type:'api'}]});
function setup(t, count=3) {
  t.mock.method(permission,'hasPermission',async()=>true);
  t.mock.method(flags,'areEnabled',async()=>true);
  t.mock.method(requirements,'getRequirement',async()=>structuredClone(story));
  t.mock.method(require('../public/applicationAccess'),'getAppType',async()=>({id:'app',project_id:'project',type:'api'}));
  const cases=Array.from({length:count},(_,index)=>caseDraft(index+1));
  const packet={story_id:'story',story_revision:tasks.revision(story),cases,
    case_assurance:cases.map(item=>({verification:{status:'passed'},case_fingerprint:tasks.fingerprint(item),assurance_review:{summary:'The exact API contract is documented.'}}))};
  const run={id:'run',project_id:'project',app_type_id:'app',input_payload:{sprint_id:'sprint'},node_results:[{node_id:'build',status:'running'}]};
  const node={id:'build',data:{kind:'artifactTask',artifactTask:'automation-engineer'}};
  const progress=[];
  const execute = async (signal=new AbortController().signal)=> {
    const result=await tasks.execute({run,node,user:{id:'actor'},signal,context:{input:[packet]},onProgress:async value=>{
      run.node_results[0].progress=structuredClone(value);progress.push(structuredClone(value));
    }});
    return result.__workflow_result;
  };
  return {run,node,packet,progress,execute};
}
const built = input => ({steps:input.draft.steps,validation:{status:'passed'},verification_status:'unverified',summary:`Built ${input.draft.client_id}`});
const completedCaseCheckpoint = value => value.automation_checkpoint?.stories?.some(packet => packet.automation_progress?.processed >= value.current_case);

test('workflow browser builds select the shared upstream Engineer without granting interactive browser actions',async t=>{
  const fixture=setup(t,1),requests=[];
  t.mock.method(require('../public/applicationAccess'),'getAppType',async()=>({id:'app',project_id:'project',type:'web'}));
  const draft=fixture.packet.cases[0];
  draft.steps=[{action:'Open the supplied application URL',expected_result:'The application title is visible',step_type:'web'}];
  fixture.packet.case_assurance[0].case_fingerprint=tasks.fingerprint(draft);
  fixture.node.data.automationStartUrl='https://application.example/';
  fixture.node.data.llmIntegrationId='selected-model';
  t.mock.method(automation,'previewAutomationDraft',async input=>{
    requests.push(input);
    return {...built(input),build_engine:'upstream-playwright-v1',browser_evidence:{transport:'upstream_playwright_mcp',interaction_mode:'read_only'}};
  });
  const first=await fixture.execute();
  assert.equal(requests.length,1);
  assert.equal(requests[0].inspect_browser,true);
  assert.equal(Object.hasOwn(requests[0],'browser_driver'),false,'The shared preview owns its upstream driver selection.');
  assert.equal(requests[0].allow_browser_actions,false,'Legacy workflow inspection does not gain browser action authority.');
  assert.equal(requests[0].user_id,'actor');assert.equal(requests[0].project_id,'project');assert.equal(requests[0].app_type_id,'app');
  assert.equal(requests[0].integration_id,'selected-model');
  assert.equal(requests[0].draft.automation_start_url,'https://application.example/');
  assert.deepEqual(requests[0].draft.steps,draft.steps);
  assert.equal(first.output.data[0].automation[0].build_engine,'upstream-playwright-v1');
  assert.equal(first.output.data[0].automation[0].browser_evidence.transport,'upstream_playwright_mcp');
  assert.equal(first.output.data[0].automation[0].browser_evidence.interaction_mode,'read_only','The workflow retains the shared preview contract.');
  assert.equal(fixture.progress.at(-1).automation_checkpoint.builder_contract,'upstream-playwright-v1');
  await fixture.execute();assert.equal(requests.length,1,'The current complete upstream draft can resume without another browser/model loop.');
  fixture.node.data.inspectBrowser=false;
  await fixture.execute();assert.equal(requests.length,2);
  assert.equal(requests[1].inspect_browser,false);
  assert.equal(Object.hasOwn(requests[1],'browser_driver'),false);
  assert.equal(requests[1].allow_browser_actions,false);
  assert.equal(requests[1].integration_id,'selected-model');
});

function webSetup(t,count=2){
 const fixture=setup(t,count);
 t.mock.method(require('../public/applicationAccess'),'getAppType',async()=>({id:'app',project_id:'project',type:'web'}));
 for(const [index,draft] of fixture.packet.cases.entries()){
  draft.steps=[{action:`Open the supplied application and inspect invoice ${index+1}`,expected_result:'The selected invoice is visible',step_type:'web'}];
  fixture.packet.case_assurance[index].case_fingerprint=tasks.fingerprint(draft);
 }
 fixture.node.data.automationStartUrl='https://application.example/';
 return fixture;
}

// Exercise the actual operation journal while keeping test receipts in memory.
// Every SQL statement must be an expected receipt operation; no business table
// is read or written by this fixture.
function journalStore(t){
 const rows=new Map(),queries=[];
 t.mock.method(require('../src/db'),'prepare',sql=>{
  queries.push(sql);
  if(sql.startsWith('INSERT INTO workflow_operation_receipts'))return{get:async(id,project_id,run_id,node_id,actor_id,request_hash,connection_id)=>{
   if(rows.has(id))return;
   rows.set(id,{id,project_id,run_id,node_id,actor_id,request_hash,connection_id,state:'in_flight'});return{id};
  }};
  if(sql.startsWith('SELECT * FROM workflow_operation_receipts'))return{get:async(id,projectId)=>{const row=rows.get(id);return row?.project_id===projectId?structuredClone(row):undefined;}};
  if(sql.includes("SET state='response_received'"))return{get:async(response,id)=>{
   const row=rows.get(id);if(row?.state!=='in_flight')return;
   row.state='response_received';row.response=structuredClone(response);return{id};
  }};
  if(sql.startsWith('DELETE FROM workflow_operation_receipts'))return{get:async(id,requestHash)=>{
   const row=rows.get(id);if(row?.state!=='in_flight'||row.request_hash!==requestHash)return;
   rows.delete(id);return{id};
  }};
  if(sql.includes("SET state='outcome_unknown'"))return{run:async(error_code,id)=>{
   const row=rows.get(id);if(row?.state==='in_flight')Object.assign(row,{state:'outcome_unknown',error_code});
  }};
  throw Error(`Unexpected test receipt SQL: ${sql}`);
 });
 return{rows,queries};
}

test('explicit browser modes forward independent inspection and action authority and retain the final script artifact',async t=>{
 const fixture=webSetup(t,1),store=journalStore(t),seen=[];
 t.mock.method(automation,'previewAutomationDraft',async input=>{seen.push(input);return{...built(input),executable:{filename:'automation.spec.ts',code:'test("invoice", async ({ page }) => {});'}};});
 for(const [mode,inspect,interactive]of[['perform_steps',true,true],['read_only',true,false],['offline',false,false]]){
  fixture.node.data.automationBrowserMode=mode;
  const result=await fixture.execute();
  assert.equal(seen.at(-1).inspect_browser,inspect);assert.equal(seen.at(-1).allow_browser_actions,interactive);
  assert.equal(Object.hasOwn(seen.at(-1),'browser_driver'),false);
  assert.match(result.output.data[0].automation[0].executable.code,/test\("invoice"/);
  assert.equal(result.output.data[0].automation[0].verification_status,'unverified');
 }
 assert.equal(seen.length,3);assert.equal(store.rows.size,1,'Only the interactive Web case reserves a durable browser-effect receipt.');
 assert.equal([...store.rows.values()][0].node_id,'build');
});

test('legacy read-only and offline workflow cases never reserve interactive receipts',async t=>{
 const fixture=webSetup(t,1),journal=require('../../../agentic/backend/workflows/operationJournal'),seen=[];
 const invoke=t.mock.method(journal,'invoke',async()=>{throw Error('Read-only generation must not reserve an interactive effect');});
 t.mock.method(automation,'previewAutomationDraft',async input=>{seen.push(input);return built(input);});
 await fixture.execute();
 fixture.node.data.inspectBrowser=false;await fixture.execute();
 assert.deepEqual(seen.map(input=>[input.inspect_browser,input.allow_browser_actions]),[[true,false],[false,false]]);
 assert.equal(invoke.mock.callCount(),0);
});

test('interactive multi-case generation reuses durable artifacts after a lost checkpoint without replaying completed browser actions',async t=>{
 const fixture=webSetup(t),store=journalStore(t),called=[];
 fixture.run.iteration_path=['story-loop',2];fixture.node.data.automationBrowserMode='perform_steps';
 t.mock.method(automation,'previewAutomationDraft',async input=>{
  called.push(input.draft.client_id);
  return{...built(input),executable:{filename:'automation.spec.ts',code:'// complete native artifact\n'+'x'.repeat(160*1024)}};
 });
 await assert.rejects(tasks.execute({run:fixture.run,node:fixture.node,user:{id:'actor'},signal:new AbortController().signal,context:{input:[fixture.packet]},onProgress:async value=>{
  if(completedCaseCheckpoint(value))throw Object.assign(new Error('Checkpoint acknowledgement was lost'),{code:'WORKFLOW_CHECKPOINT_UNAVAILABLE',statusCode:503});
 }}),{code:'WORKFLOW_CHECKPOINT_UNAVAILABLE'});
 assert.deepEqual(called,['case-1']);assert.equal(fixture.run.node_results[0].progress,undefined);
 assert.equal([...store.rows.values()][0].state,'response_received');
 assert.ok(Buffer.byteLength(JSON.stringify([...store.rows.values()][0].response))>128*1024,'The complete case artifact uses the bounded Automation Engineer receipt allowance.');
 const resumed=await fixture.execute();
 assert.deepEqual(called,['case-1','case-2'],'The resumed node consumes case-1’s retained result before generating case-2.');
 assert.equal(resumed.output.verification.status,'passed');assert.equal(resumed.output.data[0].automation[0].operation_receipt.reused,true);
 assert.equal(store.rows.size,2);assert.equal(new Set([...store.rows.keys()]).size,2);
 for(const row of store.rows.values())assert.equal(row.node_id,'build','Per-case operation identity keeps the actual workflow node identity.');
 assert.deepEqual(fixture.run.iteration_path,['story-loop',2],'Case scoping must not mutate the parent loop identity.');
 await fixture.execute();assert.deepEqual(called,['case-1','case-2'],'A completed checkpoint skips both browser and journal dispatch.');
});

test('a nested model pre-dispatch flag cannot release a whole interactive case after possible browser effects',async t=>{
 const fixture=webSetup(t,1),store=journalStore(t);fixture.node.data.automationBrowserMode='perform_steps';let calls=0;
 t.mock.method(automation,'previewAutomationDraft',async()=>{
  calls++;throw Object.assign(new Error('Model dispatch was rejected after a browser action'),{code:'AI_OUTPUT_SCHEMA_VIOLATION',statusCode:502,effect_dispatched:false});
 });
 await assert.rejects(fixture.execute(),error=>error.outcome_unknown===true&&error.effect_dispatched===true);
 assert.equal([...store.rows.values()][0].state,'outcome_unknown');
 assert.equal(store.queries.some(sql=>sql.startsWith('DELETE FROM workflow_operation_receipts')),false);
 await assert.rejects(fixture.execute(),{code:'AGENT_OPERATION_OUTCOME_UNKNOWN',outcome_unknown:true});
 assert.equal(calls,1,'Retrying the workflow cannot replay the case because a nested model had not dispatched.');
});

test('interactive receipts persist only the privacy-projected final artifact',async t=>{
 const fixture=webSetup(t,1),store=journalStore(t),secret='Protected-Workflow-Value-39!';
 Object.assign(fixture.node.data,{automationBrowserMode:'perform_steps',automationCredentialId:'managed-password'});
 t.mock.method(connections,'resolve',async()=>({connection:{id:'managed-password',kind:'http',authType:'basic',enabled:true}}));
 t.mock.method(settings,'credential',()=>`reviewer:${secret}`);
 t.mock.method(automation,'previewAutomationDraft',async input=>{
  assert.equal(input.runtime_parameter_values['t.password'],secret);
  return{...built(input),summary:`Generated for ${secret}`,executable:{filename:'automation.spec.ts',code:`// private diagnostic ${secret}`}};
 });
 const result=await fixture.execute();
 assert.equal(store.rows.size,1);assert.equal([...store.rows.values()][0].state,'response_received');
 assert.ok(!JSON.stringify([...store.rows.values()]).includes(secret),'A crash-safe receipt must not become an alternate plaintext secret store.');
 assert.ok(!JSON.stringify([result,fixture.progress]).includes(secret));
});

test('invalid browser modes fail before any preview or effect reservation',async t=>{
 const fixture=webSetup(t,1),preview=t.mock.method(automation,'previewAutomationDraft',async()=>{throw Error('Must not dispatch');});
 const invoke=t.mock.method(require('../../../agentic/backend/workflows/operationJournal'),'invoke',async()=>{throw Error('Must not reserve');});
 for(const mode of ['interactive','false',false,{},'']){
  fixture.node.data.automationBrowserMode=mode;
  await assert.rejects(fixture.execute(),{statusCode:422});
 }
 assert.equal(preview.mock.callCount(),0);assert.equal(invoke.mock.callCount(),0);assert.equal(fixture.progress.length,0);
});

test('a pre-upstream workflow checkpoint cannot reuse the previous browser loop output',async t=>{
  const fixture=setup(t,1),calls=[];
  const legacyKey=tasks.fingerprint({node:fixture.node.data,input:[{story_id:fixture.packet.story_id,story_revision:fixture.packet.story_revision,cases:fixture.packet.cases.map(tasks.fingerprint),case_assurance:fixture.packet.case_assurance}]});
  fixture.run.node_results[0].progress={automation_checkpoint:{schema_version:1,input_fingerprint:legacyKey,stories:[{
    story_id:fixture.packet.story_id,story_revision:fixture.packet.story_revision,
    automation:[{...built({draft:fixture.packet.cases[0]}),client_id:'case-1',case_fingerprint:tasks.fingerprint(fixture.packet.cases[0]),browser_evidence:{transport:'playwright_mcp'}}]
  }]}};
  t.mock.method(automation,'previewAutomationDraft',async input=>{calls.push(input);return built(input);});
  await fixture.execute();
  assert.equal(calls.length,1,'Legacy completion cannot silently skip the newly selected shared builder.');
  assert.notEqual(fixture.progress.at(-1).automation_checkpoint.input_fingerprint,legacyKey);
  assert.equal(fixture.progress.at(-1).automation_checkpoint.builder_contract,'upstream-playwright-v1');
});

test('Automation Engineer checkpoints every case, continues generation failures and retries only unfinished cases',async t=>{
  const fixture=setup(t),called=[];let failSecond=true;
  t.mock.method(automation,'previewAutomationDraft',async input=>{
    called.push(input.draft.client_id);
    if(input.draft.client_id==='case-2'&&failSecond)throw Object.assign(new Error('Provider details must not become diagnostics'),{
      code:'AUTOMATION_BUILD_INCOMPLETE',statusCode:422,publicMessage:'The invoice assertion could not be completed.',completed_sections:0,total_sections:1,
      validation_feedback:[{step_id:'draft-step-1',code:'ASSERTION_REQUIRED',message:'Include the documented invoice assertion.'}]});
    return built(input);
  });
  const first=await fixture.execute();
  assert.deepEqual(called,['case-1','case-2','case-3']);
  assert.equal(first.output.outcome,'automation_partial');assert.equal(first.output.verification.status,'needs_input');
  assert.deepEqual(first.output.data[0].automation.map(item=>item?.client_id||null),['case-1',null,'case-3']);
  assert.equal(first.output.data[0].automation_failures[0].case_index,1);
  assert.match(first.output.data[0].automation_failures[0].validation_feedback[0].message,/invoice assertion/);
  const checkpoints=fixture.progress.filter(completedCaseCheckpoint);
  assert.deepEqual(checkpoints.map(item=>item.current_case),[1,2,3]);
  assert.ok(fixture.progress.some(item=>item.completed_items[0]?.automation_progress?.active_case_index===0),'Active case progress is visible before its completed checkpoint.');
  assert.deepEqual(checkpoints[1].automation_checkpoint.stories[0].automation.map(item=>item?.client_id||null),['case-1',null]);
  assert.deepEqual(first.context.data[0].cases,fixture.packet.cases,'Internal lineage remains pinned to original authored drafts');
  const cancelledRetry=new AbortController();called.length=0;
  await assert.rejects(tasks.execute({run:fixture.run,node:fixture.node,user:{id:'actor'},signal:cancelledRetry.signal,context:{input:[fixture.packet]},onProgress:async value=>{
    fixture.run.node_results[0].progress=structuredClone(value);cancelledRetry.abort();
  }}),{statusCode:499});
  assert.deepEqual(called,[]);
  assert.equal(fixture.run.node_results[0].progress.automation_checkpoint.stories[0].automation[2].client_id,'case-3','An interrupted retry never erases a later case already completed in the original pass');
  failSecond=false;called.length=0;
  const retry=await fixture.execute();
  assert.deepEqual(called,['case-2'],'A matching successful full case never consumes a second model call');
  assert.equal(retry.output.verification.status,'passed');assert.deepEqual(retry.output.data[0].automation_failures,[]);
  assert.deepEqual(retry.output.data[0].automation.map(item=>item.client_id),['case-1','case-2','case-3']);
  fixture.node.data.instructions='Use the current node intent.';called.length=0;
  await fixture.execute();assert.equal(called.length,3,'Changed saved intent invalidates reuse');
});

test('provider, access and unknown-outcome failures stop the batch while preserving its last completed checkpoint',async t=>{
  for(const failure of [Object.assign(new Error('Unavailable'),{statusCode:503}),Object.assign(new Error('Denied'),{statusCode:403}),
    Object.assign(new Error('The previous operation is uncertain'),{code:'AUTOMATION_BUILD_INCOMPLETE',statusCode:422,outcome_unknown:true})]){
    const fixture=setup(t),called=[];
    t.mock.method(automation,'previewAutomationDraft',async input=>{called.push(input.draft.client_id);if(called.length===2)throw failure;return built(input);});
    await assert.rejects(fixture.execute(),error=>error===failure);
    assert.deepEqual(called,['case-1','case-2']);
    assert.equal(fixture.run.node_results[0].progress.automation_checkpoint.stories[0].automation[0].client_id,'case-1');
    t.mock.restoreAll();
  }
});

test('cancellation between cases does not dispatch a later case or discard a completed checkpoint',async t=>{
  const fixture=setup(t),controller=new AbortController(),called=[];
  t.mock.method(automation,'previewAutomationDraft',async input=>{called.push(input.draft.client_id);return built(input);});
  await assert.rejects(tasks.execute({run:fixture.run,node:fixture.node,user:{id:'actor'},signal:controller.signal,context:{input:[fixture.packet]},onProgress:async value=>{
    fixture.run.node_results[0].progress=structuredClone(value);if(completedCaseCheckpoint(value))controller.abort();
  }}),{statusCode:499});
  assert.deepEqual(called,['case-1']);assert.equal(fixture.run.node_results[0].progress.automation_checkpoint.stories[0].automation.length,1);
});

test('an unexpandable Gherkin case records its own issue and does not stop later complete cases',async t=>{
  const fixture=setup(t),called=[];
  const outline=fixture.packet.cases[1];outline.authoring_mode='gherkin';outline.steps=[];
  outline.gherkin_document='Feature: Read invoice\nScenario Outline: Read <invoice>\nWhen I GET /invoices/<invoice>\nThen status equals 200';
  fixture.packet.case_assurance[1].case_fingerprint=tasks.fingerprint(outline);
  t.mock.method(automation,'previewAutomationDraft',async input=>{called.push(input.draft.client_id);return built(input);});
  const result=await fixture.execute();
  assert.deepEqual(called,['case-1','case-3']);assert.equal(result.output.data[0].automation_failures[0].code,'AUTOMATION_CASE_STEPS_INVALID');
  assert.match(result.output.data[0].automation_failures[0].message,/Examples rows/);
  assert.equal(result.output.data[0].automation[2].client_id,'case-3');
});

test('node URL, username, JSON data and protected password use runtime bindings without entering durable output',async t=>{
  const fixture=setup(t,1),secret='Workflow-PRIVATE:password-39!';
  const item=fixture.packet.cases[0];item.parameter_values={username:'[Missing: username]',password:'[Missing: password]',invoice_id:'[Missing: invoice]'};
  item.steps=[{action:'GET https://application.example/invoices/@t.invoice_id with @t.username and @t.password',expected_result:'HTTP 200 and the requested invoice',step_type:'api'}];
  fixture.packet.case_assurance[0].case_fingerprint=tasks.fingerprint(item);
  Object.assign(fixture.node.data,{automationStartUrl:'https://application.example',automationUsername:'reviewer@example.test',automationCredentialId:'protected-password',automationData:'{"invoice_id":"42","invoice":{"region":"west"}}'});
  const resolved=[];
  t.mock.method(connections,'resolve',async(...args)=>{resolved.push(args);return{connection:{id:'protected-password',kind:'http',authType:'basic',username:'managed-username',encryptedSecret:{},enabled:true}};});
  t.mock.method(settings,'credential',()=>`managed-username:${secret}`);
  let requested;
  t.mock.method(automation,'previewAutomationDraft',async input=>{requested=input;return {...built(input),draft:input.draft};});
  const result=await fixture.execute();
  assert.equal(requested.runtime_parameter_values['t.password'],secret);
  assert.equal(requested.draft.parameter_values['t.username'],'reviewer@example.test');
  assert.equal(requested.draft.parameter_values['t.invoice'],'{"region":"west"}');
  assert.equal(requested.draft.automation_start_url,'https://application.example/');
  assert.deepEqual(resolved[0],['protected-password','project','https://application.example/','http']);
  assert.doesNotMatch(JSON.stringify([result,fixture.progress]),new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.equal(result.output.data[0].automation[0].parameter_values['t.password'],undefined);
  assert.equal(result.output.data[0].automation[0].parameter_bindings.credential_id,'protected-password');
  assert.equal(result.output.data[0].automation[0].case_fingerprint,tasks.fingerprint(item));
  const inherited=await inputs.resolveNodeInputs({run:fixture.run,node:{...fixture.node,data:{...fixture.node.data,automationUsername:undefined}},user:{id:'actor'},access:tasks.access});
  assert.equal(inherited.values['t.username'],'managed-username');assert.equal(inherited.privateValues['t.password'],secret,'Only the first Basic credential colon separates username from password');
});

test('sensitive data and raw node passwords are rejected, while exact external parameter references remain valid',()=>{
  for(const value of ['{"password":"a-plain-password"}','{"fixture":{"access_token":"a-token"}}','{"Authorization":"Bearer private"}','{"headers":{"Cookie":"private-session"}}','{"session_id":"private"}','[]','broken json']) assert.throws(()=>inputs.parameterData(value),{statusCode:422});
  assert.throws(()=>inputs.validateNodeOptions({automationPassword:'plaintext'}),{statusCode:422});
  assert.throws(()=>inputs.validateNodeOptions({automationStartUrl:'https://user:password@application.example'}));
  assert.throws(()=>inputs.validateNodeOptions({automationStartUrl:'https://application.example?access_token=private'}),{statusCode:422});
  assert.deepEqual(inputs.parameterData('{"password":"@r.login_password","data":{"region":"west"}}'),{'t.password':'@r.login_password','t.data':'{"region":"west"}'});
});

test('protected credentials are reauthorized and origin-bound before reaching the native builder',async t=>{
  const fixture=setup(t,1);Object.assign(fixture.node.data,{automationStartUrl:'https://other.example',automationCredentialId:'password'});
  t.mock.method(connections,'resolve',async()=>{throw Object.assign(new Error('The endpoint must stay within the selected connection.'),{statusCode:403});});
  const build=t.mock.method(automation,'previewAutomationDraft',async()=>{throw new Error('Should not dispatch');});
  await assert.rejects(fixture.execute(),{statusCode:403});assert.equal(build.mock.callCount(),0);
  t.mock.method(permission,'hasPermission',async(_,code)=>code!=='data.view');
  await assert.rejects(fixture.execute(),/data.view/);assert.equal(build.mock.callCount(),0);
});
