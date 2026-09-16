import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readSource = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

test("Create Module places the Requirement picker above Test Case selection in the right column", async () => {
  const [page, styles] = await Promise.all([
    readSource("../src/pages/TestCasesPage.tsx"),
    readSource("../src/components/create-module-modal.css")
  ]);

  const requirementPickerStart = page.indexOf("function ModuleRequirementPicker");
  const modalStart = page.indexOf("function TestCaseCreateModuleModal", requirementPickerStart);
  const modalEnd = page.indexOf("export function TestCasesPage", modalStart);
  const requirementPicker = page.slice(requirementPickerStart, modalStart);
  const modal = page.slice(modalStart, modalEnd);
  const leftColumnStart = modal.indexOf('className="test-case-create-module-details"');
  const rightColumnStart = modal.indexOf('className="test-case-create-module-picker"', leftColumnStart);
  const rightColumn = modal.slice(rightColumnStart);

  assert.ok(requirementPickerStart >= 0 && modalStart > requirementPickerStart && modalEnd > modalStart);
  assert.ok(leftColumnStart >= 0 && rightColumnStart > leftColumnStart);
  assert.ok(rightColumn.indexOf("<ModuleRequirementPicker") < rightColumn.indexOf('id="module-test-cases-heading"'));
  assert.match(rightColumn, /<ModuleRequirementPicker[\s\S]*candidateRequirements=\{candidateRequirements\}/);

  assert.match(requirementPicker, /Requirement Selection/);
  assert.match(requirementPicker, /test-case-create-module-picker-panel test-case-create-module-requirement-panel/);
  assert.match(requirementPicker, /Search Requirements by ID or title/);
  assert.match(requirementPicker, /Filter Requirements/);
  assert.match(requirementPicker, /Select all visible/);
  assert.match(requirementPicker, /Clear selected Requirements/);
  assert.match(requirementPicker, /Select all visible Requirements/);
  assert.match(requirementPicker, /Loading Requirements/);
  assert.match(requirementPicker, /<HierarchyAutoLoadSentinel[\s\S]*onLoad=\{onLoadMoreRequirements\}/);
  assert.doesNotMatch(requirementPicker, /Load more Requirements/);
  assert.match(requirementPicker, /<span role="columnheader">Requirement<\/span>[\s\S]*<span role="columnheader">Priority<\/span>[\s\S]*<span role="columnheader">Status<\/span>/);

  assert.match(styles, /\.test-case-create-module-requirement-panel\s*\{[^}]*height:\s*clamp\(340px, 43vh, 430px\)/);
  assert.match(styles, /\.test-case-create-module-requirement-toolbar\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) 42px auto/);
  assert.match(styles, /\.test-case-create-module-requirement-table-head,[\s\S]*\.test-case-create-module-requirement-option\s*\{[^}]*grid-template-columns:/);
  assert.match(styles, /@media \(max-width: 960px\)[\s\S]*\.test-case-create-module-requirement-panel/);
  assert.match(styles, /width:\s*min\(1480px, calc\(100vw - 32px\)\)/);
  assert.match(styles, /grid-template-columns:\s*clamp\(320px, 25vw, 380px\) minmax\(0, 1fr\)/);
});

