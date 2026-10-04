import { existsSync, statSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// Resolve source imports without evaluating application code. Bare packages are
// installed by their runtime; browser aliases correspond to Vite source roots.
export function resolveSourceImport(root, file, specifier) {
  const clean = specifier.split(/[?#]/, 1)[0];
  let base;
  if (clean.startsWith('@hellotest/')) {
    const [, owner, ...parts] = clean.split('/');
    const manifest = resolve(root, 'services', owner, 'package.json');
    if (!existsSync(manifest)) return undefined;
    const exported = JSON.parse(readFileSync(manifest, 'utf8')).exports?.[`./${parts.join('/')}`];
    if (typeof exported !== 'string') return undefined;
    base = resolve(root, 'services', owner, exported);
  }
  else if (clean.startsWith('/src/')) base = resolve(root, 'services/platform/frontend', clean.slice(1));
  else if (/^\/services\/[^/]+\/frontend(?:\/|$)/.test(clean)) base = resolve(root, clean.slice(1));
  else if (clean.startsWith('.')) base = resolve(dirname(file), clean);
  else return null;
  for (const suffix of ['', '.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '/index.ts', '/index.tsx', '/index.js']) {
    if (existsSync(base + suffix) && statSync(base + suffix).isFile()) return base + suffix;
  }
  // TestEngine compiles .ts files whose ESM import specifiers end in .js.
  if (base.endsWith('.js') && existsSync(base.slice(0, -3) + '.ts')) return base.slice(0, -3) + '.ts';
  return undefined;
}

export function inspectSourceImports(ts, file, source, { readStrings = false } = {}) {
  const imports = new Set(), dynamic = [];
  if (file.endsWith('.css')) {
    for (const match of source.matchAll(/@import\s+(?:url\(\s*)?["']([^"']+)["']/g)) imports.add(match[1]);
    return { imports: [...imports], dynamic };
  }
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  function visit(node) {
    if (readStrings && ts.isStringLiteralLike(node) && /^(\.|\/src\/|\/services\/)/.test(node.text)) imports.add(node.text);
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) imports.add(node.argument.literal.text);
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) imports.add(node.moduleSpecifier.text);
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ['require', 'require.resolve'].includes(node.expression.getText(ast)))) {
      if (node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) imports.add(node.arguments[0].text);
      else dynamic.push(ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return { imports: [...imports], dynamic };
}

export function reachableModules(modules, entrypoints) {
  const seen = new Set();
  const pending = [...entrypoints];
  while (pending.length) {
    const file = pending.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    for (const dependency of modules.get(file) || []) pending.push(dependency);
  }
  return seen;
}
