const { randomUUID } = require("node:crypto");
const { publicKnowledgeError } = require("./knowledgeAssistantErrors");

// Authentication and project authorization must finish before this function
// takes ownership of the response. No provider text is emitted as progress.
const streamKnowledge = async (req, reply, task, { publicError = publicKnowledgeError } = {}) => {
  const controller = new AbortController();
  const traceId = randomUUID();
  reply.hijack();
  reply.raw.writeHead(200, {
    ...reply.getHeaders(), "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no"
  });
  const send = (event, data) => {
    if (controller.signal.aborted || reply.raw.destroyed || reply.raw.writableEnded) return;
    // Bound a disconnected/slow reader rather than growing process memory.
    if (reply.raw.writableLength > 1024 * 1024) { controller.abort(); reply.raw.destroy(); return; }
    reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const disconnect = () => { if (!reply.raw.writableEnded) controller.abort(); };
  reply.raw.on("close", disconnect);
  const heartbeat = setInterval(() => {
    if (!reply.raw.destroyed && !reply.raw.writableEnded) reply.raw.write(": keep-alive\n\n");
  }, 15_000);
  heartbeat.unref?.();
  try {
    const result = await task({ signal: controller.signal, onProgress: (event) => send("progress", event) });
    send("result", result);
  } catch (error) {
    if (!controller.signal.aborted) {
      req.log?.error({ err: error, trace_id: traceId }, "Knowledge stream failed");
      send("error", { code: error.code || "KNOWLEDGE_REQUEST_FAILED", message: publicError(error),
        retryable: !error.statusCode || error.statusCode >= 500 || error.statusCode === 429, trace_id: traceId });
    }
  } finally {
    clearInterval(heartbeat);
    reply.raw.removeListener("close", disconnect);
    if (!reply.raw.destroyed && !reply.raw.writableEnded) reply.raw.end();
  }
};

module.exports = { streamKnowledge };
