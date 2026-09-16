import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildBugReportPath,
  safeBugReportReturnRoute
} from "../src/lib/bugReportNavigation.ts";

const readSource = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

test("Bug report navigation carries Sprint and Release context and permits a Release return", () => {
  const path = buildBugReportPath({
    requirementIds: ["story-1"],
    sprint: "Commerce Sprint 42",
    sprintId: "iteration-42",
    release: "Payments GA",
    releaseId: "release-ga",
    fixVersion: "v2026.8",
    returnTo: "/releases?release=release-ga",
    returnLabel: "Release details"
  });
  const url = new URL(path, "https://hellotest.invalid");

  assert.equal(url.pathname, "/issues");
  assert.equal(url.searchParams.get("create"), "1");
  assert.equal(url.searchParams.get("sprint"), "Commerce Sprint 42");
  assert.equal(url.searchParams.get("sprintId"), "iteration-42");
  assert.equal(url.searchParams.get("release"), "Payments GA");
  assert.equal(url.searchParams.get("releaseId"), "release-ga");
  assert.equal(url.searchParams.get("fixVersion"), "v2026.8");
  assert.equal(url.searchParams.get("returnTo"), "/releases?release=release-ga");
  assert.equal(safeBugReportReturnRoute("/releases?release=release-ga#readiness"), "/releases?release=release-ga#readiness");
  assert.equal(safeBugReportReturnRoute("//example.com/releases"), "");
});

test("Bug creation resolves native delivery IDs, merges native and Jira choices, and retains scope across AI acceptance", async () => {
  const [issues, requirements, executions] = await Promise.all([
    readSource("../src/pages/IssuesPage.tsx"),
    readSource("../src/pages/RequirementsPage.tsx"),
    readSource("../src/pages/ExecutionsPage.tsx")
  ]);

  assert.match(issues, /searchParams\.get\("releaseId"\) \|\| searchParams\.get\("release_id"\)/);
  assert.match(issues, /searchParams\.get\("fixVersion"\) \|\| searchParams\.get\("fix_version"\) \|\| searchParams\.get\("release"\)/);
  assert.match(issues, /searchParams\.get\("sprintId"\) \|\| searchParams\.get\("sprint_id"\)/);
  assert.match(issues, /api\.requirementIterations\.list\(\{ project_id: projectId \}\)/);
  assert.match(issues, /api\.requirementReleases\.list\(\{ project_id: projectId \}\)/);
  assert.match(issues, /canViewDeliveryScopes = can\("requirement_iteration\.view"\)/);
  assert.match(issues, /buildDeliveryScopeOptions\(\{/);
  assert.match(issues, /includeClosedSprints: true/);
  assert.match(issues, /resolveDeliveryScopePrefill\(deliveryPrefill, deliveryScopeCatalog\)/);
  assert.match(issues, /sprint: resolvedActiveBugDeliveryPrefill\?\.sprint \|\| ""/);
  assert.match(issues, /release: resolvedActiveBugDeliveryPrefill\?\.release \|\| ""/);
  assert.match(issues, /sprintOptions\.map\(\(option\) =>/);
  assert.match(issues, /releaseOptions\.map\(\(option\) =>/);

  assert.match(requirements, /sprintId: selectedSprint\?\.id \|\| selectedRequirement\.iteration_id \|\| selectedRequirement\.sprint_id/);
  assert.match(requirements, /releaseId: selectedRelease\?\.id/);
  assert.match(requirements, /fixVersion: selectedRequirement\.fix_version \|\| selectedRelease\?\.fix_version/);
  assert.match(executions, /sprint: selectedExecution\.sprint/);
  assert.match(executions, /release: selectedExecution\.release/);
});
