import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readSource = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

test("Shared Step Group product copy is canonical across primary UI surfaces", async () => {
  const [sections, localization, sharedStepsPage, testCasesPage, automationPage, designPage, executionsPage, settingsPage] = await Promise.all([
    readSource("../src/lib/workspaceSections.ts"),
    readSource("../src/lib/localization.ts"),
    readSource("../src/pages/SharedStepsPage.tsx"),
    readSource("../src/pages/TestCasesPage.tsx"),
    readSource("../src/pages/AutomationPage.tsx"),
    readSource("../src/pages/DesignPage.tsx"),
    readSource("../src/pages/ExecutionsPage.tsx"),
    readSource("../src/pages/SettingsPage.tsx")
  ]);

  assert.match(sections, /label: "Shared Step Groups", shortLabel: "Groups"/);
  assert.match(localization, /"workspace\.sharedSteps": "Shared Step Groups"/);

  const uiCopy = [sharedStepsPage, testCasesPage, automationPage, designPage, executionsPage, settingsPage].join("\n");
  assert.match(uiCopy, /New Shared Step Group/);
  assert.match(uiCopy, /Insert Shared Step Group/);
  assert.match(uiCopy, /Shared Step Group step/);
  assert.doesNotMatch(uiCopy, /\bshared steps\b/i);
  assert.doesNotMatch(uiCopy, /\bshared groups?\b/i);
});

test("Shared Step Group import/export accepts the canonical annotation and legacy aliases", async () => {
  const [page, frontendImport, backendImport] = await Promise.all([
    readSource("../src/pages/TestCasesPage.tsx"),
    readSource("../src/lib/testCaseImport.ts"),
    readSource("../../backend/api/src/services/testCase.service.js")
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
    readSource("../src/lib/workspaceRoutes.ts"),
    readSource("../src/lib/api.ts"),
    readSource("../../backend/api/src/services/testStep.service.js"),
    readSource("../../backend/api/src/security/permissions.catalog.js")
  ]);

  assert.match(routes, /sharedSteps: "\/shared-steps"/);
  assert.match(api, /\/shared-step-groups/);
  assert.match(api, /\/test-steps\/insert-shared-group/);
  assert.match(api, /shared_step_group_id/);
  assert.match(backendStepService, /shared_step_group_id/);
  assert.match(permissions, /\["shared_step\.view", "View Shared Step Groups"\]/);
  assert.match(permissions, /\["shared_step\.manage", "Create, update, and delete Shared Step Groups"\]/);
});
