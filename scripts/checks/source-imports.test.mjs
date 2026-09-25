import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { resolveSourceImport, inspectSourceImports, reachableModules } from '../lib/source-imports.mjs';
const ts = createRequire(new URL('../../services/platform/frontend/package.json', import.meta.url))('typescript');

test('source resolution covers service aliases, TypeScript ESM, query suffixes and missing imports', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'hellotest-imports-'));
  try {
    for (const file of ['services/manual/frontend/index.ts', 'services/platform/frontend/src/main.tsx', 'worker.ts', 'style.css']) {
      mkdirSync(resolve(root, file, '..'), { recursive: true }); writeFileSync(resolve(root, file), '');
    }
    const from = resolve(root, 'entry.ts');
    for (const [specifier, target] of [['/services/manual/frontend', 'services/manual/frontend/index.ts'], ['/src/main.tsx', 'services/platform/frontend/src/main.tsx'], ['./worker.js', 'worker.ts'], ['./style.css?inline', 'style.css']]) {
      assert.equal(resolveSourceImport(root, from, specifier), resolve(root, target));
    }
    assert.equal(resolveSourceImport(root, from, 'react'), null);
    assert.equal(resolveSourceImport(root, from, './absent'), undefined);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('source analysis follows real imports and exports without treating comments as dependencies', () => {
  const result = inspectSourceImports(ts, 'entry.ts', `
    // import './comment';
    import { component } from './component';
    export * from './contracts';
    type Value = import('./types').Value;
    const lazy = import('./lazy');
    const dynamic = require(variable);
  `);
  assert.deepEqual(new Set(result.imports), new Set(['./component', './contracts', './types', './lazy']));
  assert.equal(result.dynamic.length, 1);
  assert.deepEqual(inspectSourceImports(ts, 'style.css', '@import url("./theme.css");').imports, ['./theme.css']);
});

test('workspace resolution exposes only explicit package exports', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'hellotest-exports-'));
  try {
    const owner = resolve(root, 'services/dashboard');
    mkdirSync(resolve(owner, 'backend'), { recursive: true });
    writeFileSync(resolve(owner, 'backend/public.js'), '');
    writeFileSync(resolve(owner, 'backend/private.js'), '');
    writeFileSync(resolve(owner, 'package.json'), JSON.stringify({
      name: '@hellotest/dashboard', exports: { './backend': './backend/public.js' }
    }));
    const from = resolve(root, 'services/testing/backend/index.js');
    assert.equal(resolveSourceImport(root, from, '@hellotest/dashboard/backend'), resolve(owner, 'backend/public.js'));
    assert.equal(resolveSourceImport(root, from, '@hellotest/dashboard/backend/private'), undefined);
    assert.equal(resolveSourceImport(root, from, '@hellotest/absent/backend'), undefined);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('reachability handles cycles and leaves disconnected source and CSS as orphan candidates', () => {
  const graph = new Map([['entry', new Set(['feature'])], ['feature', new Set(['entry', 'style.css'])], ['style.css', new Set()], ['dead.ts', new Set()], ['dead.css', new Set()]]);
  assert.deepEqual([...reachableModules(graph, ['entry'])].sort(), ['entry', 'feature', 'style.css']);
});
