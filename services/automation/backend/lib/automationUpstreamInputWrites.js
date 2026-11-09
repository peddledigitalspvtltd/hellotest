const {parse} = require('acorn');
const {normalizeParameterKey} = require('@hellotest/platform/backend/src/utils/stepParameterResolution');
const {tokenFor} = require('@hellotest/platform/backend/src/utils/parameterNames');
const {parameterTemplateParts} = require('./automationParameterTemplates');

/** A narrow source audit for explicit parameterized text-entry commands. It
 * neither infers targets nor produces actions. Only an unconditional awaited
 * Playwright text-write argument can satisfy an authored input reference. */
function auditAuthoredInputWrites({step = {}, source = ';'} = {}) {
  const action = String(step.action || '').replace(/<[^>]*>/g, ' ').trim();
  const explicitWrite = /^(?:(?:given|when|then|and|i|the user|user)\s+)*(?:fill|type|enter)\b/i.test(action);
  const required = explicitWrite ? [...new Set((parameterTemplateParts(action) || []).filter(part => part.key).map(part => part.key))] : [];
  const result = {required_parameter_references: required.map(tokenFor), missing_parameter_references: [], text_write_count: 0};
  if (!required.length) return result;
  const tree = parse(source, {ecmaVersion: 'latest', allowAwaitOutsideFunction: true});
  const member = node => node?.type === 'MemberExpression' ? node.computed ? node.property?.value : node.property?.name : null;
  const root = node => node?.type === 'Identifier' ? node.name : node?.type === 'CallExpression' ? root(node.callee)
    : node?.type === 'MemberExpression' ? root(node.object) : null;
  const walk = (node, visit) => {
    if (!node || typeof node !== 'object') return;
    visit(node);
    for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(child => walk(child, visit));
    else if (value && typeof value === 'object') walk(value, visit);
  };
  const playwrightNames = new Set(['page', 'playwrightPage']);
  const declarations = tree.body.filter(node => node.type === 'VariableDeclaration').flatMap(node => node.declarations);
  for (let pass = 0; pass < declarations.length + 1; pass++) {
    for (const declaration of declarations) if (declaration.id?.type === 'Identifier' && playwrightNames.has(root(declaration.init))) playwrightNames.add(declaration.id.name);
  }
  const methods = new Set(['fill', 'type', 'pressSequentially', 'insertText']);
  const isWrite = node => node?.type === 'CallExpression' && methods.has(member(node.callee)) && playwrightNames.has(root(node.callee));
  // Count every emitted write, including an unsupported conditional/computed
  // shape. Missing proof after any such write must stop instead of replaying it.
  walk(tree, node => {if (isWrite(node)) result.text_write_count++;});
  const written = new Set();
  for (const statement of tree.body) {
    const call = statement.type === 'ExpressionStatement' && statement.expression?.type === 'AwaitExpression' ? statement.expression.argument : null;
    if (!isWrite(call)) continue;
    const direct = ['page', 'playwrightPage'].includes(call.callee.object?.name) && ['fill', 'type'].includes(member(call.callee));
    const value = call.arguments[direct ? 1 : 0];
    walk(value, node => {
      if (node.type === 'Literal' && typeof node.value === 'string') for (const part of parameterTemplateParts(node.value) || []) if (part.key) written.add(part.key);
      if (node.type === 'MemberExpression' && node.object?.type === 'Identifier' && node.object.name === 'params') {
        const key = normalizeParameterKey(node.computed ? node.property?.value : node.property?.name, 't');
        if (key) written.add(key);
      }
    });
  }
  result.missing_parameter_references = required.filter(key => !written.has(key)).map(tokenFor);
  return result;
}

module.exports = {auditAuthoredInputWrites};
