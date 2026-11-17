import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const frontend = fileURLToPath(new URL('../../../frontend/', import.meta.url));
const entry = resolve(frontend, 'pages/AutomationPage.tsx');
const sources = new Map();
const parse = file => ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, extname(file) === '.tsx' ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
function visit(file) {
  if (sources.has(file)) return;
  const ast = parse(file);
  sources.set(file, ast);
  const imports = [];
  function collect(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) imports.push(node.moduleSpecifier.text);
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])) imports.push(node.arguments[0].text);
    ts.forEachChild(node, collect);
  }
  collect(ast);
  for (const id of imports.filter(id => id.startsWith('.'))) {
    const base = resolve(dirname(file), id);
    if (!base.startsWith(frontend)) continue;
    const target = ['', '.tsx', '.ts', '.mjs', '.js', '/index.tsx', '/index.ts'].map(suffix => base + suffix).find(path => /\.(?:tsx?|m?js)$/.test(path) && existsSync(path));
    if (target) visit(target);
  }
}
visit(entry);

/** Only the live lazy host's reachable implementation is covered; no snapshots. */
export function automationWorkspaceSource() {
  return [...sources].map(([file, ast]) => `\n// ${relative(frontend, file)}\n${ast.text}`).join('\n');
}
export function automationOwnerSource(owner) {
  const file = resolve(frontend, owner);
  assert.ok(sources.has(file), `Automation owner must be reachable from the live route: ${owner}`);
  return sources.get(file).text;
}
export function automationOwnerAst(owner) {
  automationOwnerSource(owner);
  return sources.get(resolve(frontend, owner));
}
export function findAutomationBinding(name, owner) {
  const matches = [];
  for (const [file, ast] of sources) {
    if (owner && file !== resolve(frontend, owner)) continue;
    const walk = node => {
      if ((ts.isVariableDeclaration(node) || ts.isFunctionDeclaration(node)) && node.name?.getText(ast) === name && (ts.isFunctionDeclaration(node) || node.initializer)) matches.push({ node, ast, owner: relative(frontend, file) });
      ts.forEachChild(node, walk);
    };
    walk(ast);
  }
  assert.equal(matches.length, 1, `Expected exactly one live ${name} binding${owner ? ` in ${owner}` : ''}; found ${matches.map(item => item.owner).join(', ')}`);
  return matches[0];
}

/** Select a real useEffect by its declared dependency list in its owning hook. */
export function findAutomationEffect(dependencies, owner) {
  const ast = automationOwnerAst(owner), matches=[];
  const visit=node=>{if(ts.isCallExpression(node)&&node.expression.getText(ast)==='useEffect'&&node.arguments[1]&&ts.isArrayLiteralExpression(node.arguments[1])){
    const actual=node.arguments[1].elements.map(item=>item.getText(ast));
    if(actual.length===dependencies.length&&actual.every((value,index)=>value===dependencies[index]))matches.push(node.arguments[0]);
  }ts.forEachChild(node,visit);};visit(ast);
  assert.equal(matches.length,1,`Expected one live effect [${dependencies.join(', ')}] in ${owner}`);
  return {node:matches[0],ast,owner};
}

export function automationMutationProperty(name, property, owner) {
  const {node,ast}=findAutomationBinding(name,owner);
  assert.ok(ts.isCallExpression(node.initializer)&&ts.isObjectLiteralExpression(node.initializer.arguments[0]),`Find actual ${name} options`);
  const entry=node.initializer.arguments[0].properties.find(item=>ts.isPropertyAssignment(item)&&item.name.getText(ast)===property);
  assert.ok(entry,`Find actual ${name}.${property}`);return entry.initializer.getText(ast);
}
