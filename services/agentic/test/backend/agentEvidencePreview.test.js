const assert = require('node:assert/strict');
const test = require('node:test');
const { previewRows } = require('../../backend/services/agentEvidencePreview.service');

test('a missing or inaccessible read differs from an empty priority scope', () => {
  const route = { effective_scopes: ['stories', 'test-cases', 'runs', 'automation', 'knowledge'], priority_scopes: ['stories', 'runs', 'automation', 'knowledge'] };
  const counts = { stories: 21, test_cases: 0, runs: 0 };
  const hits = [
    { source_id: 'live-project-other-stories', content: '{"returned_records":1}' },
    { source_id: 'live-project-project-stories', content: '{"records":[{},{}],"returned_records":16}' }
  ];
  assert.deepEqual(previewRows(route, { counts, hits }, 'project'), [
    { scope: 'stories', required_confirmation: false, available: 21, preview_count: 2 },
    { scope: 'test-cases', required_confirmation: false, available: 0, preview_count: null },
    { scope: 'runs', required_confirmation: true, available: 0, preview_count: null },
    { scope: 'automation', required_confirmation: false, available: null, preview_count: null },
    { scope: 'knowledge', required_confirmation: false, available: null, preview_count: null }
  ]);
});
