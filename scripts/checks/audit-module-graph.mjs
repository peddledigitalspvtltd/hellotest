#!/usr/bin/env node
import { createRequire } from 'node:module';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveSourceImport, inspectSourceImports, reachableModules } from '../lib/source-imports.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(resolve(root, 'services/platform/frontend/package.json'));
const ts = require('typescript');
const roots = ['services', 'testengine/backend/src', 'local-run/mobile-engine/src'];
const extensions = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.css']);
const modules = new Map();
const label = file => relative(root, file).replaceAll('\\', '/');
function walk(directory, visit) {
  if (!existsSync(directory)) return;
  for (const item of readdirSync(directory, { withFileTypes: true })) {
    const file = resolve(directory, item.name);
    if (item.isDirectory()) { if (!['node_modules', 'dist', 'dist-admin', 'coverage', 'artifacts', 'vendor', 'test', 'tests', 'instance-setup-data'].includes(item.name)) walk(file, visit); }
    else visit(file);
  }
}
for (const directory of roots) walk(resolve(root, directory), file => {
  if (extensions.has(extname(file)) && !file.endsWith('.d.ts') && !file.includes('/eval/') && !/\/vite[^/]*\.ts$/.test(file) && !file.includes('/frontend/public/')) modules.set(file, new Set());
});
const resolveImport = (file, specifier) => resolveSourceImport(root, file, specifier);
const unresolved = [], dynamicSites = [];
function dependencies(file, onDependency, recordDynamic = false, readStrings = false) {
  const { imports, dynamic } = inspectSourceImports(ts, file, readFileSync(file, 'utf8'), { readStrings });
  imports.forEach(onDependency);
  if (recordDynamic) dynamicSites.push(...dynamic.map(line => ({ file: label(file), line })));
}
for (const [file, targets] of modules) dependencies(file, specifier => {
  const target = resolveImport(file, specifier);
  if (target === undefined) unresolved.push({ file: label(file), specifier });
  else if (target && modules.has(target)) targets.add(target);
}, true);
// Composition roots use service manifests to load routes dynamically.
const manifest = createRequire(import.meta.url)(resolve(root, 'services/platform/backend/src/routes/manifest.js'));
const entries = ['services/platform/frontend/src/main.tsx', 'services/platform/frontend/admin/main.tsx', 'services/platform/backend/src/server.js', 'services/platform/backend/src/migrate.js', 'testengine/backend/src/server.ts', 'local-run/mobile-engine/src/server.js', 'services/platform/backend/src/routes/manifest.js', ...manifest.serviceManifests.map(service => `services/${service.id}/backend/service.manifest.js`), ...manifest.serviceManifests.flatMap(service => [`services/${service.id}/backend/server.cjs`, `services/${service.id}/frontend/entry.ts`]), ...manifest.routeModules.map(route => route.source)].map(file => resolve(root, file));
for (const html of readdirSync(resolve(root, 'services/platform/frontend')).filter(file => file.endsWith('.html'))) {
  for (const match of readFileSync(resolve(root, 'services/platform/frontend', html), 'utf8').matchAll(/src=["'](\/src\/[^"']+)["']/g)) entries.push(resolve(root, 'services/platform/frontend', match[1].slice(1)));
}
const reachable = reachableModules(modules, entries);
const tests = new Set();
for (const directory of ['services/platform/frontend/test', 'services/platform/backend/test', 'testengine/backend/test', ...manifest.serviceManifests.map(service => `services/${service.id}/test`)]) walk(resolve(root, directory), file => {
  if (!extensions.has(extname(file))) return;
  dependencies(file, specifier => { const target = resolveImport(file, specifier); if (target) tests.add(target); }, false, true);
});
const offline = new Set();
for (const directory of ['scripts', 'services/platform/backend/eval', 'services/platform/frontend/test/fixtures']) walk(resolve(root, directory), file => {
  if (!extensions.has(extname(file))) return;
  dependencies(file, specifier => {
    const target = resolveImport(file, specifier);
    if (target === undefined) unresolved.push({ file: label(file), specifier });
    else if (target) offline.add(target);
  });
});
const offlineReachable = reachableModules(modules, offline);
const candidates = [...modules.keys()].filter(file => !reachable.has(file) && !file.endsWith('service.manifest.js'));
const sharedFeatureImports = [...modules].filter(([file]) => label(file).startsWith('services/platform/frontend/src/shared/')).flatMap(([file, imports]) => [...imports].filter(target => /^services\/(?!platform\/)[^/]+\/frontend\//.test(label(target))).map(target => ({ file: label(file), target: label(target) })));
const orphanCandidates = candidates.filter(file => !offlineReachable.has(file));
// A test referring to an otherwise unused production file does not make that
// file a runtime entry point. Keep prototypes under test/fixtures instead.
const result = { ok: unresolved.length === 0 && sharedFeatureImports.length === 0 && orphanCandidates.length === 0, modules: modules.size, entry_points: entries.length, reachable: [...reachable].filter(file => modules.has(file)).length, unresolved_imports: unresolved, shared_feature_dependencies: sharedFeatureImports, offline_entry_candidates: candidates.filter(file => offlineReachable.has(file)).map(label).sort(), unreferenced_candidates: candidates.filter(file => !tests.has(file) && !offlineReachable.has(file)).map(label).sort(), orphaned_production_sources: orphanCandidates.map(label).sort(), test_only_candidates: candidates.filter(file => tests.has(file) && !offlineReachable.has(file)).map(label).sort(), dynamic_import_sites: dynamicSites };
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
