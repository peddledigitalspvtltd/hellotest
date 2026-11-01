// Human curation is separate from the factual graph read path. A model can
// propose a source-grounded relationship; only a fresh, explicit review may
// promote it. Native record identities are never merged by name similarity.
const { randomUUID } = require('node:crypto');
const db = require('@hellotest/platform/backend/src/db');
const permissions = require('@hellotest/platform/backend/services/permission.service');
const flags = require('@hellotest/platform/backend/services/featureFlag.service');
const projectAccess = require('@hellotest/platform/backend/public/projectAccess');
const authorization = require('./knowledgeAuthorization.service');
const execution = require('./knowledgeExecution.service');
const { PERMISSIONS } = require('./knowledgeGraphContracts');
const { fingerprint, sanitizeAiText } = require('@hellotest/platform/backend/src/security/aiTextPolicy');

const RELATIONS = Object.freeze(['TESTS', 'EXECUTED_IN', 'HAS_DEFECT', 'RELATED_TO', 'DEPENDS_ON', 'DERIVED_FROM', 'USES', 'PART_OF']);
const fail = (message, statusCode = 400, code = 'KNOWLEDGE_GRAPH_INVALID') => Object.assign(new Error(message), { statusCode, code, publicMessage: message });
const object = value => value && typeof value === 'object' && !Array.isArray(value);
function strict(input, keys) {
  if (!object(input) || Object.keys(input).some(key => !keys.includes(key))) throw fail('Unsupported context graph input.');
}
function id(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 255 || /[\u0000-\u001f]/.test(value)) throw fail('A bounded record ID is required.');
  return value.trim();
}
const aliasesOf = node => Array.isArray(node.aliases) ? node.aliases : [];
async function curateTransaction(task) {
  try { return await db.transaction(async () => {
    await db.query("SET LOCAL statement_timeout = '5s'");
    return task();
  })(); }
  catch (error) {
    if (['55P03', '40P01', '40001'].includes(error.code)) throw fail('These records are being updated. Reload the graph evidence and retry.', 409, 'KNOWLEDGE_GRAPH_BUSY');
    if (error.code === '57014') throw fail('The graph update exceeded its database time budget. Reload before retrying.', 503, 'KNOWLEDGE_GRAPH_TIMEOUT');
    throw error;
  }
}
const aliasRevision = node => fingerprint(JSON.stringify([node.id, aliasesOf(node)]));
function normalizeAliases(value) {
  if (!Array.isArray(value) || value.length > 20) throw fail('Use at most 20 curated aliases.');
  const seen = new Set();
  return value.map(item => {
    if (typeof item !== 'string' || !item.trim() || item.length > 120 || /[\u0000-\u001f\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/u.test(item)) throw fail('Aliases must be 1–120 visible characters.');
    const text = item.trim();
    if (sanitizeAiText(text).text !== text) throw fail('Aliases must not contain sensitive values or embedded instructions.');
    const key = text.toLocaleLowerCase('en-US');
    if (seen.has(key)) throw fail('Remove duplicate aliases.');
    seen.add(key);
    return text;
  });
}
async function authorize(projectId, user, manage = false) {
  id(projectId);
  if (!user?.id) throw fail('Authentication is required.', 401);
  await projectAccess.getProject(projectId, user.id);
  if (!await db.prepare("SELECT id FROM users WHERE id = ? AND status = 'active'").get(user.id)) throw fail('The account is unavailable.', 403);
  for (const permission of manage ? ['knowledge.view', 'knowledge.manage'] : ['knowledge.view']) {
    if (!await permissions.hasPermission(user, permission, projectId)
        || !await flags.areEnabled(flags.getFeatureKeysForPermission(permission), { user })) throw fail(`Permission required: ${permission}`, 403);
  }
}
async function allowedPermissions(projectId, user) {
  const allowed = ['knowledge.view'];
  // Curation rechecks inside a source-locking transaction. Query its single
  // PostgreSQL client sequentially instead of queueing parallel client.querys.
  for (const permission of new Set(Object.values(PERMISSIONS))) {
    if (await permissions.hasPermission(user, permission, projectId)
        && await flags.areEnabled(flags.getFeatureKeysForPermission(permission), { user })) allowed.push(permission);
  }
  return allowed;
}
function kindGate(alias, allowed) {
  const native = Object.keys(PERMISSIONS), readable = native.filter(kind => allowed.includes(PERMISSIONS[kind]));
  return { sql: `(${alias}.source_kind NOT IN (${native.map(() => '?').join(',')})${readable.length ? ` OR ${alias}.source_kind IN (${readable.map(() => '?').join(',')})` : ''})`, params: [...native, ...readable] };
}
// ACL and source-kind gates are applied before LIMIT, including the document
// and fragment gates. A source with no readable current fragments is not a node.
function visibility(nodeAlias, projectId, user, allowed) {
  if (!/^[a-z_]+$/i.test(nodeAlias)) throw new Error('Invalid graph SQL alias.');
  const acl = authorization.predicate({ user, projectId, source: 'vs', document: 'vd', chunk: 'vc' });
  const kinds = kindGate('vs', allowed);
  return {
    sql: `${nodeAlias}.tombstoned_at IS NULL AND EXISTS (
      SELECT 1 FROM ai_knowledge_sources vs
      JOIN ai_knowledge_documents vd ON vd.source_id = vs.id AND vd.project_id = vs.project_id
      JOIN ai_knowledge_index_states vi ON vi.document_id = vd.id AND vi.project_id = vs.project_id AND vi.source_id = vs.id
      JOIN ai_knowledge_chunks vc ON vc.document_id = vd.id AND vc.source_id = vs.id AND vc.project_id = vs.project_id
      WHERE vs.id = ${nodeAlias}.source_id AND vs.project_id = ${nodeAlias}.project_id AND vs.project_id = ?
        AND vs.extraction_status = 'ready' AND vd.is_active = TRUE AND vi.is_current = TRUE AND vi.required_indexes_ready = TRUE
        AND ${authorization.applicationContextPredicate({ source: 'vs', document: 'vd' })}
        AND ${authorization.applicationRecordPredicate({ source: 'vs' })}
        AND ${kinds.sql}
        AND (vs.required_permission IS NULL ${allowed.length ? `OR vs.required_permission IN (${allowed.map(() => '?').join(',')})` : ''})
        AND ${acl.sql})`,
    params: [projectId, ...kinds.params, ...allowed, ...acl.params]
  };
}
async function getNodes(projectId, user, ids, allowed) {
  const visible = visibility('n', projectId, user, allowed);
  return db.prepare(`SELECT n.id, n.source_id, n.entity_type, n.entity_key, current_sources.title AS title, n.aliases
    FROM ai_knowledge_graph_nodes n JOIN ai_knowledge_sources current_sources ON current_sources.id = n.source_id AND current_sources.project_id = n.project_id
    WHERE n.project_id = ? AND n.id IN (${ids.map(() => '?').join(',')}) AND ${visible.sql}`)
    .all(projectId, ...ids, ...visible.params);
}
async function lockSources(projectId, ids, chunkId = null) {
  await db.prepare(`SELECT id FROM ai_knowledge_sources WHERE project_id = ? AND (
    id IN (${ids.map(() => '?').join(',') || 'NULL'})
    OR id IN (SELECT source_id FROM ai_knowledge_chunks WHERE project_id = ? AND id = ?)) ORDER BY id FOR UPDATE`)
    .all(projectId, ...ids, projectId, chunkId);
}
async function setAliases({ projectId, user, nodeId, input }) {
  strict(input, ['aliases', 'expected_revision']);
  const aliases = normalizeAliases(input.aliases);
  if (typeof input.expected_revision !== 'string') throw fail('Reload the node before editing aliases.', 409);
  await authorize(projectId, user, true);
  nodeId = id(nodeId);
  return curateTransaction(async () => {
    await db.query("SET LOCAL lock_timeout = '2s'");
    await lockSources(projectId, [nodeId]);
    await db.prepare('SELECT id FROM ai_knowledge_graph_nodes WHERE id = ? AND project_id = ? FOR UPDATE').get(nodeId, projectId);
    // Project serialization closes the race between editors assigning the
    // same alias to different native records. Reauthorize after every lock wait.
    await db.query("SELECT pg_advisory_xact_lock(hashtext(?))", [`knowledge-graph-aliases:${projectId}`]);
    await authorize(projectId, user, true);
    const allowed = await allowedPermissions(projectId, user);
    const node = (await getNodes(projectId, user, [nodeId], allowed))[0];
    if (!node) throw fail('Context graph node is unavailable.', 404);
    if (aliasRevision(node) !== input.expected_revision) throw fail('Aliases changed. Reload before saving.', 409, 'KNOWLEDGE_GRAPH_STALE');
    if (aliases.length) {
      const conflict = await db.prepare(`SELECT n.id FROM ai_knowledge_graph_nodes n
        JOIN ai_knowledge_sources current_sources ON current_sources.id = n.source_id AND current_sources.project_id = n.project_id
        WHERE n.project_id = ? AND n.id <> ? AND n.tombstoned_at IS NULL AND (
          lower(n.entity_key) IN (SELECT lower(value) FROM jsonb_array_elements_text(?::jsonb))
          OR lower(n.id) IN (SELECT lower(value) FROM jsonb_array_elements_text(?::jsonb))
          OR lower(current_sources.title) IN (SELECT lower(value) FROM jsonb_array_elements_text(?::jsonb))
          OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(n.aliases) a(value)
            JOIN jsonb_array_elements_text(?::jsonb) b(value) ON lower(a.value) = lower(b.value))) LIMIT 1`)
        .get(projectId, nodeId, aliases, aliases, aliases, aliases);
      if (conflict) throw fail('An alias already identifies another project record. Use an unambiguous alias.', 409);
    }
    await db.prepare('UPDATE ai_knowledge_graph_nodes SET aliases = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND project_id = ?').run(aliases, nodeId, projectId);
    await audit(user, projectId, 'aliases.update', nodeId, { before: aliasRevision(node), after: aliasRevision({ ...node, aliases }) });
    return { node: { ...node, aliases }, alias_revision: aliasRevision({ ...node, aliases }) };
  });
}
async function audit(user, projectId, action, targetId, metadata) {
  await require('@hellotest/platform/backend/services/adminPortal.service').recordAudit({ actorId: user.id,
    action: `knowledge_graph.${action}`, targetType: 'knowledge_graph', targetId,
    summary: 'Updated reviewed project context graph curation.', metadata: { project_id: projectId, ...metadata } });
}
function anchored(excerpt, node) {
  const text = excerpt.toLocaleLowerCase('en-US');
  return [node.id, node.entity_key, node.title, ...aliasesOf(node)].some(value => {
    const name = String(value || '').toLocaleLowerCase('en-US');
    if (name.length < 3) return false;
    let index = text.indexOf(name);
    while (index >= 0) {
      if (!/[\p{L}\p{N}_]/u.test(text[index - 1] || '') && !/[\p{L}\p{N}_]/u.test(text[index + name.length] || '')) return true;
      index = text.indexOf(name, index + 1);
    }
    return false;
  });
}
function candidateInput(input) {
  strict(input, ['source_node_id', 'target_node_id', 'relation_type', 'chunk_id', 'excerpt']);
  const value = Object.fromEntries(['source_node_id', 'target_node_id', 'chunk_id'].map(key => [key, id(input[key])]));
  if (value.source_node_id === value.target_node_id || !RELATIONS.includes(input.relation_type)) throw fail('Choose distinct records and a supported relationship.');
  if (typeof input.excerpt !== 'string' || input.excerpt.length < 3 || input.excerpt.length > 1500) throw fail('Use an exact supporting excerpt of 3–1,500 characters.');
  return { ...value, relation_type: input.relation_type, excerpt: input.excerpt };
}
function validateRelationKinds(type, source, target) {
  const pairs = {
    TESTS: source.entity_type === 'test_case' && target.entity_type === 'requirement',
    EXECUTED_IN: source.entity_type === 'test_case' && target.entity_type === 'execution',
    HAS_DEFECT: ['requirement', 'test_case', 'execution'].includes(source.entity_type) && target.entity_type === 'bug'
  };
  if (pairs[type] === false) throw fail('This relationship type does not fit the selected record kinds.');
}
async function proof(projectId, user, chunkId, allowed) {
  const access = await authorization.getEvidenceAccess({ projectId, user, evidence: [{ chunk_id: chunkId }] });
  if (!access.allowed.length) throw fail('The supporting fragment is unavailable or no longer current.', 409, 'KNOWLEDGE_GRAPH_STALE');
  const kinds = kindGate('s', allowed);
  return db.prepare(`SELECT c.id AS chunk_id, c.content, c.source_id, c.document_id, d.version AS document_version, d.checksum_sha256 AS version_hash
    FROM ai_knowledge_chunks c JOIN ai_knowledge_documents d ON d.id = c.document_id AND d.source_id = c.source_id AND d.project_id = c.project_id
    JOIN ai_knowledge_sources s ON s.id = c.source_id AND s.project_id = c.project_id
    WHERE c.id = ? AND c.project_id = ? AND d.is_active = TRUE AND s.extraction_status = 'ready' AND ${kinds.sql}
      AND ${authorization.applicationRecordPredicate({ source: 's' })}
      AND (s.required_permission IS NULL OR s.required_permission IN (${allowed.map(() => '?').join(',')}))`).get(chunkId, projectId, ...kinds.params, ...allowed);
}
// An existing human-reviewed fact stays protected while any current proof
// supports it, including proof the proposing actor cannot read. Once all its
// witnesses expire, new evidence may enter a fresh review without erasing history.
const currentProof = edge => `EXISTS (SELECT 1 FROM ai_knowledge_graph_edge_evidence prior
  JOIN ai_knowledge_documents pd ON pd.id = prior.document_id AND pd.project_id = prior.project_id
  JOIN ai_knowledge_sources ps ON ps.id = prior.source_id AND ps.project_id = prior.project_id
  JOIN ai_knowledge_index_states pi ON pi.document_id = pd.id AND pi.project_id = prior.project_id
  WHERE prior.edge_id = ${edge}.id AND prior.project_id = ${edge}.project_id
    AND prior.provenance_type IN ('DETERMINISTIC','SOURCE_EXPLICIT','HUMAN_VERIFIED')
    AND pd.is_active = TRUE AND ps.extraction_status = 'ready' AND pi.is_current = TRUE AND pi.required_indexes_ready = TRUE
    AND pd.version = prior.document_version AND pd.checksum_sha256 = prior.version_hash
    AND pi.document_version = pd.version AND pi.source_id = prior.source_id
    AND ${authorization.applicationContextPredicate({ source: 'ps', document: 'pd' })}
    AND ${authorization.applicationRecordPredicate({ source: 'ps' })})`;
async function propose({ projectId, user, input, signal }) {
  const active = () => { if (signal?.aborted) throw execution.abortError(); };
  active();
  const value = candidateInput(input);
  await authorize(projectId, user, true);
  active();
  return curateTransaction(async () => {
    // Bound waits on canonical publication locks. A cancelled extraction may
    // finish an in-flight read, but cannot continue into candidate writes.
    await db.query("SET LOCAL lock_timeout = '2s'");
    active();
    await lockSources(projectId, [value.source_node_id, value.target_node_id], value.chunk_id);
    active();
    await authorize(projectId, user, true);
    const allowed = await allowedPermissions(projectId, user);
    active();
    const nodes = await getNodes(projectId, user, [value.source_node_id, value.target_node_id], allowed);
    if (nodes.length !== 2) throw fail('Both context graph records must be readable and current.', 404);
    validateRelationKinds(value.relation_type, nodes.find(node => node.id === value.source_node_id), nodes.find(node => node.id === value.target_node_id));
    const evidence = await proof(projectId, user, value.chunk_id, allowed);
    active();
    const start = evidence?.content.indexOf(value.excerpt) ?? -1;
    if (start < 0 || !nodes.every(node => anchored(value.excerpt, node))) throw fail('The exact supporting excerpt must identify both records. Curate aliases for alternate names first.');
    const existing = await db.prepare(`SELECT existing.id, existing.status, existing.provenance_type, ${currentProof('existing')} AS has_current_proof
      FROM ai_knowledge_graph_edges existing WHERE existing.project_id = ? AND existing.source_node_id = ? AND existing.relation_type = ? AND existing.target_node_id = ? FOR UPDATE OF existing`)
      .get(projectId, value.source_node_id, value.relation_type, value.target_node_id);
    active();
    if (existing && !(existing.provenance_type === 'LLM_CANDIDATE' && existing.status !== 'ACTIVE'
        || existing.provenance_type === 'HUMAN_VERIFIED' && !existing.has_current_proof)) throw fail('This relationship already has a verified or managed definition.', 409);
    const saved = await db.prepare(`INSERT INTO ai_knowledge_graph_edges(id, project_id, source_node_id, target_node_id, relation_type, status, provenance_type, metadata)
      VALUES (?, ?, ?, ?, ?, 'CANDIDATE', 'LLM_CANDIDATE', ?)
      ON CONFLICT(project_id, source_node_id, relation_type, target_node_id) DO UPDATE SET status = 'CANDIDATE', provenance_type = 'LLM_CANDIDATE', valid_to = NULL,
        metadata = EXCLUDED.metadata, updated_at = CURRENT_TIMESTAMP
      WHERE (ai_knowledge_graph_edges.provenance_type = 'LLM_CANDIDATE' AND ai_knowledge_graph_edges.status <> 'ACTIVE')
        OR (ai_knowledge_graph_edges.provenance_type = 'HUMAN_VERIFIED' AND NOT ${currentProof('ai_knowledge_graph_edges')}) RETURNING id`)
      .get(existing?.id || randomUUID(), projectId, value.source_node_id, value.target_node_id, value.relation_type,
        { proposed_by: user.id, proposal_revision: randomUUID(), extraction: 'source_anchored_candidate' });
    if (!saved) throw fail('This relationship already has a verified or managed definition.', 409);
    active();
    const edgeId = saved.id;
    await db.prepare("DELETE FROM ai_knowledge_graph_edge_evidence WHERE edge_id = ? AND project_id = ? AND provenance_type = 'LLM_CANDIDATE'").run(edgeId, projectId);
    await db.prepare(`INSERT INTO ai_knowledge_graph_edge_evidence(edge_id,project_id,chunk_id,document_id,source_id,document_version,version_hash,span_start,span_end,provenance_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'LLM_CANDIDATE')`)
      .run(edgeId, projectId, evidence.chunk_id, evidence.document_id, evidence.source_id, evidence.document_version, evidence.version_hash,
        [...evidence.content.slice(0, start)].length, [...evidence.content.slice(0, start) + value.excerpt].length);
    await audit(user, projectId, 'relationship.propose', edgeId, { fragment_id: evidence.chunk_id, version_hash: evidence.version_hash });
    active();
    return { id: edgeId, status: 'CANDIDATE', requires_review: true };
  });
}

const reviewRevision = row => fingerprint(JSON.stringify([row.id, row.status, row.provenance_type, row.source_node_id, row.target_node_id,
  row.relation_type, row.chunk_id, row.document_id, row.document_version, row.version_hash, row.span_start, row.span_end,
  row.origin_document_id, row.origin_version_hash, row.target_document_id, row.target_version_hash,
  row.source_kind, row.source_key, row.source_title, row.source_aliases, row.target_kind, row.target_key, row.target_title, row.target_aliases, row.proposal_revision]));
async function candidateRows(projectId, user, allowed, edgeId = null) {
  const left = visibility('origin', projectId, user, allowed);
  const right = visibility('target', projectId, user, allowed);
  const acl = authorization.predicate({ user, projectId, source: 'sources', document: 'documents', chunk: 'chunks' });
  const kinds = kindGate('sources', allowed);
  return db.prepare(`SELECT e.id,e.status,e.provenance_type,e.source_node_id,e.target_node_id,e.relation_type,
    e.metadata->>'proposal_revision' AS proposal_revision,
    origin_document.id AS origin_document_id, origin_document.checksum_sha256 AS origin_version_hash,
    target_document.id AS target_document_id, target_document.checksum_sha256 AS target_version_hash,
    origin.entity_type AS source_kind, origin.entity_key AS source_key, origin.aliases AS source_aliases,
    target.entity_type AS target_kind, target.entity_key AS target_key, target.aliases AS target_aliases,
    origin_source.title AS source_title,target_source.title AS target_title,v.chunk_id,v.document_id,v.source_id,v.document_version,v.version_hash,v.span_start,v.span_end,
    substring(chunks.content FROM v.span_start + 1 FOR v.span_end - v.span_start) AS excerpt
    FROM ai_knowledge_graph_edges e JOIN ai_knowledge_graph_nodes origin ON origin.id = e.source_node_id AND origin.project_id = e.project_id
    JOIN ai_knowledge_graph_nodes target ON target.id = e.target_node_id AND target.project_id = e.project_id
    JOIN ai_knowledge_sources origin_source ON origin_source.id = origin.source_id AND origin_source.project_id = e.project_id
    JOIN ai_knowledge_sources target_source ON target_source.id = target.source_id AND target_source.project_id = e.project_id
    JOIN ai_knowledge_documents origin_document ON origin_document.source_id = origin.source_id AND origin_document.project_id = e.project_id AND origin_document.is_active = TRUE
    JOIN ai_knowledge_documents target_document ON target_document.source_id = target.source_id AND target_document.project_id = e.project_id AND target_document.is_active = TRUE
    JOIN ai_knowledge_graph_edge_evidence v ON v.edge_id = e.id AND v.project_id = e.project_id
    JOIN ai_knowledge_chunks chunks ON chunks.id = v.chunk_id AND chunks.project_id = e.project_id
    JOIN ai_knowledge_documents documents ON documents.id = v.document_id AND documents.source_id = v.source_id AND documents.project_id = e.project_id
    JOIN ai_knowledge_sources sources ON sources.id = v.source_id AND sources.project_id = e.project_id
    JOIN ai_knowledge_index_states indexes ON indexes.document_id = documents.id AND indexes.project_id = e.project_id
    WHERE e.project_id = ? AND e.status = 'CANDIDATE' AND e.provenance_type = 'LLM_CANDIDATE' ${edgeId ? 'AND e.id = ?' : ''}
      AND documents.is_active = TRUE AND documents.version = v.document_version AND documents.checksum_sha256 = v.version_hash
      AND sources.extraction_status = 'ready' AND indexes.is_current = TRUE AND indexes.required_indexes_ready = TRUE
      AND v.span_end <= length(chunks.content) AND v.span_end - v.span_start <= 1500
      AND ${authorization.applicationContextPredicate()}
      AND ${authorization.applicationRecordPredicate()}
      AND ${kinds.sql}
      AND (sources.required_permission IS NULL ${allowed.length ? `OR sources.required_permission IN (${allowed.map(() => '?').join(',')})` : ''})
      AND ${left.sql} AND ${right.sql} AND ${acl.sql}
    ORDER BY e.updated_at DESC, e.id, v.chunk_id LIMIT 101`)
    .all(projectId, ...(edgeId ? [edgeId] : []), ...kinds.params, ...allowed, ...left.params, ...right.params, ...acl.params);
}
async function listCandidates({ projectId, user }) {
  await authorize(projectId, user, true);
  const rows = await candidateRows(projectId, user, await allowedPermissions(projectId, user));
  return { candidates: rows.slice(0, 100).map(row => ({ ...row, review_revision: reviewRevision(row) })), truncated: rows.length > 100 };
}
async function review({ projectId, user, edgeId, input }) {
  strict(input, ['decision', 'expected_revision']);
  if (!['approve', 'reject'].includes(input.decision) || typeof input.expected_revision !== 'string') throw fail('An explicit review decision and current revision are required.');
  await authorize(projectId, user, true);
  edgeId = id(edgeId);
  return curateTransaction(async () => {
    await db.query("SET LOCAL lock_timeout = '2s'");
    const identity = await db.prepare('SELECT source_node_id, target_node_id FROM ai_knowledge_graph_edges WHERE id = ? AND project_id = ?').get(edgeId, projectId);
    const witnesses = await db.prepare('SELECT source_id FROM ai_knowledge_graph_edge_evidence WHERE edge_id = ? AND project_id = ?').all(edgeId, projectId);
    if (!identity) throw fail('The relationship is unavailable.', 404);
    await lockSources(projectId, [identity.source_node_id, identity.target_node_id, ...witnesses.map(row => row.source_id)]);
    await db.prepare('SELECT id FROM ai_knowledge_graph_edges WHERE id = ? AND project_id = ? FOR UPDATE').get(edgeId, projectId);
    await authorize(projectId, user, true);
    const allowed = await allowedPermissions(projectId, user);
    const row = (await candidateRows(projectId, user, allowed, edgeId))[0];
    if (!row || reviewRevision(row) !== input.expected_revision) throw fail('The relationship or its evidence changed. Reload before reviewing.', 409, 'KNOWLEDGE_GRAPH_STALE');
    const approved = input.decision === 'approve';
    if (approved && (!anchored(row.excerpt, { id: row.source_node_id, entity_key: row.source_key, title: row.source_title, aliases: row.source_aliases })
        || !anchored(row.excerpt, { id: row.target_node_id, entity_key: row.target_key, title: row.target_title, aliases: row.target_aliases }))) {
      throw fail('The current names no longer ground this relationship. Correct the aliases or submit fresh evidence.', 409, 'KNOWLEDGE_GRAPH_STALE');
    }
    await db.prepare(`UPDATE ai_knowledge_graph_edges SET status = ?, provenance_type = ?, valid_from = CURRENT_TIMESTAMP,
      valid_to = CASE WHEN ? THEN NULL ELSE CURRENT_TIMESTAMP END, metadata = metadata || ?::jsonb, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND project_id = ?`)
      .run(approved ? 'ACTIVE' : 'REJECTED', approved ? 'HUMAN_VERIFIED' : 'LLM_CANDIDATE', approved,
        { reviewed_by: user.id, review_revision: input.expected_revision }, edgeId, projectId);
    if (approved) await db.prepare("UPDATE ai_knowledge_graph_edge_evidence SET provenance_type = 'HUMAN_VERIFIED' WHERE edge_id = ? AND project_id = ?").run(edgeId, projectId);
    await audit(user, projectId, `relationship.${input.decision}`, edgeId, { review_revision: input.expected_revision, fragment_id: row.chunk_id, version_hash: row.version_hash });
    return { id: edgeId, status: approved ? 'ACTIVE' : 'REJECTED', provenance_type: approved ? 'HUMAN_VERIFIED' : 'LLM_CANDIDATE' };
  });
}

module.exports = { RELATIONS, authorize, allowedPermissions, getNodes, setAliases, propose, listCandidates, review, aliasRevision,
  _internals: { normalizeAliases, candidateInput, anchored, reviewRevision, visibility } };
