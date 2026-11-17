#!/usr/bin/env node
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { inspectSourceImports, resolveSourceImport } from '../lib/source-imports.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const ts = createRequire(import.meta.url)('typescript');
const manifests = new Map(readdirSync(resolve(root, 'services'), { withFileTypes: true }).filter(row => row.isDirectory() && existsSync(resolve(root, 'services', row.name, 'package.json')))
  .map(row => [row.name, JSON.parse(readFileSync(resolve(root, 'services', row.name, 'package.json'), 'utf8'))]));
const edges = new Map(), unresolved = [], imports = [], triad = new Set(['automation', 'agentic', 'ai']);
const owner = file => relative(root, file).replaceAll('\\', '/').match(/^services\/([^/]+)\//)?.[1];
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', 'dist-admin', 'test', 'tests', 'vendor', 'artifacts', 'instance-setup-data', 'public'].includes(entry.name)) continue;
    const file = resolve(dir, entry.name);
    if (entry.isDirectory()) { walk(file); continue; }
    if (!/\.(?:[cm]?js|tsx?)$/.test(file) || /\.d\.[cm]?ts$/.test(file)) continue;
    for (const specifier of inspectSourceImports(ts, file, readFileSync(file, 'utf8')).imports) {
      const target = resolveSourceImport(root, file, specifier);
      if (target === undefined) { unresolved.push({ file: relative(root, file), specifier }); continue; }
      const from = owner(file), to = target && owner(target);
      if (!from || !to || from === to) continue;
      const key = `${from}->${to}`;
      if (!edges.has(key)) edges.set(key, { from, to, count: 0 });
      edges.get(key).count++; imports.push({ from, to, file: relative(root, file), specifier, target: relative(root, target) });
    }
  }
}
walk(resolve(root, 'services'));
function components(nodes, selected) {
  let sequence = 0; const indexes = new Map(), lows = new Map(), stack = [], active = new Set(), result = [];
  const visit = node => {
    indexes.set(node, sequence); lows.set(node, sequence++); stack.push(node); active.add(node);
    for (const { to } of [...edges.values()].filter(edge => edge.from === node && selected(edge))) {
      if (!indexes.has(to)) { visit(to); lows.set(node, Math.min(lows.get(node), lows.get(to))); }
      else if (active.has(to)) lows.set(node, Math.min(lows.get(node), indexes.get(to)));
    }
    if (lows.get(node) === indexes.get(node)) {
      const group = []; let member;
      do { member = stack.pop(); active.delete(member); group.push(member); } while (member !== node);
      if (group.length > 1) result.push(group.sort());
    }
  };
  for (const node of nodes) if (!indexes.has(node)) visit(node);
  return result;
}
const triadCycles = components(triad, edge => triad.has(edge.from) && triad.has(edge.to));
const deepExports = [...triad].flatMap(name => Object.keys(manifests.get(name).exports || {}).filter(key => /^\.\/backend\/(?:lib|services)\//.test(key)).map(key => `${name}:${key}`));
const contractEdges = [...edges.values()].filter(edge => edge.from === 'contracts');
const result = {
  ok: !triadCycles.length && !deepExports.length && !contractEdges.length && !unresolved.length,
  scope: 'All production service source imports, including conditional public exports; package aggregation retains host/foundation composition edges.',
  packages: manifests.size, source_cross_package_imports: imports.length,
  edges: [...edges.values()].sort((a, b) => `${a.from}/${a.to}`.localeCompare(`${b.from}/${b.to}`)),
  triad_cycles: triadCycles, full_repository_package_components: components(manifests.keys(), () => true),
  forbidden_deep_exports: deepExports, contracts_outbound_edges: contractEdges, unresolved_imports: unresolved,
  ...(process.argv.includes('--detail') ? { imports } : {})
};
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
