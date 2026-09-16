import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const exports = {};
new Function('exports', ts.transpileModule(readFileSync(new URL('../src/lib/testCaseReview.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText)(exports);
const { ownsCaseReview, isPendingCaseReview } = exports;

test('manual and every AI source use assigned reviewer ownership; creators cannot override another reviewer', () => {
  for (const ai_generation_source of [undefined, 'interactive', 'scheduler', 'repository']) {
    const item = { review_status: 'pending', reviewer_id: 'assigned', created_by: 'creator', ai_generation_source, ai_generation_review_status: 'pending' };
    assert.equal(isPendingCaseReview(item), true);
    assert.equal(ownsCaseReview(item, 'assigned'), true);
    assert.equal(ownsCaseReview(item, 'creator'), false);
    assert.equal(ownsCaseReview(item, ''), false);
  }
});
test('legacy unassigned AI pending cases fall back only to their creator, never manual unassigned cases', () => {
  const item = { review_status: 'not_requested', created_by: 'creator', ai_generation_source: 'repository', ai_generation_review_status: 'pending' };
  assert.equal(isPendingCaseReview(item), true);
  assert.equal(ownsCaseReview(item, 'creator'), true);
  assert.equal(ownsCaseReview(item, 'other'), false);
  assert.equal(ownsCaseReview({ ...item, ai_generation_source: undefined }, 'creator'), false);
  assert.equal(ownsCaseReview({ ...item, ai_generation_review_status: 'accepted' }, 'creator'), false);
});
test('decisions exclude cases even if a legacy AI pending marker remains', () => {
  for (const review_status of ['accepted', 'changes_requested']) {
    assert.equal(isPendingCaseReview({ review_status, reviewer_id: 'assigned', ai_generation_source: 'scheduler', ai_generation_review_status: 'pending' }), false);
  }
  assert.equal(isPendingCaseReview(null), false);
  assert.equal(ownsCaseReview(null, 'reviewer'), false);
});
