import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const readSource = (relativePath) => readFile(path.join(testDir, relativePath), "utf8");

test("delivery catalogs require Product Management feature and iteration visibility", async () => {
  const sources = await Promise.all([
    "../src/pages/RequirementsPage.tsx",
    "../src/pages/TestCasesPage.tsx",
    "../src/pages/IssuesPage.tsx",
    "../src/pages/ExecutionsPage.tsx",
    "../src/pages/DesignPage.tsx"
  ].map(readSource));

  sources.forEach((source) => {
    assert.match(source, /hasPermission\(session, "requirement_iteration\.view", projectId\)[\s\S]{0,180}hellotest\.manual\.requirements/);
  });
});

test("Test Case data-set authoring separates view, manage, and Test Case edit rights", async () => {
  const source = await readSource("../src/pages/TestCasesPage.tsx");

  assert.match(source, /const canViewTestData = hasPermission\(session, "data\.view", projectId\) && canUseTestData/);
  assert.match(source, /const canManageTestData = hasPermission\(session, "data\.manage", projectId\) && canUseTestData/);
  assert.match(source, /enabled: Boolean\(projectId && canViewTestData\)/);
  assert.match(source, /const canLinkTestDataToCurrentCase = canViewTestData[\s\S]*canCreateTestCases[\s\S]*canUpdateTestCases/);
  assert.match(source, /const canCreateAndLinkTestData = canManageTestData && canLinkTestDataToCurrentCase/);
  assert.match(source, /canViewProjectMembers = hasPermission\(session, "project_member\.view", projectId\)/);
  assert.doesNotMatch(source, /queryFn: api\.users\.list/);
  assert.match(source, /name: member\.user_name/);
});

test("shared execution context and Shared Step Group actions fail closed", async () => {
  const [contextSelector, sharedSteps] = await Promise.all([
    readSource("../src/components/ExecutionContextSelector.tsx"),
    readSource("../src/pages/SharedStepsPage.tsx")
  ]);

  assert.match(contextSelector, /canViewTestData = hasPermission\(session, "data\.view", projectId\)/);
  assert.match(contextSelector, /hellotest\.manual\.test_data/);
  assert.match(contextSelector, /enabled: Boolean\(projectId && canViewTestData\)/);
  assert.match(sharedSteps, /canManageSharedStepGroups = hasPermission\(session, "shared_step\.manage", projectId\)/);
  assert.match(sharedSteps, /Permission required: shared_step\.manage/);
});

test("native Release association is rejected before Story or Sprint creation without update permission", async () => {
  const source = await readSource("../src/pages/RequirementsPage.tsx");
  const storyHandler = source.slice(source.indexOf("const handleCreateRequirement"), source.indexOf("const setSprintStoriesSelected"));
  const sprintHandler = source.slice(source.indexOf("const handleSaveIteration"), source.indexOf("const handleDeleteIteration"));

  assert.ok(storyHandler.indexOf("createRequirementReleaseId && !canUpdateRequirementIterations") < storyHandler.indexOf("createRequirement.mutateAsync"));
  assert.ok(sprintHandler.indexOf("iterationDraftReleaseId && !canUpdateRequirementIterations") < sprintHandler.indexOf("createRequirementIteration.mutateAsync"));
});

test("shared catalog and Run actions evaluate the active project role", async () => {
  const [catalogActions, runActions] = await Promise.all([
    readSource("../src/components/CatalogActionMenu.tsx"),
    readSource("../src/components/CreateRunActionButton.tsx")
  ]);

  assert.match(catalogActions, /const permissionProjectId = projectId \|\| activeProjectId/);
  assert.match(catalogActions, /hasPermission\(session, permission, permissionProjectId\)/);
  assert.match(catalogActions, /hasAnyPermission\(session, permissions, permissionProjectId\)/);
  assert.match(runActions, /hasPermission\(session, "run\.create", permissionProjectId\)/);
  assert.match(runActions, /hasPermission\(session, "automation\.run\.local", permissionProjectId\)/);
  assert.match(runActions, /hasPermission\(session, "automation\.run\.remote", permissionProjectId\)/);
});

test("Project administration and TestOps use exact catalog permissions and feature boundaries", async () => {
  const [projects, testOps, featureFlags] = await Promise.all([
    readSource("../src/pages/ProjectsPage.tsx"),
    readSource("../src/pages/TestOpsPage.tsx"),
    readSource("../src/lib/featureFlags.ts")
  ]);

  assert.doesNotMatch(projects, /project\.manage/);
  assert.match(projects, /hasPermission\(session, "project\.update", selectedProjectId\)/);
  assert.match(projects, /hasPermission\(session, "app_type\.manage", selectedProjectId\)/);
  assert.match(testOps, /hasPermission\(session, "transaction\.manage", projectId\) && canUseBatchProcesses/);
  assert.match(featureFlags, /"\/testops": \["hellotest\.automation\.batch_process", "hellotest\.ops\.background_jobs"\]/);
});
