import { sourceFile } from "./helpers/sourceFile.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const repositoryExports = {};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../../../automation/frontend/lib/repositoryEntries.ts', import.meta.url), 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText, {exports:repositoryExports});

const queryOwners = {
  Cases: new URL('../../../automation/frontend/workspaces/cases/useAutomationCasesQueries.ts', import.meta.url),
  Detail: new URL('../../../automation/frontend/workspaces/case/useAutomationCaseModel.tsx', import.meta.url),
  Repository: new URL('../../../automation/frontend/workspaces/repository/useRepositoryWorkspaceQueries.ts', import.meta.url)
};
const keyExports = {};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../../../automation/frontend/lib/automationQueryKeys.ts', import.meta.url), 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText, {exports:keyExports});
function queryOptions(page, name, values = {}) {
  const source = ts.createSourceFile(page, readFileSync(queryOwners[page] || sourceFile(`${page}.tsx`, "pages"), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name && ts.isCallExpression(node.initializer)) expression = node.initializer.arguments[0].getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(expression, `Missing production query ${name}`);
  const code = ts.transpileModule(`globalThis.options = (${expression});`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const context = vm.createContext({ session: {}, projectId: "project", appTypeId: "app", view: "cases", selectedCaseId: "case", selectedTransactionId: "transaction", selectedTransactionStatus: "running", selectedTransactionIsRunning: true, needsAutomationEditorData: false, needsAutomationRepository: false, isSharedGroupLibraryOpen: false, isInspectOpen: false, api: {}, AUTOMATION_CASE_DETAIL_STALE_TIME_MS: 60000, automationQueryKeys: keyExports.automationQueryKeys, canViewTestData: true, canViewExecutionMetrics: true, canViewObjectRepository: true, activeAutomationWorkspaceTab: "runs", automatedStepsQuery: {data: []}, asArray: value => Array.isArray(value) ? value : [], collectRepositoryPages: repositoryExports.collectRepositoryPages, ...values });
  vm.runInContext(code, context);
  return context.options;
}

test("Automation routes load independent query owners and the catalog defers editor-only data", () => {
  const host = readFileSync(sourceFile('AutomationPage.tsx', 'pages'), 'utf8');
  for (const route of ['AutomationCasesPage', 'AutomationCaseDetailPage', 'ObjectRepositoryPage']) {
    assert.match(host, new RegExp(`lazy\\(\\(\\) => import\\('\\.\\./routes/${route}'\\)`));
  }
  assert.doesNotMatch(host, /useAutomation(?:Cases|CaseDetail|Repository).*Controller/);
  for (const owner of ['Cases', 'Detail']) {
    for (const name of ["suitesQuery", "requirementsQuery", "modulesQuery", "testDataSetsQuery"]) {
      assert.equal(queryOptions(owner, name).enabled, false, `${owner}/${name}`);
      assert.equal(queryOptions(owner, name, { needsAutomationEditorData: true }).enabled, true, `${owner}/${name}`);
    }
  }
  assert.equal(queryOptions("Detail", "learningCacheQuery").enabled, false);
  assert.equal(queryOptions("Detail", "learningCacheQuery", { needsAutomationRepository: true }).enabled, true);
  assert.equal(queryOptions("Repository", "learningCacheQuery").enabled, true);
  assert.equal(queryOptions("Repository", "learningCacheQuery", { canViewObjectRepository: false }).enabled, false);
  const repository = readFileSync(queryOwners.Repository, 'utf8');
  assert.doesNotMatch(repository, /api\.(testSuites|executionResults|testSteps|requirements|testDataSets)\./);
  assert.equal(queryOptions("Detail", "sharedStepGroupsQuery").enabled, false);
  assert.equal(queryOptions("Detail", "sharedStepGroupsQuery", { isSharedGroupLibraryOpen: true }).enabled, true);
});

test("repository pagination stops on navigation cancellation instead of fetching every remaining page", async () => {
  const controller = new AbortController();
  let requests = 0;
  const query = queryOptions("Detail", "learningCacheQuery", {
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
    assert.equal(queryOptions("TestOpsPage", name, { view: "traces", canViewBackgroundJobs: true, canUseBatchProcesses: false }).enabled, false, name);
  }
  for (const name of ["transactionEventsQuery", "transactionArtifactsQuery"]) {
    const active = queryOptions("TestOpsPage", name, { view: "batch-process", canViewBackgroundJobs: true, canUseBatchProcesses: false });
    const terminal = queryOptions("TestOpsPage", name, { view: "batch-process", canViewBackgroundJobs: true, canUseBatchProcesses: false, selectedTransactionStatus: "completed", selectedTransactionIsRunning: false });
    assert.equal(active.enabled, true);
    assert.equal(active.refetchInterval, 15_000);
    assert.equal(terminal.enabled, true);
    assert.equal(terminal.refetchInterval, false);
    assert.notDeepEqual([...active.queryKey], [...terminal.queryKey], "Completion fetches the final events/artifacts before polling stops");
  }
});

test("Automation keeps catalog and history evidence compact, and fetches history only on Runs", async () => {
  const calls = [];
  const api = { executionResults: { list: async (query, options) => { calls.push({ query, options }); return []; } } };
  const signal = new AbortController().signal;
  await queryOptions("Cases", "executionResultsQuery", { api }).queryFn({ signal });
  await queryOptions("Detail", "selectedCaseHistoryQuery", { api, selectedAutomationCaseDetail: { id: "case" } }).queryFn({ signal });
  assert.equal(calls[0].query.projection, "summary");
  assert.equal(calls[1].query.test_case_id, "case");
  assert.equal(calls[1].query.projection, "summary");
  assert.equal(queryOptions("Detail", "selectedCaseHistoryQuery", {selectedAutomationCaseDetail: {id: "case"}, activeAutomationWorkspaceTab: "build"}).enabled, false);
  assert.equal(queryOptions("Detail", "selectedCaseHistoryQuery", {selectedAutomationCaseDetail: {id: "case"}, activeAutomationWorkspaceTab: "runs"}).enabled, true);
  assert.equal(calls[0].options.signal, signal);
  assert.equal(calls[1].options.signal, signal);
});
