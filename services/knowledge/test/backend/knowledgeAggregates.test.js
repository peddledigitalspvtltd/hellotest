const test = require("node:test");
const assert = require("node:assert/strict");
const aggregates = require("../../backend/services/knowledgeAggregates.service");
const permissions = require("@hellotest/platform/backend/services/permission.service");
const flags = require("@hellotest/platform/backend/services/featureFlag.service");

test("simple count questions are recognised with the entity and qualifier they name", () => {
  assert.deepEqual(aggregates.detect("How many open defects are there?"), { entity: "bug", qualifiers: ["open"] });
  assert.deepEqual(aggregates.detect("what is the number of test cases"), { entity: "test_case", qualifiers: [] });
  assert.deepEqual(aggregates.detect("How many failing test runs do we have?"), { entity: "execution", qualifiers: ["failed"] });
  assert.deepEqual(aggregates.detect("Total number of stories that are done"), { entity: "requirement", qualifiers: ["done"] });
  assert.deepEqual(aggregates.detect("how many critical bugs"), { entity: "bug", qualifiers: ["critical"] });
});

test("a question that is richer than a total is declined, never answered with an unqualified number", () => {
  for (const question of [
    "How many defects were opened last sprint?",
    "How many failed runs per release?",
    "How many stories are assigned to Priya?",
    "How many defects since January?",
    "How many test cases in the checkout module?",
    "How many defects by severity?",
    "What is the defect lifecycle?",
    "Tell me about the open defects",
    "how many tests"
  ]) assert.equal(aggregates.detect(question), null, question);
});

const store = ({ statuses = ["open", "closed"], severities = ["critical", "low"], count = 7, log = [] } = {}) => ({
  prepare(sql) {
    return {
      all: async () => { log.push(sql); return (/severity/.test(sql) ? severities : statuses).map((value) => ({ value })); },
      get: async (...params) => { log.push({ sql, params }); return { count }; }
    };
  }
});

test("a count is computed by a typed, parameterised query and reports the query it ran", async () => {
  const log = [];
  const result = await aggregates.compute({ projectId: "p1", spec: { entity: "bug", qualifiers: ["open", "critical"] }, store: store({ log }) });
  assert.equal(result.value, 7);
  assert.deepEqual(result.filters, { status: "open", severity: "critical" });
  const executed = log.find((entry) => entry.params);
  assert.deepEqual(executed.params, ["p1", "open", "critical"], "values are bound parameters, never interpolated");
  assert.ok(!/open|critical/.test(executed.sql.replace(/LOWER\(feedback\.(?:status|severity)\)/g, "")), "no value appears in the SQL text");
  assert.match(result.query, /SELECT COUNT\(\*\)::INTEGER AS count FROM feedback WHERE feedback\.project_id = :project_id AND LOWER\(feedback\.status\) = 'open'/);
});

test("a qualifier the project does not use is declined rather than counted as zero", async () => {
  assert.equal(await aggregates.compute({ projectId: "p1", spec: { entity: "bug", qualifiers: ["blocked"] }, store: store() }), null);
  assert.equal(await aggregates.compute({ projectId: "p1", spec: { entity: "test_case", qualifiers: ["critical"] }, store: store() }), null, "test cases have no severity");
});

test("the fact is evidence that says it was computed and names its query, and is bound to one caller's view permission", async (t) => {
  t.mock.method(permissions, "hasPermission", async (user, permission) => user.id === "viewer" && permission === "feedback.view");
  t.mock.method(flags, "areEnabled", async () => true);
  const at = () => new Date("2026-11-16T09:00:00Z");
  const [fact] = await aggregates.hits({ projectId: "p1", user: { id: "viewer" }, question: "How many open defects are there?", store: store(), now: at });
  assert.equal(fact.source_kind, "live_project");
  assert.equal(fact.source_id, "live-project-p1-aggregate-bugs");
  assert.ok(Object.keys(aggregates.SCOPE_PERMISSIONS).includes("aggregate-bugs"));
  assert.deepEqual(aggregates.SCOPE_PERMISSIONS["aggregate-bugs"], ["feedback.view"]);
  const body = JSON.parse(fact.content);
  assert.equal(body.computed_fact, true);
  assert.equal(body.value, 7);
  assert.equal(body.as_of, "2026-11-16T09:00:00.000Z");
  assert.match(body.query, /COUNT\(\*\)/);
  assert.equal(fact.citation.id, `K-${fact.chunk_id}`);
  const [again] = await aggregates.hits({ projectId: "p1", user: { id: "viewer" }, question: "How many open defects are there?", store: store(), now: at });
  assert.equal(again.chunk_id, fact.chunk_id, "the same fact has the same identity");
  assert.deepEqual(await aggregates.hits({ projectId: "p1", user: { id: "stranger" }, question: "How many open defects are there?", store: store(), now: at }), [], "no view permission, no number");
  assert.deepEqual(await aggregates.hits({ projectId: "p1", user: null, question: "How many open defects are there?", store: store() }), []);
  assert.deepEqual(await aggregates.hits({ projectId: "p1", user: { id: "viewer" }, question: "Describe the checkout flow", store: store() }), []);
});
