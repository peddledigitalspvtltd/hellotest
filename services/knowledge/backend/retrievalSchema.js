// Additive schema for the retrieval channels, applied by the deployment
// migration after the Knowledge, graph and vector projection schemas.
//
// Lexical channel
//   search_vector        'simple' vector (exact tokens, identifiers). Since
//                        lexical_version 2 it is weighted: title A, headings B,
//                        body C, model hint D.
//   search_vector_prose  language-configured (stemmed, stop words removed) vector
//                        of the same fields, for natural-language questions.
//   lexical_version      0 = legacy unweighted row; the reindex worker upgrades
//                        rows below the current version in the background, so no
//                        startup migration has to rewrite the whole table.
//
// Adding a nullable column and a constant-default column is metadata-only on
// supported PostgreSQL versions, so this is safe on a large chunk table.
module.exports = [
  `ALTER TABLE ai_knowledge_chunks ADD COLUMN IF NOT EXISTS search_vector_prose TSVECTOR`,
  `ALTER TABLE ai_knowledge_chunks ADD COLUMN IF NOT EXISTS lexical_version SMALLINT NOT NULL DEFAULT 0`,
  `CREATE INDEX IF NOT EXISTS idx_ai_knowledge_chunks_search_prose ON ai_knowledge_chunks USING GIN (search_vector_prose)`,
  // Rows leave this index as the backfill upgrades them, so it also gives an
  // instant "rows remaining" figure for progress reporting.
  `CREATE INDEX IF NOT EXISTS idx_ai_knowledge_chunks_lexical_pending ON ai_knowledge_chunks (id) WHERE lexical_version < 2`
];
