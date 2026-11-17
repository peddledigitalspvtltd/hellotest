import test from 'node:test';
import assert from 'node:assert/strict';
import { findLiteralColors } from '../../../../scripts/checks/check-component-colors.mjs';

test('component color policy accepts semantic fallbacks and ignores selectors, comments and asset contents', () => {
  assert.deepEqual(findLiteralColors('#abc { color: var(--ui-text); border-color: var(--feature-border,var(--ui-border)); background: url("data:image/svg+xml,<svg fill=\"#fff\"/>"); } /* #fff */'), []);
  assert.equal(findLiteralColors('.card { color: #fff; border-color: var(--legacy, #dbeafe); }').length, 2);
});
