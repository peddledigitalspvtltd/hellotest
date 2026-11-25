import { automationOwnerSource, automationWorkspaceSource, findAutomationBinding,automationMutationProperty } from "./helpers/automationWorkspaceSources.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { automationCaseMappingStatus } from "../../frontend/lib/automationStepPersistence.ts";
import {admitAutomationBuild} from "../../frontend/workspaces/cases/admitAutomationBuild.ts";
import { reviewedAutomationStartUrl } from "../../frontend/lib/automationStartUrl.ts";
import { automationBuildRuntimeRequest } from "../../frontend/lib/automationBuildPipeline.ts";
import { getAutomationBuildRuntimeTypes } from "../../frontend/lib/automationRuntime.ts";

const planExports = {};
new Function("require", "exports", ts.transpileModule(readFileSync(new URL("../../frontend/lib/automationPlan.ts", import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText)(() => ({}), planExports);
const mutationSource = automationMutationProperty('createAutomationCase','mutationFn','workspaces/cases/useAutomationCaseCreation.ts');
const mutationScript = ts.transpileModule(`const mutation = ${mutationSource};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const agentSetupSource = ts.createSourceFile('AutomationAgentSetup.tsx', readFileSync(new URL('../../../ai/frontend/components/AutomationAgentSetup.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const agentRequest = agentSetupSource.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === 'automationAgentRequest');
assert.ok(agentRequest, 'Creation uses the same production agent context projection as the saved-case builder.');
const agentRequestScript = ts.transpileModule(agentRequest.getText(agentSetupSource).replace(/^export\s+/, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const automationAgentRequest = new Function(`${agentRequestScript}\nreturn automationAgentRequest;`)();

function fixture({ queueFails = false, reviewFails = false, reviewCancels = false, mission = "Build account journey", overrides = {} } = {}) {
  let sequence = 0;
  const calls = { created: [], modules: [], queued: [], reviewed: [], admission: [] };
  const sources = [
    { testCase: { id: "manual-1", title: "Login", parameter_values: { "t.user": "jay" } }, steps: [{ id: "precondition", action: "an account exists", expected_result: "", step_type: "api", group_id: "setup", group_name: "Preconditions", group_kind: "local" }, { id: "login", action: "enter @t.user", expected_result: "access granted", step_type: "web", group_id: "login", group_name: "Sign in", group_kind: "reusable", reusable_group_id: "shared-login" }] },
    { testCase: { id: "manual-2", title: "Profile" }, steps: [{ id: "profile", action: "open profile", expected_result: "profile displayed", step_type: "web" }] }
  ];
  const context = {
    canUseAutomationBuilder: true, canCreateAutomationCase: true, canUseAutomationAi: true, canUseRecorder: true, appTypeId: "app", projectId: "project",
    automationCreateMetadata: { automationCaseType: "web", title: "Customer journey", description: "Selected metadata", priority: "1", status: "draft", requirementIds: ["story"], suiteIds: ["suite"], moduleIds: ["module"], dataSetId: "data" },
    automationCreateManualCaseIds: sources.map((item) => item.testCase.id),
    automationCreationMode: "ai", creationIncompatibleRuntimes: [],
    importedApiPlanReady:false,automationApiSourceParameters:{},automationApiSourcePrivateNames:[],
    automationCreateSteps: [{ id: "draft", action: "sign out", expected_result: "session closed", step_type: "web", precondition: false }],
    createSourcesQuery: { data: sources },
    automationModules: [{ id: "module", name: "Accounts" }],
    agentMission: mission, agentScheduledAt: "", agentAutonomy: "supervised", agentRetryBudget: 3, agentCapabilities: ["repository"],
    buildAgentSelection: { integrationId: 'reviewed-llm', scopes: ['automation', 'test-cases', 'stories', 'runs', 'knowledge'], inputs: {}, smart: null },
    automationAgentRequest,admitAutomationBuild,authoring:{beginBuild:(ids)=>{calls.admission.push({phase:"requested",ids});return "operation";},buildAccepted:(operation,id)=>calls.admission.push({phase:"accepted",operation,id}),buildRejected:(operation,error)=>calls.admission.push({phase:"rejected",operation,error})},
    buildPipelineOptions: {verification_mode:"generate_only",browser_driver:"mcp"}, buildBrowserLocation: "remote",
    allowBrowserActions: true, automationCreateStartUrl: "https://example.test/reviewed?tenant=one", automationCreateStartUrlRequired: true, builderContext: "Keep assertions", selectedExecutionEnvironmentId: "env", selectedExecutionConfigurationId: "config",
    ...planExports, automationCaseMappingStatus, reviewedAutomationStartUrl, automationBuildRuntimeRequest, getAutomationBuildRuntimeTypes,
    richTextToPlainText: value => String(value || '').replace(/<[^>]*>/g, ''),
    crypto: { randomUUID: () => String(++sequence) },
    reviewBuildParameters: async (caseIds, selections, titles) => {
      assert.equal(calls.created.length, 1, "review targets the durable created case");
      calls.reviewed.push({ caseIds, selections, titles });
      if (reviewFails) throw new Error("Parameter sources changed");
      if (reviewCancels) return null;
      return { parameter_values_by_case: { created: { "r.blank": "" } }, parameter_plan_keys_by_case: { created: "reviewed-created-source" }, test_suite_ids_by_case: { created: selections.test_suite_id || null } };
    },
    api: {
      testCases: {
        create: async (payload) => { calls.created.push(payload); return { id: "created" }; },
        buildAutomationBatch: async payload => { calls.queued.push(payload); if (queueFails) throw new Error("Queue unavailable"); return { transaction_id: "build" }; }
      },
      testCaseModules: { assignCases: async (...args) => { calls.modules.push(args); } }
    },
    ...overrides
  };
  return { calls, context, mutation: new Function(...Object.keys(context), `${mutationScript}\nreturn mutation;`)(...Object.values(context)) };
}

test("automation creation copies every source plan, preserves groups, and saves selected metadata and modules", async () => {
  const { calls, mutation } = fixture();
  const result = await mutation();
  assert.equal(result.id, "created");
  assert.equal(calls.created.length, 1);
  const payload = calls.created[0];
  assert.deepEqual(payload.steps.map((step) => step.action), ["an account exists", "enter @t.user", "open profile", "sign out"]);
  assert.equal(payload.steps[1].reusable_group_id, "shared-login");
  assert.equal(payload.steps[1].expected_result, "access granted");
  assert.equal(payload.description, "Selected metadata");
  assert.equal(payload.automation_case_type, "web");
  assert.equal(payload.test_case_type, "functional");
  assert.equal(payload.priority, 1);
  assert.equal(payload.status, "draft");
  assert.deepEqual(payload.test_data_set_ids, ["data"]);
  assert.equal(payload.test_data_options.test_environment_id, "env");
  assert.deepEqual(payload.requirement_ids, ["story"]);
  assert.deepEqual(calls.modules, [["module", ["created"], true]]);
  assert.equal(payload.automation_start_url, "https://example.test/reviewed?tenant=one");
  assert.deepEqual(calls.queued[0].test_case_ids, ["created"]);
  assert.deepEqual(payload.parameter_values, {}, "manual defaults remain linked instead of being copied into own overrides");
  assert.deepEqual(calls.reviewed, [{ caseIds: ["created"], selections: { test_suite_id: "suite", test_environment_id: "env", test_configuration_id: "config", test_data_set_id: "data" }, titles: { created: "Customer journey" } }]);
  assert.deepEqual(calls.queued[0].test_suite_ids_by_case, { created: "suite" });
  assert.deepEqual(calls.queued[0].parameter_plan_keys_by_case, { created: "reviewed-created-source" });
  assert.deepEqual(calls.queued[0].parameter_values_by_case, { created: { "r.blank": "" } });
  assert.equal(calls.queued[0].start_url, payload.automation_start_url);
  assert.equal(calls.queued[0].allow_browser_actions, true);
  assert.equal(calls.queued[0].browser_location, "remote");
  assert.equal(calls.queued[0].integration_id, 'reviewed-llm');
  assert.deepEqual(calls.queued[0].agent_context, { context_scopes: ['automation', 'test-cases', 'stories', 'runs', 'knowledge'], inputs: {}, smart_context: undefined });
  assert.match(calls.queued[0].additional_context, /Build account journey/);
});

test('creation forwards the reviewed model and evidence projection without changing case data or inventing a configured provider', async () => {
  const selection = { integrationId: 'chosen-provider', scopes: ['automation', 'knowledge'], inputs: { requirement_id: 'story' },
    smart: { query: 'Review login coverage', sourceIds: ['source-1'], sourceKinds: ['requirement'], contextText: 'Reviewed login evidence' } };
  const selected = fixture({ overrides: { buildAgentSelection: selection } });
  await selected.mutation();
  assert.equal(selected.calls.queued[0].integration_id, selection.integrationId);
  assert.deepEqual(selected.calls.queued[0].agent_context, { context_scopes: selection.scopes, inputs: selection.inputs,
    smart_context: { query: selection.smart.query, source_ids: selection.smart.sourceIds, source_kinds: selection.smart.sourceKinds, reviewed_context: selection.smart.contextText } });
  assert.deepEqual(selected.calls.queued[0].parameter_values_by_case, { created: { 'r.blank': '' } });
  assert.equal(Object.hasOwn(selected.calls.created[0], 'integration_id'), false, 'Provider choice belongs to this build, not case metadata.');
  const configured = fixture({ overrides: { buildAgentSelection: { ...selection, integrationId: '' } } });
  await configured.mutation();
  assert.equal(configured.calls.queued[0].integration_id, undefined, 'An explicit Configured LLM choice preserves backend provider resolution.');
});

test("creation with multiple suites leaves selection to source resolution instead of choosing the first suite", async () => {
  const { calls, mutation } = fixture({ overrides: { automationCreateMetadata: { automationCaseType: "web", title: "Multi-suite case", description: "Login", priority: "1", status: "draft", requirementIds: [], suiteIds: ["east", "west"], moduleIds: [], dataSetId: "" } } });
  await mutation();
  assert.equal(calls.reviewed[0].selections.test_suite_id, undefined);
  assert.deepEqual(calls.created[0].suite_ids, ["east", "west"]);
  assert.deepEqual(calls.queued[0].test_suite_ids_by_case, { created: null });
});

test("Build Agent starts from the linked API behavior and explicit authoring retains an independent API plan", async () => {
  const expected = { method: "GET", url: "https://catalog.test/invoices", validations: [{kind: "status", expected: "200"}] };
  const source = { testCase: { id: "manual-api" }, steps: [{ action: "GET https://catalog.test/invoices",
    expected_result: "HTTP 200 returns invoices", step_type: "api", api_request: expected }] };
  const metadata = { automationCaseType: "api", title: "Invoice automation", description: "", priority: "3",
    status: "draft", requirementIds: [], suiteIds: [], moduleIds: [], dataSetId: "" };
  const sharedOverrides = { automationCreateMetadata: metadata, automationCreateManualCaseIds: ["manual-api"],
    createSourcesQuery: { data: [source] }, automationCreateSteps: [], automationCreateStartUrl: "", automationCreateStartUrlRequired: false };
  const build = fixture({ overrides: sharedOverrides });
  await build.mutation();
  assert.equal(build.calls.created[0].steps[0].expected_result, source.steps[0].expected_result);
  assert.deepEqual(build.calls.created[0].steps[0].api_request, expected);
  assert.equal(build.calls.queued[0].allow_browser_actions, undefined);
  const author = fixture({ overrides: { ...sharedOverrides, automationCreationMode: "blank" } });
  await author.mutation();
  assert.deepEqual(author.calls.created[0].steps, []);
  assert.deepEqual(author.calls.created[0].manual_test_case_ids, ["manual-api"]);
});

test("a queue failure returns the already-created case ID so retry cannot duplicate creation", async () => {
  const { calls, mutation } = fixture({ queueFails: true });
  const result = await mutation();
  assert.equal(result.id, "created");
  assert.equal(calls.created.length, 1);
  assert.match(result.followUpFailures[0], /Queue unavailable/);
});

test("cancelling the data review preserves the created case without queueing or recreating it", async () => {
  const { calls, mutation } = fixture({ reviewCancels: true });
  const result = await mutation();
  assert.equal(result.id, "created");assert.equal(calls.created.length, 1);assert.equal(calls.reviewed.length, 1);
  assert.equal(result.buildCancelled, true);assert.equal(result.transactionId, "");assert.deepEqual(result.followUpFailures, []);assert.deepEqual(calls.queued, []);
});

test("a failed parameter review preserves the durable created case and never dispatches an unreviewed build", async () => {
  const { calls, mutation } = fixture({ reviewFails: true });
  const result = await mutation();
  assert.equal(result.id, "created");assert.equal(calls.created.length, 1);assert.equal(result.transactionId, "");
  assert.match(result.followUpFailures[0], /Parameter sources changed/);assert.deepEqual(calls.queued, []);
});


test("new AI creation tracks the accepted receipt and opens its durable Build workspace", async () => {
  const fixtureResult=fixture();const created=await fixtureResult.mutation();
  assert.deepEqual(fixtureResult.calls.admission,[{phase:'requested',ids:['created']},{phase:'accepted',operation:'operation',id:'build'}]);
  const script=ts.transpileModule(`const callback=${automationMutationProperty('createAutomationCase','onSuccess','workspaces/cases/useAutomationCaseCreation.ts')};`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  const navigations=[],invalidations=[];
  const context={engineerPath:undefined,setIsCreateAutomationOpen:value=>assert.equal(value,false),invalidateAutomationData:()=>invalidations.push(true),searchParams:new URLSearchParams('create=1&manual=old&repository=old&agent_activity=old'),navigate:(...args)=>navigations.push(args)};
  const callback=new Function(...Object.keys(context),`${script}\nreturn callback;`)(...Object.values(context));
  await callback(created);
  const [target,options]=navigations[0],params=new URLSearchParams(target.search);
  assert.equal(target.pathname,'/automation');assert.equal(params.get('case'),'created');assert.equal(params.get('tab'),'build');assert.equal(params.get('agent_activity'),'build');
  assert.equal(params.has('create'),false);assert.equal(params.has('manual'),false);assert.equal(params.has('repository'),false);
  assert.match(options.state.automationNotice.message,/created and AI build queued/);assert.equal(options.replace,true);assert.equal(invalidations.length,1);
  await callback({...created,transactionId:'',buildCancelled:true});
  const [cancelledTarget,cancelledOptions]=navigations[1];assert.equal(new URLSearchParams(cancelledTarget.search).get('case'),'created');
  assert.equal(new URLSearchParams(cancelledTarget.search).has('agent_activity'),false,'A cancelled build never invents an activity receipt');
  assert.equal(cancelledOptions.state.automationNotice.tone,'info');assert.match(cancelledOptions.state.automationNotice.message,/created.*cancelled before it started/);
  context.engineerPath = '/agentic-workflows';
  context.searchParams = new URLSearchParams('view=workbench&agent=automation-engineer');
  const studioCallback=new Function(...Object.keys(context),`${script}\nreturn callback;`)(...Object.values(context));
  await studioCallback(created);
  assert.equal(navigations[2][0].pathname, '/agentic-workflows');
  assert.equal(new URLSearchParams(navigations[2][0].search).get('agent'), 'automation-engineer');
});

test("linked manual cases can build without a redundant mission", async () => {
  const { calls, mutation } = fixture({ mission: "" });
  await mutation();
  assert.equal(calls.created.length, 1);
  assert.match(calls.queued[0].additional_context, /saved behavior plan and verify its expected results/);
});

test('prompt-only creation queues an empty honest plan with the user flow and reviewed Start URL', async () => {
  const mission = 'Create a new account using the supplied email and verify the welcome page.';
  const { calls, mutation } = fixture({ mission, overrides: { automationCreateManualCaseIds: [], automationCreateSteps: [] } });
  await mutation();
  assert.deepEqual(calls.created[0].steps, []);
  assert.match(calls.queued[0].additional_context, /Create a new account using the supplied email/);
  assert.equal(calls.queued[0].start_url, 'https://example.test/reviewed?tenant=one');
});

test('description-only creation can plan the flow while a truly empty request is rejected before creating a case', async () => {
  const { calls, mutation } = fixture({ mission: '', overrides: { automationCreateManualCaseIds: [], automationCreateSteps: [], builderContext: '' } });
  await mutation();
  assert.deepEqual(calls.created[0].steps, []);
  assert.match(calls.queued[0].additional_context, /Selected metadata/);
  const empty = fixture({ mission: '', overrides: { automationCreateManualCaseIds: [], automationCreateSteps: [], builderContext: '', automationCreateMetadata: { automationCaseType: "web", title: 'Missing flow', description: '<p> </p>', status: 'draft' } } });
  await assert.rejects(empty.mutation(), /Describe the requested flow/);
  assert.equal(empty.calls.created.length, 0);
});

test('creation carries the explicit reviewed verification choice into the durable job',async()=>{
 const {mutation,calls}=fixture({overrides:{automationCreateManualCaseIds:[],buildPipelineOptions:{verification_mode:'verify_repair',browser_driver:'mcp'}}});
 await mutation();assert.equal(calls.queued[0].verification_mode,'verify_repair');assert.equal(calls.queued[0].browser_driver,'mcp');
});

test('creation requires a platform and rejects incompatible source plans before creating records', async () => {
  const missing = fixture({overrides:{automationCreateMetadata:{title:"Missing platform"}}});
  await assert.rejects(missing.mutation(), /Select an automation case type/);
  assert.equal(missing.calls.created.length, 0);
  const mixed = fixture({overrides:{creationIncompatibleRuntimes:["web"]}});
  await assert.rejects(mixed.mutation(), /does not support web steps/);
  assert.equal(mixed.calls.created.length, 0);
});

test('source API journeys persist one case with ordered canonical requests and private parameters without regeneration',async()=>{
 const requests=[{method:'POST',url:'https://api.test/login',body_mode:'json',body:'{"password":"@t.password"}',validations:[],captures:[{path:'$.token',parameter:'token'}]}, {method:'GET',url:'https://api.test/items',headers:[{key:'Authorization',value:'Bearer @t.token'}],validations:[{kind:'status',expected:'200'}]}];
 const {mutation,calls}=fixture({overrides:{
  importedApiPlanReady:true,automationCreateManualCaseIds:[],createSourcesQuery:{data:[]},
  automationCreateMetadata:{automationCaseType:'api',title:'Login and items',description:'Imported API journey',priority:'2',status:'draft',requirementIds:[],suiteIds:[],moduleIds:[],dataSetId:''},
  automationCreateStartUrl:'',automationCreateStartUrlRequired:false,agentScheduledAt:'invalid-unused-schedule',
  automationApiSourceParameters:{base_url:'https://api.test',password:''},automationApiSourcePrivateNames:['t.password','t.token'],
  automationCreateSteps:requests.map((request,index)=>({id:`step-${index}`,action:`Request ${index}`,expected_result:'',step_type:'api',precondition:false,api_request:request}))
 }});
 const receipt=await mutation();
 assert.equal(calls.created.length,1);assert.equal(calls.queued.length,0);
 assert.deepEqual(calls.created[0].steps.map(step=>step.api_request),requests);
 assert.deepEqual(calls.created[0].steps.map(step=>step.step_order),[1,2]);
 assert.deepEqual(calls.created[0].test_data_options.private_parameter_names,['t.password','t.token']);
 assert.equal(calls.created[0].parameter_values.password,'');assert.equal(receipt.mode,'blank');
});


test("an API twin retains exact manual Story and module lineage while excluding browser source steps", async () => {
  const { calls, mutation } = fixture({ overrides: {
    automationCreateMetadata: {automationCaseType:"api",title:"Login API twin",description:"API boundary",priority:"2",status:"draft",requirementIds:["story"],moduleIds:["module"],suiteIds:[],dataSetId:""},
    automationCreateManualCaseIds:["manual-1"], automationCreationMode:"blank", automationCreateStartUrlRequired:false, automationCreateStartUrl:"",
    automationCreateSteps:[{id:"api",action:"Reject invalid credentials",expected_result:"401",step_type:"api",precondition:false,api_request:{method:"POST",url:"@r.api_base_url/auth/login",validations:[{kind:"status",expected:"401"}]}}]
  }});
  await mutation();
  const payload=calls.created[0];assert.equal(payload.automation_case_type,"api");assert.deepEqual(payload.manual_test_case_ids,["manual-1"]);assert.deepEqual(payload.requirement_ids,["story"]);assert.deepEqual(calls.modules,[["module",["created"],true]]);
  assert.equal(payload.steps.length,1);assert.equal(payload.steps[0].step_type,"api");assert.equal(payload.steps[0].api_request.url,"@r.api_base_url/auth/login");assert.equal(calls.queued.length,0);
});
