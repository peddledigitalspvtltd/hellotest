import { parse, parseExpressionAt } from 'acorn';

const semanticMethods = new Map(['getByRole', 'getByLabel', 'getByText', 'getByTestId', 'getByPlaceholder', 'getByTitle', 'getByAltText'].map(method => [method.toLowerCase(), method]));
const member = node => node?.type === 'MemberExpression' && !node.optional ? node.computed ? node.property?.value : node.property?.name : null;
const literalString = node => node?.type === 'Literal' && typeof node.value === 'string' && !node.regex ? node.value
  : node?.type === 'TemplateLiteral' && !node.expressions.length ? node.quasis[0].value.cooked : null;

/** The historical repository-string runtime uses exact matching by default.
 * Translate only its closed literal locator grammar; do not evaluate strings,
 * guess a selector, discard options, or choose an implicit first match. */
function semanticExpression(value, receiver) {
  let node;
  const source = value.trim();
  try { node = parseExpressionAt(source, 0, { ecmaVersion: 'latest' }); } catch { return null; }
  if (node.end !== source.length || node.type !== 'CallExpression' || node.optional) return null;
  let suffix = '';
  if (['first', 'last', 'nth'].includes(member(node.callee))) {
    const method = member(node.callee);
    if (method === 'nth') {
      const index = node.arguments[0];
      if (node.arguments.length !== 1 || index?.type !== 'Literal' || !Number.isSafeInteger(index.value) || index.value < 0) return null;
      suffix = `.nth(${index.value})`;
    } else {
      if (node.arguments.length) return null;
      suffix = `.${method}()`;
    }
    node = node.callee.object;
  }
  if (node?.type !== 'CallExpression' || node.optional || node.arguments.length < 1 || node.arguments.length > 2) return null;
  const callee = node.callee;
  const rawMethod = callee.type === 'Identifier' ? callee.name
    : callee.type === 'MemberExpression' && !callee.computed && !callee.optional && ['page', 'playwrightPage'].includes(callee.object?.name) ? callee.property.name : null;
  const method = String(rawMethod).toLowerCase() === 'locator' ? 'locator' : semanticMethods.get(String(rawMethod).toLowerCase()), argument = literalString(node.arguments[0]);
  if (!method || argument === null) return null;
  const options = new Map();
  if (node.arguments.length === 2) {
    const object = node.arguments[1];
    if (['getByTestId', 'locator'].includes(method) || object.type !== 'ObjectExpression') return null;
    for (const property of object.properties) {
      const key = property.key?.name ?? property.key?.value;
      if (property.type !== 'Property' || property.computed || property.method || property.shorthand || options.has(key)) return null;
      if (key === 'exact' && property.value.type === 'Literal' && typeof property.value.value === 'boolean') options.set(key, property.value.value);
      else if (key === 'name' && method === 'getByRole' && literalString(property.value) !== null) options.set(key, literalString(property.value));
      else return null;
    }
  }
  if (!['getByTestId', 'locator'].includes(method) && !options.has('exact')) options.set('exact', true);
  const rendered = [...options].map(([key, option]) => `${key}: ${JSON.stringify(option)}`).join(', ');
  return `${receiver}.${method}(${JSON.stringify(argument)}${rendered ? `, { ${rendered} }` : ''})${suffix}`;
}

/** Emit an inspected/repository locator using the runtime's exact semantics. */
export function playwrightRepositoryLocatorExpression(target, receiver = 'page') {
  if (!['page', 'playwrightPage'].includes(receiver)) throw new Error('Unsupported Playwright page binding.');
  const source = String(target || '').trim();
  if (!source) throw new Error('A recorded target locator is required.');
  if (/^(?:(?:page|playwrightPage)\.)?(?:getBy\w+|locator)\s*\(/i.test(source)) {
    const expression = semanticExpression(source, receiver);
    if (!expression) throw new Error('Unsupported semantic locator. Preserve its literal options and explicit index; dynamic or ambiguous locator expressions require review.');
    return expression;
  }
  const suffix = source.match(/\.(first\(\s*\)|last\(\s*\)|nth\(\s*(\d+)\s*\))$/);
  const base = suffix ? source.slice(0, suffix.index) : source;
  let expression;
  const alias = base.match(/^(testid|data-testid|label|placeholder|text|title|alt|alttext)=(.+)$/i);
  const role = base.match(/^role=([^\[]+)(?:\[name=["']?(.+?)["']?\])?$/i);
  if (alias) {
    const method = { testid: 'getByTestId', 'data-testid': 'getByTestId', label: 'getByLabel', placeholder: 'getByPlaceholder', text: 'getByText', title: 'getByTitle', alt: 'getByAltText', alttext: 'getByAltText' }[alias[1].toLowerCase()];
    expression = `${receiver}.${method}(${JSON.stringify(alias[2].replace(/^["']|["']$/g, ''))}${method === 'getByTestId' ? '' : ', { exact: true }'})`;
  } else if (role) {
    expression = `${receiver}.getByRole(${JSON.stringify(role[1].trim())}${role[2] ? `, { name: ${JSON.stringify(role[2])}, exact: true }` : ''})`;
  } else {
    expression = `${receiver}.locator(${JSON.stringify(base)})`;
  }
  return expression + (suffix ? suffix[1].startsWith('nth') ? `.nth(${Number(suffix[2])})` : suffix[1].startsWith('last') ? '.last()' : '.first()' : '');
}

/** Repair the unambiguous historical page.locator('getBy…(...)') form without
 * running browser actions. New model output still goes through strict source
 * validation; this adapter is for saved plans and their editable projections. */
export function canonicalizeSavedLocatorWrappers(source) {
  if (typeof source !== 'string' || !source.trim()) return { source, changed: 0 };
  const fenced = source.match(/^(\s*```(?:[A-Za-z0-9_-]+)?\s*)([\s\S]*?)(\s*```\s*)$/);
  if (fenced) {
    const normalized = canonicalizeSavedLocatorWrappers(fenced[2]);
    return normalized.changed ? { source: fenced[1] + normalized.source + fenced[3], changed: normalized.changed } : { source, changed: 0 };
  }
  let tree;
  try { tree = parse(source, { ecmaVersion: 'latest', sourceType: 'module', allowAwaitOutsideFunction: true, allowReturnOutsideFunction: true }); }
  catch { return { source, changed: 0 }; }
  const replacements = [];
  const visit = node => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'CallExpression' && !node.optional && member(node.callee) === 'locator'
      && ['page', 'playwrightPage'].includes(node.callee.object?.name) && node.arguments.length === 1) {
      const value = literalString(node.arguments[0]);
      if (value !== null && /^\s*(?:(?:page|playwrightPage)\.)?getBy\w+\s*\(/i.test(value)) {
        const expression = semanticExpression(value, node.callee.object.name);
        if (expression) replacements.push({ start: node.start, end: node.end, expression });
      }
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') visit(value);
    }
  };
  visit(tree);
  let result = source;
  for (const replacement of replacements.sort((a, b) => b.start - a.start)) {
    const newlines = source.slice(replacement.start, replacement.end).match(/\n/g)?.length || 0;
    const expression = newlines ? `(${replacement.expression}${'\n'.repeat(newlines)})` : replacement.expression;
    result = result.slice(0, replacement.start) + expression + result.slice(replacement.end);
  }
  return { source: result, changed: replacements.length };
}
