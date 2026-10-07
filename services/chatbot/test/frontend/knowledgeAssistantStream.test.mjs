import assert from "node:assert/strict";
import test from "node:test";
import { appendKnowledgeProgressEvent, consumeKnowledgeAssistantStream, isKnowledgeAnswerDelta, KnowledgeStreamError, knowledgeTurnNotice, knowledgeProgressLabel, knowledgeProgressDescription, knowledgeModelFailureMessage, knowledgeElapsedLabel, resumePendingKnowledgeTurn } from "../../frontend/lib/knowledgeAssistantStream.ts";

const progress = { contract_type: "RetrievalEvent", contract_version: "1.0", stage: "LEXICAL_SEARCH", status: "IN_PROGRESS", message: "Searching café notes" };
const result = { assistant_message: { id: "answer", role: "assistant", content: "Answer", citations: [] } };
const event = (name, data) => `event: ${name}\r\ndata: ${JSON.stringify(data)}\r\n\r\n`;
const streamed = (source, chunkSize = 1) => {
  const bytes = new TextEncoder().encode(source);
  return new Response(new ReadableStream({ start(controller) { for (let offset = 0; offset < bytes.length; offset += chunkSize) controller.enqueue(bytes.slice(offset, offset + chunkSize)); controller.close(); } }), { headers: { "content-type": "text/event-stream" } });
};

test("authenticated SSE consumer handles byte-split Unicode, CRLF, comments and reported progress", async () => {
  const received = [];
  const answer = await consumeKnowledgeAssistantStream(streamed(`: heartbeat\r\n\r\n${event("progress", progress)}${event("result", result)}`), { onProgress: (item) => received.push(item) });
  assert.deepEqual(received, [progress]);
  assert.deepEqual(answer, result);
});

test("multi-line event data and final lines without a blank delimiter are accepted", async () => {
  const source = 'event: result\ndata: {"assistant_message":\ndata: {"id":"answer","content":"Done"}}';
  assert.equal((await consumeKnowledgeAssistantStream(streamed(source, 7))).assistant_message.content, "Done");
});

test("a partial network stream never becomes a completed answer", async () => {
  await assert.rejects(consumeKnowledgeAssistantStream(streamed(event("progress", progress))), (error) => error instanceof KnowledgeStreamError && error.code === "STREAM_INTERRUPTED" && error.retryable);
});

