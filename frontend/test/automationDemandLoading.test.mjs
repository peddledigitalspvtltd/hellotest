import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

function queryOptions(page, name, values = {}) {
  const source = ts.createSourceFile(page, readFileSync(new URL(`../src/pages/${page}.tsx`, import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name && ts.isCallExpression(node.initializer)) expression = node.initializer.arguments[0].getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(expression, `Missing production query ${name}`);
  const code = ts.transpileModule(`globalThis.options = (${expression});`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const context = vm.createContext({ session: {}, projectId: "project", appTypeId: "app", view: "cases", selectedCaseId: "case", selectedTransactionId: "transaction", selectedTransactionStatus: "running", selectedTransactionIsRunning: true, needsAutomationEditorData: false, needsAutomationRepository: false, isSharedGroupLibraryOpen: false, isInspectOpen: false, api: {}, ...values });
  vm.runInContext(code, context);
  return context.options;
}

test("Automation catalog defers editor data and repository pages until those surfaces open", () => {
  for (const name of ["suitesQuery", "requirementsQuery", "modulesQuery", "testDataSetsQuery"]) {
    assert.equal(queryOptions("AutomationPage", name).enabled, false, name);
    assert.equal(queryOptions("AutomationPage", name, { needsAutomationEditorData: true }).enabled, true, name);
  }
  assert.equal(queryOptions("AutomationPage", "learningCacheQuery").enabled, false);
  assert.equal(queryOptions("AutomationPage", "learningCacheQuery", { needsAutomationRepository: true }).enabled, true);
  assert.equal(queryOptions("AutomationPage", "testCasesQuery", { view: "repository" }).enabled, false);
  assert.equal(queryOptions("AutomationPage", "executionResultsQuery", { view: "repository" }).enabled, false);
  assert.equal(queryOptions("AutomationPage", "sharedStepGroupsQuery").enabled, false);
  assert.equal(queryOptions("AutomationPage", "sharedStepGroupsQuery", { isSharedGroupLibraryOpen: true }).enabled, true);
});

test("repository pagination stops on navigation cancellation instead of fetching every remaining page", async () => {
  const controller = new AbortController();
  let requests = 0;
  const query = queryOptions("AutomationPage", "learningCacheQuery", {
    REPOSITORY_PAGE_SIZE: 2,
    api: { testCases: { learningCache: async (scope, options) => {
      assert.equal(scope.offset, 0);
      assert.equal(options.signal, controller.signal);
      requests += 1;
      controller.abort();
      return [{ id: "first" }, { id: "second" }];
    } } }
  });
  await assert.rejects(query.queryFn({ signal: controller.signal }), { name: "AbortError" });
  assert.equal(requests, 1);
});

test("TestOps traces avoid batch queries and final transaction records stop polling", () => {
  for (const name of ["appTypesQuery", "integrationsQuery", "transactionsQuery", "transactionEventsQuery", "transactionArtifactsQuery"]) {
    assert.equal(queryOptions("TestOpsPage", name, { view: "traces", canUseBatchProcesses: true }).enabled, false, name);
  }
  for (const name of ["transactionEventsQuery", "transactionArtifactsQuery"]) {
    const active = queryOptions("TestOpsPage", name, { view: "batch-process", canUseBatchProcesses: true });
    const terminal = queryOptions("TestOpsPage", name, { view: "batch-process", canUseBatchProcesses: true, selectedTransactionStatus: "completed", selectedTransactionIsRunning: false });
    assert.equal(active.enabled, true);
    assert.equal(active.refetchInterval, 15_000);
    assert.equal(terminal.enabled, true);
    assert.equal(terminal.refetchInterval, false);
    assert.notDeepEqual([...active.queryKey], [...terminal.queryKey], "Completion fetches the final events/artifacts before polling stops");
  }
});

test("Automation fetches compact catalog evidence and full evidence only for the selected case", async () => {
  const calls = [];
  const api = { executionResults: { list: async (query, options) => { calls.push({ query, options }); return []; } } };
  const signal = new AbortController().signal;
  await queryOptions("AutomationPage", "executionResultsQuery", { api }).queryFn({ signal });
  await queryOptions("AutomationPage", "selectedCaseHistoryQuery", { api, selectedAutomationCaseDetail: { id: "case" } }).queryFn({ signal });
  assert.equal(calls[0].query.projection, "summary");
  assert.equal(calls[1].query.test_case_id, "case");
  assert.equal(calls[1].query.projection, undefined);
  assert.equal(calls[0].options.signal, signal);
  assert.equal(calls[1].options.signal, signal);
});
