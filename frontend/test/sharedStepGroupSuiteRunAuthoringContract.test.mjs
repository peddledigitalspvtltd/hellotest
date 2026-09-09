import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readSource = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

test("Shared Step Groups preserve Structured and step-group Gherkin authoring without breaking reusable steps", async () => {
  const [page, gherkinGroupEditor, stepField, api, types, styles] = await Promise.all([
    readSource("../src/pages/SharedStepsPage.tsx"),
    readSource("../src/components/SharedStepGherkinEditor.tsx"),
    readSource("../src/components/GherkinStepTextField.tsx"),
    readSource("../src/lib/api.ts"),
    readSource("../src/types.ts"),
    readSource("../src/styles.css")
  ]);

  assert.match(page, /selectSharedGroupAuthoringMode/);
  assert.match(page, /structuredStepsToSharedGherkin/);
  assert.match(page, /sharedStepGherkinToStructuredSteps/);
  assert.match(page, /Shared Step Group authoring mode/);
  assert.match(page, /<SharedStepGherkinEditor/);
  assert.doesNotMatch(page, /<GherkinEditor/);
  assert.match(gherkinGroupEditor, /Reusable behavior group/);
  assert.match(gherkinGroupEditor, /SHARED_GHERKIN_KEYWORDS/);
  assert.doesNotMatch(gherkinGroupEditor, /Feature:|Scenario:/);
  assert.match(gherkinGroupEditor, /GherkinStepTextField/);
  assert.match(gherkinGroupEditor, /shared-gherkin-document-heading/);
  assert.match(gherkinGroupEditor, /Manage parameter values/);
  assert.match(gherkinGroupEditor, /composeSharedStepGherkin/);
  assert.match(gherkinGroupEditor, /Insert shared Gherkin step after/);
  assert.match(stepField, /StepParameterizedText/);
  assert.match(stepField, /mapStepParameterSegments/);
  assert.match(stepField, /!isEditing && hasParameters \? \(\s*<button[\s\S]*?gherkin-step-value-button[\s\S]*?<StepParameterizedText[\s\S]*?<\/button>\s*\) : <input/);
  assert.doesNotMatch(stepField, /gherkin-step-resolved-preview/);
  assert.match(gherkinGroupEditor, /useGherkinStepReorder/);
  assert.match(stepField, /gherkin-step-parameter-map/);
  assert.match(page, /authoring_mode: groupDraft\.authoring_mode/);
  assert.match(page, /composeSharedStepGherkin\(parseSharedStepGherkin\(groupDraft\.gherkin_document\)\)/);
  assert.match(page, /gherkin_document: gherkinDocument/);
  assert.match(page, /scopeLabels=\{\{ t: "Shared Step Group" \}\}/);
  assert.match(page, /title="Shared Step Group Params"/);
  assert.match(api, /authoring_mode\?: "structured" \| "gherkin"/);
  assert.match(types, /authoring_mode\?: "structured" \| "gherkin";[\s\S]*gherkin_document\?: string \| null/);
  assert.match(styles, /\.step-editor--shared \.step-card-menu--floating \{[\s\S]*position: relative/);
  assert.match(styles, /\.shared-gherkin-document-heading/);
  assert.match(styles, /\.shared-gherkin-step-row \{[\s\S]*?grid-template-columns: 5\.25rem minmax\(0, 1fr\) auto/);
  assert.match(page, /Duplicate selected steps/);
  for (const action of ["Insert above", "Insert below", "Paste above", "Paste below", "Copy step", "Cut step", "Delete step"]) {
    assert.match(page, new RegExp(action));
  }
});

test("suite and run creation filter against the selected metadata dimension", async () => {
  const [picker, catalogFilter, design, executions, styles] = await Promise.all([
    readSource("../src/components/SuiteCasePicker.tsx"),
    readSource("../src/components/CatalogSearchFilter.tsx"),
    readSource("../src/pages/DesignPage.tsx"),
    readSource("../src/pages/ExecutionsPage.tsx"),
    readSource("../src/styles.css")
  ]);

  for (const key of ["test-case", "module", "requirement", "label", "suite", "shared-step-group"]) {
    assert.match(picker, new RegExp(`"${key}"`));
  }
  assert.match(picker, /item\.metadata\[filterKey\]/);
  assert.match(picker, /availableFilterValues/);
  assert.match(picker, /<CatalogSearchFilter/);
  assert.match(picker, /filterIcon=\{<IconFilter/);
  assert.match(picker, /SUITE_CASE_FILTER_KEYS[^\n]+\["module", "requirement", "label", "shared-step-group"\]/);
  assert.match(picker, /RUN_SCOPE_FILTER_KEYS[^\n]+\["test-case", "module", "requirement", "label", "suite", "shared-step-group"\]/);
  assert.match(picker, /activeMetadataFilterCount/);
  assert.match(picker, /Metadata type/);
  assert.match(picker, /suite-reference-picker-filter-grid/);
  assert.match(picker, /Clear filters/);
  assert.match(picker, /associatedMetadata/);
  assert.match(picker, /matchingMetadataRecords/);
  assert.match(picker, /metadata\["test-case"\]/);
  assert.match(picker, /suite\.test_case_ids/);
  assert.match(picker, /testCase\.suite_ids/);
  assert.match(picker, /normalizeMetadataValue/);
  assert.doesNotMatch(picker, /suite-reference-picker-filters/);
  assert.match(catalogFilter, /<CatalogFilterIcon/);
  assert.match(catalogFilter, /filterIcon\?: ReactNode/);
  assert.match(catalogFilter, /filterIcon \|\| <CatalogFilterIcon/);
  assert.match(catalogFilter, /aria-haspopup="dialog"/);
  assert.match(design, /suitePickerMetadataByCaseId/);
  assert.match(design, /testCase\.module_ids/);
  assert.match(design, /module\.display_id/);
  assert.match(design, /ensure\(testCaseId\)\.suites/);
  assert.match(executions, /executionPickerMetadataByCaseId/);
  assert.match(executions, /testCase\.module_ids/);
  assert.match(executions, /module\.display_id/);
  assert.match(executions, /ensure\(testCaseId\)\.suites/);
  assert.doesNotMatch(executions, /Available run scope|Filter the run scope by test case, module, requirement, label, suite, or Shared Step Group metadata/);
  assert.match(styles, /\.suite-reference-picker-filter-footer/);
});

test("approved Suite, Module, and AI Agent artwork is centralized and reused", async () => {
  const [icons, tiles, shell, cases, agents] = await Promise.all([
    readSource("../src/components/AppIcons.tsx"),
    readSource("../src/components/TileCardPrimitives.tsx"),
    readSource("../src/components/AppShell.tsx"),
    readSource("../src/pages/TestCasesPage.tsx"),
    readSource("../src/pages/AgenticWorkflowsPage.tsx")
  ]);

  for (const asset of ["test-suite-icon.png", "module-icon.png", "ai-agents-icon.png"]) assert.match(icons, new RegExp(asset.replace(".", "\\.")));
  assert.match(tiles, /<TestSuiteIcon size=\{18\}/);
  assert.match(shell, /icon: AiAgentsIcon/);
  assert.match(shell, /case "suites":[\s\S]*return TestSuiteIcon/);
  assert.match(cases, /test-case-create-module-title-icon"><ModuleIcon/);
  assert.match(agents, /ai-agent-specialist-card__icon"><AiAgentsIcon/);
});
