const test = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../../backend/services/qualityEvidenceRules');
const { requireAiAssessment } = require('@hellotest/platform/backend/src/utils/requireAiAssessment');
const fixture = () => ({ project_id: 'p', scope: { release_id: 'release', build: 'b', environment_id: 'env' }, as_of: '2026-10-04T00:00:00.000Z', complete: true, limitations: [],
  stories: [{ id: 's', title: 'Checkout', acceptance_criteria: ['Payment succeeds', 'Invalid payment is rejected'], test_case_ids: ['t'] }],
  tests: [{ id: 't', title: 'Checkout payment', steps: [{ expected_result: 'Confirmation appears' }] }],
  runs: [{ id: 'r', build: 'b', test_environment_id: 'env', configuration_hash: 'config' }],
  attempts: [{ id: 'a', execution_id: 'r', test_case_id: 't', status: 'passed', case_revision: 'v1', data_hash: 'data' }], defects: [] });

test('links and passing tests do not establish assertion coverage or release readiness', () => {
  const snapshot = fixture();
  const report = engine.assess(snapshot, 'F11');
  assert.equal(report.data.status, 'unknown');
  assert.equal(report.data.deployment_authorized, false);
  const coverage = engine.coverage(snapshot);
  assert.equal(coverage.obligation_count, 2);
  assert.equal(coverage.unknown_weight, 2);
  assert.equal(coverage.observed_percent, null);
});
test('known blockers dominate unknown mandatory gates and no model can override them', () => {
  const snapshot = fixture(); snapshot.complete = false;
  snapshot.defects.push({ id: 'bug', status: 'open', severity: 'critical' });
  const result = engine.assess(snapshot, 'F11');
  assert.equal(result.data.status, 'not_ready');
  assert.deepEqual(result.data.gates.find(gate => gate.id === 'blocking-defects').evidence, ['defect:bug']);
});
test('empty obligation denominators are unknown, never full coverage', () => {
  const snapshot = fixture(); snapshot.stories = [];
  assert.equal(engine.coverage(snapshot).denominator_complete, false);
  assert.equal(engine.coverage(snapshot).designed_percent, null);
  assert.equal(engine.assess(snapshot, 'F11').data.status, 'unknown');
});
test('original failure survives passing retry and comparable mixed outcomes remain suspect', () => {
  const snapshot = fixture(); snapshot.attempts.push({ ...snapshot.attempts[0], id: 'original', status: 'failed' });
  assert.equal(engine.assess(snapshot, 'F11').data.status, 'not_ready');
  const row = engine.flaky(snapshot).rows[0];
  assert.equal(row.status, 'suspect'); assert.equal(row.sample_size, 2); assert.equal(row.failed, 1);
  assert.ok(row.wilson_95_interval[0] < 0.5 && row.wilson_95_interval[1] > 0.5);
});
test('incomparable builds, test revisions, data and configurations never become flaky evidence', () => {
  for (const field of ['case_revision', 'data_hash']) {
    const snapshot = fixture(); snapshot.attempts.push({ ...snapshot.attempts[0], id: 'other', status: 'failed', [field]: 'changed' });
    assert.ok(engine.flaky(snapshot).rows.every(row => row.sample_size === 1));
  }
  const snapshot = fixture(); snapshot.attempts[0].data_hash = null;
  assert.equal(engine.flaky(snapshot).rows.length, 0); assert.equal(engine.flaky(snapshot).incomparable_attempt_count, 1);
});
test('graph edges carry project and entity revisions and are never inferred as causal', () => {
  const snapshot = fixture(), graph = engine.buildGraph(snapshot);
  assert.equal(graph.name, 'AI Quality Graph');
  assert.ok(graph.edges.every(edge => edge.project_id === 'p' && edge.origin === 'recorded_relationship' && edge.source_revision.length === 64 && edge.target_revision.length === 64));
  const original = graph.nodes.find(node => node.id === 'story:s').revision;
  snapshot.stories[0].acceptance_criteria.push('Another boundary');
  assert.notEqual(engine.buildGraph(snapshot).nodes.find(node => node.id === 'story:s').revision, original);
});
test('impact traversal terminates cycles, discloses depth limits and missing roots', () => {
  const graph = { complete: true, nodes: ['a','b','c'].map(id => ({ id })), edges: [{ id:'ab',source:'a',target:'b' },{ id:'ba',source:'b',target:'a' },{ id:'bc',source:'b',target:'c' }] };
  assert.equal(engine.traverse(graph, ['a']).paths.length, 3);
  assert.equal(engine.traverse(graph, ['a'], { maxNodes: 1 }).truncated, true);
  assert.equal(engine.traverse(graph, ['a'], { maxDepth: 1 }).complete, false);
  assert.deepEqual(engine.traverse(graph, ['missing']).missing_roots, ['missing']);
});
test('what-if scenarios cannot mutate the actual release state or apply a waiver', () => {
  const snapshot = fixture(); snapshot.attempts[0].status = 'failed'; const before = JSON.stringify(snapshot);
  const report = engine.assess(snapshot, 'F16');
  assert.equal(report.data.actual_status, 'not_ready'); assert.equal(report.data.changes_applied, false);
  assert.equal(report.data.scenarios.find(item => item.gate_id === 'execution-outcomes').projected_status, 'unknown');
  assert.equal(JSON.stringify(snapshot), before);
});
test('risk bands do not manufacture calibrated probabilities', () => {
  const report = engine.assess(fixture(), 'F14');
  assert.equal(report.data.probability, null); assert.match(report.data.method, /Uncalibrated/);
});
test('strict AI actions fail without a configured model or usable model result', () => {
  assert.throws(() => requireAiAssessment({ integration: null }), { code: 'AI_MODEL_REQUIRED' });
  const integration = { is_active: true, model: 'test' };
  assert.equal(requireAiAssessment({ integration }), integration);
  assert.throws(() => requireAiAssessment({ integration, failed: true }), { code: 'AI_ASSESSMENT_FAILED' });
  assert.throws(() => requireAiAssessment({ integration, accepted: false }), { code: 'AI_ASSESSMENT_FAILED' });
});
