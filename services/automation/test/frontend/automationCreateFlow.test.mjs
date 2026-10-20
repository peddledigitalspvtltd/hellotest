import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { automationCaseMappingStatus } from "../../frontend/lib/automationStepPersistence.ts";
import { reviewedAutomationStartUrl } from "../../frontend/lib/automationStartUrl.ts";

const planExports = {};
new Function("require", "exports", ts.transpileModule(readFileSync(new URL("../../frontend/lib/automationPlan.ts", import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText)(() => ({}), planExports);
const source = readFileSync(new URL("../../frontend/pages/AutomationPage.tsx", import.meta.url), "utf8");
const creationStart = source.indexOf("  const createAutomationCase = useMutation({");
const functionStart = source.indexOf("mutationFn:", creationStart) + "mutationFn:".length;
const functionEnd = source.indexOf("\n    onSuccess:", functionStart);
const mutationSource = source.slice(functionStart, functionEnd).trim().replace(/,$/, "");
const mutationScript = ts.transpileModule(`const mutation = ${mutationSource};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function fixture({ queueFails = false, reviewFails = false, reviewCancels = false, mission = "Build account journey", overrides = {} } = {}) {
  let sequence = 0;
  const calls = { created: [], modules: [], queued: [], reviewed: [] };
  const sources = [
    { testCase: { id: "manual-1", title: "Login", parameter_values: { "t.user": "jay" } }, steps: [{ id: "precondition", action: "an account exists", expected_result: "", step_type: "api", group_id: "setup", group_name: "Preconditions", group_kind: "local" }, { id: "login", action: "enter @t.user", expected_result: "access granted", step_type: "web", group_id: "login", group_name: "Sign in", group_kind: "reusable", reusable_group_id: "shared-login" }] },
    { testCase: { id: "manual-2", title: "Profile" }, steps: [{ id: "profile", action: "open profile", expected_result: "profile displayed", step_type: "web" }] }
  ];
  const context = {
    canUseAutomationBuilder: true, canCreateAutomationCase: true, canUseAutomationAi: true, canUseRecorder: true, appTypeId: "app", projectId: "project",
    automationCreateMetadata: { title: "Customer journey", description: "Selected metadata", priority: "1", status: "draft", requirementIds: ["story"], suiteIds: ["suite"], moduleIds: ["module"], dataSetId: "data" },
    automationCreateManualCaseIds: sources.map((item) => item.testCase.id),
    automationCreationMode: "ai",
    automationCreateSteps: [{ id: "draft", action: "sign out", expected_result: "session closed", step_type: "web", precondition: false }],
    createSourcesQuery: { data: sources },
    automationModules: [{ id: "module", name: "Accounts" }],
    agentMission: mission, agentScheduledAt: "", agentAutonomy: "supervised", agentRetryBudget: 3, agentCapabilities: ["repository"],
    buildPipelineOptions: {verification_mode:"generate_only",browser_driver:"mcp"},
    allowBrowserActions: true, automationCreateStartUrl: "https://example.test/reviewed?tenant=one", automationCreateStartUrlRequired: true, builderContext: "Keep assertions", selectedExecutionEnvironmentId: "env", selectedExecutionConfigurationId: "config",
    ...planExports, automationCaseMappingStatus, reviewedAutomationStartUrl, richTextToPlainText: value => String(value || '').replace(/<[^>]*>/g, ''),
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
  assert.equal(payload.priority, 1);
  assert.equal(payload.status, "draft");
  assert.deepEqual(payload.test_data_set_ids, ["data"]);
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
  assert.match(calls.queued[0].additional_context, /Build account journey/);
});

test("creation with multiple suites leaves selection to source resolution instead of choosing the first suite", async () => {
  const { calls, mutation } = fixture({ overrides: { automationCreateMetadata: { title: "Multi-suite case", description: "Login", priority: "1", status: "draft", requirementIds: [], suiteIds: ["east", "west"], moduleIds: [], dataSetId: "" } } });
  await mutation();
  assert.equal(calls.reviewed[0].selections.test_suite_id, undefined);
  assert.deepEqual(calls.created[0].suite_ids, ["east", "west"]);
  assert.deepEqual(calls.queued[0].test_suite_ids_by_case, { created: null });
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


test("new AI creation begins build tracking for the durable created case", async () => {
  const callbacksStart = source.indexOf("\n    onSuccess:", functionEnd) + "\n    onSuccess:".length;
  const callbacksEnd = source.indexOf("\n    onError:", callbacksStart);
  const script = ts.transpileModule(`const callback = ${source.slice(callbacksStart, callbacksEnd).trim().replace(/,$/, "")};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const calls = {};
  const context = { projectId: "project", appTypeId: "app", startUrlCaseScopeRef: {current:""}, emptyAutomationMetadata: {}, automationCreateTouchedMetadataRef: { current: new Set() }, queryClient: { invalidateQueries: async () => {} }, showError: () => {}, showSuccess: () => {}, showInfo: value => { calls.info = value; }, rememberAutomationBuildDrafts: () => { calls.remembered = true; } };
  context.setAgentBriefOpen = (...args) => { calls.brief = args; };
  for (const name of ["setIsCreateAutomationOpen", "setAutomationCreateManualCaseIds", "setAutomationCreateMetadata", "setAutomationCreateSteps", "setAutomationCreateStartUrl", "setStartUrl", "setSelectedCaseId", "setSelectedAutomatedCaseId", "setBuildMethod", "setActiveAutomationWorkspaceTab", "setAgentBuildReceipt", "setExpandedCaseSections", "setSearchParams", "setAgentBuildStatus", "setAgentBuildTracking"]) context[name] = (value) => { calls[name] = value; };
  const callback = new Function(...Object.keys(context), `${script}\nreturn callback;`)(...Object.values(context));
  await callback({ id: "created", title: "New case", transactionId: "queued-build", mode: "ai", scheduledAt: undefined, followUpFailures: [] });
  assert.equal(calls.remembered, true);
  assert.equal(calls.setAgentBuildStatus, "queued");
  assert.equal(calls.setAgentBuildTracking.transactionId, "queued-build");
  assert.deepEqual(calls.setAgentBuildTracking.caseIds, ["created"]);
  assert.equal(calls.setAgentBuildTracking.projectId, "project");
  assert.deepEqual(calls.brief, [false, "created"], "the queued new case opens directly on its build workspace");
  for (const key of Object.keys(calls)) delete calls[key];
  await callback({ id: "created", title: "New case", transactionId: "", mode: "ai", buildCancelled: true, followUpFailures: [] });
  assert.equal(calls.setSelectedCaseId, "created");assert.equal(calls.setAgentBuildTracking, undefined);assert.equal(calls.remembered, undefined);
  assert.equal(calls.brief, undefined, "a cancelled build keeps configuration available");
  assert.match(calls.info, /created with its linked defaults.*cancelled before it started/);
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
  const empty = fixture({ mission: '', overrides: { automationCreateManualCaseIds: [], automationCreateSteps: [], builderContext: '', automationCreateMetadata: { title: 'Missing flow', description: '<p> </p>', status: 'draft' } } });
  await assert.rejects(empty.mutation(), /Describe the requested flow/);
  assert.equal(empty.calls.created.length, 0);
});

test('creation carries the explicit reviewed verification choice into the durable job',async()=>{
 const {mutation,calls}=fixture({overrides:{buildPipelineOptions:{verification_mode:'verify_repair',browser_driver:'mcp'}}});
 await mutation();assert.equal(calls.queued[0].verification_mode,'verify_repair');assert.equal(calls.queued[0].browser_driver,'mcp');
});
