import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readSource = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

test("automation authoring is a dedicated case workflow with complete build surfaces", async () => {
  const page = await readSource("../src/pages/AutomationPage.tsx");

  for (const capability of [
    "Create automation case",
    "AI map existing automation",
    "Schedule AI automation",
    "Build with AI",
    "Inspect & record",
    "Start blank",
    "Build studio",
    "Retrieve automation code",
    "Insert shared group",
    "Edit automation"
  ]) {
    assert.match(page, new RegExp(capability));
  }

  assert.match(page, /manual_test_case_id: source\?\.id \|\| null/);
  assert.match(page, /manual_test_case_ids: automationCreateManualCaseIds/);
  assert.match(page, /Agent mission control/);
  assert.match(page, /target_step_id: recordingTargetStepId \|\| undefined/);
  assert.match(page, /buildCaseAutomationCode\(activeCase\.title, automatedSteps\)/);
});

test("manual cases expose linked automation without merging the records", async () => {
  const page = await readSource("../src/pages/TestCasesPage.tsx");

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
    readSource("../src/pages/TestCasesPage.tsx"),
    readSource("../src/types.ts"),
    readSource("../src/lib/api.ts")
  ]);

  assert.match(page, /label="Test case type"/);
  assert.match(page, /label="Author"/);
  assert.match(page, /title="Data Sets"/);
  assert.match(page, /Every table row becomes a separate execution instance/);
  assert.match(page, /Create and link/);
  assert.match(page, /test_data_set_ids: linkedDataSetDraftIds/);
  assert.match(types, /data_set_iteration_index\?: number \| null/);
  assert.match(api, /test_data_set_ids\?: string\[\]/);
});

test("automation workspace presents a governed lifecycle and iteration evidence", async () => {
  const page = await readSource("../src/pages/AutomationPage.tsx");

  for (const capability of ["Automation delivery", "Data & profiles", "Repository", "Runs & debug", "Configure run profile"]) {
    assert.match(page, new RegExp(capability));
  }
  assert.match(page, /result\.data_set_iteration_index/);
  assert.match(page, /result\.data_set_row_snapshot/);
});

test("object repository inspection keeps locator capture focused, bounded, and explainable", async () => {
  const [page, recorder, styles] = await Promise.all([
    readSource("../src/pages/AutomationPage.tsx"),
    readSource("../../testengine/backend/src/lib/recorder.ts"),
    readSource("../src/styles.css")
  ]);

  assert.match(page, /Maximize browser workspace/);
  assert.match(page, /Selected locators/);
  assert.match(page, /Highlighted · 3s/);
  assert.match(page, /inspectPollInFlightRef/);
  assert.match(page, /tabRefreshInFlightRef/);
  assert.match(styles, /object-repository-browser-locator-dock/);
  assert.match(styles, /object-repository-inspector\.is-browser-maximized/);
  assert.match(recorder, /REPOSITORY_HIGHLIGHT_DURATION_MS = 3_000/);
  assert.match(recorder, /requestAnimationFrame/);
  assert.match(recorder, /matchCount/);
  assert.match(recorder, /stabilitySignals/);
  assert.match(recorder, /ID appears generated and may change between builds/);
});
