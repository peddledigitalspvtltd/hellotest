import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { loadTsModule } from './helpers/loadTsModule.mjs';

const filename = fileURLToPath(new URL('../src/platform/lib/serviceEndpoints.ts', import.meta.url));
const { routeModules } = createRequire(import.meta.url)('../../backend/src/routes/manifest.js');

test('browser routes reach the owning backend profile for every declared HTTP endpoint', () => {
  const { serviceForPath } = loadTsModule(filename);
  let checked = 0;
  for (const route of routeModules) {
    const source = readFileSync(new URL(`../../../../${route.source}`, import.meta.url), 'utf8');
    const paths = [...source.matchAll(/fastify\.(?:get|post|put|patch|delete|head|options)\(\s*["']([^"']+)["']/g)].map(match => match[1]);
    for (const path of paths) {
      const concrete = path.replace(/:[\w]+/g, 'fixture-id').replace('*', 'fixture-path');
      assert.equal(serviceForPath(`${concrete}?project_id=fixture`), route.service, `${route.source}: ${path}`);
      checked++;
    }
  }
  assert.ok(checked > 200, 'Exercise the actual transport surface, including nested AI and context endpoints');
});

test('runtime endpoints override build defaults and preserve the monolith fallback', () => {
  const window = { __HELLOTEST_CONFIG__: { SERVICE_URLS: { knowledge: '/services/knowledge/' } } };
  const api = loadTsModule(filename, { window }, { VITE_CHATBOT_SERVICE_URL: '/build/chatbot', VITE_AI_SERVICE_URL: '/build/ai' });
  assert.equal(api.resolveServiceBase('/v1/context/retrieve', '/api'), '/services/knowledge');
  assert.equal(api.resolveServiceBase('/test-cases/TC_214/ai-impact-preview', '/api'), '/build/ai');
  assert.equal(api.resolveServiceBase('/requirements/ai-create-jobs', '/api'), '/api');
  assert.equal(api.resolveServiceBase('/integrations', '/api'), '/api');
});

// Follow eager, emitted imports: a type reference or deferred optional workflow
// must not pull the application-wide client facade into a focused client/hook.
test('focused clients and shared AI preferences do not eagerly compose unrelated API clients', async () => {
  const ts = (await import('typescript')).default;
  const { resolveSourceImport } = await import('../../../../scripts/lib/source-imports.mjs');
  const { resolve } = await import('node:path');
  const root = fileURLToPath(new URL('../../../../', import.meta.url));
  const dependencies = JSON.parse(readFileSync(resolve(root, 'services/capabilities.json'), 'utf8')).dependencies;
  const graphs = new Map();
  function dependenciesOf(file) {
    if (graphs.has(file)) return graphs.get(file);
    const source = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const imports = ast.statements.filter(node => (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier)
      .map(node => resolveSourceImport(root, file, node.moduleSpecifier.text)).filter(Boolean);
    graphs.set(file, imports);
    return imports;
  }
  const focused = [
    ...Object.keys(dependencies).map(owner => [`services/${owner}/frontend/api.client.ts`, owner]),
    ['services/integration/frontend/hooks/useAiPromptRegistry.ts', 'platform'],
    ['services/integration/frontend/hooks/useAiLlmDefault.ts', 'platform'],
    ['services/testing/frontend/lib/testCasePickerPages.ts', 'testing']
  ];
  for (const [entry, owner] of focused) {
    const pending = [resolve(root, entry)], seen = new Set();
    while (pending.length) {
      const file = pending.pop();
      if (seen.has(file)) continue;
      seen.add(file);
      assert.notEqual(file, resolve(root, 'services/platform/frontend/src/lib/api.ts'), `${entry} eagerly loads the aggregate facade`);
      if (file.endsWith('/api.client.ts')) assert.equal(file, resolve(root, `services/${owner}/frontend/api.client.ts`), `${entry} loads an unrelated client`);
      pending.push(...dependenciesOf(file));
    }
  }
});
