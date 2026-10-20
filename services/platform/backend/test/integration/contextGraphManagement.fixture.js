const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const hash = value => createHash('sha256').update(value).digest('hex');

exports.verify = async ({ app, db, user, headers }) => {
  const project = 'mcp-p-a', prefix = '/projects/mcp-p-a/knowledge/graph';
  const graph = require('@hellotest/knowledge/backend/services/knowledgeGraph.service');
  await db.query("INSERT INTO role_permissions(role_id,permission_id) SELECT 'mcp-fixture-role',id FROM permissions WHERE code = 'knowledge.manage' ON CONFLICT DO NOTHING");
  const source = async (id, title, content, projectId = project) => {
    const digest = hash(content);
    await db.prepare(`INSERT INTO ai_knowledge_sources(id,project_id,source_kind,title,extraction_status,revision_token,checksum_sha256)
      VALUES (?,?,'text',?,'ready','fixture',?)`).run(id, projectId, title, digest);
    await db.prepare(`INSERT INTO ai_knowledge_documents(id,project_id,source_id,title,content,checksum_sha256) VALUES (?,?,?,?,?,?)`)
      .run(`${id}-doc`, projectId, id, title, content, digest);
    await db.prepare(`INSERT INTO ai_knowledge_chunks(id,project_id,document_id,source_id,chunk_index,content,search_vector)
      VALUES (?,?,?,?,0,?,to_tsvector('simple',?))`).run(`${id}-chunk`, projectId, `${id}-doc`, id, content, content);
    await db.prepare(`INSERT INTO ai_knowledge_index_states(document_id,project_id,source_id,document_version,is_current,lexical_state,dense_state,required_indexes_ready)
      VALUES (?,?,?,1,TRUE,'ready','not_configured',TRUE)`).run(`${id}-doc`, projectId, id);
    await db.prepare(`INSERT INTO ai_knowledge_security_bindings(id,project_id,source_id,principal_type,principal_id,effect,inherited)
      VALUES (?,?,?,'PROJECT',?,'ALLOW',TRUE)`).run(`${id}-binding`, projectId, id, projectId);
    await db.transaction(() => graph.syncDocument({ projectId, source: { id, project_id: projectId, source_kind: 'text', title },
      document: { id: `${id}-doc`, version: 1, checksum_sha256: digest },
      chunks: [{ id: `${id}-chunk`, source_id: id, document_id: `${id}-doc`, content }] }))();
  };
  const a = 'cg-management-auth', b = 'cg-management-checkout', hidden = 'cg-management-private';
  const text = '🔎 Auth service depends on Checkout service for login.';
  await source(a, 'Auth service', text);
  await source(b, 'Checkout service', 'Checkout service validates orders.');
  await source(hidden, 'Private design', 'Auth service is related to Checkout service in a private design.');
  await source('cg-management-foreign', 'Foreign hidden design', 'Foreign hidden design', 'mcp-p-b');
  const call = (method, path, payload) => app.inject({ method, url: prefix + path, headers, ...(payload ? { payload } : {}) });
  const resolve = await call('POST', '/resolve', { identifiers: [a, b] });
  assert.equal(resolve.statusCode, 200, resolve.body); assert.equal(resolve.headers['cache-control'], 'no-store');
  assert.equal((await call('POST', '/resolve', { query: 'x'.repeat(255) })).statusCode, 200);
  assert.equal((await call('POST', '/resolve', { query: 'x'.repeat(256) })).statusCode, 400, 'REST and native graph resolution must share the query bound');
  const node = resolve.json().nodes.find(item => item.id === a); assert.equal(node.alias_revision.length, 64);
  const aliased = await call('PUT', `/nodes/${a}/aliases`, { aliases: ['AuthSvc'], expected_revision: node.alias_revision });
  assert.equal(aliased.statusCode, 200, aliased.body);
  const staleAlias = await call('PUT', `/nodes/${a}/aliases`, { aliases: ['Login'], expected_revision: node.alias_revision });
  assert.equal(staleAlias.statusCode, 409);
  const exactAlias = await graph.resolveNodes({ projectId: project, user, query: 'AuthSvc' });
  assert.deepEqual(exactAlias.nodes.map(item => item.id), [a]);
  const bNode = resolve.json().nodes.find(item => item.id === b);
  assert.equal((await call('PUT', `/nodes/${b}/aliases`, { aliases: ['authsvc'], expected_revision: bNode.alias_revision })).statusCode, 409);
  assert.equal((await call('POST', '/resolve', { identifiers: ['cg-management-foreign'] })).json().nodes.length, 0);
  const input = { source_node_id: a, target_node_id: b, relation_type: 'DEPENDS_ON', chunk_id: `${a}-chunk`, excerpt: 'Auth service depends on Checkout service' };
  assert.equal((await call('POST', '/candidates', { ...input, excerpt: 'An invented relationship between Auth service and Checkout service' })).statusCode, 400);
  assert.equal((await call('POST', '/candidates', { ...input, approved: true })).statusCode, 400);
  const proposal = await call('POST', '/candidates', input); assert.equal(proposal.statusCode, 200, proposal.body);
  const edgeId = proposal.json().id;
  const before = await graph.expand({ projectId: project, user, seeds: [a] }); assert.equal(before.edges.length, 0, 'A model candidate must not establish a graph fact');
  let pending = (await call('GET', '/candidates')).json().candidates.find(item => item.id === edgeId);
  assert.equal(pending.excerpt, input.excerpt, 'Unicode span offsets must round-trip through PostgreSQL substring');
  assert.equal((await call('POST', `/candidates/${edgeId}/review`, { decision: 'reject', expected_revision: pending.review_revision })).statusCode, 200);
  assert.equal((await call('POST', '/candidates', input)).statusCode, 200);
  assert.equal((await call('POST', `/candidates/${edgeId}/review`, { decision: 'approve', expected_revision: pending.review_revision })).statusCode, 409, 'An old review cannot approve the same proof after rejection and reproposal');
  pending = (await call('GET', '/candidates')).json().candidates.find(item => item.id === edgeId);
  assert.equal((await call('POST', `/candidates/${edgeId}/review`, { decision: 'approve', expected_revision: 'x'.repeat(64) })).statusCode, 409);
  const approved = await call('POST', `/candidates/${edgeId}/review`, { decision: 'approve', expected_revision: pending.review_revision });
  assert.equal(approved.statusCode, 200, approved.body);
  const after = await graph.expand({ projectId: project, user, seeds: [a], maxTokens: 8000 });
  assert.ok(after.edges.some(item => item.id === edgeId && item.provenance_type === 'HUMAN_VERIFIED'));
  assert.ok(after.evidence.some(item => item.content.includes(input.excerpt)));
  assert.equal((await call('POST', `/candidates/${edgeId}/review`, { decision: 'approve', expected_revision: pending.review_revision })).statusCode, 409, 'Reviews are bound to the candidate state');
  const privateInput = { ...input, relation_type: 'RELATED_TO', chunk_id: `${hidden}-chunk`, excerpt: 'Auth service is related to Checkout service in a private design.' };
  const privateProposal = await call('POST', '/candidates', privateInput); assert.equal(privateProposal.statusCode, 200, privateProposal.body);
  const privateCandidate = (await call('GET', '/candidates')).json().candidates.find(item => item.id === privateProposal.json().id);
  await db.prepare("UPDATE ai_knowledge_security_bindings SET effect='DENY' WHERE id=?").run(`${hidden}-binding`);
  const privateQueue = await call('GET', '/candidates'); assert.ok(!privateQueue.body.includes('private design'));
  assert.equal((await call('POST', `/candidates/${privateCandidate.id}/review`, { decision: 'approve', expected_revision: privateCandidate.review_revision })).statusCode, 409);
  // A provider boundary is substituted; this test makes no paid model call.
  // Valid suggestions remain candidates; invented chunks and approval flags
  // cannot cross the domain contract into the factual graph.
  const gateway = require('@hellotest/knowledge/backend/services/knowledgeModelGateway.service');
  const selection = require('@hellotest/integration/backend/services/aiLlmSelection.service');
  const originalModel = gateway.request, originalSelection = selection.resolveLlmIntegrationForUsage;
  let modelCalls = 0;
  gateway.request = async request => {
    modelCalls++;
    assert.ok(JSON.stringify(request.messages).includes('knowledgeGraphExtraction.relationships'));
    return { relations: [
      { ...input, relation_type: 'USES' }, { ...input, relation_type: 'PART_OF', chunk_id: 'invented-chunk' },
      { ...input, relation_type: 'RELATED_TO', approved: true }
    ] };
  };
  selection.resolveLlmIntegrationForUsage = async () => ({ id: 'graph-model-fixture', type: 'llm', is_active: true, config: { project_id: project }, model: 'fixture' });
  try {
    const extracted = await call('POST', '/extract', { node_ids: [a, b] });
    assert.equal(extracted.statusCode, 200, extracted.body); assert.equal(modelCalls, 1);
    assert.equal(extracted.json().candidates.length, 1); assert.equal(extracted.json().rejected, 2);
    const factual = await graph.expand({ projectId: project, user, seeds: [a], maxTokens: 8000 });
    assert.ok(!factual.edges.some(edge => edge.type === 'USES'), 'Extraction must not approve its own suggestions');
  } finally { gateway.request = originalModel; selection.resolveLlmIntegrationForUsage = originalSelection; }
  await source('cg-management-alias-proof', 'Alias relationship proof', 'AuthSvc is part of Checkout service.');
  const aliasProposal = await call('POST', '/candidates', { ...input, relation_type: 'PART_OF', chunk_id: 'cg-management-alias-proof-chunk', excerpt: 'AuthSvc is part of Checkout service.' });
  assert.equal(aliasProposal.statusCode, 200, aliasProposal.body);
  const aliasCandidate = (await call('GET', '/candidates')).json().candidates.find(item => item.id === aliasProposal.json().id);
  const currentAliasNode = (await call('POST', '/resolve', { identifiers: [a] })).json().nodes[0];
  assert.equal((await call('PUT', `/nodes/${a}/aliases`, { aliases: [], expected_revision: currentAliasNode.alias_revision })).statusCode, 200);
  assert.equal((await call('POST', `/candidates/${aliasCandidate.id}/review`, { decision: 'approve', expected_revision: aliasCandidate.review_revision })).statusCode, 409, 'Alias changes invalidate the observed candidate revision');
  const rebound = (await call('GET', '/candidates')).json().candidates.find(item => item.id === aliasCandidate.id);
  assert.equal((await call('POST', `/candidates/${aliasCandidate.id}/review`, { decision: 'approve', expected_revision: rebound.review_revision })).statusCode, 409, 'Even a new review cannot approve an excerpt whose alias no longer identifies the endpoint');
  assert.equal((await call('POST', `/candidates/${aliasCandidate.id}/review`, { decision: 'reject', expected_revision: rebound.review_revision })).statusCode, 200);
  const release = 'cg-management-release';
  await source(release, 'Release 4.2', 'Release 4.2 depends on Auth service.');
  const releaseProposal = await call('POST', '/candidates', { source_node_id: release, target_node_id: a, relation_type: 'DEPENDS_ON', chunk_id: `${release}-chunk`, excerpt: 'Release 4.2 depends on Auth service.' });
  assert.equal(releaseProposal.statusCode, 200, releaseProposal.body);
  const releaseCandidate = (await call('GET', '/candidates')).json().candidates.find(item => item.id === releaseProposal.json().id);
  assert.equal((await call('POST', `/candidates/${releaseCandidate.id}/review`, { decision: 'approve', expected_revision: releaseCandidate.review_revision })).statusCode, 200);
  const chain = await graph.trace({ projectId: project, user, source: release, target: b, direction: 'outbound', hops: 2, maxTokens: 8000 });
  assert.ok(chain.paths.some(path => JSON.stringify(path.nodes) === JSON.stringify([release, a, b])), 'Two-hop context joins the release note to checkout through its witnessed dependency');
  assert.equal(chain.evidence.length, 2); assert.ok(chain.edges.every(edge => edge.evidence_ids.length));
  // Fresh evidence can renew an expired human-reviewed relationship. A valid
  // current fact, including one with a private witness, cannot be overwritten.
  const usageSource = 'cg-management-use-proof';
  await source(usageSource, 'Usage proof', 'Auth service uses Checkout service.');
  const usageInput = { ...input, relation_type: 'USES', chunk_id: `${usageSource}-chunk`, excerpt: 'Auth service uses Checkout service.' };
  const usageProposal = await call('POST', '/candidates', usageInput); assert.equal(usageProposal.statusCode, 200, usageProposal.body);
  let usageCandidate = (await call('GET', '/candidates')).json().candidates.find(item => item.id === usageProposal.json().id);
  assert.equal((await call('POST', `/candidates/${usageCandidate.id}/review`, { decision: 'approve', expected_revision: usageCandidate.review_revision })).statusCode, 200);
  await db.prepare("UPDATE ai_knowledge_security_bindings SET effect='DENY' WHERE id=?").run(`${usageSource}-binding`);
  assert.equal((await call('POST', '/candidates', { ...input, relation_type: 'USES' })).statusCode, 409, 'A current private witness still protects an existing verified fact');
  await db.prepare("UPDATE ai_knowledge_security_bindings SET effect='ALLOW' WHERE id=?").run(`${usageSource}-binding`);
  const renewed = 'Auth service uses Checkout service after a configuration update.';
  await db.transaction(async () => {
    await db.prepare('UPDATE ai_knowledge_documents SET is_active=FALSE,effective_to=CURRENT_TIMESTAMP WHERE id=?').run(`${usageSource}-doc`);
    await db.prepare('UPDATE ai_knowledge_index_states SET is_current=FALSE WHERE document_id=?').run(`${usageSource}-doc`);
    await db.prepare(`INSERT INTO ai_knowledge_documents(id,project_id,source_id,title,content,checksum_sha256,version) VALUES (?,?,?,'Usage proof',?,?,2)`)
      .run(`${usageSource}-doc-v2`, project, usageSource, renewed, hash(renewed));
    await db.prepare('INSERT INTO ai_knowledge_chunks(id,project_id,document_id,source_id,chunk_index,content) VALUES (?,?,?,?,0,?)')
      .run(`${usageSource}-chunk-v2`, project, `${usageSource}-doc-v2`, usageSource, renewed);
    await db.prepare(`INSERT INTO ai_knowledge_index_states(document_id,project_id,source_id,document_version,is_current,lexical_state,dense_state,required_indexes_ready) VALUES (?,?,?,2,TRUE,'ready','not_configured',TRUE)`)
      .run(`${usageSource}-doc-v2`, project, usageSource);
  })();
  const expired = await graph.expand({ projectId: project, user, seeds: [a], maxTokens: 8000 });
  assert.ok(!expired.edges.some(edge => edge.id === usageCandidate.id));
  const renewal = await call('POST', '/candidates', { ...usageInput, chunk_id: `${usageSource}-chunk-v2`, excerpt: renewed });
  assert.equal(renewal.statusCode, 200, renewal.body);
  usageCandidate = (await call('GET', '/candidates')).json().candidates.find(item => item.id === usageCandidate.id);
  assert.equal((await call('POST', `/candidates/${usageCandidate.id}/review`, { decision: 'approve', expected_revision: usageCandidate.review_revision })).statusCode, 200);
  assert.equal((await db.prepare('SELECT COUNT(*)::int AS count FROM ai_knowledge_graph_edge_evidence WHERE edge_id=?').get(usageCandidate.id)).count, 2, 'Renewal preserves the earlier immutable witness');
  // The project-scoped audit contains hashes/IDs, never copied source text.
  const events = await db.prepare("SELECT metadata FROM admin_audit_log WHERE action LIKE 'knowledge_graph.%' AND target_id=?").all(edgeId);
  assert.ok(events.length >= 2); assert.ok(!JSON.stringify(events).includes(input.excerpt));
  await db.query("DELETE FROM role_permissions WHERE role_id='mcp-fixture-role' AND permission_id IN (SELECT id FROM permissions WHERE code='knowledge.manage')");
  assert.equal((await call('GET', '/candidates')).statusCode, 403);
  return { source: { kind: 'text', ref_id: a }, target: { kind: 'text', ref_id: b }, sourceId: a, targetId: b, edgeId };
};
