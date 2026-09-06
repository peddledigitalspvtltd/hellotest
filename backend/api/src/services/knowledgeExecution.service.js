const { AsyncLocalStorage } = require("node:async_hooks");
const { randomUUID } = require("node:crypto");
const contracts = require("./knowledgeContracts.service");

const execution = new AsyncLocalStorage();
const abortError = () => Object.assign(new Error("The request was cancelled."), { name: "AbortError", code: "REQUEST_CANCELLED", statusCode: 499 });
const assertActive = () => { if (execution.getStore()?.signal?.aborted) throw abortError(); };

const run = (options, task) => {
  const context = { traceId: randomUUID(), sequence: 0, events: [], usage: [], modelStats: { calls: 0 }, ...options };
  return execution.run(context, task);
};

const emit = (stage, status = "completed", metrics = {}) => {
  const context = execution.getStore();
  if (!context) return;
  assertActive();
  const event = contracts.buildRetrievalEvent({
    stage, status, traceId: context.traceId, queryId: context.queryId || context.traceId,
    requestId: context.requestId || context.queryId || context.traceId, sequence: ++context.sequence,
    metrics: {
      ...(Number.isFinite(metrics.candidate_count) ? { candidates_found: metrics.candidate_count } : {}),
      ...(Number.isFinite(metrics.evidence_count) ? { candidates_selected: metrics.evidence_count } : {}),
      ...(Number.isFinite(metrics.round) ? { retrieval_rounds: metrics.round } : {})
    },
    status: ({ started: "IN_PROGRESS", completed: "COMPLETE", failed: "FAILED" })[status] || status
  });
  context.events.push(event);
  context.onProgress?.(event);
  return event;
};

// A deadline ends the caller's wait even when a database driver cannot cancel
// an in-flight read. The signal is also forwarded to network transports.
const bounded = async (task, { timeoutMs, signal = execution.getStore()?.signal } = {}) => {
  if (signal?.aborted) throw abortError();
  const controller = new AbortController();
  let timer;
  let onAbort;
  const interrupted = new Promise((_, reject) => {
    onAbort = () => { controller.abort(); reject(abortError()); };
    signal?.addEventListener("abort", onAbort, { once: true });
    timer = setTimeout(() => {
      controller.abort();
      reject(Object.assign(new Error("The retrieval deadline was reached."), { code: "DEADLINE_EXCEEDED" }));
    }, Math.max(1, Number(timeoutMs) || 15_000));
  });
  try {
    const active = execution.getStore();
    return await Promise.race([
      active ? execution.run({ ...active, signal: controller.signal }, () => task(controller.signal))
        : run({ signal: controller.signal }, () => task(controller.signal)),
      interrupted
    ]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
};

module.exports = { run, emit, bounded, assertActive, abortError, current: () => execution.getStore() };
