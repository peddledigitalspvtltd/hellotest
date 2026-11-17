"use strict";

function createKnowledgeSearchService(ports = {}) {
  const { ASSISTANT_GUARDRAILS, LOCAL_EMBEDDING_MODEL, MAX_CANDIDATES, MAX_FALLBACK_CANDIDATES, MAX_SEARCH_LIMIT, PRODUCT_HELP_VERSION, RETRIEVAL_EMBEDDING_TIMEOUT_MS, SOURCE_KINDS, SOURCE_PERMISSION_BY_KIND, asArray, asObject, assertRetrievalActive, boundedRetrievalStage, commonLexemes, cosineSimilarity, createError, db, embedTexts, fingerprint, getVectorCapability, knowledgeAuthorization, knowledgeContracts, knowledgeVectorStore, lexicalProseConfig, lexicalQuery, localEmbedding, normalizeFilterIds, normalizeId, normalizeSourceKind, normalizeText, rankProductHelpSections, ranking, resolveAllowedSourcePermissions, resolveEmbeddingRuntime, retrievalTimeout, sanitizeAiText, sanitizeSourceUri, usesEmbeddingsForMode, vectorLiteral } = ports;
  const required = [ASSISTANT_GUARDRAILS, LOCAL_EMBEDDING_MODEL, MAX_CANDIDATES, MAX_FALLBACK_CANDIDATES, MAX_SEARCH_LIMIT, PRODUCT_HELP_VERSION, RETRIEVAL_EMBEDDING_TIMEOUT_MS, SOURCE_KINDS, SOURCE_PERMISSION_BY_KIND, asArray, asObject, assertRetrievalActive, boundedRetrievalStage, commonLexemes, cosineSimilarity, createError, db, embedTexts, fingerprint, getVectorCapability, knowledgeAuthorization, knowledgeContracts, knowledgeVectorStore, lexicalProseConfig, lexicalQuery, localEmbedding, normalizeFilterIds, normalizeId, normalizeSourceKind, normalizeText, rankProductHelpSections, ranking, resolveAllowedSourcePermissions, resolveEmbeddingRuntime, retrievalTimeout, sanitizeAiText, sanitizeSourceUri, usesEmbeddingsForMode, vectorLiteral];
  if (required.some(value => value === undefined || value === null)) {
    throw new Error("Knowledge search requires its retrieval, authorization and vector ports.");
  }

  const getProductHelpCandidates = (query, { includeEmbeddings = true } = {}) => {
    return rankProductHelpSections(query).map((section) => {
      const sourceHash = fingerprint(`hellotest-product-help:${PRODUCT_HELP_VERSION}`);
      const versionHash = fingerprint(`${section.id}:${PRODUCT_HELP_VERSION}:${section.content}`);
      return {
        chunk_id: `product-help-${section.id}-${PRODUCT_HELP_VERSION.replace(/\W/g, "-")}`,
        document_id: `product-help-${section.id}`,
        source_id: "hellotest-product-help",
        content: section.content,
        chunk_index: 0,
        heading: section.title,
        char_start: 0,
        char_end: section.content.length,
        embedding: includeEmbeddings ? localEmbedding(section.content) : null,
        fallback_embedding: includeEmbeddings ? localEmbedding(section.content) : null,
        embedding_model: includeEmbeddings ? LOCAL_EMBEDDING_MODEL : null,
        lexical_rank: section.relevance,
        title: section.title,
        version_hash: versionHash,
        source_kind: "product_help",
        source_ref_id: `${section.id}@${PRODUCT_HELP_VERSION}`,
        app_type_id: null,
        source_uri: null,
        risk_flags: [],
        source_hash: sourceHash,
        collection_ids: []
      };
    });
  };

  const search = async ({
    projectId,
    query,
    mode = "hybrid",
    limit = 12,
    filters = {},
    user,
    userId,
    integrationId,
    allowedSourcePermissions,
    preparedEmbedding,
    signal,
    maxCandidates,
    timeoutMs
  } = {}) => {
    if (signal?.aborted) throw signal.reason || createError("Knowledge retrieval was cancelled.", 408);
    const deadlineAt = Date.now() + retrievalTimeout(timeoutMs);
    const visibilityReserveMs = Math.min(750, Math.max(1, Math.floor(retrievalTimeout(timeoutMs) / 8)));
    const remainingMs = (reserve = 0) => Math.max(0, deadlineAt - Date.now() - reserve);
    const normalizedProjectId = normalizeId(projectId);
    const sanitizedQuery = sanitizeAiText(normalizeText(query, 4_000));
    if (!normalizedProjectId || !sanitizedQuery.text) throw createError("project_id and query are required.");
    const normalizedLimit = Math.max(1, Math.min(MAX_SEARCH_LIMIT, Number.parseInt(limit, 10) || 12));
    const candidateLimit = Math.max(1, Math.min(1_000, Number(maxCandidates) || MAX_CANDIDATES));
    const normalizedMode = ["hybrid", "semantic", "keyword"].includes(mode) ? mode : "hybrid";
    const normalizedFilters = asObject(filters);
    let asOf = null;
    if (normalizedFilters.as_of) {
      const timestamp = Date.parse(normalizedFilters.as_of);
      if (!Number.isFinite(timestamp)) throw createError("as_of must be a valid timestamp.");
      await boundedRetrievalStage(() => knowledgeAuthorization.assertHistoricalAccess(user, normalizedProjectId), {
        signal, timeoutMs: remainingMs(visibilityReserveMs), code: "AUTHORIZATION_TIMEOUT"
      });
      asOf = new Date(timestamp).toISOString();
    }
    const collectionIds = normalizeFilterIds(normalizedFilters.collection_ids || normalizedFilters.collections);
    const requestedSourceIds = normalizeFilterIds(normalizedFilters.source_ids, 100);
    const includeProductHelpBySource = !requestedSourceIds.length || requestedSourceIds.includes("hellotest-product-help");
    const sourceIds = requestedSourceIds.filter((sourceId) => sourceId !== "hellotest-product-help");
    const requestedSourceKinds = [...new Set(asArray(normalizedFilters.source_kinds || normalizedFilters.source_types)
      .map((value) => String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_"))
      .filter(Boolean))].slice(0, 20);
    const normalizedRequestedSourceKinds = requestedSourceKinds
      .map((kind) => kind === "product_help" ? kind : normalizeSourceKind(kind, { fallback: null }))
      .filter(Boolean);
    const evidenceScope = require('@hellotest/platform/backend/src/utils/agentEvidenceScopeSql').normalize(normalizedFilters.evidence_scope);
    const includeProductHelp = !Object.keys(evidenceScope).length && includeProductHelpBySource
      && (!requestedSourceKinds.length || normalizedRequestedSourceKinds.includes("product_help"));
    const sourceKinds = [...new Set(normalizedRequestedSourceKinds.filter((kind) => kind !== "product_help"))];
    const includePersistedSources = (!requestedSourceKinds.length || sourceKinds.length > 0)
      && (!requestedSourceIds.length || sourceIds.length > 0);
    const appTypeId = normalizeId(normalizedFilters.app_type_id) || null;
    const effectiveAllowedSourcePermissions = Array.isArray(allowedSourcePermissions)
      ? [...new Set(allowedSourcePermissions.filter((permissionCode) => Object.values(SOURCE_PERMISSION_BY_KIND).includes(permissionCode)))]
      : await boundedRetrievalStage(() => resolveAllowedSourcePermissions(user, normalizedProjectId), {
        signal, timeoutMs: Math.min(1_500, remainingMs(visibilityReserveMs)), code: "AUTHORIZATION_TIMEOUT"
      });
    const filterParams = [normalizedProjectId, normalizedProjectId, normalizedProjectId];
    const clauses = [
      "chunks.project_id = ?",
      "documents.project_id = ?",
      "sources.project_id = ?",
      ...(asOf ? ["documents.effective_from <= ?::timestamptz AND (documents.effective_to IS NULL OR documents.effective_to > ?::timestamptz)"] : ["documents.is_active = TRUE"]),
      "index_states.required_indexes_ready = TRUE",
      "sources.extraction_status = 'ready'"
    ];
    clauses.push(knowledgeAuthorization.applicationContextPredicate());
    if (asOf) filterParams.push(asOf, asOf);
    const fragmentAcl = knowledgeAuthorization.predicate({ user, projectId: normalizedProjectId, document: "documents", chunk: "chunks" });
    clauses.push(fragmentAcl.sql);
    filterParams.push(...fragmentAcl.params);
    if (effectiveAllowedSourcePermissions.length) {
      clauses.push(`(sources.required_permission IS NULL OR sources.required_permission IN (${effectiveAllowedSourcePermissions.map(() => "?").join(", ")}))`);
      filterParams.push(...effectiveAllowedSourcePermissions);
    } else {
      clauses.push("sources.required_permission IS NULL");
    }
    if (appTypeId) {
      clauses.push("(sources.app_type_id = ? OR sources.app_type_id IS NULL)");
      filterParams.push(appTypeId);
    }
    if (sourceKinds.length) {
      clauses.push(`sources.source_kind IN (${sourceKinds.map(() => "?").join(", ")})`);
      filterParams.push(...sourceKinds);
    }
    if (sourceIds.length) {
      clauses.push(`sources.id IN (${sourceIds.map(() => "?").join(", ")})`);
      filterParams.push(...sourceIds);
    }
    const evidencePredicate = require('@hellotest/platform/backend/src/utils/agentEvidenceScopeSql').sourcePredicate('sources', evidenceScope, appTypeId);
    if (evidencePredicate.sql) {
      clauses.push(evidencePredicate.sql.replace(/^ AND /, ''));
      filterParams.push(...evidencePredicate.params);
    }
    const readCandidates = (sql, params, activeSignal = signal, cap = 3500, reserveMs = visibilityReserveMs) => evidencePredicate.sql
      ? require('./knowledgeScopedRead.service').all(sql, params, {
        signal: activeSignal, timeoutMs: Math.min(cap, 3500, remainingMs(reserveMs))
      })
      : db.prepare(sql).all(...params);
    if (collectionIds.length) {
      clauses.push(`EXISTS (
        SELECT 1 FROM ai_knowledge_collection_sources scoped_collections
        WHERE scoped_collections.source_id = chunks.source_id
          AND scoped_collections.collection_id IN (${collectionIds.map(() => "?").join(", ")})
      )`);
      filterParams.push(...collectionIds);
    }
    const embeddingProjection = !usesEmbeddingsForMode(normalizedMode)
      ? "NULL::jsonb AS embedding, NULL::jsonb AS fallback_embedding, NULL::text AS embedding_model,"
      : "chunks.embedding, chunks.fallback_embedding, chunks.embedding_model,";
    const candidateProjection = `
      SELECT chunks.id AS chunk_id, chunks.document_id, chunks.source_id, chunks.content,
        chunks.chunk_index, chunks.heading, chunks.char_start, chunks.char_end, chunks.metadata,
        ${embeddingProjection}
        documents.title, documents.checksum_sha256 AS version_hash, documents.version,
        documents.is_active AS is_current, documents.effective_from, documents.effective_to,
        sources.source_kind, sources.source_ref_id, sources.app_type_id,
        sources.source_uri, sources.risk_flags, sources.checksum_sha256 AS source_hash,
        ARRAY(SELECT collection_id FROM ai_knowledge_collection_sources links WHERE links.source_id = chunks.source_id) AS collection_ids
      FROM ai_knowledge_chunks chunks
      JOIN ai_knowledge_documents documents ON documents.id = chunks.document_id
      JOIN ai_knowledge_sources sources ON sources.id = chunks.source_id
      JOIN ai_knowledge_index_states index_states ON index_states.document_id = documents.id
    `;
    const exactIdentifiers = lexicalQuery.extractIdentifiers(sanitizedQuery.text, 10);

    const retrievalErrors = [];
    const readStage = (task, code, cap = 3_500) => {
      const timeoutMs = Math.min(cap, remainingMs(visibilityReserveMs));
      const deadline = Date.now() + timeoutMs;
      return boundedRetrievalStage(activeSignal => task(activeSignal, deadline), { signal, timeoutMs, code });
    };
    const localVector = usesEmbeddingsForMode(normalizedMode) ? localEmbedding(sanitizedQuery.text) : null;
    let queryEmbeddingResult = localVector ? { model: LOCAL_EMBEDDING_MODEL, vectors: [localVector], fallback: [localVector] } : null;
    let queryVector = localVector;
    let fallbackQueryVector = localVector;
    let denseCandidates = [];
    let vectorMode = normalizedMode === "keyword" ? "postgresql-fts-only" : "degraded-local-jsonb-cosine+fts";
    let qdrantResult = { configured: false, hits: [] };
    // Start exact and lexical reads before resolving/awaiting embeddings. Every
    // channel has its own bound, so an optional provider cannot discard fast SQL.
    // The lexical read has a MATCH predicate (so the GIN indexes can serve it) over
    // OR-ed key terms. Previously every chunk in scope was ranked against an AND of
    // every word in the question, which matched nothing for a real sentence, left
    // every rank at 0 and returned the newest chunks instead of the relevant ones.
    let lexicalPlan = { terms: [], identifiers: [], dropped: [], fallback: null };
    const lexicalPromise = includePersistedSources ? readStage((activeSignal) => {
      const lexical = lexicalQuery.buildLexicalSql(sanitizedQuery.text, {
        commonLexemes: commonLexemes(), proseConfig: lexicalProseConfig()
      });
      lexicalPlan = lexical;
      if (lexical.empty) return Promise.resolve([]);
      return readCandidates(`
        ${candidateProjection.replace("SELECT ", `SELECT ${lexical.rank} AS lexical_rank, `)}
        WHERE ${clauses.join(" AND ")} AND ${lexical.match}
        ORDER BY lexical_rank DESC, chunks.created_at DESC
        LIMIT ?
      `, [
        ...lexical.rankParams,
        ...filterParams,
        ...lexical.matchParams,
        normalizedMode === "keyword" || knowledgeVectorStore.isConfigured() || maxCandidates ? candidateLimit : MAX_FALLBACK_CANDIDATES
      ], activeSignal);
    }, "LEXICAL_SEARCH_TIMEOUT") : Promise.resolve([]);
    const directLookupPromise = includePersistedSources && exactIdentifiers.length ? readStage((activeSignal) => readCandidates(`
      ${candidateProjection.replace("SELECT ", "SELECT 1::real AS lexical_rank, TRUE AS exact_match, ")}
      WHERE ${clauses.join(" AND ")}
        AND (
          UPPER(COALESCE(sources.source_ref_id, '')) IN (${exactIdentifiers.map(() => "?").join(", ")})
          OR UPPER(COALESCE(sources.metadata->>'display_id', '')) IN (${exactIdentifiers.map(() => "?").join(", ")})
          OR UPPER(COALESCE(sources.metadata->>'key', '')) IN (${exactIdentifiers.map(() => "?").join(", ")})
          OR UPPER(sources.id) IN (${exactIdentifiers.map(() => "?").join(", ")})
        )
      ORDER BY chunks.chunk_index ASC
      LIMIT ?
    `, [...filterParams, ...exactIdentifiers, ...exactIdentifiers, ...exactIdentifiers, ...exactIdentifiers, Math.min(candidateLimit, exactIdentifiers.length * 12)], activeSignal), "DIRECT_LOOKUP_TIMEOUT") : Promise.resolve([]);
    const densePromise = usesEmbeddingsForMode(normalizedMode) && includePersistedSources
      ? readStage(async (denseSignal, channelDeadline) => {
        const sqlTime = () => Math.max(0, channelDeadline - Date.now());
        const prepared = await (typeof preparedEmbedding === "function" ? preparedEmbedding() : preparedEmbedding);
        assertRetrievalActive(denseSignal);
        let embedding;
        if (prepared?.model && Array.isArray(prepared.vector) && Array.isArray(prepared.fallback)) {
          embedding = { model: prepared.model, vectors: [prepared.vector], fallback: [prepared.fallback],
            warning: prepared.warning || null, warning_code: prepared.warning_code || null,
            warning_reason_code: prepared.warning_reason_code || null };
        } else {
          const runtime = await resolveEmbeddingRuntime({ userId: user?.id || userId, projectId: normalizedProjectId, integrationId });
          assertRetrievalActive(denseSignal);
          embedding = await embedTexts(runtime, [sanitizedQuery.text], {
            cacheResults: true, signal: denseSignal,
            timeoutMs: Math.min(RETRIEVAL_EMBEDDING_TIMEOUT_MS, remainingMs(visibilityReserveMs))
          });
        }
        assertRetrievalActive(denseSignal);
        const vector = embedding.vectors[0];
        if (embedding.model === LOCAL_EMBEDDING_MODEL) {
          return { candidates: [], embedding, projection: { configured: false, hits: [] }, mode: "local-hash-diagnostics+fts" };
        }
        const pgvectorAvailable = await getVectorCapability();
        assertRetrievalActive(denseSignal);
        let projection = { configured: false, hits: [] };
        let candidates = [];
        let mode = pgvectorAvailable ? "pgvector-exact+fts" : "degraded-local-jsonb-cosine+fts";
        if (knowledgeVectorStore.isConfigured()) {
          try {
            projection = await knowledgeVectorStore.search({
              projectId: normalizedProjectId, queryVector: vector, embeddingModel: embedding.model,
              allowedPermissions: effectiveAllowedSourcePermissions, user,
              historical: Boolean(asOf), sourceKinds, sourceIds, appTypeId,
              limit: candidateLimit, signal: denseSignal
            });
            assertRetrievalActive(denseSignal);
            if (projection.hits.length) {
              const scores = new Map(projection.hits.map((hit) => [hit.chunk_id, Number(hit.score || 0)]));
              const ids = [...scores.keys()];
              const rows = await readCandidates(`
                ${candidateProjection.replace("SELECT ", "SELECT 0::real AS lexical_rank, ")}
                WHERE ${clauses.join(" AND ")}
                  AND chunks.id IN (${ids.map(() => "?").join(", ")})
                  AND chunks.embedding_model = ?
              `, [...filterParams, ...ids, embedding.model], denseSignal, sqlTime());
              assertRetrievalActive(denseSignal);
              candidates = rows.map((candidate) => ({ ...candidate, dense_similarity: scores.get(candidate.chunk_id) || 0 }))
                .sort((left, right) => right.dense_similarity - left.dense_similarity);
              mode = "qdrant-acl-prefilter+postgresql-fts";
            }
          } catch (error) {
            assertRetrievalActive(denseSignal);
            projection = { configured: true, hits: [], degraded: true,
              error_fingerprint: fingerprint(error instanceof Error ? error.message : "Qdrant retrieval failed") };
          }
        }
        // PostgreSQL is canonical. Search its vectors even when Qdrant has hits:
        // older uploaded documents may not yet have an external projection.
        if (pgvectorAvailable) {
          try {
            const dimensions = Number(vector.length);
            if (!Number.isInteger(dimensions) || dimensions < 8 || dimensions > 8_192) throw new Error('Embedding dimensions are outside the supported vector range');
            const typedDistance = `(chunks.embedding_vector::vector(${dimensions}) <=> ?::vector(${dimensions}))`;
            const rows = await readCandidates(`
              ${candidateProjection.replace("SELECT ", `SELECT (1 - ${typedDistance}) AS dense_similarity, 0::real AS lexical_rank, `)}
              WHERE ${clauses.join(" AND ")}
                AND chunks.embedding_vector IS NOT NULL
                AND chunks.embedding_model = ?
                AND chunks.embedding_model <> '${LOCAL_EMBEDDING_MODEL}'
                AND vector_dims(chunks.embedding_vector) = ?
              ORDER BY ${typedDistance} ASC
              LIMIT ?
            `, [vectorLiteral(vector), ...filterParams, embedding.model, dimensions, vectorLiteral(vector), candidateLimit], denseSignal, sqlTime());
            assertRetrievalActive(denseSignal);
            const union = new Map([...candidates, ...rows].map((candidate) => [candidate.chunk_id, candidate]));
            candidates = [...union.values()].sort((left, right) => Number(right.dense_similarity || 0) - Number(left.dense_similarity || 0)).slice(0, candidateLimit);
          } catch (error) {
            assertRetrievalActive(denseSignal);
            if (!candidates.length) mode = "degraded-local-jsonb-cosine+fts";
          }
        }
        return { candidates, embedding, projection, mode };
      }, "SEMANTIC_SEARCH_TIMEOUT") : Promise.resolve(null);
    const settled = await Promise.allSettled([lexicalPromise, directLookupPromise, densePromise]);
    assertRetrievalActive(signal);
    const channel = (index, fallback) => {
      if (settled[index].status === "fulfilled") return settled[index].value;
      retrievalErrors.push(settled[index].reason?.code || "RETRIEVAL_CHANNEL_UNAVAILABLE");
      return fallback;
    };
    const lexicalCandidates = channel(0, []);
    const directLookupCandidates = channel(1, []);
    const dense = channel(2, null);
    if (dense) {
      denseCandidates = dense.candidates;
      queryEmbeddingResult = dense.embedding;
      queryVector = dense.embedding.vectors[0];
      fallbackQueryVector = dense.embedding.fallback[0];
      vectorMode = dense.mode;
      qdrantResult = dense.projection;
      if (dense.embedding.warning_code) retrievalErrors.push(dense.embedding.warning_reason_code || dense.embedding.warning_code);
    }
    const lexicalIds = new Set(lexicalCandidates.map((candidate) => candidate.chunk_id));
    for (const candidate of directLookupCandidates.slice().reverse()) {
      if (!lexicalIds.has(candidate.chunk_id)) lexicalCandidates.unshift(candidate);
      else Object.assign(lexicalCandidates.find((item) => item.chunk_id === candidate.chunk_id), { exact_match: true, lexical_rank: Math.max(1, Number(candidate.lexical_rank || 0)) });
    }
    if (includeProductHelp && !collectionIds.length) {
      lexicalCandidates.push(...getProductHelpCandidates(sanitizedQuery.text, { includeEmbeddings: usesEmbeddingsForMode(normalizedMode) }));
      lexicalCandidates.sort((left, right) => Number(right.lexical_rank || 0) - Number(left.lexical_rank || 0));
    }

    const candidateById = new Map();
    for (const candidate of lexicalCandidates) candidateById.set(candidate.chunk_id, candidate);
    for (const candidate of denseCandidates) {
      const previous = candidateById.get(candidate.chunk_id);
      candidateById.set(candidate.chunk_id, { ...previous, ...candidate,
        lexical_rank: Math.max(Number(previous?.lexical_rank || 0), Number(candidate.lexical_rank || 0)) });
    }
    // Give exact lookup and both retrieval channels room within the caller's
    // candidate budget before reranking the authorized union.
    const candidateIds = new Set(directLookupCandidates.map((candidate) => candidate.chunk_id));
    for (let index = 0; index < Math.max(lexicalCandidates.length, denseCandidates.length); index += 1) {
      if (lexicalCandidates[index]) candidateIds.add(lexicalCandidates[index].chunk_id);
      if (denseCandidates[index]) candidateIds.add(denseCandidates[index].chunk_id);
    }
    const candidates = [...candidateIds].slice(0, maxCandidates ? candidateLimit : MAX_FALLBACK_CANDIDATES).map((id) => candidateById.get(id)).filter(Boolean);
    // --- Ranking ---------------------------------------------------------------
    // ORDER comes from weighted reciprocal-rank fusion of the channels; RELEVANCE is
    // a separate absolute estimate used to decide whether a hit answers the question
    // at all (see knowledgeRanking.js). A hashed local vector is word hashing, not
    // semantic similarity, so it never counts as the semantic channel.
    const { semanticIsReal, semanticUsable, lexicalFallback, semanticSignal } = ranking.channelAvailability({
      mode: normalizedMode, embeddingModel: queryEmbeddingResult?.model, localEmbeddingModel: LOCAL_EMBEDDING_MODEL,
      denseCandidates, candidates
    });
    const keyTerms = lexicalPlan.terms?.length ? lexicalPlan.terms : lexicalQuery.extractKeyTerms(sanitizedQuery.text).terms;
    const loweredQuery = sanitizedQuery.text.toLowerCase();
    const semanticRanked = !semanticUsable ? [] : (denseCandidates.length ? denseCandidates : candidates
      .filter(candidate => candidate.embedding_model === queryEmbeddingResult.model && Array.isArray(candidate.embedding))
      .slice().sort((left, right) => cosineSimilarity(right.embedding, queryVector) - cosineSimilarity(left.embedding, queryVector)));
    const fused = ranking.fuse([
      { name: "exact", ids: normalizedMode === "semantic" && !lexicalFallback ? [] : directLookupCandidates.map((candidate) => candidate.chunk_id) },
      { name: "lexical", ids: normalizedMode === "semantic" && !lexicalFallback ? [] : lexicalCandidates.filter((candidate) => Number(candidate.lexical_rank) > 0 || candidate.exact_match).map((candidate) => candidate.chunk_id) },
      { name: "semantic", ids: semanticUsable ? semanticRanked.map((candidate) => candidate.chunk_id) : [] }
    ]);
    const scoredAll = candidates.map((candidate) => {
      const primaryCompatible = normalizedMode !== "keyword"
        && semanticIsReal
        && candidate.embedding_model === queryEmbeddingResult.model
        && Array.isArray(candidate.embedding);
      const semantic = primaryCompatible ? Math.max(0, cosineSimilarity(candidate.embedding, queryVector)) : 0;
      const localHashSimilarity = normalizedMode === "keyword" || semanticIsReal ? null
        : Math.max(0, cosineSimilarity(candidate.fallback_embedding, fallbackQueryVector));
      const lexical = ranking.lexicalQuality({
        sqlRank: candidate.lexical_rank, keyTerms, exact: Boolean(candidate.exact_match),
        candidateText: `${candidate.title || ""}\n${candidate.heading || ""}\n${candidate.content || ""}`,
        phrase: String(candidate.content || "").toLowerCase().includes(loweredQuery)
      });
      const relevance = ranking.relevanceOf({ lexical, semantic, semanticIsReal: semanticUsable });
      const reciprocalRank = fused.get(candidate.chunk_id)?.normalized || 0;
      // Order by fused rank; modes with a single usable channel degrade to that channel.
      const score = reciprocalRank || (normalizedMode === "semantic" && semanticUsable ? semantic : lexical);
      const citationId = `K-${candidate.chunk_id}`;
      return {
        id: candidate.chunk_id,
        chunk_id: candidate.chunk_id,
        document_id: candidate.document_id,
        source_id: candidate.source_id,
        canonical_id: candidate.source_id,
        knowledge_id: candidate.document_id,
        fragment_id: candidate.chunk_id,
        version: candidate.version || null,
        is_current: candidate.is_current !== false,
        effective_from: candidate.effective_from || null,
        effective_to: candidate.effective_to || null,
        index_ready: true,
        collection_ids: asArray(candidate.collection_ids),
        title: candidate.title,
        source_kind: candidate.source_kind,
        source_ref_id: candidate.source_ref_id,
        content: candidate.content,
        excerpt: String(candidate.content || "").slice(0, 700),
        score: Number(score.toFixed(6)),
        relevance: Number(relevance.toFixed(6)),
        lexical_score: Number(lexical.toFixed(6)),
        semantic_score: Number(semantic.toFixed(6)),
        semantic_signal: semanticSignal,
        local_hash_similarity: localHashSimilarity === null ? null : Number(localHashSimilarity.toFixed(6)),
        reciprocal_rank_score: Number(reciprocalRank.toFixed(6)),
        channel_ranks: fused.get(candidate.chunk_id)?.ranks || {},
        citation: {
          id: citationId,
          label: candidate.title,
          source_id: candidate.source_id,
          source_kind: candidate.source_kind,
          source_ref_id: candidate.source_ref_id,
          source_uri: candidate.source_kind === "url"
            ? sanitizeSourceUri(candidate.source_uri)
            : candidate.source_kind === "file" ? `/knowledge/sources/${candidate.source_id}/file` : null,
          document_id: candidate.document_id,
          chunk_id: candidate.chunk_id,
          canonical_id: candidate.source_id,
          knowledge_id: candidate.document_id,
          fragment_id: candidate.chunk_id,
          version: candidate.version || null,
          is_current: candidate.is_current !== false,
          effective_from: candidate.effective_from || null,
          effective_to: candidate.effective_to || null,
          excerpt: String(candidate.content || "").slice(0, 700),
          source_hash: candidate.source_hash || null,
          version_hash: candidate.version_hash || null,
          chunk_hash: fingerprint(candidate.content),
          location: {
            chunk_index: Number(candidate.chunk_index || 0),
            heading: candidate.heading || null,
            heading_path: asArray(candidate.metadata?.section_path),
            section_type: candidate.metadata?.section_type || null,
            char_start: Number(candidate.char_start || 0),
            char_end: Number(candidate.char_end || 0),
            page: Number(candidate.metadata?.page || 0) || null
          }
        }
      };
    }).sort((left, right) => right.score - left.score || right.relevance - left.relevance);
    // Pinned sources or collections are the user's explicit choice of material: a long
    // specification keeps more than three passages instead of being cut short.
    const perSourceCap = sourceIds.length || collectionIds.length ? ranking.PINNED_PER_SOURCE_CAP : ranking.PER_SOURCE_CAP;
    // Every result came from at least one real candidate channel (exact ID, GIN
    // full-text match, or provider embedding). Keep the fused order and let
    // information-need coverage, followed by the optional cross-encoder, decide
    // whether the evidence is sufficient; a guessed global score cutoff hid
    // useful evidence for some question classes.
    const scored = ranking.diversify(scoredAll, { limit: normalizedLimit, cap: perSourceCap });

    const selectedSourceIds = normalizeFilterIds(scored.map((hit) => hit.source_id).filter((id) => id !== "hellotest-product-help"));
    const partialSources = selectedSourceIds.length ? await boundedRetrievalStage((activeSignal) => readCandidates(`SELECT DISTINCT sources.id
      FROM ai_knowledge_sources sources
      JOIN ai_knowledge_documents documents ON documents.source_id = sources.id
      JOIN ai_knowledge_chunks chunks ON chunks.document_id = documents.id
      JOIN ai_knowledge_index_states index_states ON index_states.document_id = documents.id
      WHERE sources.project_id = ? AND sources.extraction_status = 'ready' AND index_states.required_indexes_ready = TRUE
        ${asOf ? "AND documents.effective_from <= ?::timestamptz AND (documents.effective_to IS NULL OR documents.effective_to > ?::timestamptz)" : "AND documents.is_active = TRUE"}
        AND sources.id IN (${selectedSourceIds.map(() => "?").join(",")}) AND NOT (${fragmentAcl.sql})`,
    [normalizedProjectId, ...(asOf ? [asOf, asOf] : []), ...selectedSourceIds, ...fragmentAcl.params], activeSignal, 750, 0), { signal, timeoutMs: Math.min(750, remainingMs()), code: "VISIBILITY_CHECK_TIMEOUT" }).catch((error) => {
      assertRetrievalActive(signal);
      retrievalErrors.push(error.code || "VISIBILITY_CHECK_UNAVAILABLE");
      return selectedSourceIds.map((id) => ({ id }));
    }) : [];
    const partialSourceIds = new Set(partialSources.map((source) => source.id));
    for (const hit of scored) hit.visibility = { state: partialSourceIds.has(hit.source_id) ? "PARTIAL" : "FULL" };
    if (signal?.aborted) throw signal.reason || createError("Knowledge retrieval was cancelled.", 408);

    return {
      project_id: normalizedProjectId,
      query: sanitizedQuery.text,
      mode: normalizedMode,
      results: scored,
      retrieval: {
        candidate_count: candidates.length,
        result_count: scored.length,
        embedding_model: queryEmbeddingResult?.model || null,
        query_class: knowledgeContracts.classifyQuery(sanitizedQuery.text),
        direct_lookup_count: directLookupCandidates.length,
        vector_mode: vectorMode,
        degraded: retrievalErrors.length > 0 || (normalizedMode !== "keyword" && (vectorMode.startsWith("degraded") || Boolean(qdrantResult.degraded) || queryEmbeddingResult.model === LOCAL_EMBEDDING_MODEL)),
        error_codes: [...new Set(retrievalErrors)],
        retrieval_error_count: retrievalErrors.length,
        ranking: normalizedMode === "keyword"
          ? "PostgreSQL full-text lexical ranking over OR-ed key terms (no embedding provider call)"
          : semanticUsable
            ? "plain reciprocal-rank fusion of exact identifiers, PostgreSQL full-text and dense retrieval"
            : "reciprocal-rank fusion of exact identifiers and PostgreSQL full-text; no provider embedding was available, so the hashed local vector is not used as semantic evidence",
        ranking_detail: {
          fusion: "rrf", k: ranking.RRF_K, channels: normalizedMode === "semantic" && semanticUsable ? ["semantic"] : semanticUsable ? ["exact", "lexical", "semantic"] : ["exact", "lexical"], per_source_cap: perSourceCap,
          semantic_signal: semanticSignal,
          lexical: { key_terms: keyTerms.length, identifiers: lexicalPlan.identifiers?.length || 0, dropped_common_terms: lexicalPlan.dropped?.length || 0, fallback: lexicalPlan.fallback || null }
        },
        candidate_admission: "exact_identifier_or_lexical_match_or_provider_vector",
        filters: { collection_ids: collectionIds, source_kinds: requestedSourceKinds, source_ids: requestedSourceIds, app_type_id: appTypeId },
        source_acl: {
          enforced: true,
          partial: partialSourceIds.size > 0,
          partially_visible_sources: partialSourceIds.size,
          allowed_record_permissions: effectiveAllowedSourcePermissions,
          vector_prefilter_enforced: vectorMode.startsWith("qdrant")
        },
        vector_projection_error_fingerprint: qdrantResult.error_fingerprint || null,
        vector_acl_prefilter: Boolean(qdrantResult.configured),
        historical: Boolean(asOf),
        as_of: asOf,
        query_redaction_count: sanitizedQuery.redaction_count,
        query_risk_flags: sanitizedQuery.risk_flags
      },
      guardrails: ASSISTANT_GUARDRAILS
    };
  };

  const expandEvidence = async ({ projectId, user, hits = [], window = 1, limit = 12, asOf, signal, timeoutMs, maxCandidates } = {}) => {
    if (signal?.aborted) throw signal.reason || createError("Knowledge expansion cancelled.", 408);
    const deadlineAt = Date.now() + retrievalTimeout(timeoutMs, 1_500);
    const remainingMs = () => Math.max(0, deadlineAt - Date.now());
    const access = await knowledgeAuthorization.getEvidenceAccess({ projectId, user, evidence: hits, asOf, signal, timeoutMs: remainingMs() });
    const seeds = access.allowed.filter((hit) => hit.source_id !== "hellotest-product-help").slice(0, 6);
    const radius = Math.max(0, Math.min(2, Number(window) || 1));
    const maximum = Math.max(0, Math.min(24, Number(limit) || 12, maxCandidates ?? 24));
    if (!maximum) return { results: [] };
    const acl = knowledgeAuthorization.predicate({ user, projectId, document: "documents", chunk: "chunks" });
    const settled = await Promise.allSettled(seeds.map(async (seed) => {
      const ordinal = Number(seed.citation?.location?.chunk_index || 0);
      const rows = await boundedRetrievalStage(() => db.prepare(`SELECT chunks.* FROM ai_knowledge_chunks chunks
        JOIN ai_knowledge_documents documents ON documents.id = chunks.document_id
        JOIN ai_knowledge_sources sources ON sources.id = chunks.source_id
        JOIN ai_knowledge_index_states indexes ON indexes.document_id = documents.id
        WHERE chunks.project_id = ? AND documents.project_id = ? AND sources.project_id = ?
          AND sources.extraction_status = 'ready' AND indexes.required_indexes_ready = TRUE
          AND ${knowledgeAuthorization.applicationContextPredicate()}
          ${asOf ? "AND documents.effective_from <= ?::timestamptz AND (documents.effective_to IS NULL OR documents.effective_to > ?::timestamptz)" : "AND documents.is_active = TRUE"}
          AND chunks.document_id = ? AND chunks.chunk_index BETWEEN ? AND ? AND ${acl.sql}
        ORDER BY chunks.chunk_index LIMIT 5`).all(projectId, projectId, projectId, ...(asOf ? [asOf, asOf] : []),
        seed.document_id || seed.knowledge_id, Math.max(0, ordinal - radius), ordinal + radius, ...acl.params), { signal, timeoutMs: Math.max(0, remainingMs() - 10), code: "PARENT_EXPANSION_TIMEOUT" });
      assertRetrievalActive(signal);
      return rows.map((row) => ({
        ...seed, id: row.id, chunk_id: row.id, fragment_id: row.id,
        content: row.content, excerpt: row.content.slice(0, 700), score: Number((Number(seed.score || 0.5) * 0.85).toFixed(6)),
        expansion_of: seed.chunk_id || seed.fragment_id,
        citation: {
          ...seed.citation, id: `K-${row.id}`, chunk_id: row.id, fragment_id: row.id,
          excerpt: row.content.slice(0, 700), chunk_hash: fingerprint(row.content),
          location: { chunk_index: row.chunk_index, heading: row.heading, heading_path: asArray(row.metadata?.section_path),
            char_start: row.char_start, char_end: row.char_end, page: row.metadata?.page || null }
        }
      }));
    }));
    assertRetrievalActive(signal);
    const windows = settled.filter((entry) => entry.status === "fulfilled").map((entry) => entry.value);
    const errors = settled.filter((entry) => entry.status === "rejected").map((entry) => entry.reason?.code || "PARENT_EXPANSION_UNAVAILABLE");
    const seen = new Set(hits.map((hit) => hit.chunk_id || hit.fragment_id));
    const results = windows.flat().filter((hit) => {
      if (seen.has(hit.chunk_id)) return false;
      seen.add(hit.chunk_id);
      return true;
    }).slice(0, maximum);
    return { results, retrieval: { degraded: errors.length > 0, error_codes: errors }, expansion: { kind: "adjacent_fragments", window: radius, bounded: true, seed_count: seeds.length, result_count: results.length } };
  };

  // Which relation types a question is most likely about. Used only to PREFER those
  // edges when a node's fanout is capped; a path through any other type is still found.
  const relationPreferenceForQuestion = (query) => {
    const text = String(query || "").toLowerCase();
    const preferred = [];
    if (/\b(?:cover|coverage|covers|covered|traceab|verif|validat|tested by|tests for|test cases? (?:for|of))\b/.test(text)) preferred.push("TESTS");
    if (/\b(?:defect|defects|bug|bugs|regress|failure|failures|failing|failed|broken)\b/.test(text)) preferred.push("HAS_DEFECT", "TESTS");
    if (/\b(?:run|runs|execut|executed|result|results)\b/.test(text)) preferred.push("EXECUTED_IN", "HAS_DEFECT");
    if (/\b(?:mention|mentions|mentioned|referenced|reference|document|documents|notes?)\b/.test(text)) preferred.push("MENTIONS");
    return [...new Set(preferred)];
  };

  // The entities a question names (exact display IDs such as STORY-12 or TC-0045) are
  // the natural place to start walking the graph. Resolving them directly means the
  // walk no longer waits for, or depends on, whichever passages search happened to rank.
  const resolveQuestionEntities = async ({ projectId, user, query, appTypeId, signal, timeoutMs, identifiers: supplied }) => {
    const identifiers = asArray(supplied).length ? normalizeFilterIds(supplied, 3) : lexicalQuery.extractIdentifiers(query, 3);
    if (!identifiers.length) return [];
    const graph = require("./knowledgeGraph.service");
    const settled = await Promise.allSettled(identifiers.map((identifier) => graph.resolve({
      projectId, user, query: identifier, limit: 2, app_type_id: appTypeId, signal, timeoutMs: Math.max(1, timeoutMs)
    })));
    return normalizeFilterIds(settled.flatMap((entry) => entry.status === "fulfilled" && !entry.value.ambiguous ? entry.value.nodes.map((node) => node.id) : []), 3);
  };

  // Content for the neighbours a walk reached. A relationship witness is a short line
  // that PROVES an edge; it does not tell the model what the neighbour says. Read each
  // new neighbour's lead passage under the same source ACL as search.
  const loadNeighbourPassages = async ({ projectId, user, sourceIds, edgeBySource, signal, timeoutMs, limit }) => {
    if (!sourceIds.length || !limit) return [];
    const acl = knowledgeAuthorization.predicate({ user, projectId, source: "sources", document: "documents", chunk: "chunks" });
    const rows = await boundedRetrievalStage(() => db.prepare(`SELECT DISTINCT ON (chunks.source_id)
        chunks.id AS chunk_id, chunks.document_id, chunks.source_id, chunks.content, chunks.chunk_index, chunks.heading, chunks.char_start, chunks.char_end, chunks.metadata,
        documents.title, documents.version, documents.checksum_sha256 AS version_hash, documents.is_active AS is_current, documents.effective_from, documents.effective_to,
        sources.source_kind, sources.source_ref_id, sources.source_uri, sources.checksum_sha256 AS source_hash
      FROM ai_knowledge_chunks chunks
      JOIN ai_knowledge_documents documents ON documents.id = chunks.document_id
      JOIN ai_knowledge_sources sources ON sources.id = chunks.source_id
      JOIN ai_knowledge_index_states indexes ON indexes.document_id = documents.id
      WHERE chunks.project_id = ? AND documents.project_id = ? AND sources.project_id = ?
        AND sources.extraction_status = 'ready' AND indexes.required_indexes_ready = TRUE AND documents.is_active = TRUE
        AND ${knowledgeAuthorization.applicationContextPredicate()}
        AND chunks.source_id IN (SELECT jsonb_array_elements_text(?::jsonb)) AND ${acl.sql}
      ORDER BY chunks.source_id, chunks.chunk_index LIMIT ?`).all(projectId, projectId, projectId, sourceIds, ...acl.params, limit),
    { signal, timeoutMs, code: "GRAPH_NEIGHBOUR_TIMEOUT" });
    return rows.map((row) => {
      const relation = edgeBySource.get(row.source_id);
      return {
        id: row.chunk_id, chunk_id: row.chunk_id, document_id: row.document_id, source_id: row.source_id, canonical_id: row.source_id,
        knowledge_id: row.document_id, fragment_id: row.chunk_id, version: row.version, is_current: row.is_current !== false,
        effective_from: row.effective_from || null, effective_to: row.effective_to || null, index_ready: true, collection_ids: [],
        title: row.title, source_kind: row.source_kind, source_ref_id: row.source_ref_id, content: row.content, excerpt: String(row.content || "").slice(0, 700),
        // A neighbour is relevant because the graph connected it, not because it matched the question.
        score: 0.3, relevance: 0.3, graph_neighbour: true,
        relationship_context: relation ? { relation_type: relation.type, provenance_type: relation.provenance_type, via_edge_id: relation.id } : null,
        citation: {
          id: `K-${row.chunk_id}`, label: row.title, source_id: row.source_id, source_kind: row.source_kind, source_ref_id: row.source_ref_id,
          source_uri: row.source_kind === "url" ? sanitizeSourceUri(row.source_uri) : row.source_kind === "file" ? `/knowledge/sources/${row.source_id}/file` : null,
          document_id: row.document_id, chunk_id: row.chunk_id, canonical_id: row.source_id, knowledge_id: row.document_id, fragment_id: row.chunk_id,
          version: row.version, is_current: row.is_current !== false, effective_from: row.effective_from || null, effective_to: row.effective_to || null,
          excerpt: String(row.content || "").slice(0, 700), source_hash: row.source_hash || null, version_hash: row.version_hash || null, chunk_hash: fingerprint(row.content),
          location: { chunk_index: Number(row.chunk_index || 0), heading: row.heading || null, heading_path: asArray(row.metadata?.section_path),
            section_type: row.metadata?.section_type || null, char_start: Number(row.char_start || 0), char_end: Number(row.char_end || 0), page: Number(row.metadata?.page || 0) || null }
        }
      };
    });
  };

  const expandRelationships = async ({ projectId, user, hits = [], query, mode = "hybrid", limit = 6, signal, maxCandidates, timeoutMs, appTypeId, app_type_id, sourceKinds, identifiers, focusSourceIds } = {}) => {
    if (signal?.aborted) throw signal.reason || createError("Knowledge expansion cancelled.", 408);
    const deadlineAt = Date.now() + retrievalTimeout(timeoutMs, 1_500);
    const remainingMs = () => Math.max(0, deadlineAt - Date.now());
    const application = app_type_id || appTypeId;
    const maximum = Math.floor(Math.min(12, Math.max(0, maxCandidates == null ? 12 : Number(maxCandidates) || 0), Math.max(0, Number(limit) || 0)));
    if (!maximum) return { results: [], relationships: [] };
    // Seeds: entities the question names come first, then the strongest authorized hits.
    const [access, anchored] = await Promise.all([
      hits.length ? knowledgeAuthorization.getEvidenceAccess({ projectId, user, evidence: hits, signal, timeoutMs: remainingMs() }) : { allowed: [] },
      resolveQuestionEntities({ projectId, user, query, identifiers, appTypeId: application, signal, timeoutMs: Math.min(800, Math.floor(remainingMs() / 3)) }).catch(() => [])
    ]);
    const hitSeeds = normalizeFilterIds(access.allowed.filter(hit => SOURCE_KINDS.has(hit.source_kind)).map((hit) => hit.source_id), 6).filter((id) => id !== "hellotest-product-help");
    // Sources cited in the recent turns of this conversation are seeds too. They are only IDs: the walk
    // re-applies every visibility and permission check, so a source the caller can no longer see yields nothing.
    const focusSeeds = normalizeFilterIds(focusSourceIds, 6).filter((id) => id !== "hellotest-product-help");
    const seeds = [...new Set([...anchored, ...focusSeeds, ...hitSeeds])].slice(0, 6);
    if (!seeds.length) return { results: [], relationships: [], retrieval: { anchored_seed_count: 0 } };
    // The walk's proof budget and the neighbour-content budget share what this expansion may return.
    const proofLimit = Math.max(1, Math.ceil(maximum / 2));
    // Graph traversal returns the relationship's exact immutable witnesses. A
    // target's semantically similar passage does not establish an edge.
    const graph = await boundedRetrievalStage(boundedSignal => require('./knowledgeGraph.service').expand({ projectId, user, seeds, query, signal:boundedSignal,
      app_type_id:application, sourceKinds, preferRelations: relationPreferenceForQuestion(query), timeoutMs: Math.max(1, remainingMs()), hops: 2, fanout: 3, maxNodes: 18, maxEdges: 12, maxEvidence: proofLimit, maxTokens: 8000 }),
      {signal, timeoutMs:remainingMs(), code:'RELATIONSHIP_SEARCH_TIMEOUT'});
    assertRetrievalActive(signal);
    // Lead passages of the neighbours the walk reached (not the seeds, which search already returned).
    const known = new Set(seeds);
    const edgeBySource = new Map();
    for (const edge of graph.edges) for (const id of [edge.source, edge.target]) if (!known.has(id) && !edgeBySource.has(id)) edgeBySource.set(id, edge);
    const neighbourIds = [...edgeBySource.keys()].slice(0, Math.max(0, maximum - Math.min(graph.evidence.length, proofLimit)));
    let neighbours = [];
    let neighbourError = null;
    if (neighbourIds.length && remainingMs() > 0) {
      try { neighbours = await loadNeighbourPassages({ projectId, user, sourceIds: neighbourIds, edgeBySource, signal, timeoutMs: Math.max(1, remainingMs()), limit: neighbourIds.length }); }
      catch (error) { assertRetrievalActive(signal); neighbourError = error?.code || "GRAPH_NEIGHBOUR_UNAVAILABLE"; }
    }
    const results = [...graph.evidence, ...neighbours].slice(0, maximum);
    return { results, relationships: graph.edges.map(edge => ({
      id: edge.id, source_canonical_id: edge.source, target_canonical_id: edge.target, relationship_type: edge.type,
      provenance_type: edge.provenance_type, evidence_ids: edge.evidence_ids, witness_span:edge.witness_span, endpoints_authorized: true
    })), retrieval: { embedding_model: null, vector_mode: 'graph_witnesses', degraded: graph.limitations.partial || Boolean(neighbourError),
      error_codes: neighbourError ? [neighbourError] : [], anchored_seed_count: anchored.length, focus_seed_count: focusSeeds.length, neighbour_passage_count: neighbours.length,
      graph: { stats: graph.stats, limitations: graph.limitations, budget: graph.budget } } };
  };

  const allocateCandidateBudgets = (queryCount, maxCandidates) => {
    if (maxCandidates === undefined || maxCandidates === null) return Array(queryCount).fill(undefined);
    const total = Math.max(0, Math.min(10_000, Math.floor(Number(maxCandidates) || 0)));
    const count = Math.min(queryCount, total);
    return Array.from({ length: count }, (_, index) => Math.min(1_000,
      Math.floor(total / count) + (index < total % count ? 1 : 0)));
  };

  const searchMany = async ({ queries, projectId, mode = "hybrid", user, userId, integrationId, ...options } = {}) => {
    const deadlineAt = Date.now() + retrievalTimeout(options.timeoutMs);
    const remainingMs = () => Math.max(0, deadlineAt - Date.now());
    const normalizedProjectId = normalizeId(projectId);
    const normalizedMode = ["hybrid", "semantic", "keyword"].includes(mode) ? mode : "hybrid";
    const normalizedQueries = [...new Map(asArray(queries)
      .map((query) => sanitizeAiText(normalizeText(query, 4_000)).text)
      .filter(Boolean)
      .map((query) => [query.toLowerCase(), query])).values()].slice(0, 10);
    if (!normalizedProjectId || !normalizedQueries.length) throw createError("project_id and at least one query are required.");
    const candidateBudgets = allocateCandidateBudgets(normalizedQueries.length, options.maxCandidates);
    const activeQueries = normalizedQueries.slice(0, candidateBudgets.length);
    if (!activeQueries.length) return {
      results: [], errors: [], query_count: 0, embedding_batch_count: 0,
      candidate_count: 0, skipped_query_count: normalizedQueries.length, candidate_budget_exhausted: true
    };
    const allowedSourcePermissions = await boundedRetrievalStage(() => resolveAllowedSourcePermissions(user, normalizedProjectId), {
      signal: options.signal, timeoutMs: Math.min(1_500, remainingMs()), code: "AUTHORIZATION_TIMEOUT"
    });
    const embeddingTimeoutMs = Math.min(RETRIEVAL_EMBEDDING_TIMEOUT_MS, Math.max(1, Math.floor(remainingMs() / 2)));
    // Share the provider batch without making lexical/exact searches wait for it.
    let embeddingBatchPromise = null;
    const getEmbeddingBatch = () => {
      embeddingBatchPromise ||= boundedRetrievalStage(async (signal) => {
        const runtime = await resolveEmbeddingRuntime({ userId: user?.id || userId, projectId: normalizedProjectId, integrationId });
        assertRetrievalActive(signal);
        return embedTexts(runtime, activeQueries, { cacheResults: true, signal, timeoutMs: embeddingTimeoutMs });
      }, { signal: options.signal, timeoutMs: Math.min(remainingMs(), embeddingTimeoutMs + 300), code: "EMBEDDING_SETUP_TIMEOUT" })
        .catch((error) => {
          assertRetrievalActive(options.signal);
          const fallback = activeQueries.map(localEmbedding);
          return { model: LOCAL_EMBEDDING_MODEL, vectors: fallback, fallback,
            warning_code: error.code || "EMBEDDING_UNAVAILABLE" };
        });
      return embeddingBatchPromise;
    };
    const settled = await Promise.allSettled(activeQueries.map(async (query, index) => ({
      query,
      result: await search({
        ...options,
        timeoutMs: remainingMs(),
        maxCandidates: candidateBudgets[index],
        projectId: normalizedProjectId,
        query,
        mode: normalizedMode,
        integrationId,
        user,
        userId,
        allowedSourcePermissions,
        preparedEmbedding: () => getEmbeddingBatch().then((embeddingBatch) => embeddingBatch ? {
          model: embeddingBatch.model,
          vector: embeddingBatch.vectors[index],
          fallback: embeddingBatch.fallback[index],
          warning: embeddingBatch.warning,
          warning_code: embeddingBatch.warning_code,
          warning_reason_code: embeddingBatch.warning_reason_code
        } : null)
      })
    })));
    assertRetrievalActive(options.signal);
    const results = settled.filter((entry) => entry.status === "fulfilled").map((entry) => entry.value);
    return {
      results,
      errors: settled.filter((entry) => entry.status === "rejected").map((entry) => entry.reason),
      query_count: activeQueries.length,
      skipped_query_count: normalizedQueries.length - activeQueries.length,
      candidate_count: results.reduce((count, entry) => count + Number(entry.result.retrieval?.candidate_count || 0), 0),
      embedding_batch_count: embeddingBatchPromise ? 1 : 0
    };
  };

  return { getProductHelpCandidates, search, searchMany, expandEvidence, expandRelationships, allocateCandidateBudgets, relationPreferenceForQuestion, resolveQuestionEntities, loadNeighbourPassages };
}

module.exports = { createKnowledgeSearchService };
