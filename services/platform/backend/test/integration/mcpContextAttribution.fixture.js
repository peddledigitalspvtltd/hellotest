const assert = require('node:assert/strict');

// The native HTTP plugin must recover host correlation from the verified MCP
// credential. Public tool arguments and protocol metadata have no such power.
async function verify({ app, db, rpc, graphFixture }) {
  const auth = require('@hellotest/mcp/backend/auth');
  const attribution = { feature: 'mcp.fixture.internal-context', session_id: 'mcp-session-owned', task_id: 'mcp-task-owned', trace_id: 'mcp-host-trace' };
  const credential = await auth.issue({ id: 'mcp-a' }, 'mcp-p-a', 'fixture-worker', { contextAttribution: attribution });
  try {
    const result = await rpc('hellotest_context_build', {
      question: 'Release requires passing tests',
      filters: { source_ids: ['mcp-source'] },
      budgets: { deadline_ms: 8000, max_query_cost_usd: 0, max_tool_calls: 3 }
    }, credential.token);
    assert.equal(result.result.isError, undefined, JSON.stringify(result.result));
    const memory = result.result.structuredContent.data.packet.retrieval.context_graph;
    assert.equal(memory.status, 'recorded');
    const row = await db.prepare('SELECT project_id,actor_id,feature_id,task_ref,session_id,trace_ref FROM ai_context_graph_traces WHERE id=?').get(memory.trace_id);
    assert.deepEqual(row, { project_id: 'mcp-p-a', actor_id: 'mcp-a', feature_id: attribution.feature,
      task_ref: attribution.task_id, session_id: attribution.session_id, trace_ref: attribution.trace_id });
    await assert.rejects(require('@hellotest/mcp/backend/server').invoke(await auth.authenticate(credential.token), 'hellotest_context_build', {
      question: 'Inspect', context_attribution: { session_id: 'other-owner-session' }
    }), { code: 'MCP_INVALID_ARGUMENT' });
    const graphRequest = { question: 'Auth service depends on Checkout service',
      intent_plan: { retrieval_strategy: 'graph_expand', queries: ['Auth service Checkout service dependencies'] },
      filters: { requested_scopes: ['knowledge'] },
      budgets: { deadline_ms: 15000, max_query_cost_usd: 0, max_tool_calls: 4, max_context_tokens: 8000 } };
    const expanded = await rpc('hellotest_context_build', graphRequest, credential.token);
    assert.equal(expanded.result.isError, undefined, JSON.stringify(expanded.result));
    const packet = expanded.result.structuredContent.data.packet;
    assert.equal(packet.retrieval.retrieval_strategy.requested, 'graph_expand');
    assert.equal(packet.retrieval.retrieval_strategy.applied, 'graph_expand', JSON.stringify(packet.retrieval));
    assert.equal(packet.retrieval.retrieval_strategy.graph_tool_calls, 1);
    assert.ok(packet.budget.used.tool_calls <= graphRequest.budgets.max_tool_calls);
    const edge = packet.relationships.find(item => item.source === graphFixture.sourceId && item.target === graphFixture.targetId && item.type === 'DEPENDS_ON');
    assert.ok(edge, JSON.stringify(packet.retrieval));
    assert.equal(edge.provenance_type, 'HUMAN_VERIFIED');
    const visible = new Set(packet.evidence.map(item => item.evidence_id));
    assert.ok(edge.evidence_ids.length && edge.evidence_ids.every(id => visible.has(id)));
    const selection = await db.prepare('SELECT selection FROM ai_context_graph_traces WHERE id=?').get(packet.retrieval.context_graph.trace_id);
    assert.equal(selection.selection.retrieval_strategy.graph_tool_calls, 1);
    const pinned = await rpc('hellotest_context_build', { ...graphRequest, filters: { ...graphRequest.filters, source_ids: [graphFixture.sourceId] } }, credential.token);
    assert.equal(pinned.result.isError, undefined, JSON.stringify(pinned.result));
    const receipt = pinned.result.structuredContent.data.packet.retrieval.retrieval_strategy;
    assert.equal(receipt.graph_tool_calls, 0); assert.equal(receipt.graph_expansion_status, 'skipped');
    assert.equal(receipt.graph_expansion_reason, 'selected_sources_or_collections');
  } finally {
    await db.prepare('UPDATE mcp_credentials SET revoked_at=NOW() WHERE id=?').run(credential.id);
  }
  await assert.rejects(auth.authenticate(credential.token), { code: 'MCP_UNAUTHORIZED' });
  const descriptor = await app.inject({ method: 'GET', url: '/mcp', headers: { host: 'localhost' } });
  assert.equal(descriptor.statusCode, 405);
}
module.exports = { verify };
