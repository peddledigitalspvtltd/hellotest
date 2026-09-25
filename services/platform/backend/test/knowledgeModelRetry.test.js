const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const execution = require("../../../knowledge/backend/services/knowledgeExecution.service");
const gateway = require("../../../knowledge/backend/services/knowledgeModelGateway.service");
const assistant = require("../../../chatbot/backend/services/knowledgeAssistant.service");
const rag = require("../../../knowledge/backend/services/knowledgeRag.service");
const { retryKnowledgeModel, readRetryAfterMs } = require("../src/utils/knowledgeModelRetry");
const { modelHttpError } = require("../src/utils/knowledgeAssistantErrors");
const { streamKnowledge } = require("../src/utils/knowledgeStream");
const { resetServiceResilienceState } = require("../src/utils/resilientHttpClient");

const completion = () => new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }));
const input = (name) => ({ integration: { base_url: `https://${name}.invalid/v1`, model: "test" }, operation: "knowledge.assistant.synthesize", messages: [] });
const failure = (status, body = "temporarily unavailable", retryAfter = "0") => new Response(JSON.stringify({ error: body }), { status, headers: { "retry-after": retryAfter } });

test("transient HTTP failures retry once, preserve the payload, and charge both attempts", async (t) => {
  for (const status of [408, 429, 500, 502, 503, 504, 529]) {
    resetServiceResilienceState();
    const sent = [], events = [];
    t.mock.method(global, "fetch", async (_, init) => { sent.push(init.body); return sent.length === 1 ? failure(status) : completion(); });
    await execution.run({ modelBudget: { max_tool_calls: 3 }, onProgress: (event) => events.push(event) }, async () => {
      assert.deepEqual(await assistant._internals.requestJsonCompletion(input(`retry-${status}`)), { ok: true });
      assert.equal(execution.current().modelStats.calls, 2);
      assert.equal(execution.current().modelStats.retries, 1);
    });
    assert.equal(sent.length, 2);
    assert.equal(sent[0], sent[1]);
    assert.equal(events[0].status, "IN_PROGRESS");
    assert.equal(events[0].metrics.model_attempt, 2);
    assert.equal(events[0].metrics.model_max_attempts, 3);
  }
});

test("exhausted retries return the safe provider category after exactly three attempts", async (t) => {
  resetServiceResilienceState();
  let calls = 0;
  t.mock.method(global, "fetch", async () => { calls++; return failure(503, "PRIVATE_CREDENTIAL_OR_PROMPT"); });
  await assert.rejects(assistant._internals.requestJsonCompletion(input("exhausted")), (error) => {
    assert.equal(error.code, "MODEL_UNAVAILABLE");
    assert.equal(error.modelAttempts, 3);
    assert.doesNotMatch(JSON.stringify(error), /PRIVATE_CREDENTIAL_OR_PROMPT/);
    return true;
  });
  assert.equal(calls, 3);
});

test("authentication, billing, model, request, and configuration errors are not retried", async (t) => {
  for (const [status, body, code] of [[401, "denied", "MODEL_AUTHENTICATION_FAILED"], [403, "denied", "MODEL_AUTHENTICATION_FAILED"], [402, "billing", "MODEL_QUOTA_EXCEEDED"], [429, "insufficient_quota", "MODEL_QUOTA_EXCEEDED"], [404, "model_not_found", "MODEL_NOT_FOUND"], [400, "bad request", "MODEL_REQUEST_REJECTED"]]) {
    let calls = 0;
    t.mock.method(global, "fetch", async () => { calls++; return failure(status, body); });
    await assert.rejects(assistant._internals.requestJsonCompletion(input(`terminal-${status}`)), { code });
    assert.equal(calls, 1);
  }
  t.mock.method(global, "fetch", async () => { throw new Error("Invalid configuration must never dispatch"); });
  await assert.rejects(assistant._internals.requestJsonCompletion({ ...input("bad-url"), integration: { base_url: "not a URL", model: "test" } }), { code: "MODEL_CONFIGURATION_ERROR" });
});

test("Retry-After supports seconds and dates and never resends earlier to fit a deadline", async () => {
  const now = Date.parse("2026-09-10T10:00:00Z");
  assert.equal(readRetryAfterMs(new Response(null, { headers: { "retry-after": "2" } }), now), 2000);
  assert.equal(readRetryAfterMs(new Response(null, { headers: { "retry-after": "-1" } }), now), null);
  assert.equal(readRetryAfterMs(new Response(null, { headers: { "retry-after": "Thu, 10 Sep 2026 10:00:03 GMT" } }), now), 3000);
  let calls = 0;
  await assert.rejects(retryKnowledgeModel(async () => { calls++; throw modelHttpError(429, "", 2000); }, { timeoutMs: 100 }), { code: "MODEL_RATE_LIMITED" });
  assert.equal(calls, 1);
  const startedAt = Date.now();
  await retryKnowledgeModel(async () => { if (++calls === 2) throw modelHttpError(429, "", 30); return {}; }, { timeoutMs: 200 });
  assert.ok(Date.now() - startedAt >= 25);
});

