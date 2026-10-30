const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const automationUtils = require("../../../platform/backend/src/utils/testStepAutomation");

function builderFunctions({markers=false}={}) {
  const filename = path.join(__dirname, "../../backend/services/aiAutomationBuilder.service.js");
  const source = fs.readFileSync(filename, "utf8");
  const module = { exports: {} };
  const database = { prepare: () => ({}) };
  new Function("require", "exports", "module", `${source}\nmodule.exports = { normalizeLlmBuild, buildPrompt, summarizeDataSetRows, summarizeVariables };`)((name) => {
    if (name.endsWith("/db") || name.endsWith("/obsDb")) return database;
    if (name.endsWith("/testStepAutomation")) return automationUtils;
    if (name.endsWith("/automationCaseType")) return require("../../../platform/backend/src/utils/automationCaseType");
    if (name.endsWith("/automationRuntimeSpecialist")) return require("../../backend/lib/automationRuntimeSpecialist");
    if (name.endsWith("/automationApiParameterContract")) return require("../../backend/lib/automationApiParameterContract");
    if (name.endsWith("/automationGeneratedProgram")) return require("../../backend/lib/automationGeneratedProgram");
    if (name.endsWith("/automationKnowledgeContext")) return require("../../backend/lib/automationKnowledgeContext");
    if (name.endsWith("/automationGenerationGrounding")) return require("../../backend/lib/automationGenerationGrounding");
    if (name.endsWith("/aiInstructionBlocks")) return markers?require("../../../platform/backend/src/utils/aiInstructionBlocks"):{aiInstructionBlock:(feature,key)=>require("../../../platform/shared/aiFeatureCatalog.json").find(item=>item.id===feature)?.defaults.instruction_blocks[key] || ""};
    if (name === "crypto") return require("node:crypto");
    return {};
  }, module.exports, module);
  return module.exports;
}

test("native builds validate JavaScript and preserve the iOS runtime", () => {
  const { normalizeLlmBuild } = builderFunctions();
  const steps = [{ id: "native", step_order: 1, step_type: "ios" }];
  const build = (candidate) => normalizeLlmBuild({ steps: [{ step_id: "native", ...candidate }] }, steps, [], null);
  for (const candidate of [
    { automation_code: "await driver.;" },
    { step_type: "selenium", automation_code: "await driver.back();" },
    { step_type: "android", automation_code: "await driver.back();" },
    { step_order: 2, automation_code: "await driver.back();" },
    { automation_code: 'test("native flow", async () => { await driver.back(); });' }
  ]) assert.throws(() => build(candidate));
  const result = build({ step_type: "ios", step_order: 1, automation_code: 'await ios.tap("SignIn.Submit");' });
  assert.equal(result.updates[0].step_type, "ios");
  assert.equal(result.updates[0].automation_code, 'await ios.tap("SignIn.Submit");');
});

test('web mappings reject semantic locator expressions incorrectly wrapped as CSS selectors',()=>{
 const {normalizeLlmBuild}=builderFunctions(),steps=[{id:'web',step_order:1,step_type:'web'}];
 const build=code=>normalizeLlmBuild({steps:[{step_id:'web',automation_code:code}]},steps,[],null);
 for(const code of ["await page.locator('getByRole(\"textbox\", {name:\"Email\"})').fill('@t.email');","await playwrightPage.locator('page.getByLabel(\"Email\")').fill('@t.email');"])assert.throws(()=>build(code),/Playwright locator expression.*selector string/);
 for(const code of ['await page.getByRole("textbox", {name:"Email"}).fill("@t.email");','await page.locator("#email").fill("@t.email");','await page.locator("Signup.Email").fill("@t.email");','await page.waitForTimeout(300000);'])assert.equal(build(code).updates.length,1);
});

