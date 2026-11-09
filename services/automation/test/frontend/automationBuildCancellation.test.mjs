import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const require = createRequire(new URL("../../../platform/frontend/package.json", import.meta.url));
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const source = file => readFileSync(new URL(file, import.meta.url), "utf8");
const transpile = value => ts.transpileModule(value, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX
} }).outputText;
const load = (file, dependencies = {}) => {
  const exports = {};
  new Function("require", "exports", transpile(source(file)))(name => Object.hasOwn(dependencies, name) ? dependencies[name] : require(name), exports);
  return exports;
};
const monitoring = load("../../frontend/lib/automationActivityMonitoring.ts");
const page = ts.createSourceFile("AutomationPage.tsx", source("../../frontend/pages/AutomationPage.tsx"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const find = (node, predicate) => predicate(node) ? node : ts.forEachChild(node, child => find(child, predicate));
const cancelMutation = find(page, node => ts.isVariableDeclaration(node) && node.name.getText(page) === "cancelAutomationBuild");
assert.ok(cancelMutation && ts.isCallExpression(cancelMutation.initializer));
const mutationSource = cancelMutation.initializer.arguments[0].getText(page);
const mutationFixture = (overrides = {}) => {
  const calls = [], invalidated = [], statuses = [], receipts = [], successes = [];
  const context = {
    canUseAutomationBuilder: true, canUseAutomationAi: true, projectId: "project",
    agentBuildTracking: { transactionId: "build", projectId: "project" },
    api: { testCases: { cancelAutomationBuild: async id => { calls.push(id); return { transaction_id: id, status: "cancelled", cancelled: true }; } } },
    queryClient: { invalidateQueries: async options => { invalidated.push(options.queryKey); } },
    setAgentBuildStatus: value => statuses.push(value), setAgentBuildRetryIds: () => {}, setAgentBuildReceipt: value => receipts.push(value),
    showSuccess: value => successes.push(value), showError: () => {}, ...overrides
  };
  const options = new Function(...Object.keys(context), transpile(`return (${mutationSource});`))(...Object.values(context));
  return { options, calls, invalidated, statuses, receipts, successes };
};

const activity = (overrides = {}) => ({ id: "build", project_id: "project", app_type_id: "app", action: "automation_generator_run", status: "running", metadata: {}, ...overrides });
function activityFixture({ current = activity(), previous, selectedId = "", denied = [], stoppingActivityId, history = [], withStop = true } = {}) {
  let stateIndex = 0;
  const stops = [], refetches = [], workspaces = [];
  const Workspace = props => { workspaces.push(props); return React.createElement("div", { "data-workspace-stopped": props.stopped || undefined }, "Saved source and evidence"); };
  const dependencies = {
    react: { ...React, useEffect: () => {}, useRef: value => ({ current: value }), useState: value => [stateIndex++ === 0 ? selectedId : value, () => {}] },
    "@tanstack/react-query": { useQuery: options => ({
      data: options.queryKey[0] === "automation-agent-history" ? { items: history, next_cursor: null }
        : options.queryKey[0] === "automation-agent-record" ? previous : current,
      isPending: false, isFetching: false, isError: false,
      refetch: async () => { refetches.push(options.queryKey[0]); }
    }) },
    "@hellotest/testing/frontend/api.client": { testingApi: { testCases: {} } },
    "@hellotest/platform/frontend/src/platform/hooks/useCapabilityAccess": { useCapabilityAccess: () => ({ can: permission => !denied.includes(permission) }) },
    "@hellotest/platform/frontend/src/platform/components/RichTextEditor": { richTextToPlainText: value => value },
    "./AutomationEngineerWorkspace": { AutomationEngineerWorkspace: Workspace },
    "./AutomationSourceProposalReview": { AutomationSourceProposalReview: () => null },
    "../lib/automationActivityMonitoring": monitoring,
    "./AutomationAgentActivity.css": {}
  };
  const { AutomationAgentActivity } = load("../../frontend/components/AutomationAgentActivity.tsx", dependencies);
  const tree = AutomationAgentActivity({ projectId: "project", appTypeId: "app", caseId: "case", caseTitle: "Case", onStop: withStop ? id => stops.push(id) : undefined, stoppingActivityId });
  const nodes = [];
  const visit = node => {
    if (!React.isValidElement(node)) return;
    nodes.push(node);
    React.Children.forEach(node.props.children, visit);
  };
  visit(tree);
  const buttons = nodes.filter(node => node.type === "button");
  const button = text => buttons.find(node => React.Children.toArray(node.props.children).join("") === text);
  return { tree, html: renderToStaticMarkup(tree), button, stops, refetches, workspaces };
}

test("the cancellation API sends only an empty POST body to the encoded transaction route", async () => {
  const api = ts.createSourceFile("api.client.ts", source("../../../testing/frontend/api.client.ts"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const method = find(api, node => ts.isPropertyAssignment(node) && node.name.getText(api) === "cancelAutomationBuild");
  assert.ok(method);
  const calls = [];
  const cancel = new Function("request", transpile(`return (${method.initializer.getText(api)});`))((...args) => { calls.push(args); return Promise.resolve({ cancelled: true }); });
  await cancel("build/with space");
  assert.deepEqual(calls, [["/test-cases/automation/jobs/build%2Fwith%20space/cancel", { method: "POST", body: "{}" }]]);
});

test("Stop build targets only the current queued/running generator and disables during cancellation", () => {
  for (const status of ["queued", "running"]) {
    const fixture = activityFixture({ current: activity({ status }) });
    assert.equal(fixture.button("Stop build").props.disabled, false);
    fixture.button("Stop build").props.onClick();
    assert.deepEqual(fixture.stops, ["build"]);
  }
  const pending = activityFixture({ stoppingActivityId: "build" });
  assert.equal(pending.button("Stopping…").props.disabled, true);
  assert.equal(activityFixture({ stoppingActivityId: "other-build" }).button("Stop build").props.disabled, true);
  assert.equal(activityFixture({ current: activity({ action: "legacy", metadata: { agent_kind: "local-llm" } }) }).button("Stop build"), undefined);
});

test("the real scheduled batch producer metadata exposes Stop before worker execution", () => {
  const producer = ts.createSourceFile("batchProcess.service.js", source("../../../testing/backend/services/batchProcess.service.js"), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const queued = find(producer, node => ts.isObjectLiteralExpression(node) && node.properties.some(property =>
    ts.isPropertyAssignment(property) && property.name.getText(producer) === "action" && property.initializer.getText(producer) === '"batch_case_automation_build"'
  ));
  assert.ok(queued, "The actual AutomationPage batch producer remains covered");
  const action = queued.properties.find(property => property.name?.getText(producer) === "action");
  const metadata = queued.properties.find(property => property.name?.getText(producer) === "metadata");
  const actualProducerFields = new Function("test_case_ids", "selectedCaseCount", "verification_mode", "browser_driver", "verification_driver",
    `return { action: ${action.initializer.getText(producer)}, metadata: ${metadata.initializer.getText(producer)} };`
  )(["case"], 1, "generate_only", "mcp", "native");
  assert.equal(actualProducerFields.metadata.agent_kind, undefined, "Scheduled batch jobs have no worker-added local-llm marker");
  const fixture = activityFixture({ current: activity({ ...actualProducerFields, status: "queued", metadata: {
    ...actualProducerFields.metadata, scheduled_at: "2026-11-07T04:30:00.000Z"
  } }) });
  assert.ok(fixture.button("Stop build"));
  fixture.button("Stop build").props.onClick();
  assert.deepEqual(fixture.stops, ["build"]);
});

test("terminal, historical and unrelated activity never offer Stop build", () => {
  for (const status of ["completed", "failed", "pending", "cancelled"]) assert.equal(activityFixture({ current: activity({ status }) }).button("Stop build"), undefined);
  assert.equal(activityFixture({ selectedId: "older", previous: activity({ id: "older" }) }).button("Stop build"), undefined);
  assert.equal(activityFixture({ current: activity({ action: "another_job" }) }).button("Stop build"), undefined);
  assert.equal(activityFixture({ current: activity({ action: "batch_case_automation_build", metadata: { agent_activity: false, agent_kind: "local-llm" } }) }).button("Stop build"), undefined);
  assert.equal(activityFixture({ withStop: false }).button("Stop build"), undefined);
});

test("build and AI access are required both for the visible control and before its API call", async () => {
  for (const permission of ["automation.build", "automation.ai"]) {
    const fixture = activityFixture({ denied: [permission] });
    assert.equal(fixture.button("Stop build"), undefined);
    assert.match(fixture.html, /permissions are required/);
  }
  for (const access of [{ canUseAutomationBuilder: false }, { canUseAutomationAi: false }]) {
    const fixture = mutationFixture(access);
    await assert.rejects(fixture.options.mutationFn("build"), /automation.build and automation.ai/);
    assert.deepEqual(fixture.calls, []);
  }
});

test("stopped receipts override completed and prior failure labels while preserving source/evidence", () => {
  const retained = {
    cancelled: true, outcome_status: "incomplete", failed: 1, error: "Prior failure", retry_test_case_ids: ["case"],
    step_progress: [{ test_case_id: "case", step_id: "one", instruction_status: "saved", preview_artifact_id: "saved-preview" }],
    verification_by_case: { case: { status: "running", message: "Verifying saved instructions" } },
    workspace_application: { snapshot_artifact_id: "native-evidence" }, build_data_artifacts: { case: "build-data" }
  };
  const before = structuredClone(retained);
  const fixture = activityFixture({ current: activity({ status: "completed", metadata: retained }) });
  assert.match(fixture.html, /data-status="cancelled"/);
  assert.match(fixture.html, /Build stopped\. Saved sections and evidence retained\./);
  assert.match(fixture.html, /Verification stopped/);
  assert.doesNotMatch(fixture.html, /Instructions generated|Partially generated|The build could not finish|Retry 1 unfinished|Verifying saved instructions/);
  assert.equal(fixture.workspaces[0].stopped, true);
  assert.equal(fixture.workspaces[0].working, false);
  assert.equal(fixture.workspaces[0].incomplete, false);
  assert.equal(fixture.workspaces[0].steps[0].preview_artifact_id, "saved-preview");
  assert.equal(fixture.workspaces[0].application.snapshot_artifact_id, "native-evidence");
  assert.deepEqual(retained, before);
});

test("history summaries label cancelled builds Stopped without changing their persisted status", () => {
  const item = activity({ id: "older", status: "completed", cancelled: true });
  const fixture = activityFixture({ history: [item] });
  assert.match(fixture.html, /value="older"[^>]*>[^<]*Stopped<\/option>/);
  assert.equal(item.status, "completed");
});

test("a successful scoped stop refreshes activity, history and detail without changing saved drafts", async () => {
  const fixture = mutationFixture();
  const response = await fixture.options.mutationFn("build");
  await fixture.options.onSuccess(response, "build");
  assert.deepEqual(fixture.calls, ["build"]);
  assert.deepEqual(fixture.statuses, ["cancelled"]);
  assert.deepEqual(fixture.invalidated, [["automation-agent-activity"], ["automation-agent-history"], ["automation-agent-record"]]);
  assert.match(fixture.receipts[0], /Saved sections and evidence retained/);
});

test("a refreshed completed cancellation receipt remains Stopped and loads its retained saved Plan", async () => {
  const handler = find(page, node => ts.isVariableDeclaration(node) && node.name.getText(page) === "handleAutomationAgentActivity");
  const { automationSavedPlanReceipt } = load("../../frontend/lib/automationBuildTracking.ts");
  const statuses = [], retries = [], plans = [];
  const context = {
    projectId: "project", appTypeId: "app", selectedCaseId: "case", agentBuildStatus: "running",
    agentBuildTracking: { transactionId: "build", projectId: "project", caseIds: ["case"] }, latestAgentActivityRef: { current: null },
    setAgentBuildTracking: () => {}, setAgentBuildStatus: value => statuses.push(value), setAgentBuildReceipt: () => {},
    setAgentBuildOutputIds: () => {}, setAgentBuildRetryIds: value => retries.push(value), automationSavedPlanReceipt,
    handledAgentActivityRef: { current: new Set() }, refreshingAgentActivityRef: { current: new Set() },
    openGeneratedAutomationPlan: async (...args) => { plans.push(args); }, setAgentPlanRefreshError: () => {}, invalidateAutomationData: () => {},
    currentAutomationSelectionRef: { current: { projectId: "project", selectedCaseId: "case" } }
  };
  const onUpdate = new Function(...Object.keys(context), transpile(`return (${handler.initializer.getText(page)});`))(...Object.values(context));
  const receipt = activity({ status: "completed", metadata: {
    cancelled: true, outcome_status: "cancelled", input_test_case_ids: ["case"], output_test_case_ids: ["case"],
    retry_test_case_ids: ["case"], step_progress: [{ test_case_id: "case", step_id: "saved", instruction_status: "saved", preview_artifact_id: "retained-preview" }]
  } });
  const before = structuredClone(receipt);
  await onUpdate(receipt);
  assert.deepEqual(statuses, ["cancelled"]);
  assert.deepEqual(retries, [[]]);
  assert.deepEqual(plans, [["case", "project", ["case"], false]]);
  assert.deepEqual(receipt, before);
});

test("an already terminal build keeps its outcome and cancellation cannot alter a different active build", async () => {
  const finished = mutationFixture();
  await finished.options.onSuccess({ transaction_id: "build", status: "completed", cancelled: false }, "build");
  assert.deepEqual(finished.statuses, []);
  assert.match(finished.successes[0], /already finished/);
  const switched = mutationFixture({ agentBuildTracking: { transactionId: "new-build", projectId: "project" } });
  await switched.options.onSuccess({ cancelled: true }, "build");
  assert.deepEqual(switched.statuses, []);
});
