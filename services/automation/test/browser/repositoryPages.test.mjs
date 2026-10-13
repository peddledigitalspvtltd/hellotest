import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = await readFile(new URL('../../frontend/lib/repositoryEntries.ts', import.meta.url), 'utf8');
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const exports = {};
runInNewContext(output, { exports });
const collect = exports.collectRepositoryPages;
test('repository pages retain all rows, deduplicate boundaries and stop at a short page', async () => {
  const requests = [];
  const rows = await collect(async page => { requests.push(page); return page.offset === 0 ? [{id:'a'},{id:'b'}] : page.offset === 2 ? [{id:'b'},{id:'c'}] : [{id:'d'}]; }, {pageSize:2});
  assert.deepEqual(Array.from(rows, row => row.id), ['a','b','c','d']);
  assert.deepEqual(requests.map(page => page.offset), [0,2,4]);
});
test('repository pages cancel stale scope reads and reject repeated full pages', async () => {
  const controller = new AbortController();
  await assert.rejects(collect(async () => {controller.abort();return [{id:'a'}];}, {signal:controller.signal}), {name:'AbortError'});
  let reads = 0;
  await assert.rejects(collect(async () => {reads++; return [{id:'a'}];}, {pageSize:1}), /repeated a page/);
  assert.equal(reads, 2);
});

test('repository pages reject invalid paging configuration before a request', async () => {
  for (const pageSize of [0, -1, 1.5, NaN]) await assert.rejects(collect(async () => {throw new Error('Unexpected read');}, {pageSize}), /positive integer/);
});
