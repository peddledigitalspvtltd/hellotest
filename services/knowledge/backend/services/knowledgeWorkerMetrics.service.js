"use strict";

const db = require("@hellotest/platform/backend/src/db");
const lexical = require("./knowledgeLexicalQuery");
const QUEUE_STAGES = Object.freeze([
  "knowledge_native_outbox_batch", "knowledge_user_ingestion_batch", "knowledge_semantic_work_batch",
  "knowledge_graph_projection_batch", "knowledge_vector_projection_batch", "knowledge_lexical_reindex_batch"
]);
const queueStageSet = new Set(QUEUE_STAGES);

// Only queue names and aggregate ages leave PostgreSQL. No project, source,
// document or user identifiers enter the operational metrics surface.
const queueMetricsSql = `
  SELECT 'knowledge_native_outbox_batch' AS stage, COUNT(*)::INTEGER AS queued,
    COALESCE(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - MIN(created_at))), 0)::DOUBLE PRECISION AS oldest_lag_seconds
  FROM ai_knowledge_native_outbox WHERE status IN ('queued','running') AND next_attempt_at <= CURRENT_TIMESTAMP
  UNION ALL
  SELECT 'knowledge_user_ingestion_batch', COUNT(*)::INTEGER,
    COALESCE(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - MIN(created_at))), 0)::DOUBLE PRECISION
  FROM ai_knowledge_ingestion_jobs WHERE status IN ('queued','running')
  UNION ALL
  SELECT 'knowledge_semantic_work_batch', COUNT(*)::INTEGER,
    COALESCE(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - MIN(created_at))), 0)::DOUBLE PRECISION
  FROM ai_knowledge_semantic_jobs WHERE status IN ('queued','running') AND next_attempt_at <= CURRENT_TIMESTAMP
  UNION ALL
  SELECT 'knowledge_graph_projection_batch', COUNT(*)::INTEGER,
    COALESCE(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - MIN(next_attempt_at))), 0)::DOUBLE PRECISION
  FROM ai_knowledge_graph_projection_states WHERE unresolved_count > 0 AND next_attempt_at <= CURRENT_TIMESTAMP
  UNION ALL
  SELECT 'knowledge_vector_projection_batch', COUNT(*)::INTEGER,
    COALESCE(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - MIN(updated_at))), 0)::DOUBLE PRECISION
  FROM ai_knowledge_vector_jobs WHERE status = 'queued' AND next_attempt_at <= CURRENT_TIMESTAMP
  UNION ALL
  SELECT 'knowledge_lexical_reindex_batch', COUNT(*)::INTEGER,
    COALESCE(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - MIN(created_at))), 0)::DOUBLE PRECISION
  FROM ai_knowledge_chunks WHERE lexical_version < ${lexical.LEXICAL_VERSION}
`;

const normalizeQueueMetrics = (rows = []) => Object.fromEntries(rows
  .filter((row) => queueStageSet.has(row.stage))
  .map((row) => [row.stage, {
    queued: Math.max(0, Number(row.queued) || 0),
    oldest_lag_seconds: Math.max(0, Number(row.oldest_lag_seconds) || 0)
  }]));

let pendingRead = null;
const readQueueMetrics = () => {
  if (pendingRead) return pendingRead;
  pendingRead = Promise.resolve().then(async () => {
  const result = db.pool?.query
    ? await db.pool.query({ text: queueMetricsSql, query_timeout: 1_500 })
    : await db.query(queueMetricsSql);
  return normalizeQueueMetrics(result.rows || []);
  }).finally(() => { pendingRead = null; });
  return pendingRead;
};

module.exports = { QUEUE_STAGES, normalizeQueueMetrics, queueMetricsSql, readQueueMetrics };
