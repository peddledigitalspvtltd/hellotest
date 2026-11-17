const fs = require('node:fs');
const path = require('node:path');
const { parse } = require('acorn');

/** Contract callback tests lift the actual owned implementation into their
 * existing named dependency ports. Production integration tests instantiate
 * the factories through the public builder instead. No behavior is recreated. */
function implementationSource(name) {
  const source = fs.readFileSync(path.resolve(__dirname, '../../backend/services', `${name}.js`), 'utf8');
  const tree = parse(source, { ecmaVersion: 'latest' });
  const factory = tree.body.find(node => node.type === 'FunctionDeclaration' && /^create[A-Z]/.test(node.id.name));
  if (!factory) return source;
  return factory.body.body.filter(node => !(node.type === 'ReturnStatement' || node.type === 'VariableDeclaration' && node.declarations.some(declaration => ['exports', 'require'].includes(declaration.id.name))))
    .map(node => source.slice(node.start, node.end)).join('\n')
    .replace(/\bports\./g, '').replace(/(require|import)\((['"])\.\.\//g, '$1($2');
}
function implementationFunctionSource(module, name) {
  const source = implementationSource(module), tree = parse(source, { ecmaVersion: 'latest' });
  const node = tree.body.find(node => node.type === 'FunctionDeclaration' && node.id?.name === name
    || node.type === 'VariableDeclaration' && node.declarations.some(declaration => declaration.id.name === name)
    || node.type === 'ExpressionStatement' && node.expression.left?.object?.name === 'exports' && node.expression.left.property?.name === name);
  if (!node) throw new Error(`Missing implementation function ${module}:${name}`);
  return source.slice(node.start, node.end);
}
module.exports = { implementationSource, implementationFunctionSource };
