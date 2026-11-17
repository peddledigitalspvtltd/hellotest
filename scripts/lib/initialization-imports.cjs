const { parse } = require('acorn');

// Initialization graph, not the complete architectural/runtime-call graph.
// Follow direct loads, local loader aliases, statically called local functions,
// IIFEs and static class initializers. Deferred callbacks/methods stay deferred.
// Inter-module callbacks and opaque factories still need the full source graph
// and runtime coverage; this helper does not claim general program evaluation.
function initializationImports(source) {
  let ast;
  try { ast = parse(source, { ecmaVersion: 'latest', sourceType: 'script', allowReturnOutsideFunction: true }); }
  catch { ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module', allowReturnOutsideFunction: true }); }
  const imports = new Set(), active = new Set();
  const root = { loaders: new Set(['require']), functions: new Map(), classes: new Map() };
  const clone = env => ({ loaders: new Set(env.loaders), functions: new Map(env.functions), classes: new Map(env.classes) });
  const literal = node => node?.type === 'Literal' && typeof node.value === 'string' ? node.value : null;
  const names = node => !node ? [] : node.type === 'Identifier' ? [node.name]
    : node.type === 'AssignmentPattern' ? names(node.left)
    : node.type === 'RestElement' ? names(node.argument)
    : node.type === 'ObjectPattern' ? node.properties.flatMap(item => names(item.value || item.argument))
    : node.type === 'ArrayPattern' ? node.elements.flatMap(names) : [];
  const hoist = (body, env) => {
    for (const node of body || []) if (node.type === 'FunctionDeclaration' && node.id) env.functions.set(node.id.name, node);
  };
  const invoke = (fn, args, env) => {
    if (!fn || active.has(fn)) return;
    active.add(fn);
    const scope = clone(env);
    for (const [index, parameter] of fn.params.entries()) {
      for (const name of names(parameter)) { scope.loaders.delete(name);scope.functions.delete(name);scope.classes.delete(name); }
      if (parameter.type === 'Identifier' && args[index]?.type === 'Identifier' && env.loaders.has(args[index].name)) scope.loaders.add(parameter.name);
      if (parameter.type === 'AssignmentPattern') visit(parameter.right, scope);
    }
    if (fn.body.type === 'BlockStatement') { hoist(fn.body.body, scope);for (const node of fn.body.body) visit(node, scope); }
    else visit(fn.body, scope);
    active.delete(fn);
  };
  const visitClass = (node, env, constructArgs) => {
    const elements = node.body.body;
    if (constructArgs) {
      for (const element of elements) {
        if (element.type === 'PropertyDefinition' && !element.static) visit(element.value, env);
        if (element.kind === 'constructor') invoke(element.value, constructArgs, env);
      }
    } else {
      visit(node.superClass, env);
      for (const element of elements) {
        if (element.computed) visit(element.key, env);
        if (element.type === 'StaticBlock') for (const statement of element.body) visit(statement, env);
        if (element.type === 'PropertyDefinition' && element.static) visit(element.value, env);
      }
    }
  };
  const visit = (node, env) => {
    if (!node || typeof node !== 'object') return;
    if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(node.type)) return;
    if (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(node.type)) {
      if (literal(node.source)) imports.add(literal(node.source));
      if (node.declaration) visit(node.declaration, env);
      return;
    }
    if (node.type === 'ImportExpression') { if (literal(node.source)) imports.add(literal(node.source));return; }
    if (node.type === 'ClassDeclaration' || node.type === 'ClassExpression') {
      if (node.id) env.classes.set(node.id.name, node);visitClass(node, env);return;
    }
    if (node.type === 'VariableDeclarator') {
      visit(node.init, env);
      if (node.id.type === 'Identifier') {
        const name = node.id.name, loader = node.init?.type === 'Identifier' && env.loaders.has(node.init.name);
        env.loaders.delete(name);if (loader) env.loaders.add(name);
        if (['FunctionExpression', 'ArrowFunctionExpression'].includes(node.init?.type)) env.functions.set(name, node.init);
        if (node.init?.type === 'ClassExpression') env.classes.set(name, node.init);
      }
      return;
    }
    if (node.type === 'CallExpression' || node.type === 'NewExpression') {
      const callee = node.callee;
      if (node.type === 'CallExpression' && callee.type === 'Identifier' && env.loaders.has(callee.name) && literal(node.arguments[0])) imports.add(literal(node.arguments[0]));
      const fn = ['FunctionExpression', 'ArrowFunctionExpression'].includes(callee.type) ? callee
        : callee.type === 'Identifier' ? env.functions.get(callee.name)
        : callee.type === 'MemberExpression' && ['call', 'apply'].includes(callee.property?.name) && ['FunctionExpression', 'ArrowFunctionExpression'].includes(callee.object?.type) ? callee.object : null;
      if (fn) invoke(fn, callee.type === 'MemberExpression' ? node.arguments.slice(1) : node.arguments, env);
      if (node.type === 'NewExpression') {
        const type = callee.type === 'ClassExpression' ? callee : callee.type === 'Identifier' ? env.classes.get(callee.name) : null;
        if (type) visitClass(type, env, node.arguments);
      }
      visit(callee, env);
      for (const argument of node.arguments) visit(argument, env);
      return;
    }
    for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(item => visit(item, env));else if (value && typeof value === 'object') visit(value, env);
  };
  hoist(ast.body, root);for (const node of ast.body) visit(node, root);
  return [...imports];
}
module.exports = { initializationImports };
