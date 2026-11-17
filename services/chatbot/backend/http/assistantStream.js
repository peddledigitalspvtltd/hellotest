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
    // Only the persisted, contract-checked answer is streamed. The evidence
    // cards go first, then paragraphs from the validated contract, so provider
    // drafts and claims removed by validation can never reach the browser.
    const message = result?.assistant_message || result?.message;
    const contract = result?.answer_contract || message?.answer_contract || message?.retrieval?.answer_contract;
    if (active() && message && typeof message.id === "string" && message.id.length <= 255
      && typeof message.content === "string" && message.content.length > 0
      && contract?.contract_type === "AnswerContract"
      && ["1.0", "AnswerContract.v1"].includes(contract.contract_version)
      && Array.isArray(contract.claims) && Array.isArray(contract.citation_ids)) {
      const citations = (Array.isArray(message.citations) ? message.citations : []).slice(0, 30).map(item => ({
        id: String(item.id || "").slice(0, 255),
        source_id: typeof item.source_id === "string" ? item.source_id.slice(0, 255) : null,
        source_kind: typeof item.source_kind === "string" ? item.source_kind.slice(0, 80) : null,
        title: String(item.title || item.label || "Project source").slice(0, 500),
        uri: typeof item.uri === "string" ? item.uri.slice(0, 2000) : null,
        source_uri: typeof item.source_uri === "string" ? item.source_uri.slice(0, 2000) : null,
        freshness: item.freshness && typeof item.freshness === "object" ? { current: item.freshness.current === true } : undefined
      })).filter(item => item.id);
      if (citations.length && !send("answer_sources", { contract_type: "AnswerSources", contract_version: "1.0", verification: "complete", answer_id: message.id, citations })) await waitForDrain();
      const sections = message.content.split(/(\n{2,})/).reduce((items, part, index, all) => {
        if (index % 2 === 0) items.push(`${part}${all[index + 1] || ""}`);
        return items;
      }, []);
      const sectionCount = Math.max(1, sections.length);
      let sequence = 0;
      for (let sectionIndex = 0; sectionIndex < sections.length && active(); sectionIndex++) {
        let remaining = sections[sectionIndex];
        while (remaining && active()) {
          let end = Math.min(4096, remaining.length);
          if (end < remaining.length && /[\uD800-\uDBFF]/.test(remaining[end - 1])) end -= 1;
          if (!end) end = Math.min(4096, remaining.length);
          const chunk = remaining.slice(0, end);
          remaining = remaining.slice(end);
          const delivered = send("answer_delta", { contract_type: "AnswerDelta", contract_version: "1.0", verification: "complete",
            answer_id: message.id, sequence: sequence++, section_index: sectionIndex, section_count: sectionCount, text: chunk });
          if (!delivered) await waitForDrain();
        }
      }
    }
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
