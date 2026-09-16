import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readSource = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

test("Test Case creation filters Story choices with populated editable Release and Sprint scope", async () => {
  const page = await readSource("../src/pages/TestCasesPage.tsx");

  assert.match(page, /api\.requirementReleases\.list\(\{ project_id: projectId \}\)/);
  assert.match(page, /api\.requirementIterations\.list\(\{ project_id: projectId \}\)/);
  assert.match(page, /const deliveryScopeCatalog = useMemo\(\(\) => \(\{[\s\S]*?jiraVersions:[\s\S]*?jiraSprints:/);
  assert.match(page, /buildDeliveryScopeOptions\(\{[\s\S]*?\.\.\.deliveryScopeCatalog/);
  assert.match(page, /const \[caseDeliveryRelease, setCaseDeliveryRelease\] = useState\(""\)/);
  assert.match(page, /const \[caseDeliverySprint, setCaseDeliverySprint\] = useState\(""\)/);
  assert.match(page, /const creationRequirementOptions = useMemo\([\s\S]*?releaseMatches[\s\S]*?sprintMatches/);
  assert.match(page, /aria-label="Test case release scope"[\s\S]*?deliveryReleaseOptions\.map/);
  assert.match(page, /aria-label="Test case sprint scope"[\s\S]*?deliverySprintOptions\.map/);
  assert.match(page, /onChange=\{\(event\) => updateCaseRequirement\(event\.target\.value\)\}/);
});

test("Test Case context links and run builders resolve and prefill delivery scope", async () => {
  const page = await readSource("../src/pages/TestCasesPage.tsx");
  const routeContext = page.slice(
    page.indexOf('if (searchParams.get("create") !== "1")'),
    page.indexOf("const historyByCaseId")
  );

  for (const queryKey of ["release_id", "release", "sprint_id", "sprint"]) {
    assert.match(routeContext, new RegExp(`searchParams\\.get\\(\"${queryKey}\"\\)`));
  }
  assert.match(routeContext, /resolveDeliveryScopePrefill/);
  assert.match(page, /const openRunBuilder = \(testCaseIds: string\[\], mode: ExecutionStartMode = "manual"\)/);
  assert.match(page, /return \{ release: releases\.length === 1 \? releases\[0\] : "", sprint: sprints\.length === 1 \? sprints\[0\] : "" \}/);
  assert.match(page, /if \(!runDeliveryFieldsEditedRef\.current\.release\) setExecutionRelease\(prefill\.release\)/);
  assert.match(page, /if \(!runDeliveryFieldsEditedRef\.current\.sprint\) setExecutionSprint\(prefill\.sprint\)/);
  const opener = page.slice(page.indexOf("const openRunBuilder ="), page.indexOf("useEffect", page.indexOf("const openRunBuilder =")));
  assert.ok(opener.indexOf("setIsCreateExecutionModalOpen(true)") < opener.indexOf("setPendingRunBuilder("), "The form opens before optional delivery prefill completes");
  assert.match(page, /releaseOptions=\{deliveryReleaseOptions\}/);
  assert.match(page, /sprintOptions=\{deliverySprintOptions\}/);
  assert.match(page, /<select value=\{executionRelease\}[\s\S]*?releaseOptions\.map/);
  assert.match(page, /<select value=\{executionSprint\}[\s\S]*?sprintOptions\.map/);
});

test("Test Suite run creation also uses populated delivery selectors and linked-case prefill", async () => {
  const page = await readSource("../src/pages/DesignPage.tsx");

  assert.match(page, /const openSuiteRunBuilder = \(mode: ExecutionStartMode\)/);
  assert.match(page, /runScopeStoryIds\.map\(id => deliveryScopeByRequirementId\.get\(id\)\)/);
  assert.match(page, /suiteDeliveryPrefillPending \|\| suiteDeliveryPrefillError/);
  assert.match(page, /onCreateManualRun=\{\(\) => openSuiteRunBuilder\("manual"\)\}/);
  assert.match(page, /releaseOptions=\{deliveryReleaseOptions\}/);
  assert.match(page, /sprintOptions=\{deliverySprintOptions\}/);
  assert.match(page, /<select value=\{executionRelease\}[\s\S]*?releaseOptions\.map/);
  assert.match(page, /<select value=\{executionSprint\}[\s\S]*?sprintOptions\.map/);
});
