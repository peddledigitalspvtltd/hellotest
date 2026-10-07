import assert from "node:assert/strict";
import test from "node:test";
import { qualityNextActions } from "../../frontend/lib/qualityNextActions.ts";

const overview = () => ({
  visibility: { stories: true, cases: true, suites: true, runs: true, bugs: true },
  inventory: { stories: 0, covered_stories: 0, cases: 0, designed_cases: 0, suites: 0, open_defects: 0 },
  execution: { failed: 0, blocked: 0, pending: 0 }, recent_runs: []
});

test("the next step never interprets unavailable inventory or hidden sources as an empty project", () => {
  const data = overview();
  data.inventory = Object.fromEntries(Object.keys(data.inventory).map(key => [key, null]));
  data.execution = { failed: null, blocked: null, pending: null };
  assert.deepEqual(qualityNextActions(data), []);
  const hidden = overview();
  hidden.visibility = Object.fromEntries(Object.keys(hidden.visibility).map(key => [key, false]));
  assert.deepEqual(qualityNextActions(hidden), []);
});

test("observed blockers lead the next step while coverage and unfinished work remain available", () => {
  const data = overview();
  data.execution = { failed: 2, blocked: 1, pending: 4 };
  data.inventory = { stories: 8, covered_stories: 5, cases: 12, designed_cases: 10, suites: 1, open_defects: 2 };
  data.recent_runs = [{ id: "run" }];
  const actions = qualityNextActions(data);
  assert.equal(actions[0].id, "investigate");
  assert.equal(actions[0].count, 3);
  assert.equal(actions.find(action => action.id === "coverage").count, 3);
  assert.equal(actions.find(action => action.id === "pending").count, 4);
});

test("empty project guidance advances through authoring, grouping and first execution with explicit create permissions", () => {
  const data = overview();
  assert.equal(qualityNextActions(data)[0].id, "first-case");
  assert.equal(qualityNextActions(data)[0].permission, "testcase.create");
  data.inventory.cases = 2; data.inventory.designed_cases = 2;
  assert.equal(qualityNextActions(data)[0].id, "suite");
  assert.equal(qualityNextActions(data)[0].permission, "suite.create");
  data.inventory.suites = 1;
  assert.equal(qualityNextActions(data)[0].id, "run");
  assert.equal(qualityNextActions(data)[0].permission, "run.create");
  data.recent_runs = [{ id: "completed" }];
  assert.deepEqual(qualityNextActions(data), []);
});
