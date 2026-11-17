const assert = require("node:assert/strict");
const test = require("node:test");
const execution = require("../../../knowledge/backend/services/knowledgeExecution.service");
const { formatKnowledgeMetrics } = require("../src/knowledgeMetrics");

test("Knowledge retrieval metrics expose bounded stage timing, candidates and outcomes", async () => {
  await execution.run({}, async () => {
    execution.emit("HYBRID_SEARCH", "started");
    await new Promise((resolve) => setTimeout(resolve, 12));
    execution.emit("HYBRID_SEARCH", "completed", { candidate_count: 7 });
    execution.emit("RERANKING", "started");
    execution.emit("RERANKING", "failed", { error_code: "RERANKER_TIMEOUT" });
    execution.recordRetrievalOutcome({ candidate_count: 7, degraded: true, termination_reason: "context_sufficient" });
  });
  execution.recordWorkerBatch("knowledge_native_outbox_batch", {
    result: { processed: 2, queue: { queued: 4, oldest_lag_seconds: 12.5 } }, elapsed_ms: 24
  });

  const metrics = formatKnowledgeMetrics(execution.metricsSnapshot(), {
    knowledge_native_outbox_batch: { queued: 4, oldest_lag_seconds: 12.5 }
  });
  assert.match(metrics, /hellotest_knowledge_stage_duration_seconds_count\{stage="HYBRID_SEARCH"\} [1-9]/);
  assert.match(metrics, /hellotest_knowledge_stage_failures_total\{stage="RERANKING"\} [1-9]/);
  assert.match(metrics, /hellotest_knowledge_candidates_total\{stage="HYBRID_SEARCH"\} [1-9]/);
  assert.match(metrics, /hellotest_knowledge_retrievals_total\{degraded="true"\} [1-9]/);
  assert.match(metrics, /hellotest_knowledge_termination_total\{reason="context_sufficient"\} [1-9]/);
  assert.match(metrics, /hellotest_knowledge_worker_queue_lag_seconds\{stage="knowledge_native_outbox_batch"\} 12\.500/);
  assert.match(metrics, /hellotest_knowledge_worker_processed_total\{stage="knowledge_native_outbox_batch"\} [1-9]/);
  assert.match(metrics, /hellotest_knowledge_worker_queue_depth\{stage="knowledge_native_outbox_batch"\} 4/);
  assert.match(metrics, /hellotest_knowledge_worker_queue_oldest_lag_seconds\{stage="knowledge_native_outbox_batch"\} 12\.500/);
  assert.doesNotMatch(metrics, /query|project_id|user_id|trace_id/i);
});