test("Create Module loads project Requirements and persists their selected ids", async () => {
  const [page, api, types] = await Promise.all([
    readSource("../src/pages/TestCasesPage.tsx"),
    readSource("../src/lib/api.ts"),
    readSource("../src/types.ts")
  ]);

  assert.match(page, /type CreateModuleDraft = \{[\s\S]*requirementIds: string\[\]/);
  assert.match(page, /api\.requirements\.listPage\(\{[\s\S]*project_id: projectId,[\s\S]*projection: "summary"/);
  assert.match(page, /canSelectRequirements=\{canViewRequirements\}/);
  assert.match(page, /const moduleRequirementIds = canViewRequirements[\s\S]*draft\.requirementIds\.filter\(Boolean\)/);
  assert.match(page, /createTestCaseModule\.mutateAsync\(\{[\s\S]*requirement_ids: moduleRequirementIds/);
  assert.match(page, /isLocked=\{Boolean\(assignmentRetryName\)\}/);
  assert.match(api, /testCaseModules:[\s\S]*create: \(input: \{[^}]*requirement_ids\?: string\[\]/);
  assert.match(types, /export type TestCaseModule = \{[\s\S]*requirement_ids\?: string\[\]/);
});

test("selecting Requirements auto-selects every app-scoped linked Test Case without losing manual choices", async () => {
  const [page, api, styles] = await Promise.all([
    readSource("../src/pages/TestCasesPage.tsx"),
    readSource("../src/lib/api.ts"),
    readSource("../src/components/create-module-modal.css")
  ]);
  const modalStart = page.indexOf("function TestCaseCreateModuleModal");
  const modalEnd = page.indexOf("export function TestCasesPage", modalStart);
  const modal = page.slice(modalStart, modalEnd);
  const requirementHandlerStart = modal.indexOf("const handleRequirementSelectionChange");
  const manualHandlerStart = modal.indexOf("const updateCaseSelection", requirementHandlerStart);
  const requirementHandler = modal.slice(requirementHandlerStart, manualHandlerStart);

  assert.match(modal, /const \[manualSelectedCaseIds, setManualSelectedCaseIds\]/);
  assert.match(modal, /const \[excludedAutoCaseIds, setExcludedAutoCaseIds\]/);
  assert.match(modal, /const \[linkedCasesByRequirement, setLinkedCasesByRequirement\]/);
  assert.match(modal, /selectedRequirementIds\.flatMap\([\s\S]*linkedCasesByRequirement\[requirementId\]/);
  assert.match(modal, /const selectedIds = useMemo\(\(\) => \[\.\.\.new Set\(\[[\s\S]*manualSelectedCaseIds[\s\S]*activeAutoLinkedCaseIds/);
  assert.match(modal, /activeAutoLinkedCaseIds\.filter\(\(testCaseId\) => !excludedAutoCaseIdSet\.has\(testCaseId\)\)/);
  assert.match(modal, /candidateTestCases\.map[\s\S]*Object\.values\(linkedCasesByRequirement\)[\s\S]*byId\.set/);
  assert.match(modal, /onSelectionChange=\{handleRequirementSelectionChange\}/);
  assert.doesNotMatch(requirementHandler, /setManualSelectedCaseIds/);
  assert.match(modal, /<TestCasePicker[\s\S]*selectedIds=\{selectedIds\}[\s\S]*onChange=\{updateCaseSelection\}/);
  assert.match(modal, /current\.filter\(\(id\) => nextIdSet\.has\(id\)\)/);
  assert.match(modal, /activeAutoLinkedCaseIds\.filter\(\(id\) => !nextIdSet\.has\(id\)\)/);
  assert.match(modal, /setExcludedAutoCaseIds/);

  assert.match(modal, /Promise\.all\(batches\.map\(\(batch\) => onResolveRequirementCases\(batch\)\)\)/);
  assert.match(page, /api\.testCases\.resolveRequirementCases\(\{[\s\S]*app_type_id: appTypeId,[\s\S]*requirement_ids: requirementIds/);
  assert.match(api, /resolveRequirementCases: \(input: \{ app_type_id: string; requirement_ids: string\[\] \}\)[\s\S]*\/test-cases\/resolve-requirements/);
  assert.doesNotMatch(page, /MAX_CREATE_MODULE_CASES/);

  assert.match(modal, /const isResolvingRequirementCases/);
  assert.match(modal, /disabled=\{isSaving \|\| isResolvingRequirementCases\}/);
  assert.doesNotMatch(modal, /Linked cases are selected automatically/);
  assert.doesNotMatch(page, /onWheel(?:Capture)?=/);
  assert.doesNotMatch(page, /scrollModuleRecordList/);
  assert.match(modal, /disabled=\{isSaving[\s\S]*isResolvingRequirementCases[\s\S]*hasRequirementCaseResolutionError\}/);
  assert.match(modal, /testCaseIds: canAssignCases \? selectedIds : \[\]/);
  assert.match(styles, /\.test-case-create-module-auto-link-status\s*\{/);
  assert.match(styles, /\.test-case-create-module-auto-link-status\.is-error/);
  assert.match(styles, /\.test-case-create-module-options\s*\{[^}]*overscroll-behavior-y:\s*auto/);
  assert.match(styles, /\.test-case-create-module-picker\s*\{[^}]*overflow-y:\s*auto !important;[^}]*overscroll-behavior:\s*auto/);
});
