const test = require('node:test');
const assert = require('node:assert/strict');
const { buildRetrievalRequest, buildContextPacket, buildModelRequest, RetrievalBudget } = require('@hellotest/knowledge/backend/services/knowledgeContracts.service');
const { contextFromPacket } = require('@hellotest/mcp/backend/gateway');
const { assembleContext, refinementBudgets } = require('../../backend/services/assistant/contextAssembly');
const { createSynthesis } = require('../../backend/services/assistant/synthesis');

const project = 'assembly-project';
const question = 'Which refund rule applies, and what does the regression suite cover?';
const hit = (id, content, fields = {}) => ({ project_id: project, evidence_id: id, source_id: `source-${id}`, source_kind: 'text',
  content, is_current: true, citation: { id }, ...fields });
const auth = { project_scope_enforced: true, source_acl_enforced: true };
function read(request, hits, relationships = []) {
  const budget = new RetrievalBudget(request.budgets);
  budget.consumeRound(1, 2);
  return contextFromPacket(buildContextPacket({ retrievalRequest: request, evidence: hits, relationships, authorization: auth,
    retrieval: { retrieval_round_count: 1, query_chain: [request.query] }, budget }), request);
}

test('one bounded synthesis packet retains unique cited evidence from both reads and the read tools', () => {
  const request = buildRetrievalRequest({ projectId: project, query: question });
  const refund = hit('refund', 'Refunds are processed within five business days.');
  const suite = hit('suite', 'The regression suite covers expired credit cards.');
  const toolEvidence = hit('trace', 'The checkout test verifies the refund confirmation.');
  const edge = { id: 'verified-edge', source: 'source-suite', target: 'source-trace', type: 'VERIFIES', provenance_type: 'DETERMINISTIC', evidence_ids: ['suite', 'trace'] };
  const initial = read(request, [refund]);
  const refined = read({ ...request, query: 'checkout regression coverage' }, [suite, refund]);
  const context = assembleContext({ request, initial, refined, toolResult: { evidence: [toolEvidence], relationships: [edge] } });
  const synthesis = JSON.parse(buildModelRequest({ contextPacket: context.packet, question, model: 'configured-model' }).messages[1].content);
  assert.equal(synthesis.question, question);
  assert.deepEqual(synthesis.context_packet.evidence.map(item => item.evidence_id), ['refund', 'suite', 'trace']);
  assert.equal(synthesis.context_packet.relationships[0].knowledge_edge_id, 'verified-edge');
  assert.equal(context.retrieval.retrieval_round_count, 2);
  assert.equal(context.retrieval.read_tool_evidence_count, 1);
  assert.equal(context.budget.tool_calls_used, 4);
  assert.deepEqual(contextFromPacket(context.packet, request).hits.map(item => item.citation.id), ['refund', 'suite', 'trace']);
});

test('assembly enforces the original budget and removes relationships with omitted or foreign evidence', () => {
  const request = buildRetrievalRequest({ projectId: project, query: question, budgets: { max_evidence_items: 2, max_rounds: 1 } });
  const initial = read(request, [hit('refund', 'Refunds are processed within five business days.')]);
  const outOfScope = hit('hidden', 'Foreign evidence.', { project_id: 'another-project' });
  const related = hit('trace', 'Checkout verifies refund status.');
  const context = assembleContext({ request, initial, toolResult: { evidence: [outOfScope, related, hit('extra', 'Other evidence.')], relationships: [
    { id: 'denied-edge', source: 'source-hidden', target: 'source-refund', type: 'VERIFIES', provenance_type: 'DETERMINISTIC', evidence_ids: ['hidden', 'refund'] },
    { id: 'clipped-edge', source: 'source-extra', target: 'source-refund', type: 'VERIFIES', provenance_type: 'DETERMINISTIC', evidence_ids: ['extra', 'refund'] }
  ] } });
  assert.equal(refinementBudgets(request.budgets, initial).max_rounds, 0);
  assert.deepEqual(context.hits.map(item => item.citation.id), ['refund', 'trace']);
  assert.deepEqual(context.packet.relationships, []);
  assert.equal(context.packet.limitations.budget_partial, true);
  assert.equal(context.packet.limitations.authorization_partial, true);
});

test('the model receives only reauthorized combined evidence and matching coverage', async () => {
  const request = buildRetrievalRequest({ projectId: project, query: question });
  const initial = read(request, [hit('refund', 'Refunds are processed within five business days.')]);
  const refined = read(request, [hit('suite', 'Regression tests cover expired cards.')]);
  const context = assembleContext({ request, initial, refined });
  const { synthesize } = createSynthesis({
    execution: { assertActive() {}, emit() {} }, waitForModelCallGap: async () => {},
    requestGroundedAnswer: async ({ hits, contextPacket }) => {
      assert.deepEqual(hits.map(item => item.citation.id), ['refund']);
      assert.deepEqual(contextPacket.evidence.map(item => item.evidence_id), ['refund']);
      assert.equal(contextPacket.coverage.source_count, 1);
      assert.equal(contextPacket.coverage.evidence_count, 1);
      assert.equal(contextPacket.limitations.authorization_partial, true);
      return { status: 'insufficient_context' };
    },
    normalizeModelAnswer: candidate => candidate
  });
  const { outcome } = await synthesize({ integration: { model: 'test' }, question, hits: context.hits,
    context, contextPacket: context.packet, retrieval: context.retrieval,
    authorizeEvidence: async hits => ({ allowed: hits.slice(0, 1), denied_ids: ['suite'] }) });
  assert.equal(outcome.safety.model_synthesis_completed, true);
  assert.equal(context.retrieval.pre_model_access_denied_count, 1);
});
