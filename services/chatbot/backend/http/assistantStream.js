const { randomUUID } = require("node:crypto");
const { publicKnowledgeError } = require("@hellotest/platform/backend/src/utils/knowledgeAssistantErrors");

/** Deliver only the answer that has passed grounding, access checks and persistence.
 * Raw provider tokens may contain rejected claims and are never sent to a browser.
 */
const answerDeliveryEvents = function* (result, chunkSize = 240) {
  if (result?.pending) return;
  const answer = result?.assistant_message || result?.message;
  if (!answer?.id || typeof answer.content !== "string") return;
  const width = Number.isSafeInteger(chunkSize) && chunkSize > 0 ? Math.min(chunkSize, 2_048) : 240;
  const characters = Array.from(answer.content);
  for (let offset = 0, sequence = 0; offset < characters.length; offset += width, sequence += 1) {
    yield {
      contract_type: "AnswerDelta", contract_version: "1.0", verification: "complete",
      answer_id: String(answer.id), sequence, text: characters.slice(offset, offset + width).join("")
    };
  }
};

const streamAssistant = async (req, reply, task) => {
  const controller = new AbortController();
  const traceId = randomUUID();
  reply.hijack();
  reply.raw.writeHead(200, {
    ...reply.getHeaders(), "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no"
  });
  const active = () => !controller.signal.aborted && !reply.raw.destroyed && !reply.raw.writableEnded;
  const send = (event, data) => {
    if (!active()) return false;
    if (reply.raw.writableLength > 1024 * 1024) { controller.abort(); reply.raw.destroy(); return false; }
    return reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const disconnect = () => { if (!reply.raw.writableEnded) controller.abort(); };
  reply.raw.on("close", disconnect);
  const waitForDrain = () => new Promise((resolve) => {
    if (!active()) { resolve(); return; }
    let timer;
    const cleanup = () => { clearTimeout(timer); reply.raw.removeListener("drain", done); controller.signal.removeEventListener("abort", done); resolve(); };
    const done = () => cleanup();
    reply.raw.once("drain", done);
    controller.signal.addEventListener("abort", done, { once: true });
    timer = setTimeout(() => { controller.abort(); reply.raw.destroy(); cleanup(); }, 15_000);
    timer.unref?.();
  });
  const heartbeat = setInterval(() => { if (active() && reply.raw.writableLength < 1024 * 1024) reply.raw.write(": keep-alive\n\n"); }, 15_000);
  heartbeat.unref?.();
  try {
    const result = await task({ signal: controller.signal, onProgress: (event) => send("progress", event) });
    // Progress is transport activity. Only the terminal result completes a turn.
    for (const delta of answerDeliveryEvents(result)) {
      if (!active()) break;
      if (!send("answer_delta", delta)) await waitForDrain();
    }
    send("result", result);
  } catch (error) {
    if (active()) {
      req.log?.error({ err: error, trace_id: traceId }, "Assistant stream failed");
      send("error", { code: error.code || "KNOWLEDGE_REQUEST_FAILED", message: publicKnowledgeError(error),
        retryable: !error.statusCode || error.statusCode >= 500 || error.statusCode === 429, trace_id: traceId });
    }
  } finally {
    clearInterval(heartbeat);
    reply.raw.removeListener("close", disconnect);
    if (!reply.raw.destroyed && !reply.raw.writableEnded) reply.raw.end();
  }
};

module.exports = { streamAssistant, answerDeliveryEvents };
