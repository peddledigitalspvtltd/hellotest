import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readSource = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

test("automation authoring is a dedicated case workflow with complete build surfaces", async () => {
  const page = await readSource("../src/pages/AutomationPage.tsx");

  for (const capability of [
    "Create automation case",
    "AI architect",
    "Smart recorder",
    "Blank canvas",
    "Build studio",
    "Retrieve automation code",
    "Insert shared group",
    "Record into step"
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
});
