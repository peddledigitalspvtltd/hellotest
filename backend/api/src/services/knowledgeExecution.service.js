const { AsyncLocalStorage } = require("node:async_hooks");
const { randomUUID } = require("node:crypto");
const contracts = require("./knowledgeContracts.service");

const execution = new AsyncLocalStorage();
const abortError = () => Object.assign(new Error("The request was cancelled."), { name: "AbortError", code: "REQUEST_CANCELLED", statusCode: 499 });
const assertActive = () => { if (execution.getStore()?.signal?.aborted) throw abortError(); };

const run = (options, task) => {
  const context = { traceId: randomUUID(), progress: { sequence: 0, startedAt: Date.now() }, events: [], usage: [], modelStats: { calls: 0 }, ...options };
  return execution.run(context, task);
};

const emit = (stage, status = "completed", metrics = {}) => {
  const context = execution.getStore();
  if (!context) return;
  assertActive();
  const event = contracts.buildRetrievalEvent({
    stage, status, traceId: context.traceId, queryId: context.queryId || context.traceId,
    requestId: context.requestId || context.queryId || context.traceId, sequence: ++context.progress.sequence,
    errorCode: metrics.error_code,
    metrics: {
      elapsed_ms: Math.max(0, Date.now() - context.progress.startedAt),
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
  const duration = timeoutMs == null || !Number.isFinite(Number(timeoutMs)) ? 15_000 : Number(timeoutMs);
  const deadlineError = () => Object.assign(new Error("The operation deadline was reached."), { code: "DEADLINE_EXCEEDED" });
  if (duration <= 0) throw deadlineError();
  const controller = new AbortController();
  let timer;
  let onAbort;
  const interrupted = new Promise((_, reject) => {
    onAbort = () => { controller.abort(); reject(abortError()); };
    signal?.addEventListener("abort", onAbort, { once: true });
    timer = setTimeout(() => {
      controller.abort();
      reject(deadlineError());
    }, duration);
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
