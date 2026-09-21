import assert from "node:assert/strict";
import test from "node:test";
import {
  createConfirmedRequirementBacklogMove,
  createConfirmedRequirementSprintMove,
  groupRequirementsBySprint,
  projectConfirmedRequirementSprintMove,
  resolveRequirementSprintIterationFromEvidence
} from "../src/lib/requirementSprintMove.ts";

const origin = { id: "origin", project_id: "project", name: "Original Sprint", source: "hellotest", requirement_ids: ["story"] };
const target = { id: "target", project_id: "project", name: "Target Sprint", source: "hellotest", requirement_ids: [] };
const story = { id: "story", project_id: "project", title: "Moved Story", iteration_id: origin.id, sprint: origin.name };

test("a confirmed Sprint move removes the Story from stale origin membership in either catalog order", () => {
  const moved = projectConfirmedRequirementSprintMove(createConfirmedRequirementSprintMove(story, target));
  for (const catalog of [[origin, target], [target, origin]]) {
    const result = groupRequirementsBySprint([moved], catalog, new Map([[story.id, target]]));
    assert.deepEqual(result.groups.find(group => group.iteration.id === origin.id).requirements, []);
    assert.deepEqual(result.groups.find(group => group.iteration.id === target.id).requirements.map(item => item.id), [story.id]);
    assert.deepEqual(result.unassignedRequirements, []);
  }
});

test("a confirmed backlog move cannot be reclaimed by stale Sprint membership", () => {
  const moved = projectConfirmedRequirementSprintMove(createConfirmedRequirementBacklogMove(story));
  const result = groupRequirementsBySprint([moved], [origin, target], new Map());
  assert.ok(result.groups.every(group => group.requirements.length === 0));
  assert.deepEqual(result.unassignedRequirements.map(item => item.id), [story.id]);
});

test("saved Sprint IDs beat conflicting labels and scoped origin observations", () => {
  const moved = { ...story, iteration_id: target.id };
  const resolved = resolveRequirementSprintIterationFromEvidence([
    { requirement: moved },
    { requirement: { ...story, iteration_id: null }, scopedIteration: origin }
  ], [origin, target]);
  assert.equal(resolved?.id, target.id);
  const result = groupRequirementsBySprint([moved], [origin, target], new Map([[story.id, resolved]]));
  assert.deepEqual(result.groups[0].requirements, []);
  assert.deepEqual(result.groups[1].requirements.map(item => item.id), [story.id]);
});

test("legacy names and scoped children still resolve when no saved Sprint ID is available", () => {
  assert.equal(resolveRequirementSprintIterationFromEvidence([
    { requirement: { ...story, iteration_id: null } }
  ], [origin, target])?.id, origin.id);
  assert.equal(resolveRequirementSprintIterationFromEvidence([
    { requirement: { ...story, iteration_id: null, sprint: null }, scopedIteration: target }
  ], [origin, target])?.id, target.id);
});
