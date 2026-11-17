const formatKnowledgeMetrics = (snapshot = {}, workerQueues = {}) => {
  const lines = [
    "# HELP hellotest_knowledge_stage_duration_seconds Time spent in bounded Knowledge retrieval stages.",
    "# TYPE hellotest_knowledge_stage_duration_seconds histogram"
  ];
  const buckets = Array.isArray(snapshot.duration_buckets_seconds) ? snapshot.duration_buckets_seconds : [];
  for (const [stage, metric] of Object.entries(snapshot.stages || {})) {
    const labels = `stage="${stage}"`;
    buckets.forEach((bucket, index) => {
      lines.push(`hellotest_knowledge_stage_duration_seconds_bucket{${labels},le="${bucket}"} ${Number(metric.buckets?.[index] || 0)}`);
    });
    lines.push(`hellotest_knowledge_stage_duration_seconds_bucket{${labels},le="+Inf"} ${Number(metric.completed || 0) + Number(metric.failed || 0)}`);
    lines.push(`hellotest_knowledge_stage_duration_seconds_sum{${labels}} ${Number(metric.duration_seconds || 0).toFixed(6)}`);
    lines.push(`hellotest_knowledge_stage_duration_seconds_count{${labels}} ${Number(metric.completed || 0) + Number(metric.failed || 0)}`);
  }

  lines.push("# HELP hellotest_knowledge_stage_failures_total Failed Knowledge retrieval stages.");
  lines.push("# TYPE hellotest_knowledge_stage_failures_total counter");
  for (const [stage, metric] of Object.entries(snapshot.stages || {})) {
    lines.push(`hellotest_knowledge_stage_failures_total{stage="${stage}"} ${Number(metric.failed || 0)}`);
  }

  lines.push("# HELP hellotest_knowledge_candidates_total Candidates examined by Knowledge retrieval stage.");
  lines.push("# TYPE hellotest_knowledge_candidates_total counter");
  for (const [stage, count] of Object.entries(snapshot.candidate_stages || {})) {
    lines.push(`hellotest_knowledge_candidates_total{stage="${stage}"} ${Number(count || 0)}`);
  }

  const retrievals = snapshot.retrievals || {};
  lines.push("# HELP hellotest_knowledge_retrievals_total Completed Knowledge retrieval requests by degraded outcome.");
  lines.push("# TYPE hellotest_knowledge_retrievals_total counter");
  lines.push(`hellotest_knowledge_retrievals_total{degraded="false"} ${Math.max(0, Number(retrievals.total || 0) - Number(retrievals.degraded || 0))}`);
  lines.push(`hellotest_knowledge_retrievals_total{degraded="true"} ${Number(retrievals.degraded || 0)}`);
  lines.push("# HELP hellotest_knowledge_retrieval_candidates_total Candidate records examined across retrieval requests.");
  lines.push("# TYPE hellotest_knowledge_retrieval_candidates_total counter");
  lines.push(`hellotest_knowledge_retrieval_candidates_total ${Number(retrievals.candidates || 0)}`);

  lines.push("# HELP hellotest_knowledge_termination_total Retrievals grouped by bounded termination reason.");
  lines.push("# TYPE hellotest_knowledge_termination_total counter");
  for (const [reason, count] of Object.entries(snapshot.termination_reasons || {})) {
    lines.push(`hellotest_knowledge_termination_total{reason="${reason}"} ${Number(count || 0)}`);
  }

  lines.push("# HELP hellotest_knowledge_worker_batches_total Knowledge worker batches by fixed processing stage.");
  lines.push("# TYPE hellotest_knowledge_worker_batches_total counter");
  lines.push("# HELP hellotest_knowledge_worker_failures_total Failed Knowledge worker batches by fixed processing stage.");
  lines.push("# TYPE hellotest_knowledge_worker_failures_total counter");
  lines.push("# HELP hellotest_knowledge_worker_processed_total Knowledge items processed by worker stage.");
  lines.push("# TYPE hellotest_knowledge_worker_processed_total counter");
  lines.push("# HELP hellotest_knowledge_worker_batch_duration_seconds_total Cumulative Knowledge worker batch duration in seconds.");
  lines.push("# TYPE hellotest_knowledge_worker_batch_duration_seconds_total counter");
  lines.push("# HELP hellotest_knowledge_worker_queue_lag_seconds Last observed age of the oldest queued item for a worker stage.");
  lines.push("# TYPE hellotest_knowledge_worker_queue_lag_seconds gauge");
  for (const [stage, metric] of Object.entries(snapshot.workers || {})) {
    const labels = `stage="${stage}"`;
    lines.push(`hellotest_knowledge_worker_batches_total{${labels}} ${Number(metric.batches || 0)}`);
    lines.push(`hellotest_knowledge_worker_failures_total{${labels}} ${Number(metric.failures || 0)}`);
    lines.push(`hellotest_knowledge_worker_processed_total{${labels}} ${Number(metric.processed || 0)}`);
    lines.push(`hellotest_knowledge_worker_batch_duration_seconds_total{${labels}} ${Number(metric.duration_seconds || 0).toFixed(6)}`);
    if (Number.isFinite(Number(metric.queue_lag_seconds))) {
      lines.push(`hellotest_knowledge_worker_queue_lag_seconds{${labels}} ${Number(metric.queue_lag_seconds).toFixed(3)}`);
    }
  }
  lines.push("# HELP hellotest_knowledge_worker_queue_depth Current due items waiting in each durable Knowledge work queue.");
  lines.push("# TYPE hellotest_knowledge_worker_queue_depth gauge");
  for (const [stage, queue] of Object.entries(workerQueues || {})) {
    lines.push(`hellotest_knowledge_worker_queue_depth{stage="${stage}"} ${Number(queue.queued || 0)}`);
  }
  lines.push("# HELP hellotest_knowledge_worker_queue_oldest_lag_seconds Age of the oldest due Knowledge work item by stage.");
  lines.push("# TYPE hellotest_knowledge_worker_queue_oldest_lag_seconds gauge");
  for (const [stage, queue] of Object.entries(workerQueues || {})) {
    lines.push(`hellotest_knowledge_worker_queue_oldest_lag_seconds{stage="${stage}"} ${Number(queue.oldest_lag_seconds || 0).toFixed(3)}`);
  }
  return lines.join("\n");
};

module.exports = { formatKnowledgeMetrics };
