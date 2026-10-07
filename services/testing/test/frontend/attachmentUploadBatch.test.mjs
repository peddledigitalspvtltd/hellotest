import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
const exports = {};
new Function('exports', ts.transpileModule(readFileSync(new URL('../../frontend/lib/attachmentUploadBatch.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(exports);
const { uploadAttachmentBatch } = exports;

test('partial upload failures preserve original file objects and ordering without abandoning successful uploads', async () => {
  const files = ['one', 'two', 'three', 'four'].map(name => ({ name }));
  const attempted = [];
  const result = await uploadAttachmentBatch(files, async file => {
    attempted.push(file);
    if (file.name === 'two' || file.name === 'four') throw new Error('Connection lost');
  });
  assert.equal(attempted.length, 4);
  assert.equal(result.uploaded, 2);
  assert.deepEqual(result.failed, [files[1], files[3]]);
  assert.equal(result.failed[0], files[1]);
  assert.equal(result.firstError, 'Connection lost');
  const retry = await uploadAttachmentBatch(result.failed, async () => {});
  assert.equal(retry.uploaded, 2);
  assert.deepEqual(retry.failed, []);
});

test('large file batches respect the worker limit and handle empty input', async () => {
  let active = 0; let peak = 0;
  const result = await uploadAttachmentBatch(Array.from({ length: 10 }, (_, id) => id), async () => {
    active += 1; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 2)); active -= 1;
  }, 3);
  assert.equal(result.uploaded, 10); assert.equal(peak, 3);
  assert.deepEqual(await uploadAttachmentBatch([], async () => { throw new Error('must not run'); }), { uploaded: 0, failed: [], firstError: '' });
});
