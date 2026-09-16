import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const loadResolver = readPage => {
  const exports = {};
  const source = readFileSync(new URL('../src/lib/testCasePickerPages.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'exports', compiled)(() => ({ api: { testCases: { listPicker: readPage } } }), exports);
  return exports.resolveTestCasePickerScope;
};

test('explicit selection resolver never expands an unselected catalogue', async () => {
  const resolve = loadResolver(() => { throw new Error('Unexpected catalogue request'); });
  assert.deepEqual(await resolve({ project_id: 'project' }), []);
});

test('explicit selections over200 IDs are batched, paged by25 and retain abort/project scope', async () => {
  const calls = [], signal = new AbortController().signal;
  const ids = Array.from({ length: 205 }, (_, i) => 'case-' + i);
  const resolve = loadResolver(async (input, options) => {
    calls.push(input);
    assert.equal(input.project_id, 'project');
    assert.equal(input.page_size, 25);
    assert.equal(options.signal, signal);
    const offset = Number(input.cursor || 0), scoped = input.ids.split(',');
    assert.ok(scoped.length <= 200);
    const items = scoped.slice(offset, offset + 25).map(id => ({ id }));
    const next = offset + items.length;
    return { items, is_last: next >= scoped.length, next_cursor: next < scoped.length ? String(next) : null };
  });
  assert.deepEqual((await resolve({ project_id: 'project', ids: ids.join(',') }, signal)).map(item => item.id), ids);
  assert.equal(calls.length, 9);
});

test('selected scope pagination failures surface for retry rather than silently truncating associations', async () => {
  const resolve = loadResolver(async () => ({ items: [{ id: 'case' }], is_last: false, next_cursor: 'same' }));
  await assert.rejects(resolve({ project_id: 'project', module_id: 'module' }), /fully loaded/);
  const broken = loadResolver(async () => ({ items: [], is_last: false, next_cursor: null }));
  await assert.rejects(broken({ project_id: 'project', suite_ids: 'suite' }), /fully loaded/);
});
