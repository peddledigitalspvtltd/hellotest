const test = require("node:test");
const assert = require("node:assert/strict");
const execution = require("../src/services/knowledgeExecution.service");
const assistant = require("../src/services/knowledgeAssistant.service");
const gateway = require("../src/services/knowledgeModelGateway.service");
const db = require("../src/db");
const orchestrator = require("../src/services/aiContextOrchestrator.service");
const { publicKnowledgeError } = require("../src/utils/knowledgeAssistantErrors");

test("nested retrieval work shares ordered progress and wall time with its caller", async () => {
  const events = [];
  await execution.run({ onProgress: (event) => events.push(event) }, async () => {
    execution.emit("QUERY_RECEIVED");
    await execution.bounded(async () => { execution.emit("HYBRID_SEARCH", "started"); }, { timeoutMs: 100 });
    execution.emit("GENERATION", "failed", { error_code: "MODEL_TIMEOUT" });
  });
  assert.deepEqual(events.map((event) => event.sequence), [1, 2, 3]);
  assert.ok(events.every((event, index) => Number.isFinite(event.metrics.elapsed_ms) && (!index || event.metrics.elapsed_ms >= events[index - 1].metrics.elapsed_ms)));
  assert.equal(events[2].error_code, "MODEL_TIMEOUT");
});

test("an exhausted deadline never starts another retrieval or model call", async () => {
  let called = false;
  await assert.rejects(execution.bounded(() => { called = true; }, { timeoutMs: 0 }), { code: "DEADLINE_EXCEEDED" });
  assert.equal(called, false);
});

test("a timed-out model aborts its transport and leaves the parent turn able to return evidence", async () => {
  let modelSignal;
  gateway.registerAdapter("bounded-test", ({ signal }) => { modelSignal = signal; return new Promise(() => {}); });
  await execution.run({}, async () => {
    await assert.rejects(gateway.request({ integration: { config: { protocol: "bounded-test" } }, messages: [], timeoutMs: 10 }), { code: "DEADLINE_EXCEEDED" });
    assert.equal(modelSignal.aborted, true);
    execution.assertActive();
  });
});

test("slow history is bounded and does not continue with evidence authorization after its deadline", async (context) => {
  let finishRead;
  const historyRead = new Promise((resolve) => { finishRead = resolve; });
  context.mock.method(db, "prepare", () => ({ all: () => historyRead }));
  await assert.rejects(assistant._internals.readConversationHistory({ sessionId: "s", userMessageId: "m", user: { id: "u" }, timeoutMs: 10 }), { code: "HISTORY_LOOKUP_TIMEOUT" });
  finishRead([{ role: "assistant", project_id: "project", citations: [{ id: "evidence" }] }]);
  await new Promise((resolve) => setImmediate(resolve));
});

test("a cancelled live lookup stops before scheduling the remaining project reads", async (context) => {
  let reads = 0;
  let release;
  const controller = new AbortController();
  context.mock.method(db, "prepare", () => {
    reads++;
    return { get: () => new Promise((resolve) => { release = resolve; }) };
  });
  const result = execution.run({ signal: controller.signal }, () => orchestrator.buildLiveProjectEvidence({ projectId: "project", route: { live_scopes: ["stories"] } }));
  controller.abort();
  release({ id: "project" });
  await assert.rejects(result, { name: "AbortError" });
  assert.equal(reads, 1);
});

test("a failed live database read is not presented as an authoritative zero count", async (context) => {
  context.mock.method(db, "prepare", () => ({ get: async () => { throw Object.assign(new Error("Database unavailable"), { code: "DB_UNAVAILABLE" }); } }));
  await assert.rejects(execution.run({}, () => orchestrator.buildLiveProjectEvidence({ projectId: "project", route: { live_scopes: ["stories"] } })), { code: "DB_UNAVAILABLE" });
});

test("provider failures have actionable categories without copying provider response data", async (context) => {
  const cases = [[401, "MODEL_AUTHENTICATION_FAILED"], [404, "MODEL_NOT_FOUND"], [429, "MODEL_RATE_LIMITED"], [422, "MODEL_REQUEST_REJECTED"], [503, "MODEL_UNAVAILABLE"]];
  for (const [status, code] of cases) {
    context.mock.method(global, "fetch", async () => new Response(JSON.stringify({ error: { message: "PRIVATE_PROVIDER_RESPONSE" } }), { status }));
    await assert.rejects(assistant._internals.requestJsonCompletion({ integration: { base_url: `https://provider-${status}.invalid/v1`, model: "test" }, messages: [], operation: "test", timeoutMs: 100 }), (error) => error.code === code && !JSON.stringify(error).includes("PRIVATE_PROVIDER_RESPONSE"));
  }
  assert.match(publicKnowledgeError({ code: "ANSWER_AUTHORIZATION_TIMEOUT", statusCode: 503 }), /verify current access/);
});

test("incomplete or malformed model output gets classified without an unbounded retry", async (context) => {
  let calls = 0;
  context.mock.method(global, "fetch", async () => { calls++; return new Response(JSON.stringify({ choices: [{ message: { content: '{"partial":' }, finish_reason: "length" }] }), { status: 200 }); });
  await assert.rejects(assistant._internals.requestJsonCompletion({ integration: { base_url: "https://truncated.invalid/v1", model: "test" }, messages: [], operation: "test" }), { code: "MODEL_OUTPUT_TRUNCATED" });
  assert.equal(calls, 1);
});
