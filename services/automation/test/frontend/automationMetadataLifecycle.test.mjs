import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { mapCaseHooksToExecutionHooks, mapExecutionHooksToRunHooks } from "../../../testing/frontend/lib/runHooks.ts";
import { caseParameterSaveOptions } from "../../../platform/frontend/src/shared/lib/parameterPrivacy.ts";
import { applyAutomationStepOptions, parseAutomationStepOptions } from "../../frontend/lib/automationStepOptions.ts";

const transpile = (source) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const helpers = {};
new Function("exports", transpile(readFileSync(new URL("../../frontend/lib/automationMetadataDraft.ts", import.meta.url), "utf8")))(helpers);
const page = readFileSync(new URL("../../frontend/pages/AutomationPage.tsx", import.meta.url), "utf8");
const effectStart = page.indexOf("  useEffect(() => {\n    if (!selectedCaseId) {\n      if (lastAutomationCaseDraftSeedRef.current)") + "  useEffect(".length;
const effectEnd = page.indexOf("\n  }, [activeCase, projectId, selectedCaseId]);", effectStart) + "\n  }".length;
const effectScript = transpile(`const effect = ${page.slice(effectStart, effectEnd)};`);

function metadataFixture() {
  const state = {};
  const lastAutomationCaseDraftSeedRef = { current: null };
  const setters = Object.fromEntries(["CaseDraft", "TestCaseParameterValues", "SuiteLinkDraftIds", "CaseRequirementIds", "CaseModuleIds", "CaseDataSetId", "AutomationManualLinkDraftIds", "SelectedExecutionDataSetId", "OverrideSharedSteps", "ExecutionHookDraft"].map((key) => [`set${key}`, (value) => { state[key] = typeof value === "function" ? value(state[key]) : value; }]));
  const refresh = (activeCase) => {
    const context = { mapExecutionHooksToRunHooks, activeCase, selectedCaseId: activeCase?.id || "", projectId: "project", lastAutomationCaseDraftSeedRef, ...setters, ...helpers, normalizeAutomationParameterValues: (value) => value || {}, formatParameterText: (value) => JSON.stringify(value || {}) };
    new Function(...Object.keys(context), `${effectScript}\neffect();`)(...Object.values(context));
  };
  return { state, refresh };
}

test("step-save and AI refetch preserve unsaved metadata while updating pristine fields", () => {
  const { state, refresh } = metadataFixture();
  const original = { id: "case", title: "Original", description: "Old description", revision: 1, priority: 3, status: "active", parameter_values: { "t.user": "saved", "t.locale": "en" }, suite_ids: ["suite"], requirement_ids: ["story"], module_ids: ["module"], test_data_set_ids: ["data"], manual_test_case_ids: ["manual"] };
  refresh(original);
  state.CaseDraft = { ...state.CaseDraft, title: "Unsaved title" };
  state.TestCaseParameterValues = { ...state.TestCaseParameterValues, "t.user": "unsaved" };
  state.CaseRequirementIds = ["new-story"];
  state.CaseModuleIds = ["failed-module-link"];
  state.SuiteLinkDraftIds = ["new-suite"];
  state.CaseDataSetId = "new-data";
  state.AutomationManualLinkDraftIds = ["new-manual"];
  state.SelectedExecutionDataSetId = "run-data";
  state.ExecutionHookDraft = [{id:'pending-hook',hookType:'BEFORE_TEST',itemType:'test',itemId:'setup',name:'Pending setup'}];
  refresh({ ...original, revision: 2, description: "Updated remotely", parameter_values: { "t.user": "saved", "t.locale": "fr" } });
  assert.equal(state.CaseDraft.title, "Unsaved title");
  assert.equal(state.CaseDraft.description, "Updated remotely");
  assert.deepEqual(state.TestCaseParameterValues, { "t.user": "unsaved", "t.locale": "fr" });
  assert.deepEqual(state.CaseRequirementIds, ["new-story"]);
  assert.deepEqual(state.CaseModuleIds, ["failed-module-link"]);
  assert.deepEqual(state.SuiteLinkDraftIds, ["new-suite"]);
  assert.deepEqual(state.AutomationManualLinkDraftIds, ["new-manual"]);
  assert.equal(state.CaseDataSetId, "new-data");
  assert.equal(state.SelectedExecutionDataSetId, "run-data");
  assert.equal(state.ExecutionHookDraft[0].itemId,'setup','A step save must not discard an unsaved setup selection.');
  refresh({ id: "other-case", title: "Another case", revision: 1 });
  assert.equal(state.CaseDraft.title, "Another case");
  assert.deepEqual(state.CaseModuleIds, []);
  assert.deepEqual(state.ExecutionHookDraft, [],'A different case cannot inherit the previously selected case setup.');
});

