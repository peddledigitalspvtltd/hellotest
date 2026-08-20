import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readSource = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

test("People management exposes user CRUD and role editors without Jira-specific UI", async () => {
  const page = await readSource("../src/pages/PeoplePage.tsx");

  for (const capability of ["Create user", "Initial password", "Confirm password", "Save user", "Delete user", "Create role", "Save permissions"]) {
    assert.match(page, new RegExp(capability));
  }
  assert.doesNotMatch(page, /Jira/i);
  assert.match(page, /api\.users\.create/);
  assert.match(page, /api\.users\.update/);
  assert.match(page, /api\.users\.delete/);
});

test("Requirements Management appears above Product Management authoring and owns Stories", async () => {
  const [shell, sections] = await Promise.all([
    readSource("../src/components/AppShell.tsx"),
    readSource("../src/lib/workspaceSections.ts")
  ]);

  assert.match(shell, /label: "Requirements Management"/);
  assert.match(shell, /icon: RequirementsManagementIcon/);
  assert.ok(shell.indexOf('label: "Requirements Management"') < shell.indexOf('id: "authoring"'));
  assert.match(sections, /REQUIREMENTS_MANAGEMENT_SECTION_ITEMS[\s\S]*label: "Stories"/);
  const authoring = sections.slice(sections.indexOf("TEST_AUTHORING_SECTION_ITEMS"), sections.indexOf("TEST_ENVIRONMENT_SECTION_ITEMS"));
  assert.doesNotMatch(authoring, /label: "Stories"/);
});

test("manual test-case details place mature automation cards beside Details", async () => {
  const page = await readSource("../src/pages/TestCasesPage.tsx");
  const tabs = page.slice(page.indexOf('items={['), page.indexOf(']}', page.indexOf('items={[')));

  assert.ok(tabs.indexOf('label: "Details"') < tabs.indexOf('label: "Automation Cases"'));
  assert.match(page, /automation-case-tile test-case-linked-automation-card/);
  assert.match(page, /Create one with AI, the smart recorder, or a blank canvas/);
  assert.doesNotMatch(page, /summary="Create an independent automation case while preserving this manual case as its traceable source\."/);
});

test("Story-linked test-case creation enters the standard new-case workspace with coherent scope", async () => {
  const page = await readSource("../src/pages/TestCasesPage.tsx");

  assert.match(page, /beginCreateCase\(requestedSuiteId, requestedRequirementId\)/);
  assert.match(page, /setProjectId\(requestedProjectId\)/);
  assert.match(page, /requirement_id: requirementId/);
});
