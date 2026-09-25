import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const readSource = (relativePath) => readFile(path.join(testDir, relativePath), "utf8");

test("delivery catalogs require Product Management feature and iteration visibility", async () => {
  const sources = await Promise.all([
    "../../../manual/frontend/pages/RequirementsPage.tsx",
    "../../../testing/frontend/pages/TestCasesPage.tsx",
    "../../../testing/frontend/pages/IssuesPage.tsx",
    "../../../testing/frontend/pages/ExecutionsPage.tsx",
    "../../../testing/frontend/pages/DesignPage.tsx"
  ].map(readSource));

  sources.forEach((source) => {
    assert.match(source, /can\("requirement_iteration\.view"\)/);
  });
});

test("Test Case data-set authoring separates view, manage, and Test Case edit rights", async () => {
  const source = await readSource("../../../testing/frontend/pages/TestCasesPage.tsx");

  assert.match(source, /const canViewTestData = can\("data\.view"\) && canUseTestData/);
  assert.match(source, /const canManageTestData = can\("data\.manage"\) && canUseTestData/);
  assert.match(source, /enabled: [^\n]*Boolean\(projectId && canViewTestData && needsAuthoringCatalog\)/);
  assert.match(source, /const canLinkTestDataToCurrentCase = canViewTestData[\s\S]*canCreateTestCases[\s\S]*canUpdateTestCases/);
  assert.match(source, /const canCreateAndLinkTestData = canManageTestData && canLinkTestDataToCurrentCase/);
  assert.match(source, /canViewProjectMembers = can\("project_member\.view"\)/);
  assert.doesNotMatch(source, /queryFn: api\.users\.list/);
  assert.match(source, /name: member\.user_name/);
});

test("shared execution context and Shared Step Group actions fail closed", async () => {
  const [contextSelector, sharedSteps] = await Promise.all([
    readSource("../../../testing/frontend/components/ExecutionContextSelector.tsx"),
    readSource("../../../testing/frontend/pages/SharedStepsPage.tsx")
  ]);

  assert.match(contextSelector, /canViewTestData = !hideDataSet && can\("data\.view"\)/);
  assert.match(contextSelector, /useCapabilityAccess\(projectId\)/);
  assert.match(contextSelector, /optionalQueryView\(useQuery/);
  assert.match(contextSelector, /enabled: Boolean\(projectId && canViewTestData\)/);
  assert.match(sharedSteps, /canManageSharedStepGroups = can\("shared_step\.manage"\)/);
  assert.match(sharedSteps, /Permission required: shared_step\.manage/);
});

test("native Release association is rejected before Story or Sprint creation without update permission", async () => {
  const source = await readSource("../../../manual/frontend/pages/RequirementsPage.tsx");
  const storyHandler = source.slice(source.indexOf("const handleCreateRequirement"), source.indexOf("const setSprintStoriesSelected"));
  const sprintHandler = source.slice(source.indexOf("const handleSaveIteration"), source.indexOf("const handleDeleteIteration"));

  assert.ok(storyHandler.indexOf("createRequirementReleaseId && !canUpdateRequirementIterations") < storyHandler.indexOf("createRequirement.mutateAsync"));
  assert.ok(sprintHandler.indexOf("iterationDraftReleaseId && !canUpdateRequirementIterations") < sprintHandler.indexOf("createRequirementIteration.mutateAsync"));
});

test("shared catalog and Run actions evaluate the active project role", async () => {
  const [catalogActions, runActions] = await Promise.all([
    readSource("../src/shared/components/CatalogActionMenu.tsx"),
    readSource("../../../testing/frontend/components/CreateRunActionButton.tsx")
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
    readSource("../pages/ProjectsPage.tsx"),
    readSource("../src/platform/pages/TestOpsPage.tsx"),
    readSource("../src/platform/lib/featureFlags.ts")
  ]);

  assert.doesNotMatch(projects, /project\.manage/);
  assert.match(projects, /hasPermission\(session, "project\.update", selectedProjectId\)/);
  assert.match(projects, /hasPermission\(session, "app_type\.manage", selectedProjectId\)/);
  assert.match(testOps, /hasPermission\(session, "transaction\.manage", projectId\) && canUseBatchProcesses/);
  assert.match(featureFlags, /"\/testops": \["hellotest\.automation\.batch_process", "hellotest\.ops\.background_jobs"\]/);
});
