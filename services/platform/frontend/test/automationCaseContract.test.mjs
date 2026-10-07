import { readApiSources } from "./helpers/readApiSources.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readSource = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

test("automation authoring is a dedicated case workflow with complete build surfaces", async () => {
  const page = await readSource("../../../automation/frontend/pages/AutomationPage.tsx");

  for (const capability of [
    "Create automation case",
    "Build with automation agent",
    "Schedule builds",
    "Record flow",
    "Author steps",
    "AutomationOverlay",
    "Generate from your saved behavior",
    "Complete automation code",
    "Insert Shared Step Group",
    "Edit instructions"
  ]) {
    assert.match(page, new RegExp(capability));
  }

  assert.match(page, /manual_test_case_id: metadata\.manualCaseIds\[0\] \|\| null/);
  assert.match(page, /manual_test_case_ids: metadata\.manualCaseIds/);
  assert.match(page, /seedAutomationPlan\(sources/);
  assert.match(page, /Build instructions \(optional\)/);
  assert.match(page, /target_step_id: origin\.targetStepId \|\| undefined/);
  assert.match(page, /code=\{completeAutomationCode\}/);
  assert.match(page, /Automation mapping needed/);
  assert.match(page, /<DetailSectionTabs/);
  assert.match(page, /<AutomationRunReviewDialog/);
  assert.match(page, /const automationActionTargetIds = selectedAutomationActionTargetIds;/);
  assert.match(page, /inspectSavedPlans\(request\.caseIds\)/);
  assert.match(page, /retrySavedAutomationRun\(pendingRemoteRun/);
});

test("manual cases expose linked automation without merging the records", async () => {
  const page = await readSource("../../../testing/frontend/pages/TestCasesPage.tsx");

  assert.match(page, /testCase\.manual_test_case_ids\?\.includes\(selectedTestCaseId\)/);
  assert.match(page, /label: "Automation Cases"/);
  assert.match(page, /`\/automation\?case=\$\{encodeURIComponent\(automationCase\.display_id \|\| automationCase\.id\)\}`/);
  assert.match(page, /`\/automation\?create=1&manual=\$\{encodeURIComponent\(selectedTestCase\.id\)\}`/);
  assert.doesNotMatch(page, /AI map existing automation/);
  assert.doesNotMatch(page, /Schedule AI automation/);
  assert.match(page, /showAutomationTools=\{false\}/);
  assert.match(page, /showRecorderTools=\{false\}/);
});

test("test cases distinguish authored parameters from row-level execution data", async () => {
  const [page, types, api] = await Promise.all([
    readSource("../../../testing/frontend/pages/TestCasesPage.tsx"),
    readSource("../src/types.ts"),
    readApiSources()
  ]);

  assert.match(page, /label="Test case type"/);
  assert.match(page, /label="Author"/);
  assert.match(page, /title=\{caseDraft\.authoring_mode === "gherkin" \? "Examples · Linked Test Data" : "Data Sets"\}/);
  const panel = await readSource("../src/platform/components/AuthoringDataSetPanel.tsx");
  const picker = await readSource("../../../testing/frontend/components/TestDataSetPickerDialog.tsx");
  assert.match(picker, /Every table row becomes an independent execution iteration/);
  assert.match(panel, /No Data Sets Defined/);
  assert.match(panel, /Create Data Set/);
  assert.match(panel, /Link Existing Data Set/);
  assert.match(page, /test_data_set_ids: linkedDataSetDraftIds\.slice\(0, 1\)/);
  assert.match(page, /setLinkedDataSetDraftIds\(\[dataSetLinkDraftId\]\)/);
  assert.match(types, /data_set_iteration_index\?: number \| null/);
  assert.match(api, /test_data_set_ids\?: string\[\]/);
});

test("automation workspace shares one editable plan across agent, recording, and playback", async () => {
  const page = await readSource("../../../automation/frontend/pages/AutomationPage.tsx");

  for (const capability of ["AutomationCaseMetadata", "Automation step plan", "Preconditions", "Build step plan", "Save recording to plan", "Play saved plan", "Execution profile"]) {
    assert.match(page, new RegExp(capability));
  }
  assert.match(page, /result\.data_set_iteration_index/);
  assert.match(page, /result\.data_set_row_snapshot/);
});

test("blank automation authoring uses focused Test Case tabs and platform-aware behaviour steps", async () => {
  const [page, editor, engine, pipeline] = await Promise.all([
    readSource("../../../automation/frontend/pages/AutomationPage.tsx"),
    readSource("../../../automation/frontend/components/StepAutomationEditor.tsx"),
    readSource("../../../../testengine/backend/src/lib/webEngine.ts"),
    readSource("../../../../testengine/backend/src/lib/pipeline.ts")
  ]);

  assert.match(page, /<DetailSectionTabs/);
  for (const tab of ["Details", "Plan", "Test Data", "Before \/ After", "Build tools", "Objects", "Runs"]) {
    assert.match(page, new RegExp(`label: "${tab}"`));
  }
  for (const platform of ["web", "api", "android", "ios"]) {
    assert.match(page, new RegExp(`"${platform}"`));
  }
  assert.doesNotMatch(page, /automation-gherkin-keyword/);
  assert.doesNotMatch(page, /<select[^>]*value=\{draft\.behaviorKeyword\}/);
  assert.match(page, /<AutomationRepositoryFieldPicker/);
  assert.match(page, /spec\.showValue \?/);
  assert.match(page, /<AutomationParameterInput/);
  assert.match(page, /HTTP method/);
  assert.match(page, /Request settings, parameters &amp; validation|Request settings, parameters & validation/);
  assert.match(page, /buildAutomationApiRequest/);
  assert.match(page, /<StepAutomationDialog/);
  assert.match(page, /const openInstructionEditor = \(\) => \{/);
  assert.match(page, /buildAutomationEditorStep\(\{[\s\S]*?step, draft, currentCode: sourceCode/);
  assert.match(page, /onClick=\{openInstructionEditor\}[^>]*>Request settings/);
  assert.match(page, /canViewAutomationCode \? <AutomationInstructionPreview/);
  assert.match(page, /test_environment_id: selectedExecutionEnvironmentId \|\| undefined/);
  assert.match(page, /test_configuration_id: selectedExecutionConfigurationId \|\| undefined/);
  assert.match(page, /test_data_set_id: selectedExecutionDataSetId \|\| undefined/);
  assert.match(editor, /AutomationReferencedParameters/);
  assert.match(editor, /<details[^>]*className="automation-request-details automation-editor-section"/);
  assert.match(editor, /testingApi\.testSteps\.runApiRequest/);
  assert.match(editor, /const AUTHORING_STEP_TYPE_OPTIONS = STEP_TYPE_OPTIONS/);
  assert.match(page, /"web\.drag"/);
  assert.match(engine, /async drag\(source: string, destination: string/);
  assert.match(pipeline, /"drag"/);
});

test("object repository inspection keeps locator capture focused, bounded, and explainable", async () => {
  const [page, recorder, styles] = await Promise.all([
    readSource("../../../automation/frontend/pages/AutomationPage.tsx"),
    readSource("../../../../testengine/backend/src/lib/recorder.ts"),
    readSource("../src/styles.css")
  ]);

  assert.match(page, /<h2>HelloTest Live builder<\/h2>/);
  assert.match(page, /Hide Page Object properties/);
  assert.match(page, /Show Page Object properties/);
  assert.doesNotMatch(page, /Focus browser workspace/);
  assert.match(page, /label: "All fields"/);
  assert.match(page, /label: "Selected"/);
  assert.match(page, /Highlighted · 1s/);
  assert.match(page, /validateInspectedFields\.mutate\(\)/);
  assert.match(page, /"Validate"/);
  assert.match(page, /object-repository-selected-editor/);
  assert.match(page, /inspect\/validate/);
  assert.match(page, /validationStatus !== "unique"/);
  assert.match(page, /screenScreenshotUrl: pendingCapture\.screen_screenshot_url/);
  assert.match(page, /screenDom: pendingCapture\.screen_dom/);
  assert.match(page, /Save screen & fields/);
  assert.match(page, /aria-label="Page Object properties"/);
  assert.doesNotMatch(page, /aria-label="Screen capture bundle"/);
  assert.match(page, /screen_dom_compressed: effectiveScreenDom/);
  assert.match(page, /screen_screenshot_url: effectiveScreenScreenshot/);
  assert.match(page, /accessibility_tree: effectiveAccessibilityTree/);
  assert.match(page, /useDeferredValue\(screenDomDraft\)/);
  assert.match(page, /inspectPollInFlightRef/);
  assert.match(page, /tabRefreshInFlightRef/);
  assert.match(page, /repairInspectedFieldWithAi/);
  assert.match(page, /reinspectField/);
  assert.match(page, /dismissInspectField/);
  assert.match(page, /Restore hidden/);
  assert.match(page, /const queryScope = appTypeId/);
  assert.doesNotMatch(page, /Repository signals are healthy/);
  assert.doesNotMatch(page, /Inspect a control to keep its selected locator visible here/);
  assert.doesNotMatch(page, /Opened.*browser for repository inspection/);
  assert.match(styles, /object-repository-browser-locator-dock/);
  assert.match(styles, /object-repository-inspector\.is-browser-maximized/);
  assert.match(styles, /grid-template-columns: minmax\(0, 1fr\) clamp\(20rem, 27vw, 26rem\)/);
  assert.match(recorder, /REPOSITORY_HIGHLIGHT_DURATION_MS = 1_000/);
  assert.match(recorder, /outline = "1px solid #2f6df6"/);
  assert.match(recorder, /lastHoveredElement/);
  assert.match(recorder, /sessions\/:id\/inspect\/validate/);
  assert.match(recorder, /captureValidatedRepositoryLocator/);
  assert.match(recorder, /matchCount !== 1/);
  assert.match(recorder, /screen_screenshot_url/);
  assert.match(recorder, /id="addressToggle"/);
  assert.match(recorder, /id="typeToggle"/);
  assert.match(recorder, /class="action-panel" id="actionPanel" hidden/);
  assert.match(recorder, /class="more-controls"/);
  assert.match(recorder, /ancestor_dom/);
  assert.match(recorder, /removeAttribute\("value"\)/);
  assert.match(recorder, /requestAnimationFrame/);
  assert.match(recorder, /matchCount/);
  assert.match(recorder, /stabilitySignals/);
  assert.match(recorder, /ID appears generated and may change between builds/);
});
