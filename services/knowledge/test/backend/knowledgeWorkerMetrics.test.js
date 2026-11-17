const assert = require("node:assert/strict");
const test = require("node:test");
const metrics = require("../../backend/services/knowledgeWorkerMetrics.service");

test("worker backlog metrics include only fixed queue stages and aggregate age/counts", () => {
  const result = metrics.normalizeQueueMetrics([
    { stage: "knowledge_native_outbox_batch", queued: "4", oldest_lag_seconds: "12.5" },
    { stage: "user:private-project", queued: 10_000, oldest_lag_seconds: 60 }
  ]);
  assert.deepEqual(Object.keys(result), ["knowledge_native_outbox_batch"]);
  assert.deepEqual(result.knowledge_native_outbox_batch, { queued: 4, oldest_lag_seconds: 12.5 });
  assert.match(metrics.queueMetricsSql, /FROM ai_knowledge_graph_projection_states/);
  assert.match(metrics.queueMetricsSql, /FROM ai_knowledge_semantic_jobs/);
  assert.doesNotMatch(metrics.queueMetricsSql, /project_id|source_ref_id|document_id|user_id/i);
});
