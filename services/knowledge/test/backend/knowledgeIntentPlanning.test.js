const test = require("node:test");
const assert = require("node:assert/strict");
const planning = require("../../backend/services/knowledgeIntentPlanning.service");
const enrichment = require("../../backend/services/knowledgeEnrichment.service");
const gateway = require("../../backend/services/knowledgeModelGateway.service");
const selection = require("@hellotest/integration/backend/services/aiLlmSelection.service");
const execution = require("../../backend/services/knowledgeExecution.service");
const integration = { type: "llm", is_active: true, id: "model-1", model: "fixture", config: { project_id: "project-1" } };
const input = { request: { project_id: "project-1", query: "Which payment Stories lack negative test coverage?", filters: {}, budgets: { deadline_ms: 12000 } }, user: { id: "user-1" } };

function selected(context) {
  const calls = [];
  context.mock.method(selection, "resolveLlmIntegrationForUsage", async value => { calls.push(value); return integration; });
  return calls;
}

test("intent planning uses the project/user model before retrieval and preserves exact relevant queries", async context => {
  const calls = selected(context);
  let request;
  context.mock.method(gateway, "request", async value => {
    request = value;
    return { source_kinds: ["requirement", "test_case", "passwords"], information_needs: ["negative payment coverage"], search_queries: ["payment negative test coverage", "unrelated mountain weather"] };
  });
  const result = await execution.run({}, () => planning.planIntent(input));
  assert.equal(result.mode, "llm");
  assert.deepEqual(result.plan.queries, ["payment negative test coverage"]);
  assert.deepEqual(result.plan.source_kinds, ["requirement", "test_case"]);
  assert.equal(calls[0].projectId, "project-1"); assert.equal(calls[0].userId, "user-1");
  assert.equal(request.operation, "knowledge.context.plan-intent");
  assert.equal(request.timeoutMs, 4000);
});

test("model failure and invalid output produce explicit standard retrieval fallback", async context => {
  selected(context);
  for (const response of [new Error("provider unavailable"), {}]) {
    context.mock.method(gateway, "request", async () => { if (response instanceof Error) throw response; return response; });
    const result = await execution.run({}, () => planning.planIntent(input));
    assert.equal(result.mode, "standard"); assert.equal(result.plan, null); assert.ok(result.reason);
  }
});

test("missing configuration skips model dispatch and foreign project models cannot plan context", async context => {
  context.mock.method(selection, "resolveLlmIntegrationForUsage", async () => null);
  context.mock.method(gateway, "request", async () => { throw new Error("must not dispatch"); });
  const missing = await execution.run({}, () => planning.planIntent(input));
  assert.equal(missing.reason, "LLM_INTEGRATION_MISSING");
  await assert.rejects(execution.run({}, () => planning.planIntent({ ...input, integration: { ...integration, config: { project_id: "foreign" } } })), /project|scope/i);
});

test("cancellation never becomes a standard fallback", async context => {
  selected(context); const controller = new AbortController();
  context.mock.method(gateway, "request", async () => { controller.abort(); throw new DOMException("Cancelled", "AbortError"); });
  await assert.rejects(execution.run({}, () => planning.planIntent({ ...input, signal: controller.signal })), { name: "AbortError" });
});

test("a stalled model-configuration lookup falls back before consuming the retrieval deadline", async context => {
  context.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000 });
  context.mock.method(selection, "resolveLlmIntegrationForUsage", () => new Promise(() => {}));
  context.mock.method(gateway, "request", async () => assert.fail("No model was resolved"));
  const pending = execution.run({}, () => planning.planIntent({ ...input, request: { ...input.request, budgets: { deadline_ms: 120 } } }));
  await new Promise(resolve => setImmediate(resolve));
  context.mock.timers.tick(20);
  const result = await pending;
  assert.equal(result.mode, "standard");
  assert.equal(result.reason, "INTENT_CONFIGURATION_TIMEOUT");
  assert.equal(Date.now(), 1_020);
});

const chunks = [{ index: 0, heading: "Payments", content: "A declined payment preserves the basket. Retry after correcting billing details." }];
test("knowledge enrichment accepts only exact source excerpts and bounded chunk identities", () => {
  const result = enrichment.normalizeEnrichment({ sections: [
    { chunk_index: 99, excerpt: "fabricated" }, { chunk_index: 0, excerpt: "A declined payment preserves the basket.", information_needs: ["What happens after decline?"] },
    { chunk_index: 0, excerpt: "Retry after correcting billing details." }
  ] }, chunks);
  assert.equal(result.sections.length, 1); assert.equal(result.summary_kind, "source_excerpts");
  assert.throws(() => enrichment.normalizeEnrichment({ sections: [{ chunk_index: 0, excerpt: "A declined payment deletes the basket." }] }, chunks), /anchored/);
});

test("LLM enrichment failure leaves standard knowledge build available", async context => {
  selected(context);
  context.mock.method(gateway, "request", async () => { throw Object.assign(new Error("private provider error"), { code: "MODEL_TIMEOUT" }); });
  const result = await execution.run({}, () => enrichment.enrichDocument({ projectId: "project-1", source: { created_by: "user-1", title: "Payments" }, chunks }));
  assert.equal(result.mode, "standard"); assert.equal(result.reason, "MODEL_TIMEOUT");
  assert.deepEqual(result.sections, []); assert.ok(!JSON.stringify(result).includes("private provider error"));
});
