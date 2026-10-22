const db = require('@hellotest/platform/backend/src/db');
const authorization = require('./knowledgeAuthorization.service');
const { fingerprint } = require('@hellotest/platform/backend/src/security/aiTextPolicy');
const { boundedRetrievalStage, assertRetrievalActive } = require('@hellotest/platform/backend/src/utils/knowledgeRetrievalTiming');

const fail = (message, statusCode = 404, code = 'KNOWLEDGE_EVIDENCE_UNAVAILABLE') => Object.assign(new Error(message), { message, publicMessage: message, statusCode, code });

// Exact fragment reads share the same source, revision, native-record and ACL
// boundary as graph witnesses. Keep this reusable outside the MCP transport.
function createEvidenceReader({ store = db, access = authorization } = {}) {
  return async function fetchEvidence({ projectId, user, fragmentId, asOf, expectedDocumentId, expectedVersionHash, signal, timeoutMs = 5000 }) {
    const deadline = Date.now() + Math.min(10000, Math.max(1, Number(timeoutMs) || 5000));
    const stage = task => boundedRetrievalStage(task, { signal, timeoutMs: Math.max(0, deadline - Date.now()), code: 'KNOWLEDGE_EVIDENCE_TIMEOUT' });
    if (typeof projectId !== 'string' || !projectId || !user?.id || typeof fragmentId !== 'string' || !fragmentId || fragmentId.length > 255)
      throw fail('Verified project, user and fragment are required.', 400, 'KNOWLEDGE_EVIDENCE_INVALID');
    const allowed = await stage(boundedSignal => access.getEvidenceAccess({ projectId, user, evidence: [{ fragment_id: fragmentId }], asOf,
      requireCurrentNativeRecords: true, signal: boundedSignal, timeoutMs: Math.max(0, deadline - Date.now()) }));
    if (!allowed.allowed.length) throw fail('This evidence is unavailable or no longer authorized.');
    const acl = access.predicate({ user, projectId, document: 'documents', chunk: 'chunks' });
    // Apply ACL/version/index/native gates again in the content SELECT. A source
    // changing between the permission probe and hydration cannot reuse its old
    // access decision, and cross-source or cross-project rows never join.
    const row = await stage(() => store.prepare(`SELECT chunks.id,chunks.project_id,chunks.document_id,chunks.source_id,
      chunks.heading,chunks.content,chunks.chunk_index,chunks.char_start,chunks.char_end,chunks.created_at,
      documents.version,documents.checksum_sha256 AS version_hash,documents.is_active AS is_current,
      documents.effective_from,documents.effective_to,sources.title,sources.source_kind,sources.source_ref_id,
      sources.checksum_sha256 AS source_hash,sources.required_permission
      FROM ai_knowledge_chunks chunks
      JOIN ai_knowledge_documents documents ON documents.id=chunks.document_id AND documents.source_id=chunks.source_id AND documents.project_id=chunks.project_id
      JOIN ai_knowledge_sources sources ON sources.id=chunks.source_id AND sources.project_id=chunks.project_id
      JOIN ai_knowledge_index_states indexes ON indexes.document_id=documents.id AND indexes.project_id=sources.project_id
        AND indexes.source_id=sources.id AND indexes.document_version=documents.version
      WHERE chunks.id=? AND chunks.project_id=? AND sources.extraction_status='ready' AND indexes.required_indexes_ready=TRUE
        AND ${access.applicationContextPredicate()}
        ${asOf ? 'AND documents.effective_from<=?::timestamptz AND(documents.effective_to IS NULL OR documents.effective_to>?::timestamptz)' : `AND documents.is_active=TRUE AND indexes.is_current=TRUE AND ${access.applicationRecordPredicate()}`}
        AND ${acl.sql}`).get(fragmentId, projectId, ...(asOf ? [asOf, asOf] : []), ...acl.params));
    assertRetrievalActive(signal);
    if (!row) throw fail('This evidence is unavailable or no longer authorized.');
    // Required native permissions can change during hydration too. This final
    // check also keeps the permission oracle out of the model response.
    const fresh = await stage(boundedSignal => access.getEvidenceAccess({ projectId, user, evidence: [{ fragment_id: row.id }], asOf,
      requireCurrentNativeRecords: true, signal: boundedSignal, timeoutMs: Math.max(0, deadline - Date.now()) }));
    if (!fresh.allowed.length) throw fail('This evidence is unavailable or no longer authorized.');
    if (expectedDocumentId && expectedDocumentId !== row.document_id || expectedVersionHash && expectedVersionHash !== row.version_hash)
      throw fail('The evidence revision differs from the cited revision. Retrieve current context or request authorized historical evidence.', 409, 'KNOWLEDGE_EVIDENCE_CHANGED');
    const { required_permission, ...fragment } = row;
    return { fragment, citation: { id: `K-${row.id}`, source_id: row.source_id, source_kind: row.source_kind, source_ref_id: row.source_ref_id,
      document_id: row.document_id, chunk_id: row.id, fragment_id: row.id, source_version: String(row.version),
      source_hash: row.source_hash, version_hash: row.version_hash, chunk_hash: fingerprint(row.content), is_current: row.is_current,
      effective_from: row.effective_from, effective_to: row.effective_to,
      location: { chunk_index: row.chunk_index, heading: row.heading, char_start: row.char_start, char_end: row.char_end } },
      observed_at: new Date().toISOString(), as_of: asOf || null };
  };
}

module.exports = { createEvidenceReader, fetchEvidence: createEvidenceReader() };