test('saved input assertion regeneration uses the trusted raw frozen binding and retains safe mismatch codes',()=>{
 const {normalizeLlmBuild}=builderFunctions();
 const literal='Fixture private input';
 const steps=[{id:'web',step_order:2,step_type:'web',automation_code:`await expect(page.locator("#old")).toHaveValue(${JSON.stringify(literal)});`}];
 const source='await page.getByLabel("Name").fill("@r.opaque"); await expect(page.getByLabel("Name")).toHaveValue("@r.opaque");';
 const parameters={'r.opaque':'@r.opaque'},resolved=[];
 const grounding={origins:new Set(),parameters,resolveAssertionParameter:key=>{resolved.push(key);return literal;}};
 const build=code=>normalizeLlmBuild({steps:[{step_id:'web',automation_code:code}]},steps,[],null,grounding);
 assert.equal(build(source).updates[0].automation_code,source,'validation never substitutes the private frozen value into saved source');
 assert.deepEqual(resolved,['r.opaque']);assert.deepEqual(parameters,{'r.opaque':'@r.opaque'});
 assert.throws(()=>build(source.replace('.toHaveValue(','.not.toHaveValue(')),error=>{
  assert.equal(error.code,'AUTOMATION_GENERATED_ASSERTION_NOT_PRESERVED');assert.match(error.message,/Step 2:/);assert.ok(!error.message.includes(literal));return true;
 });
});

test('native shared templates resolve under Engineer AI Controls while its configured task and model settings remain active',async()=>{
 const catalog=require('../../../platform/shared/aiFeatureCatalog.json'),profiles=new Map(catalog.map(item=>[item.id,{config:structuredClone(item.defaults),fingerprint:item.id,group:item.group,published_version:1}]));
 const engineer=profiles.get('ai.agentic.automation-engineer');engineer.config.prompt='Custom NFR guidance must be honored';engineer.config.temperature=0.13;engineer.config.context={mode:'none',required:false};
 profiles.get('ai.automation.keyword_generation').config.instruction_blocks['aiAutomationBuilder.prompt.45']='Published shared instruction customized by admin';
 const runtimeSource=fs.readFileSync(require.resolve('../../../platform/backend/src/utils/aiFeatureRuntime'),'utf8'),module={exports:{}};
 const local=require('node:module').createRequire(require.resolve('../../../platform/backend/src/utils/aiFeatureRuntime'));
 new Function('require','module','exports',runtimeSource)(id=>id==='../../services/aiConfiguration.service'?{featureId:value=>profiles.has(value)?value:null,resolve:async value=>{assert.ok(profiles.has(value),value);return profiles.get(value);}}:local(id),module,module.exports);
 const {buildPrompt}=builderFunctions({markers:true});
 const prompt=buildPrompt({testCase:{title:'Registration'},steps:[],cacheRows:[],knowledgeRows:[],capturedActions:[],capturedNetwork:[],additionalContext:'NFR only'});
 assert.match(prompt,/HELLOTEST_AI:ai.automation.keyword_generation:aiAutomationBuilder/);
 const result=await module.exports.apply({body:JSON.stringify({model:'authorized-model',messages:[{role:'user',content:prompt}]})},{featureKey:'ai.agentic.automation-engineer'});
 const payload=JSON.parse(result.init.body);assert.doesNotMatch(result.init.body,/HELLOTEST_AI:/);assert.match(payload.messages[0].content,/Custom NFR guidance/);assert.match(result.init.body,/Published shared instruction customized by admin/);assert.equal(payload.temperature,0.13);assert.equal(payload.model,'authorized-model');assert.equal(result.options.traceContext.feature,'ai.agentic.automation-engineer');
});

