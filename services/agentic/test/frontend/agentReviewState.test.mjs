import assert from 'node:assert/strict';
import test from 'node:test';
import { QualityReviewInitial, QualityReviewReducer } from '../../frontend/quality/qualityReviewState.ts';
import { RepositoryReviewInitial, RepositoryReviewReducer } from '../../frontend/agents/repositoryReviewState.ts';

test('changing a prepared quality plan invalidates its prior approval', () => {
  let state = QualityReviewReducer(QualityReviewInitial(), { type: 'field', key: 'plan', value: { id: 'first' } });
  state = QualityReviewReducer(state, { type: 'field', key: 'reviewed', value: true });
  assert.equal(state.reviewed, true);
  state = QualityReviewReducer(state, { type: 'field', key: 'plan', value: { id: 'changed' } });
  assert.equal(state.reviewed, false);
  const cleared = QualityReviewReducer({ ...state, formError: 'Old error', draftFinding: { id: 'old' } }, { type: 'run.started' });
  assert.equal(cleared.plan, null); assert.equal(cleared.formError, ''); assert.equal(cleared.draftFinding, null);
});
test('repository run and scope changes discard old publication selections and receipts', () => {
  let state = { ...RepositoryReviewInitial('objects'), selected: new Set(['private-object']), search: 'Old run', page: 3, publishReceipt: { items: [] } };
  const priorSelection = state.selected;
  state = RepositoryReviewReducer(state, { type: 'run.changed' });
  assert.equal(state.selected.size, 0); assert.equal(priorSelection.size, 1); assert.equal(state.page, 1); assert.equal(state.publishReceipt, null);
  state = RepositoryReviewReducer({ ...state, file: { name: 'old.zip' }, repositoryUrl: 'https://example.test/old' }, { type: 'scope.changed', group: 'knowledge' });
  assert.equal(state.file, null); assert.equal(state.repositoryUrl, ''); assert.equal(state.group, 'knowledge');
});
test('changing repository review category or publication filter clears incompatible selection', () => {
  const selected = { ...RepositoryReviewInitial('objects'), selected: new Set(['object']), page: 4 };
  const next = RepositoryReviewReducer(selected, { type: 'field', key: 'group', value: 'knowledge' });
  assert.equal(next.selected.size, 0); assert.equal(next.page, 1); assert.equal(selected.selected.size, 1);
});