test("cancellation interrupts a pending stream read and releases the connection", async () => {
  const controller = new AbortController();
  let cancelled = false;
  const response = new Response(new ReadableStream({ cancel() { cancelled = true; } }));
  const pending = consumeKnowledgeAssistantStream(response, { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, (error) => error.name === "AbortError");
  assert.equal(cancelled, true);
});

test("server errors retain retry eligibility and support references", async () => {
  await assert.rejects(consumeKnowledgeAssistantStream(streamed(event("error", { code: "SCOPE_REVOKED", message: "Scope changed", retryable: false, trace_id: "trace-1" }))), (error) => error.code === "SCOPE_REVOKED" && !error.retryable && error.message.includes("trace-1"));
});

test("unsupported contracts and malformed final payloads fail without rendering them", async () => {
  await assert.rejects(consumeKnowledgeAssistantStream(streamed(event("progress", { ...progress, contract_version: "9.0" }))), /unsupported progress contract/);
  await assert.rejects(consumeKnowledgeAssistantStream(streamed(event("result", { html: "<script>bad()</script>" }))), /invalid result/);
  await assert.rejects(consumeKnowledgeAssistantStream(streamed("event: result\ndata: not-json\n\n")), /invalid event/);
});

test("an idempotent pending response remains pending for the same-turn retry flow", async () => {
  const pending = { pending: true, client_turn_id: "turn-1", retry_after_seconds: 3 };
  assert.deepEqual(await consumeKnowledgeAssistantStream(streamed(event("result", pending))), pending);
});

test("pending turns automatically resume through the same request and stop after a bounded number of checks", async () => {
  let calls = 0;
  let pendingEvents = 0;
  const response = await resumePendingKnowledgeTurn(async () => ++calls < 3 ? { pending: true, client_turn_id: "original" } : result, { retryDelayMs: 1, onPending: () => pendingEvents++ });
  assert.equal(response, result);
  assert.equal(calls, 3);
  assert.equal(pendingEvents, 2);
  calls = 0;
  await assert.rejects(resumePendingKnowledgeTurn(async () => { calls++; return { pending: true }; }, { retryDelayMs: 1, maxPendingRetries: 2 }), error => error.code === "TURN_PENDING" && knowledgeTurnNotice(error).kind === "pending");
  assert.equal(calls, 3);
});

test("Stop interrupts pending retry delay without issuing another request", async () => {
  const controller = new AbortController();
  let calls = 0;
  const pending = resumePendingKnowledgeTurn(async () => { calls++; return { pending: true }; }, { signal: controller.signal, onPending: () => controller.abort() });
  await assert.rejects(pending, error => error.name === "AbortError");
  assert.equal(calls, 1);
});

test("failure messages distinguish connection, service timeout, pending and explicit Stop", () => {
  assert.match(knowledgeTurnNotice(new KnowledgeStreamError("timeout", "REQUEST_TIMEOUT")).title, /took too long/);
  assert.match(knowledgeTurnNotice(new KnowledgeStreamError("lost", "STREAM_INTERRUPTED")).title, /connection/i);
  assert.equal(knowledgeTurnNotice(new KnowledgeStreamError("wait", "TURN_PENDING")).kind, "pending");
  assert.equal(knowledgeTurnNotice(new Error("aborted"), true).kind, "cancelled");
  assert.equal(knowledgeTurnNotice(new KnowledgeStreamError("Access revoked", "SCOPE_REVOKED", false)).retryable, false);
});

test("live progress uses reported stages and real elapsed time; model failures never imply retrieval failed", () => {
  assert.equal(knowledgeProgressLabel({ stage: "GENERATION" }), "Writing an answer from the evidence");
  assert.equal(knowledgeProgressLabel({ stage: "LEXICAL_SEARCH" }), "Searching project records and documents");
  assert.equal(knowledgeElapsedLabel(65_400), "1m 05s");
  for (const code of ["MODEL_AUTHENTICATION_FAILED", "MODEL_NOT_FOUND", "MODEL_QUOTA_EXCEEDED", "MODEL_RATE_LIMITED", "MODEL_TIMEOUT", "MODEL_INVALID_RESPONSE"]) {
    const explanation = knowledgeModelFailureMessage(code);
    assert.doesNotMatch(explanation, /retrieval failed|context timed out/i);
    assert.match(explanation, /sources|evidence/);
  }
  assert.match(knowledgeModelFailureMessage("MODEL_AUTHENTICATION_FAILED"), /credentials/);
  assert.match(knowledgeModelFailureMessage("MODEL_QUOTA_EXCEEDED"), /quota/);
});

test("retry progress reports real attempts without implying a final model or retrieval failure", () => {
  const retry = { ...progress, stage: "GENERATION", sequence: 3, error_code: "MODEL_RATE_LIMITED", metrics: { model_attempt: 2, model_max_attempts: 3, retry_delay_ms: 1000, elapsed_ms: 3200 } };
  assert.equal(knowledgeProgressLabel(retry), "Retrying answer model · attempt 2 of 3");
  assert.match(knowledgeProgressDescription(retry), /provider is limiting requests.*Retrying automatically/);
  assert.match(knowledgeProgressLabel({ ...retry, stage: "HYBRID_SEARCH" }), /Retrying related-evidence search/);
  assert.match(knowledgeProgressLabel({ ...retry, stage: "RETRIEVAL_PLANNING" }), /Retrying search planning/);
  assert.match(knowledgeProgressDescription({ ...retry, error_code: "MODEL_TIMEOUT" }), /previous model attempt took too long/);
  assert.equal(knowledgeProgressLabel({ ...retry, status: "FAILED" }), "The answer model is unavailable");
  assert.equal(knowledgeProgressLabel({ ...retry, metrics: { model_attempt: NaN, model_max_attempts: 3 } }), "Writing an answer from the evidence");
  let events = appendKnowledgeProgressEvent([], retry);
  events = appendKnowledgeProgressEvent(events, retry);
  events = appendKnowledgeProgressEvent(events, { ...retry, sequence: 4, metrics: { ...retry.metrics, model_attempt: 3 } });
  assert.deepEqual(events.map((item) => item.metrics.model_attempt), [2, 3]);
});

test("provider retry progress stays in the same SSE request and resolves only the final answer", async () => {
  const retry = { ...progress, stage: "GENERATION", metrics: { model_attempt: 2, model_max_attempts: 3 } };
  const events = [];
  const answer = await consumeKnowledgeAssistantStream(streamed(`${event("progress", retry)}${event("result", result)}`), { onProgress: (item) => events.push(item) });
  assert.deepEqual(answer, result);
  assert.deepEqual(events, [retry]);
});

const delta = (text, sequence = 0, answerId = "answer") => ({ contract_type: "AnswerDelta", contract_version: "1.0", verification: "complete", answer_id: answerId, sequence, text });

test("checked answer delivery preserves split Unicode and completes only with the matching saved result", async () => {
  const final = { assistant_message: { ...result.assistant_message, content: "Café 🧪 evidence" } };
  const received = [];
  const answer = await consumeKnowledgeAssistantStream(streamed(`${event("answer_delta", delta("Café 🧪 "))}${event("answer_delta", delta("evidence", 1))}${event("result", final)}`), { onAnswerDelta: item => received.push(item) });
  assert.equal(received.map(item => item.text).join(""), final.assistant_message.content);
  assert.deepEqual(answer, final);
});

test("unchecked, reordered, mixed-answer and mismatched deltas never complete a turn", async () => {
  assert.equal(isKnowledgeAnswerDelta({ ...delta("text"), verification: "pending" }), false);
  assert.equal(isKnowledgeAnswerDelta({ ...delta("text"), sequence: 0.5 }), false);
  assert.equal(isKnowledgeAnswerDelta({ ...delta("text"), text: "x".repeat(4097) }), false);
  for (const source of [
    event("answer_delta", { ...delta("Answer"), verification: "pending" }),
    event("answer_delta", delta("Answer", 1)),
    event("answer_delta", delta("An")) + event("answer_delta", delta("swer", 1, "another-answer")),
    event("answer_delta", delta("Another")) + event("result", result),
    event("answer_delta", delta("Answer")) + event("result", { pending: true })
  ]) await assert.rejects(consumeKnowledgeAssistantStream(streamed(source)), error => error instanceof KnowledgeStreamError);
  await assert.rejects(consumeKnowledgeAssistantStream(streamed(event("answer_delta", delta("Answer")))), error => error.code === "STREAM_INTERRUPTED");
});

test("unknown extension events are ignored and terminal result closes the reader immediately", async () => {
  const source = `event: future-extension\ndata: plain extension data\n\n${event("result", result)}event: error\ndata: invalid trailing data\n\n`;
  assert.deepEqual(await consumeKnowledgeAssistantStream(streamed(source, 1000)), result);
});

test("connection recovery checks the same turn once and never retries authorization failures", async () => {
  let calls = 0, reconnects = 0;
  const answer = await resumePendingKnowledgeTurn(async () => { calls++; if (calls === 1) throw new KnowledgeStreamError("Disconnected", "STREAM_INTERRUPTED"); return result; }, { maxConnectionRetries: 1, connectionRetryDelayMs: 0, onReconnecting: () => reconnects++ });
  assert.deepEqual(answer, result);
  assert.equal(calls, 2);
  assert.equal(reconnects, 1);
  calls = 0;
  await assert.rejects(resumePendingKnowledgeTurn(async () => { calls++; throw new KnowledgeStreamError("Denied", "HTTP_403", false); }, { maxConnectionRetries: 1 }), error => error.code === "HTTP_403");
  assert.equal(calls, 1);
  calls = 0;
  await assert.rejects(resumePendingKnowledgeTurn(async () => { calls++; throw new KnowledgeStreamError("Disconnected", "STREAM_INTERRUPTED"); }, { maxConnectionRetries: 1, connectionRetryDelayMs: 0 }), error => error.code === "STREAM_INTERRUPTED");
  assert.equal(calls, 2);
});

test("an underlying reader failure is classified as an interrupted connection for same-turn recovery", async () => {
  const response = new Response(new ReadableStream({ start(controller) { controller.error(new TypeError("Socket closed")); } }));
  await assert.rejects(consumeKnowledgeAssistantStream(response), error => error instanceof KnowledgeStreamError && error.code === "STREAM_INTERRUPTED");
});
