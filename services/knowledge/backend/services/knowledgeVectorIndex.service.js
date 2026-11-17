'use strict';

// Maintain one typed HNSW expression index for each actively used semantic
// embedding dimension. The canonical column remains untyped so multiple model
// dimensions can coexist during a backfill. Local deterministic hashes are
// excluded: they are diagnostic-only and never rank as semantic evidence.
const db = require('@hellotest/platform/backend/src/db');
const LOCAL_EMBEDDING_MODEL = 'hellotest-hash-v1';
const MAX_DIMENSIONS = 2_000; // pgvector HNSW supports vector dimensions up to 2,000.
const boundedInt = (value, fallback, min, max) => {
  const number = Number(value);
  return Number.isSafeInteger(number) ? Math.max(min, Math.min(max, number)) : fallback;
};

async function processPgvectorIndexMaintenance({ limit = 4, minRows = 100, signal } = {}) {
  if (signal?.aborted) throw signal.reason || new Error('Vector index maintenance cancelled');
  const extension = await db.prepare(`SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname='vector') AS vector,
    EXISTS (SELECT 1 FROM pg_am WHERE amname='hnsw') AS hnsw`).get();
  if (!extension?.vector || !extension?.hnsw) return { indexed: 0, skipped: 'pgvector_hnsw_unavailable' };
  const maxDimensions = boundedInt(limit, 4, 1, 8);
  const minimumRows = boundedInt(minRows, 100, 1, 1_000_000);
  const dimensions = await db.prepare(`SELECT vector_dims(embedding_vector)::INTEGER AS dimensions,COUNT(*)::BIGINT AS rows
    FROM ai_knowledge_chunks WHERE embedding_vector IS NOT NULL AND embedding_model <> ?
    GROUP BY vector_dims(embedding_vector) HAVING COUNT(*) >= ?
    ORDER BY COUNT(*) DESC,vector_dims(embedding_vector) LIMIT ?`).all(LOCAL_EMBEDDING_MODEL, minimumRows, maxDimensions);
  let indexed = 0;
  for (const row of dimensions) {
    if (signal?.aborted) throw signal.reason || new Error('Vector index maintenance cancelled');
    const size = Number(row.dimensions);
    if (!Number.isInteger(size) || size < 8 || size > MAX_DIMENSIONS) continue;
    const name = `idx_ai_knowledge_chunks_embedding_hnsw_d${size}`;
    // DDL is deliberately executed through the pool (outside a transaction):
    // CREATE INDEX CONCURRENTLY keeps large active ingestion tables available.
    await db.query(`CREATE INDEX CONCURRENTLY IF NOT EXISTS ${name}
      ON ai_knowledge_chunks USING hnsw ((embedding_vector::vector(${size})) vector_cosine_ops)
      WHERE embedding_vector IS NOT NULL AND vector_dims(embedding_vector) = ${size}
        AND embedding_model <> '${LOCAL_EMBEDDING_MODEL}'`);
    indexed += 1;
  }
  return { indexed, dimensions: dimensions.map(row => Number(row.dimensions)), min_rows: minimumRows };
}

module.exports = { processPgvectorIndexMaintenance, MAX_DIMENSIONS, LOCAL_EMBEDDING_MODEL };
