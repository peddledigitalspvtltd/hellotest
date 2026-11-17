const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

function checkRuntimeExports(root) {
  const requireFromRoot = createRequire(path.join(root, 'package.json'));
  const missing = [];
  const checked = new Set();
  const runtimeTarget = value => typeof value === 'string' ? value : value && typeof value === 'object' && !Array.isArray(value)
    ? runtimeTarget(value.require ?? value.node ?? value.default ?? value.import) : null;
  const runtimeFile = target => typeof target === 'string' && target.startsWith('./') && !target.startsWith('./frontend/')
    && !/\.(?:css|d\.[cm]?ts|tsx?)$/.test(target) && target !== './package.json';
  const verify = specifier => {
    if (checked.has(specifier)) return;
    checked.add(specifier);
    try { requireFromRoot.resolve(specifier); }
    catch (error) { missing.push(`${specifier}: ${error.code || error.message}`); }
  };
  const walk = directory => fs.existsSync(directory) ? fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (['node_modules', 'test', 'tests', 'vendor', 'public', 'assets'].includes(entry.name)) return [];
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(file) : [file];
  }) : [];
  for (const entry of fs.readdirSync(path.join(root, 'services'), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifest = path.join(root, 'services', entry.name, 'package.json');
    if (!fs.existsSync(manifest)) continue;
    const metadata = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    const packageDirectory = path.dirname(manifest);
    for (const dependency of Object.keys(metadata.dependencies || {}).filter(name => name.startsWith('@hellotest/'))) {
      if (!fs.existsSync(path.join(root, 'services', dependency.split('/')[1], 'package.json'))) missing.push(`${dependency}: workspace manifest missing`);
    }
    for (const [key, conditions] of Object.entries(metadata.exports || {})) {
      const target = runtimeTarget(conditions);
      if (!runtimeFile(target)) continue;
      if (!key.includes('*')) { verify(metadata.name + key.slice(1));continue; }
      const [prefix, suffix] = target.split('*');
      if (suffix == null) { missing.push(`${metadata.name}${key.slice(1)}: unsupported wildcard target`);continue; }
      const directory = path.resolve(packageDirectory, prefix.endsWith('/') ? prefix : path.dirname(prefix));
      for (const file of walk(directory)) {
        const relative = `./${path.relative(packageDirectory, file).split(path.sep).join('/')}`;
        if (relative.startsWith(prefix) && relative.endsWith(suffix)) {
          const member = relative.slice(prefix.length, suffix ? -suffix.length : undefined);
          verify(metadata.name + key.slice(1).replace('*', member));
        }
      }
    }
    // Verify concrete consumers as well as export declarations: a missing file
    // behind a wildcard would otherwise disappear from the expansion above.
    // Parse source without importing it or opening a database/model connection.
    const { parse } = require('acorn');
    for (const file of walk(packageDirectory).filter(file => /\.[cm]?js$/.test(file) && !file.includes(`${path.sep}frontend${path.sep}`))) {
      const source = fs.readFileSync(file, 'utf8');
      let ast;
      try { ast = parse(source, { ecmaVersion: 'latest', sourceType: 'script', allowReturnOutsideFunction: true }); }
      catch {
        try { ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module', allowReturnOutsideFunction: true }); }
        catch (error) { throw new Error(`Cannot audit runtime imports in ${path.relative(root,file)}: ${error.message}`); }
      }
      const visit = node => {
        if (!node || typeof node !== 'object') return;
        const literal = node.type === 'ImportDeclaration' || node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration' ? node.source
          : node.type === 'ImportExpression' ? node.source
          : node.type === 'CallExpression' && (node.callee?.name === 'require' || node.callee?.object?.name === 'require' && node.callee?.property?.name === 'resolve') ? node.arguments[0] : null;
        if (literal?.type === 'Literal' && typeof literal.value === 'string' && literal.value.startsWith('@hellotest/')) verify(literal.value);
        for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(visit);else if (value && typeof value === 'object') visit(value);
      };
      visit(ast);
    }
  }
  if (missing.length) throw new Error(`Runtime exports are missing from the image:\n${missing.join('\n')}`);
  return checked.size;
}

if (require.main === module) {
  try { console.log(`Verified ${checkRuntimeExports(path.resolve(process.argv[2] || '.'))} runtime exports.`); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { checkRuntimeExports };
