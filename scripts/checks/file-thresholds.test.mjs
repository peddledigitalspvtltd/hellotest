import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewLargeFiles } from './check-file-thresholds.mjs';

test('large production files require concrete split reviews and cannot silently grow past their reviewed ceiling', () => {
  const file = 'services/automation/backend/services/dispatch.js', files = [{ file, lines: 1400 }];
  assert.equal(reviewLargeFiles(files, {}).ok, false);
  const plan = { owner: 'automation', rationale: 'Keep queue receipts atomic while extracting policy.', seams: ['queue receipts', 'lease lifecycle'], validation: ['receipt rollback integration'], max_lines: 1400 };
  assert.equal(reviewLargeFiles(files, { [file]: plan }).ok, true);
  assert.equal(reviewLargeFiles([{ file, lines: 1401 }], { [file]: plan }).ok, false);
  assert.equal(reviewLargeFiles([{ file, lines: 1200 }], {}).ok, true);
  assert.equal(reviewLargeFiles(files, { [file]: { ...plan, validation: [] } }).ok, false);
});
