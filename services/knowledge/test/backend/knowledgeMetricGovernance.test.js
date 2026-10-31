const test = require('node:test');
const assert = require('node:assert/strict');
const processing = require('../../backend/services/knowledgeProcessing.service');
const catalog = require('@hellotest/platform/shared/metricCatalog.json');

test('empty extraction never reports excellent indexed context quality', () => {
  for (const input of [{}, { text: '', chunks: [] }, { text: 'A source exists but no text chunks were extracted.', chunks: [] }, { text: 'Source text', chunks: [{ content: '   ' }] }]) {
    const result = processing.assessContextQuality(input);
    assert.equal(result.score, 0);
    assert.equal(result.grade, 'poor');
    assert.equal(result.requires_review, true);
  }
});

test('knowledge governance separates structural quality, retrieval ranking, sufficiency and claim support', () => {
  const metrics = ['metric.knowledge.document_quality', 'metric.knowledge.retrieval_rank', 'metric.knowledge.evidence_sufficiency', 'metric.knowledge.claim_grounding', 'metric.knowledge.fixture_evaluation'].map(id => catalog.find(item => item.key === id));
  assert.ok(metrics.every(Boolean));
  assert.equal(new Set(metrics.flatMap(item => item.runtime_keys)).size, metrics.flatMap(item => item.runtime_keys).length);
  assert.match(metrics.find(item => item.key === 'metric.knowledge.claim_grounding').criteria, /cited interpretation.*extractive support.*completed verification/);
  assert.equal(metrics.find(item => item.key === 'metric.knowledge.fixture_evaluation').runtime_status, 'reference');
});
