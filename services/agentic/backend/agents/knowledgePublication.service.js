const db = require('@hellotest/platform/backend/src/db');
const permissions = require('@hellotest/platform/backend/services/permission.service');
const rag = require('@hellotest/knowledge/backend/services/knowledgeRag.service');
const { sanitizeAiText, fingerprint } = require('@hellotest/platform/backend/src/security/aiTextPolicy');
const agents = require('./repositoryAgents.service');
const { LIMITS, error } = require('./catalog');

async function authorize(id, user, write = false) {
  const run = await agents.getRun(id, user, write ? 'agentic_workflow.run' : 'agentic_workflow.view');
  if (run.agent_type !== 'repository_knowledge') throw error('Knowledge processing is available for Repository Knowledge Builder results.', 400);
  const permission = write ? 'knowledge.manage' : 'knowledge.view';
  if (!await permissions.hasPermission(user, permission, run.project_id)) throw error(`Permission required: ${permission}`, 403);
  return run;
}

function receipts(run) {
  const findings = new Set((run.result?.findings?.knowledge || []).map(item => item.id));
  const items = (run.published?.items || []).filter(item => item.target_type === 'knowledge'
    && findings.has(item.finding_id) && typeof item.target_id === 'string' && item.target_id.length <= 255);
  if (items.length > 500) throw error('This publication exceeds the status review limit. Narrow the repository analysis.', 413);
  return [...new Map(items.map(item => [item.finding_id, { finding_id: item.finding_id, target_id: item.target_id }])).values()];
}

async function readStatus(run) {
  const published = receipts(run);
  if (!published.length) return { items: [], ready: 0, pending: 0, failed: 0 };
  const targets = [...new Set(published.map(item => item.target_id))];
  // Every join keeps the exact project/source/document identity. A receipt is
  // never a license to inspect an arbitrary target or a sibling application.
  const rows = await db.prepare(`SELECT repo.id AS target_id, repo.is_active, repo.description, repo.content,
      sources.id AS source_id, sources.extraction_status, sources.checksum_sha256 AS source_checksum,
      documents.id AS document_id, documents.checksum_sha256 AS document_checksum,
      indexes.required_indexes_ready, indexes.is_current,
      outbox.status AS queue_status, graph.id AS graph_node_id, graph.tombstoned_at,
      projection.document_id AS projected_document_id,
      EXISTS(SELECT 1 FROM ai_knowledge_graph_chunk_entities fragments
        JOIN ai_knowledge_chunks chunks ON chunks.id = fragments.chunk_id AND chunks.project_id = fragments.project_id
          AND chunks.document_id = fragments.document_id AND chunks.source_id = fragments.source_id
        WHERE fragments.project_id = repo.project_id AND fragments.source_id = sources.id
          AND fragments.node_id = sources.id AND fragments.document_id = documents.id) AS projected_fragments
    FROM ai_knowledge_repo repo
    LEFT JOIN ai_knowledge_sources sources ON sources.project_id = repo.project_id
      AND sources.source_kind = 'knowledge_item' AND sources.source_ref_id = repo.id
    LEFT JOIN ai_knowledge_documents documents ON documents.project_id = repo.project_id
      AND documents.source_id = sources.id AND documents.is_active = TRUE
    LEFT JOIN ai_knowledge_index_states indexes ON indexes.document_id = documents.id
      AND indexes.project_id = repo.project_id AND indexes.source_id = sources.id AND indexes.document_version = documents.version
    LEFT JOIN ai_knowledge_sync_outbox outbox ON outbox.project_id = repo.project_id AND outbox.source_ref_id = repo.id
    LEFT JOIN ai_knowledge_graph_nodes graph ON graph.project_id = repo.project_id AND graph.source_id = sources.id
    LEFT JOIN ai_knowledge_graph_projection_states projection ON projection.project_id = repo.project_id AND projection.document_id = documents.id
    WHERE repo.project_id = ? AND repo.app_type_id IS NOT DISTINCT FROM ? AND repo.id IN (${targets.map(() => '?').join(',')})
    ORDER BY repo.id, documents.version DESC`).all(run.project_id, run.app_type_id || null, ...targets);
  const records = new Map();
  for (const row of rows) if (!records.has(row.target_id)) records.set(row.target_id, row);
  const items = published.map(receipt => {
    const row = records.get(receipt.target_id);
    const item = { ...receipt, ...(row?.source_id ? { source_id: row.source_id } : {}),
      ...(row?.document_id ? { document_id: row.document_id } : {}),
      indexing: 'pending', knowledge_graph: 'pending', context_graph: 'pending' };
    if (!row) return { ...item, indexing: 'failed', error: 'The published Knowledge Repo item is no longer available in this project and application.' };
    if (!row.is_active || row.extraction_status === 'archived') return { ...item, indexing: 'archived' };
    if (row.queue_status === 'failed') return { ...item, indexing: 'failed', error: 'Knowledge processing failed. Retry processing the published source; its saved document is retained.' };
    if (row.queue_status === 'queued') return { ...item, indexing: 'queued' };
    if (row.queue_status === 'running' || row.extraction_status === 'processing') return { ...item, indexing: 'processing' };
    if (row.extraction_status === 'failed') return { ...item, indexing: 'failed', error: 'Knowledge processing failed. Retry processing the published source; its saved document is retained.' };
    const currentHash = fingerprint(sanitizeAiText([row.description, row.content].filter(Boolean).join('\n\n')).text);
    const searchable = row.extraction_status === 'ready' && row.document_id && row.required_indexes_ready
      && row.is_current && row.source_checksum === currentHash && row.document_checksum === currentHash;
    if (!searchable) return item;
    item.indexing = 'ready';
    if (row.graph_node_id === row.source_id && !row.tombstoned_at
      && row.projected_document_id === row.document_id && row.projected_fragments) {
      item.knowledge_graph = 'ready'; item.context_graph = 'ready';
    }
    return item;
  });
  return { items,
    ready: items.filter(item => item.indexing === 'ready' && item.knowledge_graph === 'ready' && item.context_graph === 'ready').length,
    pending: items.filter(item => !['failed','archived'].includes(item.indexing) && (item.indexing !== 'ready' || item.knowledge_graph !== 'ready' || item.context_graph !== 'ready')).length,
    failed: items.filter(item => item.indexing === 'failed').length };
}

