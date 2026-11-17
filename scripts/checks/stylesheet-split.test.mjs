import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const postcss = createRequire(resolve(root, 'services/platform/frontend/package.json'))('postcss');
const manifest = JSON.parse(await readFile(resolve(root, 'docs/architecture/stylesheet-split-manifest.json'), 'utf8'));
const hash = text => createHash('sha256').update(text).digest('hex');

for (const entry of manifest.stylesheets) test(`${entry.entry}: ordered fragments preserve every original byte and complete CSS rule`, async () => {
  const imports = await readFile(resolve(root, entry.entry), 'utf8');
  const actual = [...imports.matchAll(/@import "\.\/([^"\n]+)";/g)].map(match => resolve(dirname(resolve(root, entry.entry)), match[1]));
  assert.deepEqual(actual, entry.parts.map(part => resolve(root, part.file)));
  const parts = await Promise.all(entry.parts.map(async part => {
    const content = await readFile(resolve(root, part.file), 'utf8');
    assert.ok(content.split('\n').length <= manifest.max_fragment_lines, part.file);
    assert.equal(hash(content), part.sha256, `Unreviewed legacy fragment change: ${part.file}`);
    assert.doesNotThrow(() => postcss.parse(content, { from: part.file }));
    return content;
  }));
  const combined = parts.join('');
  assert.equal(Buffer.byteLength(combined), entry.original_bytes);
  assert.equal(hash(combined), entry.original_sha256, 'The original cascade must concatenate without changed or omitted bytes.');
});

test('named overlay tokens retain existing modal and menu stacking values', async () => {
  const source = await readFile(resolve(root, 'services/platform/frontend/src/overlay-layers.css'), 'utf8');
  const ast = postcss.parse(source), values = new Map();
  ast.walkDecls(decl => { if (decl.prop.startsWith('--z-')) values.set(decl.prop, decl.value); });
  assert.equal(values.get('--z-dialog-backdrop'), '1200');
  assert.equal(values.get('--z-dialog-nested'), '1220');
  assert.equal(values.get('--z-context-popover'), '1300');
  assert.equal(values.get('--z-action-menu'), '1400');
  assert.match(source, /z-index: var\(--z-dialog-backdrop\) !important/);
});