test("an attempt timeout can recover while every attempt and wait shares the total deadline", async () => {
  let calls = 0, firstSignal;
  const result = await retryKnowledgeModel(({ signal }) => {
    calls++;
    if (calls === 1) { firstSignal = signal; return new Promise(() => {}); }
    return { recovered: true };
  }, { timeoutMs: 150, attemptTimeoutMs: 10, baseDelayMs: 0 });
  assert.deepEqual(result, { recovered: true });
  assert.equal(firstSignal.aborted, true);
  const signals = [], startedAt = Date.now();
  await assert.rejects(retryKnowledgeModel(({ signal }) => { signals.push(signal); return new Promise(() => {}); }, { timeoutMs: 80, attemptTimeoutMs: 30, baseDelayMs: 0 }), { code: "DEADLINE_EXCEEDED" });
  assert.ok(Date.now() - startedAt < 200);
  assert.ok(signals.every((signal) => signal.aborted));
  let dispatched = false;
  await assert.rejects(retryKnowledgeModel(() => { dispatched = true; }, { timeoutMs: 0 }), { code: "DEADLINE_EXCEEDED" });
  assert.equal(dispatched, false);
});

test("cancellation during retry backoff never dispatches another attempt", async () => {
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(execution.run({ signal: controller.signal, onProgress: () => controller.abort() }, () => retryKnowledgeModel(async () => {
    calls++; throw modelHttpError(503, "", 1000);
  })), { name: "AbortError" });
  assert.equal(calls, 1);
});

test("parent cancellation also aborts an attempt that supplies its own independent signal", async () => {
  const parent = new AbortController(), child = new AbortController();
  let attemptSignal;
  const pending = execution.run({ signal: parent.signal }, () => retryKnowledgeModel(({ signal }) => {
    attemptSignal = signal;
    return new Promise(() => {});
  }, { signal: child.signal }));
  parent.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(attemptSignal.aborted, true);
});

test("retry attempts respect call and cost budgets, including conservative failed-call reservations", async () => {
  let calls = 0;
  gateway.registerAdapter("retry-budget", async () => { calls++; throw modelHttpError(503, "", 0); });
  const request = { integration: { model: "test", config: { protocol: "retry-budget" } }, messages: [] };
  await execution.run({ modelBudget: { max_tool_calls: 2 } }, async () => {
    await assert.rejects(gateway.request(request), { code: "MODEL_UNAVAILABLE" });
    assert.equal(execution.current().modelStats.calls, 2);
    await assert.rejects(gateway.request(request), { code: "MODEL_BUDGET_EXCEEDED" });
  });
  assert.equal(calls, 2);
  await execution.run({ modelBudget: { max_tool_calls: 3, max_query_cost_usd: 5 } }, async () => {
    await assert.rejects(gateway.request({ ...request, integration: { ...request.integration, config: { ...request.integration.config, pricing: { input_per_million_usd: 1000, output_per_million_usd: 1000 } } } }), { code: "MODEL_COST_BUDGET_EXCEEDED" });
    assert.equal(execution.current().modelStats.calls, 1);
  });
  assert.equal(calls, 3);
});

test("a failed buffered response body retries without leaking partial provider output into SSE", async (t) => {
  resetServiceResilienceState();
  let calls = 0;
  t.mock.method(global, "fetch", async () => {
    calls++;
    if (calls > 1) return completion();
    return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode("PRIVATE_PARTIAL_PROVIDER_TEXT"));
      controller.error(Object.assign(new Error("connection reset"), { code: "ECONNRESET" }));
    } }));
  });
  const raw = new EventEmitter(), writes = [];
  Object.assign(raw, { writableLength: 0, writeHead() {}, write: (value) => writes.push(value), end: () => { raw.writableEnded = true; } });
  await streamKnowledge({}, { raw, hijack() {}, getHeaders: () => ({}) }, ({ signal, onProgress }) => execution.run({ signal, onProgress }, () => assistant._internals.requestJsonCompletion(input("buffered-retry"))));
  const output = writes.join("");
  assert.equal(calls, 2);
  assert.equal((output.match(/event: result/g) || []).length, 1);
  assert.equal((output.match(/event: error/g) || []).length, 0);
  assert.doesNotMatch(output, /PRIVATE_PARTIAL_PROVIDER_TEXT/);
  assert.match(output, /"model_attempt":2/);
});

test("embedding retries recover before indexing switches to local fallback", async (t) => {
  resetServiceResilienceState();
  let calls = 0;
  t.mock.method(global, "fetch", async () => {
    calls++;
    return calls === 1 ? failure(503) : new Response(JSON.stringify({ data: [{ index: 0, embedding: [1, 0, 0] }] }));
  });
  const result = await rag._internals.embedTexts({ configured: true, baseUrl: "https://embedding-retry.invalid/v1", model: "fixture", provider: "fixture", integration: { id: "embedding-retry", api_key: "fixture" } }, ["authorized text"], { timeoutMs: 1000 });
  assert.equal(calls, 2);
  assert.equal(result.warning, null);
  assert.equal(result.model, "fixture");
  assert.deepEqual(result.vectors, [[1, 0, 0]]);
});

test("invalid embedding configuration skips dispatch and keeps the existing explicit fallback", async (t) => {
  let calls = 0;
  t.mock.method(global, "fetch", async () => { calls++; return completion(); });
  const result = await rag._internals.embedTexts({ configured: true, baseUrl: "not-a-URL", model: "fixture", integration: { id: "invalid-embedding", api_key: "fixture" } }, ["authorized text"]);
  assert.equal(calls, 0);
  assert.equal(result.warning_code, "embedding_fallback");
  assert.equal(result.warning_reason_code, "MODEL_CONFIGURATION_ERROR");
});
