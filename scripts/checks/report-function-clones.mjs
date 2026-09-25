#!/usr/bin/env node
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const ts = createRequire(resolve(root, 'services/platform/frontend/package.json'))('typescript');
const roots = ['services', 'testengine/backend/src', 'local-run/mobile-engine/src'];
const files = execFileSync('rg', ['--files', ...roots], { cwd: root, encoding: 'utf8' }).trim().split('\n').filter(file => /\.[cm]?[jt]sx?$/.test(file));
const groups = new Map();
for (const file of files) {
  const source = readFileSync(resolve(root, file), 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  function visit(node) {
    if ((ts.isFunctionDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && node.body) {
      const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, node.getText(ast));
      const tokens = [];
      for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) tokens.push(scanner.getTokenText());
      const key = tokens.join(' ');
      if (key.length >= 250) {
        const locations = groups.get(key) || [];
        locations.push({ file, line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1, name: node.name?.getText(ast) || node.parent?.name?.getText(ast) || '<callback>' });
        groups.set(key, locations);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
}
const candidates = [...groups].filter(([, sites]) => new Set(sites.map(site => site.file)).size > 1)
  .map(([text, sites]) => ({ normalized_characters: text.length, sites }))
  .sort((a, b) => b.normalized_characters * b.sites.length - a.normalized_characters * a.sites.length);
// Advisory, not a deletion gate: identical callbacks can close over different
// state, and independently deployed runtimes can require separate adapters.
console.log(JSON.stringify({ files_scanned: files.length, candidate_groups: candidates.length, candidates }, null, 2));