test("API builds reject requests whose normalization would discard behavior or assertions", () => {
  const { normalizeLlmBuild } = builderFunctions();
  const steps = [{ id: "api", step_order: 1, step_type: "api" }];
  const build = (request) => normalizeLlmBuild({ steps: [{ step_id: "api", api_request: request, automation_code: "ignored body" }] }, steps, [], null);
  for (const request of [
    { url: "/accounts", method: "FETCH" },
    { url: "/accounts", method: "POST", body_mode: "binary" },
    { url: "/accounts", method: "POST", body_mode: "json", body: { account: 1 } },
    { url: "/accounts", headers: { Authorization: "@t.token" } },
    { url: "/accounts", validations: [{ kind: "json_schema", expected: "{}" }] },
    { url: "/accounts", validations: [{ kind: "json_path", expected: "active" }] },
    { url: "/accounts", captures: [{ path: "$.id" }] },
    { url: "/accounts", headers: [{key:"X-Tenant",value:42}] },
    { url: "/accounts", headers: [{key:"",value:"tenant"}] },
    { url: "/accounts", validations: [{kind:"body_contains",expected:""}] },
    { url: "/accounts", method:"GET",body_mode:"json",body:'{"a":1}' },
    { url: "/accounts", method:"POST",body_mode:"none",body:'{"a":1}' },
    { url: "/accounts", timeout_ms:500 }
  ]) assert.throws(() => build(request), /API/);
  const result = build({ method: "POST", url: "/accounts", body_mode: "json", body: '{"email":"@t.email"}',
    validations: [{ kind: "status", expected: "201" }, { kind: "json_path", target: "$.status", expected: "active" }],
    captures: [{ path: "$.id", parameter: "@t.account_id" }] });
  assert.equal(result.updates[0].automation_code, null);
  assert.equal(result.updates[0].api_request.body, '{"email":"@t.email"}');
  assert.equal(result.updates[0].api_request.validations.length, 2);
});

test('API regeneration preserves existing assertions and captures needed by later sections',()=>{
 const {normalizeLlmBuild}=builderFunctions();
 const request={method:'POST',url:'/accounts',body_mode:'json',body:'{"email":"@t.email"}',validations:[{kind:'json_path',target:'$.status',expected:'active'}],captures:[{path:'$.id',parameter:'@t.account_id'}]};
 const steps=[{id:'api',step_order:1,step_type:'api',api_request:request}];
 const build=next=>normalizeLlmBuild({steps:[{step_id:'api',api_request:next}]},steps,[],null);
 for(const next of [{...request,validations:[]},{...request,validations:[{kind:'json_path',target:'$.status',expected:'pending'}]},{...request,captures:[]}])assert.throws(()=>build(next),/existing API/);
 const result=build({...request,url:'/v2/accounts'});assert.deepEqual(result.updates[0].api_request.validations,request.validations);assert.deepEqual(result.updates[0].api_request.captures,request.captures);
});

