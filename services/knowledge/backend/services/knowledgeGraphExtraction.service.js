// Optional free-text extraction proposes grounded relationships between already
// authorized native entities. It never creates entities or approves its output.
const db = require('@hellotest/platform/backend/src/db');
const authorization = require('./knowledgeAuthorization.service');
const management = require('./knowledgeGraphManagement.service');
const execution = require('./knowledgeExecution.service');
const gateway = require('./knowledgeModelGateway.service');
const { aiInstructionBlock } = require('@hellotest/platform/backend/src/utils/aiInstructionBlocks');
const { sanitizeAiText } = require('@hellotest/platform/backend/src/security/aiTextPolicy');
const FEATURE = 'ai.knowledge.graph_extract';
const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode, code: 'KNOWLEDGE_GRAPH_EXTRACTION_INVALID', publicMessage: message });

function normalizeInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => key !== 'node_ids')
      || !Array.isArray(input.node_ids) || input.node_ids.length < 2 || input.node_ids.length > 12
      || input.node_ids.some(value => typeof value !== 'string' || !value.trim() || value.length > 255)) throw fail('Choose 2–12 graph records for relationship suggestions.');
  const ids = [...new Set(input.node_ids.map(value => value.trim()))];
  if (ids.length < 2) throw fail('Choose at least two distinct graph records.');
  return ids;
}
function normalizeSuggestions(candidate, nodes, chunks) {
  if (!candidate || !Array.isArray(candidate.relations) || candidate.relations.length > 12) throw fail('The model returned an invalid relationship contract.', 502);
  const nodeMap = new Map(nodes.map(node => [node.id, node]));
  const chunkMap = new Map(chunks.map(chunk => [chunk.chunk_id, chunk]));
  const accepted = [], seen = new Set();
  let rejected = 0;
  for (const value of candidate.relations) {
    try {
      const item = management._internals.candidateInput(value);
      const source = nodeMap.get(item.source_node_id), target = nodeMap.get(item.target_node_id), chunk = chunkMap.get(item.chunk_id);
      if (!source || !target || !chunk || !chunk.content.includes(item.excerpt)
          || !management._internals.anchored(item.excerpt, source) || !management._internals.anchored(item.excerpt, target)) throw fail('Unsupported relationship evidence.');
      const key = JSON.stringify([item.source_node_id, item.relation_type, item.target_node_id]);
      if (seen.has(key)) continue;
      seen.add(key); accepted.push(item);
    } catch { rejected++; }
  }
  return { accepted, rejected };
}
function selectPassages(rows, nodes) {
  const passages = [];
  for (const row of rows) {
    const text = row.content.slice(0, 16_000);
    let best;
    // Overlapping windows preserve a supported sentence near the end of a
    // chunk, rather than always spending model context on its opening text.
    for (let start = 0; start < text.length; start += 500) {
      const content = text.slice(start, start + 2000);
      const score = nodes.filter(node => management._internals.anchored(content, node)).length;
      if (score >= 2 && (!best || score > best.score)) best = { ...row, content, score, sampled_start: start };
      if (start + 2000 >= text.length) break;
    }
    if (best) passages.push(best);
  }
  return passages.sort((left, right) => right.score - left.score).slice(0, 8)
    .map(({ score: _score, sampled_start: _start, ...row }) => row);
}
async function extract({ projectId, user, input, signal }) {
  const ids = normalizeInput(input);
  await management.authorize(projectId, user, true);
  return execution.run({ signal, modelBudget: { max_tool_calls: 1 }, modelStats: { calls: 0 } }, async () => {
    const allowed = await management.allowedPermissions(projectId, user);
    const nodes = await management.getNodes(projectId, user, ids, allowed);
    if (nodes.length !== ids.length) throw fail('All selected graph records must be readable and current.', 404);
    const terms = [...new Set(nodes.flatMap(node => [node.entity_key, node.title, ...(node.aliases || [])]).filter(value => value?.length >= 3))];
    const acl = authorization.predicate({ user, projectId, source: 'sources', document: 'documents', chunk: 'chunks' });
    const rows = await db.prepare(`SELECT chunks.id AS chunk_id, chunks.content, chunks.source_id
      FROM ai_knowledge_chunks chunks JOIN ai_knowledge_documents documents ON documents.id = chunks.document_id AND documents.project_id = chunks.project_id
      JOIN ai_knowledge_sources sources ON sources.id = chunks.source_id AND sources.project_id = chunks.project_id
      JOIN ai_knowledge_index_states indexes ON indexes.document_id = documents.id AND indexes.project_id = chunks.project_id
      WHERE chunks.project_id = ? AND sources.id IN (${ids.map(() => '?').join(',')}) AND sources.extraction_status = 'ready'
        AND documents.is_active = TRUE AND indexes.is_current = TRUE AND indexes.required_indexes_ready = TRUE
        AND ${authorization.applicationContextPredicate()}
        AND ${authorization.applicationRecordPredicate()}
        AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(?::jsonb) terms(value) WHERE strpos(lower(chunks.content), lower(terms.value)) > 0)
        AND ${acl.sql} ORDER BY chunks.chunk_index, sources.id LIMIT 25`).all(projectId, ...ids, terms, ...acl.params);
    const chunks = selectPassages(rows, nodes);
    if (!chunks.length) return { candidates: [], rejected: 0, model_calls: 0, reason: 'NO_GROUNDED_PASSAGES', truncated: false };
    const controls = require('@hellotest/platform/backend/services/aiConfiguration.service');
    const profile = await controls.resolve(FEATURE);
    const integration = await require('@hellotest/integration/backend/services/aiLlmSelection.service').resolveLlmIntegrationForUsage({
      projectId, userId: user.id, usageKey: FEATURE, integrationId: profile.config.integration_id || undefined,
      fallback: 'project-then-global', allowMissing: true
    });
    require('./knowledgeIntegrationScope.service').assertLlmIntegrationProjectScope(integration, projectId);
    if (!integration) throw fail('Configure a model for Knowledge relationship extraction in AI Controls.', 409);
    execution.assertActive();
    const candidate = await require('@hellotest/platform/backend/src/utils/llmTraceContext').run({ actor_id: user.id, project_id: projectId, feature: FEATURE }, () => gateway.request({
      integration, operation: 'knowledge.graph.extract', signal, timeoutMs: 15_000, maxOutputTokens: 1200,
      messages: [{ role: 'system', content: aiInstructionBlock(FEATURE, 'knowledgeGraphExtraction.relationships') },
        { role: 'user', content: JSON.stringify({ relation_types: management.RELATIONS,
          entities: nodes.map(node => ({ source_node_id: node.id, kind: node.entity_type, key: node.entity_key,
            title: sanitizeAiText(node.title).text, aliases: node.aliases })),
          chunks: chunks.map(chunk => ({ ...chunk, content: sanitizeAiText(chunk.content).text })) }) }]
    }));
    execution.assertActive();
    const normalized = normalizeSuggestions(candidate, nodes, chunks);
    const candidates = [];
    let rejected = normalized.rejected;
    for (const item of normalized.accepted) {
      execution.assertActive();
      try { candidates.push(await management.propose({ projectId, user, input: item, signal })); }
      catch (error) {
        if (![400, 404, 409].includes(error.statusCode)) throw error;
        // Evidence may have changed during the model call. A stale candidate is
        // discarded, never silently rebound to the new document revision.
        rejected++;
      }
    }
    return { candidates, rejected, model_calls: execution.current().modelStats.calls, requires_review: true,
      usage: execution.current().usage, truncated: rows.length > chunks.length || rows.some(row => row.content.length > 2000) };
  });
}
module.exports = { extract, _internals: { normalizeInput, normalizeSuggestions, selectPassages } };
