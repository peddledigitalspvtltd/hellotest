import { readApiSources } from "./helpers/readApiSources.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readSource = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

test("Shared Step Group product copy is canonical across primary UI surfaces", async () => {
  const [sections, localization, sharedStepsPage, testCasesPage, automationPage, designPage, executionsPage, settingsPage] = await Promise.all([
    readSource("../src/platform/lib/workspaceSections.ts"),
    readSource("../src/platform/lib/localization.ts"),
    readSource("../../../testing/frontend/pages/SharedStepsPage.tsx"),
    readSource("../../../testing/frontend/pages/TestCasesPage.tsx"),
    readSource("../../../automation/frontend/pages/AutomationPage.tsx"),
    readSource("../../../testing/frontend/pages/DesignPage.tsx"),
    readSource("../../../testing/frontend/pages/ExecutionsPage.tsx"),
    readSource("../pages/SettingsPage.tsx")
  ]);

  assert.match(sections, /label: "Shared Step Groups", shortLabel: "Groups"/);
  assert.match(localization, /"workspace\.sharedSteps": "Shared Step Groups"/);

  const uiCopy = [sharedStepsPage, testCasesPage, automationPage, designPage, executionsPage, settingsPage].join("\n");
  assert.match(uiCopy, /New Shared Step Group/);
  assert.match(uiCopy, /Insert Shared Step Group/);
  assert.match(uiCopy, /Shared Step Group step/);
  // Entity actions retain the canonical name. Metrics may describe individual
  // shared steps (execution units), rather than the group container.
  assert.doesNotMatch(uiCopy, /\b(?:New|Create|Insert|Edit|Delete) Shared (?:Steps|Groups?)\b/i);
  assert.match(sharedStepsPage, /Cases Reusing Shared Steps/);
});

test("Shared Step Group import/export accepts the canonical annotation and legacy aliases", async () => {
  const [page, frontendImport, backendImport] = await Promise.all([
    readSource("../../../testing/frontend/pages/TestCasesPage.tsx"),
    readSource("../../../testing/frontend/lib/testCaseImport.ts"),
    readSource("../../../testing/backend/services/testCase.service.js")
  ]);

  assert.match(page, /`\[Shared Step Group: \$\{sharedName\}\]/);
  assert.match(page, /"Shared Step Groups": sharedStepGroups/);
  assert.match(frontendImport, /shared step group\|shared steps\|sharedgroup\|shared/);
  assert.match(backendImport, /shared step group\|shared steps\|sharedgroup\|shared/);
  assert.match(frontendImport, /"sharedgroups", "sharedstepgroups", "reusablegroups"/);
  assert.match(frontendImport, /normalized === "sharedstepgroup"/);
  assert.match(backendImport, /normalized === "sharedstepgroup"/);
});

test("Shared Step Group terminology leaves stable routes and API contracts intact", async () => {
  const [routes, api, backendStepService, permissions] = await Promise.all([
    readSource("../src/platform/lib/workspaceRoutes.ts"),
    readApiSources(),
    readSource("../../../testing/backend/services/testStep.service.js"),
    readSource("../../backend/src/security/permissions.catalog.js")
  ]);

  assert.match(routes, /sharedSteps: "\/shared-steps"/);
  assert.match(api, /\/shared-step-groups/);
  assert.match(api, /\/test-steps\/insert-shared-group/);
  assert.match(api, /shared_step_group_id/);
  assert.match(backendStepService, /shared_step_group_id/);
  assert.match(permissions, /\["shared_step\.view", "View Shared Step Groups"\]/);
  assert.match(permissions, /\["shared_step\.manage", "Create, update, and delete Shared Step Groups"\]/);
});

test("Shared Step Groups expose review-before-save AI improvement without automation code", async () => {
  const page = await readSource("../../../testing/frontend/pages/SharedStepsPage.tsx");

  assert.match(page, /canManageSharedStepGroups && can\("testcase\.ai"\)/);
  assert.match(page, /AI Improve Steps/);
  assert.match(page, /api\.testCases\.rephraseStep/);
  assert.match(page, /Review the changes, then save the group/);
  assert.match(page, /automation_code: "",[\s\S]*api_request: null/);
  assert.doesNotMatch(page, /Preview Shared Step Group automation code/);
});
