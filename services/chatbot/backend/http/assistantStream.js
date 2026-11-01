const { randomUUID } = require("node:crypto");
const { publicKnowledgeError } = require("@hellotest/platform/backend/src/utils/knowledgeAssistantErrors");

// JSON clients receive the same disconnect cancellation as the streaming UI.
const runConnectedAssistant = async (req, reply, task) => {
  const controller = new AbortController();
  const disconnect = () => { if (!reply.raw.writableEnded) controller.abort(); };
  req.raw?.once("aborted", disconnect);
  reply.raw.once("close", disconnect);
  if (req.raw?.aborted || reply.raw.destroyed) controller.abort();
  try {
    controller.signal.throwIfAborted();
    return await task({ signal: controller.signal });
  } finally {
    req.raw?.removeListener("aborted", disconnect);
    reply.raw.removeListener("close", disconnect);
  }
};

const streamAssistant = async (req, reply, task) => {
  const controller = new AbortController();
  const traceId = randomUUID();
  if (req.raw?.aborted || reply.raw.destroyed) return;
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
  req.raw?.once("aborted", disconnect);
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
    // Deliver the complete saved contract once. Artificially splitting an
    // already-validated answer duplicates its content and exposes an incomplete
    // preview before the structured answer and its citations arrive.
    if (active() && !send("result", result)) await waitForDrain();
  } catch (error) {
    if (active()) {
      req.log?.error({ err: error, trace_id: traceId }, "Assistant stream failed");
      send("error", { code: error.code || "KNOWLEDGE_REQUEST_FAILED", message: publicKnowledgeError(error),
        retryable: !error.statusCode || error.statusCode >= 500 || error.statusCode === 429, trace_id: traceId });
    }
  } finally {
    clearInterval(heartbeat);
    req.raw?.removeListener("aborted", disconnect);
    reply.raw.removeListener("close", disconnect);
    if (!reply.raw.destroyed && !reply.raw.writableEnded) reply.raw.end();
  }
};

module.exports = { streamAssistant, runConnectedAssistant };