const getPublicationStatus = async (id, user) => readStatus(await authorize(id, user));

async function processPublishedKnowledge(id, input, user) {
  const run = await authorize(id, user, true);
  const selected = input?.item_ids;
  if (!Array.isArray(selected) || !selected.length || selected.length > LIMITS.max_selected_items
    || selected.some(value => typeof value !== 'string' || !value || value.length > 255)
    || new Set(selected).size !== selected.length) throw error('Choose between 1 and 50 distinct published Knowledge findings to process.');
  const published = receipts(run);
  const chosen = selected.map(id => published.find(item => item.finding_id === id));
  if (chosen.some(item => !item)) throw error('Choose findings already published from this Repository Knowledge Builder run.', 409);
  await db.transaction(async () => {
    // Lock the native targets before scheduling any work. Reject the whole
    // selection if one target was removed, archived or moved to another scope.
    for (const item of chosen) {
      const target = await db.prepare(`SELECT id, is_active FROM ai_knowledge_repo
        WHERE id = ? AND project_id = ? AND app_type_id IS NOT DISTINCT FROM ? FOR SHARE`)
        .get(item.target_id, run.project_id, run.app_type_id || null);
      if (!target || !target.is_active) throw error('A selected Knowledge Repo item is missing or archived. Refresh the published results.', 409);
    }
    for (const item of chosen) await rag.queueLegacyKnowledgeSync({ projectId: run.project_id, sourceRefId: item.target_id, userId: user.id });
  })();
  return readStatus(run);
}

module.exports = { getPublicationStatus, processPublishedKnowledge };
