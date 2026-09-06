import assert from "node:assert/strict";
import test from "node:test";
import { consumeKnowledgeAssistantStream, KnowledgeStreamError } from "../src/lib/knowledgeAssistantStream.ts";

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
