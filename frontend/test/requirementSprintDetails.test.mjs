import assert from "node:assert/strict";
import test from "node:test";

import {
  getStoryDetailSprintOptions,
  requirementSprintSelectionValue,
  resolveRequirementSprintAssignment
} from "../src/lib/requirementSprintDetails.ts";

const localSprint = {
  id: "iteration-1",
  project_id: "project-1",
  name: "Workspace Sprint",
  state: "future"
};

const jiraSprint = {
  id: "iteration-2",
  project_id: "project-1",
  name: "Jira Sprint",
  jira_sprint_id: "42",
  jira_sprint_name: "Jira Sprint",
  state: "active"
};

const closedSprint = {
  id: "iteration-3",
  project_id: "project-1",
  name: "Completed Sprint",
  state: "closed"
};

test("Story details lists workspace-created and connected-workspace available Sprints", () => {
  const options = getStoryDetailSprintOptions([localSprint, jiraSprint, closedSprint], "");

  assert.deepEqual(options.map((option) => option.value), ["iteration-1", "42"]);
});

test("Story details keeps an associated Sprint selected, including a completed Sprint", () => {
  assert.equal(requirementSprintSelectionValue({ iteration_id: "iteration-1" }), "iteration-1");
  assert.equal(requirementSprintSelectionValue({ sprint_id: "42", iteration_id: "iteration-2" }), "42");

  const options = getStoryDetailSprintOptions([localSprint, closedSprint], "iteration-3");
  assert.deepEqual(options.map((option) => option.value), ["iteration-1", "iteration-3"]);
});

test("Story detail Sprint changes use the correct backend assignment field", () => {
  assert.deepEqual(resolveRequirementSprintAssignment("iteration-1", [localSprint, jiraSprint]), {
    iteration: localSprint,
    input: { sprint: "", iteration_id: "iteration-1" }
  });
  assert.deepEqual(resolveRequirementSprintAssignment("42", [localSprint, jiraSprint]), {
    iteration: jiraSprint,
    input: { sprint: "42", iteration_id: "" }
  });
  assert.deepEqual(resolveRequirementSprintAssignment("", [localSprint, jiraSprint]), {
    iteration: null,
    input: { sprint: "", iteration_id: "" }
  });
});

test("persisted project Sprints keep canonical membership even when legacy Jira metadata is present", () => {
  const persisted = { ...jiraSprint, source: "hellotest" };
  assert.deepEqual(getStoryDetailSprintOptions([persisted], "").map(option => option.value), [persisted.id]);
  assert.equal(requirementSprintSelectionValue({ iteration_id: persisted.id, sprint_id: "42" }, [persisted]), persisted.id);
  assert.deepEqual(resolveRequirementSprintAssignment(persisted.id, [persisted]).input, { sprint: "", iteration_id: persisted.id });
});
