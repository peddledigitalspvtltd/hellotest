import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDeliveryScopeOptions,
  resolveDeliveryScopePrefill,
  resolveReleaseScopeValue,
  resolveSprintScopeValue
} from "../src/lib/deliveryScopeOptions.ts";

const releases = [
  {
    id: "release-1",
    project_id: "project-1",
    name: "Payments GA",
    fix_version: "v2026.4",
    state: "in_progress",
    sprint_ids: [],
    requirement_ids: [],
    requirement_count: 0
  }
];

const iterations = [
  {
    id: "iteration-local",
    project_id: "project-1",
    name: "Workspace Sprint 9",
    state: "active"
  },
  {
    id: "iteration-jira",
    project_id: "project-1",
    name: "Imported Sprint",
    jira_sprint_id: "42",
    jira_sprint_name: "Commerce Sprint 42",
    state: "future"
  },
  {
    id: "iteration-closed",
    project_id: "project-1",
    name: "Closed Sprint",
    state: "closed"
  }
];

const jiraVersions = [
  { id: "jira-version-duplicate", name: "V2026.4", released: false, archived: false },
  { id: "jira-version-2", name: "v2026.5", released: false, archived: false },
  { id: "jira-version-archived", name: "v2025.1", released: true, archived: true }
];

const jiraSprints = [
  { id: "42", name: "commerce sprint 42", state: "active" },
  { id: "43", name: "Commerce Sprint 43", state: "future" }
];

test("delivery scope options merge native and Jira catalogs using canonical execution values", () => {
  const { releaseOptions, sprintOptions } = buildDeliveryScopeOptions({
    releases,
    iterations,
    jiraVersions,
    jiraSprints
  });

  assert.deepEqual(releaseOptions.map((option) => option.value), ["v2026.4", "v2026.5"]);
  assert.equal(releaseOptions.find((option) => option.value === "v2026.4")?.source, "hellotest");
  assert.deepEqual(
    sprintOptions.map((option) => option.value),
    ["Commerce Sprint 42", "Commerce Sprint 43", "Workspace Sprint 9"]
  );
  assert.equal(sprintOptions.some((option) => option.value === "Closed Sprint"), false);
});

test("delivery scope options preserve exact current values, including closed and unknown scope", () => {
  const { releaseOptions, sprintOptions } = buildDeliveryScopeOptions({
    releases,
    iterations,
    jiraVersions,
    jiraSprints,
    currentRelease: "V2026.4",
    currentSprint: "Closed Sprint"
  });

  assert.equal(releaseOptions.find((option) => option.value.toLowerCase() === "v2026.4")?.value, "V2026.4");
  assert.equal(sprintOptions.some((option) => option.value === "Closed Sprint"), true);

  const unknown = buildDeliveryScopeOptions({ currentRelease: "Customer Preview", currentSprint: "Sprint X" });
  assert.equal(unknown.releaseOptions[0].value, "Customer Preview");
  assert.equal(unknown.releaseOptions[0].source, "current");
  assert.equal(unknown.sprintOptions[0].value, "Sprint X");
});

test("delivery scope tokens and deep-link IDs resolve to editable execution values", () => {
  const catalogs = { releases, iterations, jiraVersions, jiraSprints };

  assert.equal(resolveReleaseScopeValue("release:release-1", catalogs), "v2026.4");
  assert.equal(resolveReleaseScopeValue("jira:jira-version-2", catalogs), "v2026.5");
  assert.equal(resolveSprintScopeValue("iteration-jira", catalogs), "Commerce Sprint 42");
  assert.equal(resolveSprintScopeValue("jira:43", catalogs), "Commerce Sprint 43");
  assert.equal(resolveSprintScopeValue("Uncatalogued Sprint", catalogs), "Uncatalogued Sprint");

  assert.deepEqual(resolveDeliveryScopePrefill({
    releaseId: "release-1",
    releaseToken: "release-from-link",
    sprintId: "iteration-jira",
    sprintToken: "sprint-from-link"
  }, catalogs), {
    release: "release-from-link",
    sprint: "sprint-from-link",
    unresolvedReleaseId: false,
    unresolvedSprintId: false
  });

  assert.deepEqual(resolveDeliveryScopePrefill({
    releaseId: "release-1",
    sprintId: "iteration-jira"
  }, catalogs), {
    release: "v2026.4",
    sprint: "Commerce Sprint 42",
    unresolvedReleaseId: false,
    unresolvedSprintId: false
  });

  assert.deepEqual(resolveDeliveryScopePrefill({
    releaseId: "missing-release",
    releaseToken: "fallback-release",
    sprintId: "missing-sprint",
    sprintToken: "fallback-sprint"
  }, catalogs), {
    release: "fallback-release",
    sprint: "fallback-sprint",
    unresolvedReleaseId: false,
    unresolvedSprintId: false
  });

  assert.deepEqual(resolveDeliveryScopePrefill({
    releaseId: "missing-release",
    sprintId: "missing-sprint"
  }, catalogs), {
    release: "",
    sprint: "",
    unresolvedReleaseId: true,
    unresolvedSprintId: true
  });
});
