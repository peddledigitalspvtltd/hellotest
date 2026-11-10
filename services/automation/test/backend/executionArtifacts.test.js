const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeInlineArtifactRefs, createInlineArtifactAttacher, screenshotCaptureAllowed } = require('../../backend/domain/executionArtifacts');

test('engine evidence accepts legacy aliases and drops references without inline content', () => {
  assert.deepEqual(normalizeInlineArtifactRefs({ artifact_refs: [
    null, [], { path: '/screens/receipt.png', mimeType: 'image/png', contentBase64: 'YQ==' },
    { fileName: 'log.txt', dataUrl: 'data:text/plain;base64,Yg==', contentBase64: 'ignored', content_type: 'text/plain' },
    { kind: 'trace', content_base64: 'Yw==' }, { path: '/external-only' }
  ] }), [
    { file_name: 'receipt.png', mime_type: 'image/png', content: 'data:image/png;base64,YQ==' },
    { file_name: 'log.txt', mime_type: 'text/plain', content: 'data:text/plain;base64,Yg==' },
    { file_name: 'trace.bin', mime_type: 'application/octet-stream', content: 'data:application/octet-stream;base64,Yw==' }
  ]);
  assert.deepEqual(normalizeInlineArtifactRefs(null), []);
});

test('evidence persistence failure does not fail execution completion or skip later evidence', async () => {
  const calls = [];
  const attach = createInlineArtifactAttacher(async (transactionId, ref) => {
    calls.push([transactionId, ref.file_name]);
    if (ref.file_name === 'broken') throw new Error('Storage unavailable');
    return { id: ref.file_name };
  });
  const bundle = { artifact_refs: ['first', 'broken', 'last'].map(file_name => ({ file_name, content_base64: 'YQ==' })) };
  assert.deepEqual(await attach(null, bundle), []);
  assert.deepEqual(calls, []);
  assert.deepEqual(await attach('transaction-1', bundle), [{ id: 'first' }, { id: 'last' }]);
  assert.deepEqual(calls, [['transaction-1', 'first'], ['transaction-1', 'broken'], ['transaction-1', 'last']]);
});

test('managed screenshot upload honors the selected mode before legacy booleans and preserves failure overrides', () => {
  for (const [mode, passed, failed] of [['all', true, true], ['passed', true, false], ['failed', false, true], ['off', false, false]]) {
    const policy = { screenshot_mode: mode, screenshot_on_success: !passed, screenshot_on_failure: !failed };
    assert.equal(screenshotCaptureAllowed(policy, 'passed'), passed, mode);
    assert.equal(screenshotCaptureAllowed(policy, 'failed'), failed, mode);
    assert.equal(screenshotCaptureAllowed(policy, 'blocked'), failed, mode);
    assert.equal(screenshotCaptureAllowed(policy, 'failed', true), true, 'an explicitly requested failure screenshot remains authorized');
  }
  assert.equal(screenshotCaptureAllowed({ screenshot_on_success: true, screenshot_on_failure: false }, 'passed'), true);
  assert.equal(screenshotCaptureAllowed({ screenshot_on_success: true, screenshot_on_failure: false }, 'failed'), false);
});
