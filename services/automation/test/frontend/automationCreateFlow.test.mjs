import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const planExports = {};
new Function("require", "exports", ts.transpileModule(readFileSync(new URL("../../frontend/lib/automationPlan.ts", import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText)(() => ({}), planExports);
const source = readFileSync(new URL("../../frontend/pages/AutomationPage.tsx", import.meta.url), "utf8");
const creationStart = source.indexOf("  const createAutomationCase = useMutation({");
const functionStart = source.indexOf("mutationFn:", creationStart) + "mutationFn:".length;
const functionEnd = source.indexOf("\n    onSuccess:", functionStart);
const mutationSource = source.slice(functionStart, functionEnd).trim().replace(/,$/, "");
const mutationScript = ts.transpileModule(`const mutation = ${mutationSource};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function fixture({ queueFails = false } = {}) {
  let sequence = 0;
  const calls = { created: [], modules: [], queued: [] };
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
    agentMission: "Build account journey", agentScheduledAt: "", agentAutonomy: "supervised", agentRetryBudget: 3, agentCapabilities: ["repository"],
    startUrl: "https://example.test", builderContext: "Keep assertions", selectedExecutionEnvironmentId: "env", selectedExecutionConfigurationId: "config",
    ...planExports,
    crypto: { randomUUID: () => String(++sequence) },
    api: {
      testCases: {
        create: async (payload) => { calls.created.push(payload); return { id: "created" }; },
        queueAutomationGenerator: async (id, payload) => { calls.queued.push({ id, payload }); if (queueFails) throw new Error("Queue unavailable"); return { transaction_id: "build" }; }
      },
      testCaseModules: { assignCases: async (...args) => { calls.modules.push(args); } }
    }
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
  assert.equal(calls.queued[0].id, "created");
  assert.match(calls.queued[0].payload.additional_context, /Build account journey/);
});

test("a queue failure returns the already-created case ID so retry cannot duplicate creation", async () => {
  const { calls, mutation } = fixture({ queueFails: true });
  const result = await mutation();
  assert.equal(result.id, "created");
  assert.equal(calls.created.length, 1);
  assert.match(result.followUpFailures[0], /Queue unavailable/);
});


test("new AI creation begins build tracking for the durable created case", async () => {
  const callbacksStart = source.indexOf("\n    onSuccess:", functionEnd) + "\n    onSuccess:".length;
  const callbacksEnd = source.indexOf("\n    onError:", callbacksStart);
  const script = ts.transpileModule(`const callback = ${source.slice(callbacksStart, callbacksEnd).trim().replace(/,$/, "")};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const calls = {};
  const context = { projectId: "project", emptyAutomationMetadata: {}, automationCreateTouchedMetadataRef: { current: new Set() }, queryClient: { invalidateQueries: async () => {} }, showError: () => {}, showSuccess: () => {}, rememberAutomationBuildDrafts: () => { calls.remembered = true; } };
  for (const name of ["setIsCreateAutomationOpen", "setAutomationCreateManualCaseIds", "setAutomationCreateMetadata", "setAutomationCreateSteps", "setSelectedCaseId", "setSelectedAutomatedCaseId", "setBuildMethod", "setActiveAutomationWorkspaceTab", "setAgentBuildReceipt", "setExpandedCaseSections", "setSearchParams", "setAgentBuildStatus", "setAgentBuildTracking"]) context[name] = (value) => { calls[name] = value; };
  const callback = new Function(...Object.keys(context), `${script}\nreturn callback;`)(...Object.values(context));
  await callback({ id: "created", title: "New case", transactionId: "queued-build", mode: "ai", scheduledAt: undefined, followUpFailures: [] });
  assert.equal(calls.remembered, true);
  assert.equal(calls.setAgentBuildStatus, "queued");
  assert.equal(calls.setAgentBuildTracking.transactionId, "queued-build");
  assert.deepEqual(calls.setAgentBuildTracking.caseIds, ["created"]);
  assert.equal(calls.setAgentBuildTracking.projectId, "project");
});