test("metadata refresh keeps explicit parameter deletions and accepts newly saved defaults", () => {
  assert.deepEqual(helpers.mergeAutomationMetadataFields({ a: "edited" }, { a: "old", removed: "value" }, { a: "remote", removed: "value", new: "default" }), { a: "edited", new: "default" });
});

test("module or suite failure after metadata save returns success and refreshes the case revision for retry", async () => {
  const start = page.indexOf("  const updateAutomationCase = useMutation({");
  const fnStart = page.indexOf("mutationFn:", start) + "mutationFn:".length;
  const fnEnd = page.indexOf("\n    onSuccess:", fnStart);
  const successStart = fnEnd + "\n    onSuccess:".length;
  const successEnd = page.indexOf("\n    onError:", successStart);
  const invalidated = [];
  const warnings = [];
  const context = {
    mapCaseHooksToExecutionHooks, executionHookDraft:[], caseParameterSaveOptions, visiblePrivateNames: new Set(),
    caseParameterOverrideDraftRef: {current: {scope: "project:case", names: new Set()}}, caseParameterPrivacyScope: "project:case",
    canViewTestData: true, overrideSharedSteps: true, session: {user:{id:"author"}}, hasPermission:()=>true,
    canUseAutomationBuilder: true, canUpdateAutomationCase: true, isAutomationCaseDetailReady: true,
    activeCase: { id: "case", revision: 4, module_ids: [] },
    caseDraft: { title: "Saved title", description: "", status: "active", priority: "3", parameterText: "" },
    testCaseParameterValues: {}, suiteLinkDraftIds: ["suite"], caseRequirementIds: [], caseModuleIds: ["module"], caseDataSetId: "", automationManualLinkDraftIds: [],
    selectedParameterSuite: { id: "suite" }, suiteParameterValues: { "s.tenant": "unsaved" }, automationModules: [],
    normalizeAutomationParameterValues: (values) => values, parseParameterText: () => ({}),
    api: { testCases: { update: async () => ({ id: "case", revision: 5 }) }, testCaseModules: { assignCases: async () => { throw new Error("offline"); } }, testSuites: { update: async () => { throw new Error("offline"); } } },
    projectId: "project", automationCaseDetailQueryKey: (...args) => ["test-case-detail", ...args],
    queryClient: { invalidateQueries: async ({ queryKey }) => { invalidated.push(queryKey); } },
    showError: (error) => warnings.push(error.message), showSuccess: () => {}
  };
  const script = transpile(`const mutation = ${page.slice(fnStart, fnEnd).trim().replace(/,$/, "")}; const onSuccess = ${page.slice(successStart, successEnd).trim().replace(/,$/, "")};`);
  const { mutation, onSuccess } = new Function(...Object.keys(context), `${script}\nreturn { mutation, onSuccess };`)(...Object.values(context));
  const result = await mutation();
  assert.equal(result.response.revision, 5);
  assert.equal(result.followUpFailures.length, 2);
  await onSuccess(result);
  assert.ok(invalidated.some((key) => key[0] === "test-case-detail" && key[2] === "case"));
  assert.ok(invalidated.some((key) => key[0] === "test-case-modules"));
  assert.match(warnings[0], /Case details were saved/);
});


test("revoked case-update access stops an automation metadata write before any API call", async () => {
  const start = page.indexOf("  const updateAutomationCase = useMutation({");
  const fnStart = page.indexOf("mutationFn:", start) + "mutationFn:".length;
  const fnEnd = page.indexOf("\n    onSuccess:", fnStart);
  const script = transpile(`const mutation = ${page.slice(fnStart, fnEnd).trim().replace(/,$/, "")};`);
  const mutation = new Function("canUpdateAutomationCase", `${script}\nreturn mutation;`)(false);
  await assert.rejects(mutation(), /Test Case update permissions are required/);
});

test('saved section options only come from a leading metadata comment',()=>{
 assert.equal(parseAutomationStepOptions({automation_code:'await web.fill("Hint", "// @hellotest-options skip");'}).skip,false);
 assert.deepEqual(parseAutomationStepOptions({automation_code:'// @hellotest-options skip optional screenshotOnFailure\r\nawait web.click("Submit");'}),{skip:true,optional:true,screenshotOnFailure:true});
});

test('shared section options replace only metadata while preserving full program structure',()=>{
 const program='import { test } from "@playwright/test";\n\ntest.beforeEach(async () => { await setup(); });\ntest("flow", async ({ page }) => {\n  await page.goto("/");\n});';
 const updated=applyAutomationStepOptions(`// @hellotest-options optional\n${program}`,{skip:true,optional:false,screenshotOnFailure:true});
 assert.equal(updated,`// @hellotest-options screenshotOnFailure skip\n${program}`);
 assert.equal(applyAutomationStepOptions(updated,{skip:false,optional:false,screenshotOnFailure:false}),program);
});