test('completion feedback repairs invalid generated bodies and retains complete validated sections',async()=>{
 const {normalizeLlmBuild}=builderFunctions();
 const {completeAutomationBuild}=require('../../backend/lib/automationBuildCompletion');
 const steps=[{id:'open',step_order:1,step_type:'web',action:'Open page'},{id:'save',step_order:2,step_type:'web',action:'Save',expected_result:'Saved',automation_code:'await expect(page.locator("#status")).toHaveText("Saved");'}],requests=[];
 const result=await completeAutomationBuild({steps,validate:(payload,required)=>normalizeLlmBuild(payload,required,[],null),generate:async request=>{requests.push(request);return request.attempt===1?{steps:[{step_id:'open',automation_code:'await page.goto("https://app.test");'},{step_id:'save',automation_code:'// implemented'}]}:{steps:[{step_id:'save',automation_code:'test("save",async({page,expect})=>{await page.locator("#save").click();await expect(page.locator("#status")).toHaveText("Saved");});'}]};}});
 assert.equal(result.completion_attempts,2);assert.deepEqual(requests[1].feedback.required_sections.map(item=>item.step_id),['save']);assert.match(requests[1].feedback.validation_errors[0].message,/no executable/);assert.equal(result.updates[0].automation_code,'await page.goto("https://app.test");');assert.doesNotMatch(result.updates[1].automation_code,/^test\(/);assert.match(result.updates[1].automation_code,/toHaveText\("Saved"\)/);
});

test("agent guidance includes API shape, native aliases and knowledge records without text", () => {
  const { buildPrompt } = builderFunctions();
  const prompt = buildPrompt({ testCase: { title: "Mixed checkout" }, steps: [], cacheRows: [],
    knowledgeRows: [{ title: "Attached specification", content: null }], capturedActions: [], capturedNetwork: [] });
  assert.match(prompt, /body_mode/);
  assert.match(prompt, /android, ios, mobile, driver/);
  assert.match(prompt, /Attached specification/);
});

test('Engineer prompt keeps current source provenance and separate unverified reviewed context alongside pinned steps', () => {
  const { buildPrompt } = builderFunctions();
  const prompt = buildPrompt({ testCase: { title: 'Signup' }, steps: [{ id: 'step-1', step_order: 1, action: 'Submit signup', expected_result: 'Account confirmation appears' }], cacheRows: [],
    knowledgeRows: { knowledge: [{ evidence_id: 'K-fragment-7', source_id: 'source-2', title: 'Signup acceptance', content: 'Account confirmation is required.', freshness: { current: true, status: 'CURRENT', source_version: 'revision-12' }, scores: { fused: 0.93 } }] },
    buildContext: { retrieval: { transport: 'mcp', reviewed_context: { kind: 'user_reviewed_supplement', trust: 'unverified_user_input', content: 'Review the account confirmation.', current_evidence_ids: ['K-fragment-7'] } } }, capturedActions: [], capturedNetwork: [] });
  assert.match(prompt, /"evidence_id": "K-fragment-7"/);
  assert.match(prompt, /"source_version": "revision-12"/);
  assert.match(prompt, /retrieval_ranking_only_not_factual_confidence/);
  assert.match(prompt, /"reviewed_context": \{/);
  assert.match(prompt, /"trust": "unverified_user_input"/);
  assert.match(prompt, /"action": "Submit signup"/);
  assert.match(prompt, /"expected_result": "Account confirmation appears"/);
});

test("builder context masks private keyed data even without an explicit secret flag",()=>{
 const {summarizeDataSetRows,summarizeVariables}=builderFunctions();
 const rows=summarizeDataSetRows([{key:"password",value:"PRIVATE",is_secret:false},{key:"username",value:"reader"},{"t.api_key":"PRIVATE","t.user":"reader"}]);
 assert.ok(!JSON.stringify(rows).includes("PRIVATE"));assert.equal(rows[1].value,"reader");assert.equal(rows[2]["t.user"],"reader");
 assert.ok(!JSON.stringify(summarizeVariables([{key:"access_token",value:"PRIVATE"},{key:"tenant",value:"demo"}])).includes("PRIVATE"));
});

test('final save rejects changed manual source expectations or link sets before any generated instruction writes',async()=>{
 const filename=path.join(__dirname,'../../backend/services/aiAutomationBuilder.service.js');
 const source=fs.readFileSync(filename,'utf8');
 const manual=[{id:'manual',title:'Checkout',steps:[{id:'m',action:'Submit',expected_result:'Saved'}]}];
 const step={id:'section',test_case_id:'auto',action:'Submit',expected_result:'Saved',step_order:1,step_type:'web',automation_code:''};
 for(const scenario of ['unchanged','expectation','links','app','project','parameters','input_data']){
  const writes=[],locks=[];let currentManual=structuredClone(manual);if(scenario==='expectation')currentManual[0].steps[0].expected_result='Updated acceptance';
  const database={transaction:callback=>callback,prepare:sql=>({get:async id=>{locks.push({sql,id});return {id,app_type_id:scenario==='app'?'other-app':'app',project_id:scenario==='project'?'other-project':'p'};},all:async()=>sql.includes('FROM automation_case_links')?(scenario==='links'?[{manual_test_case_id:'other'}]:[{manual_test_case_id:'manual'}]):[step],run:async()=>({changes:1})})};
  const module={exports:{}};
  new Function('require','exports','module',source+'\nexports.applyForTest=applyBuild;')((id)=>{
   if(id.endsWith('/db')||id.endsWith('/obsDb'))return database;
   if(id.endsWith('/testStepAutomation'))return automationUtils;
   if(id.endsWith('/automationBuildContext'))return {loadAutomationManualContext:async input=>{assert.equal(input.lock,true);return currentManual;},loadAutomationParameterContext:async input=>{assert.equal(input.lock,true);return {source_key:scenario==='parameters'?'changed':'original'};},manualContextKey:require('../../backend/lib/automationBuildContext').manualContextKey};
   if(id.endsWith('/testStep.service'))return {updateTestStep:async(...args)=>writes.push(args)};
   if(id.endsWith('/automationBrowserParameters'))return {loadBrowserParameterResolver:async input=>{assert.equal(input.materialize,false);assert.equal(input.lock,true);return {inputSourceKey:scenario==='input_data'?'edited-selected-data':'original-inputs'};}};
   if(id==='crypto')return require('node:crypto');return {};
  },module.exports,module);
  const operation=module.exports.applyForTest({build:{updates:[{step,step_type:'web',automation_code:'await page.locator("#submit").click();'}],manual_context:manual,manual_link_ids:['manual'],parameter_context_key:'original',input_context:{selection:{test_environment_id:'env'},source_key:'original-inputs'},project_id:'p',app_type_id:'app'},createdBy:'author'});
  if(scenario==='unchanged'){assert.equal((await operation).length,1);assert.equal(writes.length,1);assert.ok(locks.some(row=>row.id==='manual'&&row.sql.includes('FOR UPDATE')));}
  else{await assert.rejects(operation,/manual.*changed|Linked manual cases changed|application or project changed|test parameters changed|Selected test data.*changed/);assert.equal(writes.length,0);}
 }
});

test('actual signup failure shape rejects an invented inbox and returns the missing mailbox prerequisite without pretending the OTP input checks email',async()=>{
 const {normalizeLlmBuild}=builderFunctions(),{navigationOrigins}=require('../../backend/lib/automationGenerationGrounding'),{completeAutomationBuild}=require('../../backend/lib/automationBuildCompletion');
 const steps=Array.from({length:8},(_,index)=>({id:'step-'+(index+1),step_order:index+1,step_type:'web',action:index===5?'Check the email inbox for the verification code.':index===6?'Enter the verification code':'Signup action '+(index+1),expected_result:index===5?'Verification email is received':'Expected '+(index+1)}));
 const mappings=steps.map(step=>({step_id:step.id,automation_code:step.step_order===6?'await web.openTab("https://mail.example.com"); await page.getByRole("textbox", { name: "Email" }).fill("@t.email");':step.step_order===7?'await page.getByLabel("Verification code").fill("@t.verification_code"); await expect(page.getByText("Expected 7")).toBeVisible();':'await page.locator("#signup-'+step.step_order+'").click(); await expect(page.getByText("Expected '+step.step_order+'")).toBeVisible();'}));
 const requests=[],events=[],origins=navigationOrigins('https://app.hellotest.ai/');
 await assert.rejects(completeAutomationBuild({steps,manualSteps:steps.map(step=>({...step,id:'manual-'+step.id,test_case_id:'manual'})),validate:(payload,required)=>normalizeLlmBuild(payload,required,[],null,{origins}),onProgress:async event=>events.push(event),generate:async request=>{requests.push(request);return request.attempt===1?{steps:mappings}:{steps:[],blocked_steps:[{step_id:'step-6',dependency_type:'mailbox',reason:'A real mailbox URL or API/access reference was not supplied.',required_context:['Authorized test mailbox or inbox API connection'],required_parameters:[]}]};}}),error=>error.code==='AUTOMATION_DEPENDENCY_MISSING'&&error.completed_sections===7&&error.pending_step_ids[0]==='step-6');
 assert.equal(requests.length,2);assert.match(requests[1].feedback.validation_errors[0].message,/no supplied or observed URL evidence/);assert.deepEqual(requests[1].feedback.required_sections.map(row=>row.step_id),['step-6']);assert.equal(events.filter(event=>event.phase==='automation.agent.section.ready').length,7);
 const configured=navigationOrigins('https://app.hellotest.ai/','User supplied inbox URL: https://inbox.test/');
 assert.equal(normalizeLlmBuild({steps:[{step_id:'step-6',automation_code:'await web.openTab("https://inbox.test/"); await expect(page.getByText("Verification code")).toBeVisible();'}]},[steps[5]],[],null,{origins:configured}).updates.length,1);
});
