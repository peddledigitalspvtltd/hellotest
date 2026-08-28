import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readSource = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

test("Story creation resolves editable Sprint and Release route context", async () => {
  const page = await readSource("../src/pages/RequirementsPage.tsx");
  const routeContext = page.slice(
    page.indexOf('if (searchParams.get("create") !== "1"'),
    page.indexOf("const openRequirementImportModal")
  );
  const storyDialog = page.slice(page.indexOf("{isCreateModalOpen ?"), page.indexOf("{isCreateIterationModalOpen ?"));

  for (const queryKey of ["sprint_id", "sprint", "release_id", "release"]) {
    assert.match(routeContext, new RegExp(`searchParams\\.get\\(\"${queryKey}\"\\)`));
  }
  assert.match(routeContext, /requirementIterationsQuery\.isLoading/);
  assert.match(routeContext, /requirementReleasesQuery\.isLoading/);
  assert.match(routeContext, /requestedLocalRelease/);
  assert.match(routeContext, /isRequestedSprintClosed/);
  assert.match(routeContext, /isRequestedReleaseClosed/);
  assert.match(routeContext, /requestedJiraVersionCandidate\?\.released/);
  assert.match(storyDialog, /value=\{createDraft\.sprint\}[\s\S]*onChange=\{\(event\) => setCreateStorySprintSelection/);
  assert.match(storyDialog, /value=\{createStoryReleaseSelection\}[\s\S]*onChange=\{\(event\) => setCreateStoryReleaseSelection/);
  assert.match(page, /appendRequirementReleaseScope\.mutateAsync\([\s\S]*requirement_ids: \[response\.id\]/);
});

test("Sprint creation exposes editable Release prefill and appends the new Sprint", async () => {
  const [page, api] = await Promise.all([
    readSource("../src/pages/RequirementsPage.tsx"),
    readSource("../src/lib/api.ts")
  ]);

  assert.match(page, /searchParams\.get\("create_sprint"\) !== "1"/);
  assert.match(page, /openCreateIteration\(\[\], requestedReleaseId\)/);
  assert.match(page, /const \[iterationDraftReleaseId, setIterationDraftReleaseId\] = useState\(""\)/);
  assert.match(page, /aria-label="Release for this Sprint"[\s\S]*value=\{iterationDraftReleaseId\}/);
  assert.match(page, /selectableRequirementReleases\.map/);
  assert.match(page, /const selectableJiraVersions = useMemo\([\s\S]*!version\.released/);
  assert.match(page, /appendRequirementReleaseScope\.mutateAsync\([\s\S]*sprint_ids: \[createdSprintId\]/);
  assert.match(api, /appendScope: \(id: string, input: \{ requirement_ids\?: string\[\]; sprint_ids\?: string\[\] \}\)/);
  assert.match(api, /`\/requirement-releases\/\$\{id\}\/scope`/);
});
