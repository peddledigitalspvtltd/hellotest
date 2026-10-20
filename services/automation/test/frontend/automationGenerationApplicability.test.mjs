import test from 'node:test';
import assert from 'node:assert/strict';
import { generationApplicabilityNotice } from '../../frontend/lib/automationGenerationApplicability.ts';

test('the current exact generation version needs no historical applicability notice', () => {
  assert.equal(generationApplicabilityNotice({ applicability: { status: 'current', reasons: [] } }), null);
});

test('edited source or specifications are visibly historical while retained source remains available', () => {
  for (const reason of ['source_changed', 'specification_changed', 'manual_specification_changed', 'section_removed']) {
    const preview = { automation_code: 'await page.locator("#save").click();', applicability: { status: 'historical', reasons: [reason] } };
    const notice = generationApplicabilityNotice(preview);
    assert.equal(notice.historical, true);assert.equal(notice.title, 'Historical generation');assert.match(notice.message, /earlier version/);
    assert.ok(preview.automation_code);
  }
});

test('legacy or unavailable comparisons cannot imply applicability or echo server-provided prose', () => {
  for (const preview of [{}, { applicability: { status: 'unknown', reasons: ['PRIVATE_MODEL_TEXT'] } }, { applicability: { status: 'forged-current' } }]) {
    const notice = generationApplicabilityNotice(preview);
    assert.equal(notice.historical, false);assert.equal(notice.title, 'Generation version unavailable');assert.doesNotMatch(JSON.stringify(notice), /PRIVATE|forged/);
  }
});
