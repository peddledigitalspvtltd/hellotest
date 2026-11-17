"use strict";

// Background maintenance that upgrades existing rows in place after a change to
// how the index is built. Startup migrations stay additive and fast; this work
// runs in small, lock-friendly batches from the Knowledge worker and reports
// visible progress, so an operator can see when an upgrade has finished.
const db = require("@hellotest/platform/backend/src/db");
const lexical = require("./knowledgeLexicalQuery");

const BATCH_SIZE = 500;
const TICK_BUDGET_MS = 2_000;

// One statement upgrades a whole batch. Rows are claimed with SKIP LOCKED so the
// job never waits on, or blocks, ingestion writing the same chunks. Source
// fields are recomposed from canonical columns and the stored hint, so the
// result matches what ingestion now writes.
const reindexBatchSql = (proseConfig) => `
  WITH batch AS (
    SELECT id FROM ai_knowledge_chunks
    WHERE lexical_version < ${lexical.LEXICAL_VERSION}
    ORDER BY id LIMIT ? FOR UPDATE SKIP LOCKED
  ), fields AS (
    SELECT chunks.id,
      COALESCE(documents.title, '') AS title,
      concat_ws(' ',
        (SELECT string_agg(part, ' ') FROM jsonb_array_elements_text(
          CASE WHEN jsonb_typeof(chunks.metadata->'section_path') = 'array' THEN chunks.metadata->'section_path' ELSE '[]'::jsonb END) AS part),
        chunks.heading) AS headings,
      chunks.content AS body,
      COALESCE(chunks.metadata->'llm_context_hint'->>'excerpt', '') AS hint
    FROM ai_knowledge_chunks chunks
    JOIN ai_knowledge_documents documents ON documents.id = chunks.document_id
    WHERE chunks.id IN (SELECT id FROM batch)
  )
  UPDATE ai_knowledge_chunks target SET
    search_vector = ${weighted("simple")},
    search_vector_prose = ${weighted(proseConfig)},
    lexical_version = ${lexical.LEXICAL_VERSION}
  FROM fields WHERE target.id = fields.id
  RETURNING target.id`;

const weighted = (config) => {
  // `config` passes through the module's allow-list check before reaching SQL.
  lexical.weightedVectorSql(config);
  return `(setweight(to_tsvector('${config}', fields.title), 'A') || setweight(to_tsvector('${config}', fields.headings), 'B')`
    + ` || setweight(to_tsvector('${config}', fields.body), 'C') || setweight(to_tsvector('${config}', fields.hint), 'D'))`;
};

/**
 * Upgrade legacy lexical vectors. Runs batches until the time budget is spent or
 * nothing is left, so a small backlog drains in one tick and a large one is
 * spread over many without monopolising the database.
 */
const processLexicalReindex = async ({ batchSize = BATCH_SIZE, budgetMs = TICK_BUDGET_MS, signal } = {}) => {
  const deadline = Date.now() + Math.max(1, budgetMs);
  const size = Math.max(1, Math.min(2_000, Number(batchSize) || BATCH_SIZE));
  const sql = reindexBatchSql(lexical.configuredProseConfig());
  let upgraded = 0;
  while (Date.now() < deadline) {
    if (signal?.aborted) break;
    const rows = await db.prepare(sql).all(size);
    upgraded += rows.length;
    if (rows.length < size) break;
  }
  return { upgraded, version: lexical.LEXICAL_VERSION };
};

/** Rows still on an older lexical version. Served by the partial index. */
const lexicalReindexProgress = async () => {
  const row = await db.prepare(`SELECT COUNT(*)::INTEGER AS pending FROM ai_knowledge_chunks WHERE lexical_version < ${lexical.LEXICAL_VERSION}`).get();
  const pending = Number(row?.pending || 0);
  return { version: lexical.LEXICAL_VERSION, pending, complete: pending === 0 };
};

module.exports = { processLexicalReindex, lexicalReindexProgress, _internals: { reindexBatchSql } };
