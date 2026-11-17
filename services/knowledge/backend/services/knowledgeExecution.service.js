const { AsyncLocalStorage } = require("node:async_hooks");
const { randomUUID } = require("node:crypto");
const { performance } = require("node:perf_hooks");
const contracts = require("./knowledgeContracts.service");

const execution = new AsyncLocalStorage();
const STAGE_DURATION_BUCKETS_SECONDS = Object.freeze([0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]);
const stageNames = new Set(contracts.STAGES);
const terminationNames = new Set(Object.values(contracts.TERMINATION_REASONS));
const WORKER_STAGES = Object.freeze([
  "knowledge_native_outbox_batch", "knowledge_user_ingestion_batch", "knowledge_semantic_work_batch",
  "knowledge_embedding_backfill_scan", "knowledge_source_reconciliation", "knowledge_index_gap_reconciliation",
  "knowledge_graph_projection_batch", "knowledge_vector_projection_batch", "knowledge_lexical_reindex_batch",
  "knowledge_pgvector_index_maintenance", "knowledge_context_trace_purge", "knowledge_trace_partition_maintenance"
]);
const workerStageNames = new Set(WORKER_STAGES);
const stageMetricState = new Map();
const candidateMetricState = new Map();
const terminationMetricState = new Map();
const workerMetricState = new Map();
const retrievalMetricState = { total: 0, degraded: 0, candidates: 0 };
const stageMetric = (stage) => {
  let value = stageMetricState.get(stage);
  if (!value) {
    value = { completed: 0, failed: 0, durationSeconds: 0, buckets: STAGE_DURATION_BUCKETS_SECONDS.map(() => 0) };
    stageMetricState.set(stage, value);
  }
  return value;
};
const increment = (map, key, amount) => {
  if (!key || !Number.isFinite(amount) || amount <= 0) return;
  map.set(key, (map.get(key) || 0) + amount);
};
const abortError = () => Object.assign(new Error("The request was cancelled."), { name: "AbortError", code: "REQUEST_CANCELLED", statusCode: 499 });
const assertActive = () => { if (execution.getStore()?.signal?.aborted) throw abortError(); };

const run = (options, task) => {
  const context = { traceId: randomUUID(), progress: { sequence: 0, startedAt: Date.now() }, stageStartedAt: new Map(), events: [], usage: [], modelStats: { calls: 0 }, ...options };
  return execution.run(context, task);
};

const emit = (stage, status = "completed", metrics = {}) => {
  const context = execution.getStore();
  if (!context) return;
  assertActive();
  const normalizedStage = String(stage || "").toUpperCase();
  if (stageNames.has(normalizedStage)) {
    if (status === "started") {
      const starts = context.stageStartedAt.get(normalizedStage) || [];
      starts.push(performance.now());
      context.stageStartedAt.set(normalizedStage, starts);
    } else if (status === "completed" || status === "failed") {
      const starts = context.stageStartedAt.get(normalizedStage) || [];
      const startedAt = starts.pop();
      if (!starts.length) context.stageStartedAt.delete(normalizedStage);
      else context.stageStartedAt.set(normalizedStage, starts);
      if (Number.isFinite(startedAt)) {
        const elapsedSeconds = Math.max(0, (performance.now() - startedAt) / 1000);
        const metric = stageMetric(normalizedStage);
        metric[status] += 1;
        metric.durationSeconds += elapsedSeconds;
        STAGE_DURATION_BUCKETS_SECONDS.forEach((bucket, index) => { if (elapsedSeconds <= bucket) metric.buckets[index] += 1; });
      }
    }
  }
  if (stageNames.has(normalizedStage) && Number.isFinite(metrics.candidate_count)) {
    increment(candidateMetricState, normalizedStage, Math.max(0, metrics.candidate_count));
  }
  const event = contracts.buildRetrievalEvent({
    stage, status, traceId: context.traceId, queryId: context.queryId || context.traceId,
    requestId: context.requestId || context.queryId || context.traceId, sequence: ++context.progress.sequence,
    errorCode: metrics.error_code,
    trustedMessage: metrics.message,
    metrics: {
      elapsed_ms: Math.max(0, Date.now() - context.progress.startedAt),
      ...(Number.isFinite(metrics.candidate_count) ? { candidates_found: metrics.candidate_count } : {}),
      ...(Number.isFinite(metrics.evidence_count) ? { candidates_selected: metrics.evidence_count } : {}),
      ...(Number.isFinite(metrics.round) ? { retrieval_rounds: metrics.round } : {}),
      ...Object.fromEntries(["model_attempt", "model_max_attempts", "retry_delay_ms"].filter((key) => Number.isFinite(metrics[key])).map((key) => [key, metrics[key]]))
    },
    status: ({ started: "IN_PROGRESS", completed: "COMPLETE", failed: "FAILED" })[status] || status
  });
  context.events.push(event);
  context.onProgress?.(event);
  return event;
};

const recordRetrievalOutcome = ({ candidate_count = 0, degraded = false, termination_reason } = {}) => {
  retrievalMetricState.total += 1;
  if (degraded) retrievalMetricState.degraded += 1;
  retrievalMetricState.candidates += Number.isFinite(Number(candidate_count)) ? Math.max(0, Number(candidate_count)) : 0;
  const reason = terminationNames.has(termination_reason) ? termination_reason : contracts.TERMINATION_REASONS.FAILED;
  increment(terminationMetricState, reason, 1);
};

const metricsSnapshot = () => ({
  duration_buckets_seconds: [...STAGE_DURATION_BUCKETS_SECONDS],
  stages: Object.fromEntries([...stageMetricState].map(([stage, metric]) => [stage, {
    completed: metric.completed, failed: metric.failed, duration_seconds: metric.durationSeconds, buckets: [...metric.buckets]
  }])),
  candidate_stages: Object.fromEntries(candidateMetricState),
  retrievals: { ...retrievalMetricState },
  termination_reasons: Object.fromEntries(terminationMetricState),
  workers: Object.fromEntries(workerMetricState)
});

const recordWorkerBatch = (stage, { result = {}, elapsed_ms = 0, error = null } = {}) => {
  if (!workerStageNames.has(stage)) return;
  const metric = workerMetricState.get(stage) || { batches: 0, failures: 0, duration_seconds: 0, processed: 0, queue_lag_seconds: null };
  metric.batches += 1;
  if (error) metric.failures += 1;
  metric.duration_seconds += Math.max(0, Number(elapsed_ms) || 0) / 1000;
  metric.processed += [result?.processed, result?.upgraded, result?.archived, result?.deleted, result?.months_ensured]
    .reduce((sum, value) => sum + (Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0), 0);
  const lag = Number(result?.queue?.oldest_lag_seconds ?? result?.oldest_lag_seconds ?? result?.queue_lag_seconds);
  if (Number.isFinite(lag) && lag >= 0) metric.queue_lag_seconds = lag;
  workerMetricState.set(stage, metric);
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

module.exports = { run, emit, bounded, assertActive, abortError, current: () => execution.getStore(), recordRetrievalOutcome, recordWorkerBatch, metricsSnapshot };
