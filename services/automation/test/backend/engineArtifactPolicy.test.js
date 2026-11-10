const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const { Readable } = require('node:stream');
const artifacts = require('../../backend/domain/executionArtifacts');

function fixture({ mode, steps = [], hooks = [], directOverride = false, queued = true }) {
  const filename = require.resolve('../../backend/services/engineArtifact.service');
  const local = createRequire(filename), module = { exports: {} }, uploads = [];
  const policy = { screenshot_mode: mode, screenshot_on_failure: false, screenshot_on_success: false };
  const transaction = { id: 'transaction', metadata: { execution_result_id: 'result', artifact_policy: policy, capture_failure_override: directOverride } };
  const database = { prepare: sql => ({ get: async () => sql.includes('workspace_transactions') ? transaction : queued ? { transaction_id: transaction.id, payload: { artifact_policy: policy, steps, hooks } } : null }) };
  new Function('require', 'module', 'exports', fs.readFileSync(filename, 'utf8'))(id => {
    if (id.endsWith('/db') || id.endsWith('/obsDb')) return database;
    if (id.endsWith('/attachment.service')) return { uploadManagedExecutionObject: async input => { uploads.push(input); return { id: 'image', filename: input.fileName, mimeType: input.mimeType }; } };
    if (id.endsWith('/src/config')) return { config: { objectStorage: { maxAttachmentBytes: 8 * 1024 * 1024 } } };
    return local(id);
  }, module, module.exports);
  const upload = outcome => module.exports.upload({ engineRunId: 'engine', kind: 'screenshot', outcome, checksum: 'fixture', fileName: 'failed.png', mimeType: 'image/png', stream: Readable.from(['image']) });
  return { upload, uploads };
}

test('explicit failed-step screenshots upload under global off or passed modes for main steps, hooks and direct runs', async () => {
  const forced = { automation_code: '// @hellotest-options timeoutMs=3000 screenshotOnFailure\nthrow new Error("fixture");' };
  for (const mode of ['off', 'passed']) {
    for (const source of [{ steps: [forced] }, { hooks: [{ steps: [forced] }] }, { queued: false, directOverride: true }]) {
      const f = fixture({ mode, ...source });
      assert.equal((await f.upload('failed')).attachment_id, 'image');
      assert.equal(f.uploads.length, 1);
      assert.equal(f.uploads[0].resultId, 'result');
    }
    const unrequested = fixture({ mode });
    await assert.rejects(unrequested.upload('failed'), { statusCode: 403 });
    assert.equal(unrequested.uploads.length, 0);
  }
  await assert.rejects(fixture({ mode: 'off', hooks: [{ steps: [forced] }] }).upload('passed'), { statusCode: 403 }, 'Failure overrides do not enable passed screenshots');
});

test('upload override detection follows the same exact leading flags as the runtime', () => {
  for (const source of ['const text="// @hellotest-options screenshotOnFailure";', 'await page.click("#go");\n// @hellotest-options screenshotOnFailure', '// @hellotest-options no-screenshotOnFailure', '// @hellotest-options screenshotonfailure']) {
    assert.equal(artifacts.hasFailureScreenshotOverride([{ automation_code: source }]), false, source);
  }
  assert.equal(artifacts.hasFailureScreenshotOverride([], [{ steps: [{ automation_code: '// @hellotest-options screenshotOnFailure\nawait page.click("#go");' }] }]), true);
});
