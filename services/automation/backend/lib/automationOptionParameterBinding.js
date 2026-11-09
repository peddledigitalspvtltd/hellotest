const { parseExpressionAt } = require('acorn');
const { createHash } = require('node:crypto');
const { normalizeParameterKey } = require('@hellotest/platform/backend/src/utils/stepParameterResolution');
// Defer the receipt dependency: the closed compiler also imports this parser.
const browserReceipt = snapshot => require('./automationInteractiveEvidence').browserReceipt(snapshot);
const { validFramePath, framePathKey, snapshotFrameScope } = require('./automationFrameScope');

// Only this module can issue the correspondence between a real literal click
// and its reusable option name. JSON/model fields cannot manufacture it.
const issued = new WeakMap();
const referencePattern = /^@[tsr]\.(?:[A-Za-z][A-Za-z0-9_-]*|\[(?:\\.|[^\]\\\r\n])+\])$/i;
const reference = key => /^[a-z][a-z0-9_-]*$/i.test(key.slice(2)) ? `@${key}`
  : `@${key.slice(0, 2)}[${key.slice(2).replace(/\\/g, '\\\\').replace(/\]/g, '\\]')}]`;
const literal = node => node?.type === 'Literal' && typeof node.value === 'string' && !node.regex ? node.value : null;
function optionLocator(input) {
  if (typeof input !== 'string' || input.length > 2000) return null;
  const source = input.trim(); let node;
  try { node = parseExpressionAt(source, 0, { ecmaVersion: 'latest' }); } catch { return null; }
  if (!['', ';'].includes(source.slice(node.end).trim()) || node.type !== 'CallExpression' || node.optional
    || node.arguments.length !== 2 || literal(node.arguments[0]) !== 'option') return null;
  const callee = node.callee;
  if (!(callee.type === 'Identifier' && callee.name === 'getByRole'
    || callee.type === 'MemberExpression' && !callee.computed && !callee.optional
      && callee.object?.name === 'page' && callee.property?.name === 'getByRole')) return null;
  const options = node.arguments[1], entries = new Map();
  if (options.type !== 'ObjectExpression' || options.properties.length !== 2) return null;
  for (const property of options.properties) {
    const key = property.key?.name ?? property.key?.value;
    if (property.type !== 'Property' || property.computed || property.method || property.shorthand || entries.has(key)) return null;
    entries.set(key, property.value);
  }
  const name = literal(entries.get('name'));
  return name !== null && name.length > 0 && name.length <= 2000 && entries.get('exact')?.type === 'Literal'
    && entries.get('exact').value === true ? { name } : null;
}
function optionLocatorNameBinding(input) {
  const parsed = optionLocator(input);
  if (!parsed || !referencePattern.test(parsed.name)) return null;
  const key = normalizeParameterKey(parsed.name);
  return key ? { key, reference: reference(key), name: parsed.name } : null;
}
const menuScopePattern = /^\.select-wrapper:has\(select#[A-Za-z_][A-Za-z0-9_-]*\) > ul\.dropdown-content$/;
function scopedSelectionLocator(input) {
  if (typeof input !== 'string' || input.length > 2000) return null;
  const source = input.trim(); let node;
  try { node = parseExpressionAt(source, 0, { ecmaVersion: 'latest' }); } catch { return null; }
  const callee = node.callee, root = callee?.object, container = root?.callee;
  if (!['', ';'].includes(source.slice(node.end).trim()) || node.type !== 'CallExpression' || node.optional
    || callee?.type !== 'MemberExpression' || callee.computed || callee.optional || callee.property?.name !== 'getByText'
    || node.arguments.length !== 2 || root?.type !== 'CallExpression' || root.optional || root.arguments.length !== 1
    || !(container?.type === 'Identifier' && container.name === 'locator'
      || container?.type === 'MemberExpression' && !container.computed && !container.optional
        && container.object?.name === 'page' && container.property?.name === 'locator')) return null;
  const scope = literal(root.arguments[0]), name = literal(node.arguments[0]), options = node.arguments[1], property = options?.properties?.[0];
  if (!scope || scope.length > 500 || !menuScopePattern.test(scope) || name === null || !name || name.length > 2000
    || options.type !== 'ObjectExpression' || options.properties.length !== 1 || property.type !== 'Property'
    || property.computed || property.method || property.shorthand || (property.key?.name ?? property.key?.value) !== 'exact'
    || property.value?.type !== 'Literal' || property.value.value !== true) return null;
  return { name, scope };
}
function selectionLocatorNameBinding(input) {
  const option = optionLocatorNameBinding(input);
  if (option) return option;
  const parsed = scopedSelectionLocator(input);
  if (!parsed || !referencePattern.test(parsed.name)) return null;
  const key = normalizeParameterKey(parsed.name);
  return key ? { key, reference: reference(key), ...parsed } : null;
}
const render = (name, scope) => scope ? `locator(${JSON.stringify(scope)}).getByText(${JSON.stringify(name)}, {"exact":true})`
  : `getByRole("option", ${JSON.stringify({ name, exact: true })})`;
function recordedScopedSelectionLocatorSource(input) {
  const parsed = scopedSelectionLocator(input);
  return parsed ? `page.${render(parsed.name, parsed.scope)}` : null;
}
const fingerprint = snapshot => {
  try { return createHash('sha256').update(JSON.stringify(browserReceipt(snapshot))).digest('hex'); } catch { return null; }
};
function canonicalIssuedOptionRequest(request, { snapshot, stepId } = {}) {
  const proof = request?.name === 'browser_click' && issued.get(request.arguments);
  if (!proof || stepId !== undefined && proof.stepId !== stepId || snapshot && proof.snapshot !== snapshot
    || fingerprint(proof.snapshot) !== proof.fingerprint) return request;
  return { ...request, arguments: proof.canonical };
}

function createOptionParameterBinding({ stepId, obligations, bindings, publicValues } = {}) {
  const permitted = new Set();
  for (const binding of bindings) {
    const row = obligations.find(item => item.id === binding.obligation_id);
    // Authoring must explicitly select a parameter. Its name or equality with
    // unrelated data cannot turn a click into a data-bearing selection.
    const action = String(row?.action || '').replace(/<[^>]*>/g, ' ');
    for (const clause of action.split(/[;!?\n]|\.(?=\s|$)|\bthen\b/i)) {
      const selection = /\b(?:select|choose|pick)\b([\s\S]*)/i.exec(clause);
      if (!selection || /\b(?:do\s+not|don't|never|not)\s*$/i.test(clause.slice(0, selection.index))) continue;
      for (const match of selection[1].matchAll(/@[tsr]\.(?:[A-Za-z][A-Za-z0-9_-]*|\[(?:\\.|[^\]\\\r\n])+\])/gi)) {
        const key = normalizeParameterKey(match[0]);
        if (binding.action_parameters.includes(key) && publicValues.has(key) && publicValues.get(key).trim()) permitted.add(key);
      }
    }
  }
  function evidence(args, snapshot) {
    if (snapshot?.tool !== 'browser_snapshot' || snapshot.result?.isError || snapshot.mcp_call === false
      || args.frame !== undefined && !validFramePath(args.frame)) return null;
    const page = browserReceipt(snapshot), scope = snapshotFrameScope(page);
    if (!scope || framePathKey(args.frame) !== framePathKey(scope.path)) return null;
    const proxy = element => {
      const proof = element.selection_option;
      return proof?.kind === 'native_select_proxy' && typeof proof.menu_scope === 'string' && menuScopePattern.test(proof.menu_scope)
        && typeof proof.option_label === 'string' && proof.option_label.length > 0 && proof.option_label.length <= 2000
        && element.text === proof.option_label && !element.text_truncated
        && element.locator_candidates.some(candidate => { const parsed = scopedSelectionLocator(candidate); return parsed?.scope === proof.menu_scope && parsed.name === proof.option_label; });
    };
    const elements = (page.elements || []).filter(element => element?.locators_validated === true
      && Array.isArray(element.locator_candidates) && element.displayed !== false
      && ((element.accessible_role || element.role || element.attributes?.role) === 'option' || proxy(element)));
    const completeName = element => proxy(element) ? element.selection_option.option_label
      : element.accessible_name && !element.accessible_name_truncated ? element.accessible_name
      : !element.accessible_name && element.label && !element.label_truncated ? element.label : null;
    return { page, elements, completeName, proxy };
  }
  function targetFor(key, args, snapshot, currentView) {
    if (!permitted.has(key)) return null;
    const view = currentView || evidence(args, snapshot), value = publicValues.get(key);
    if (!view || [...permitted].filter(name => publicValues.get(name) === value).length !== 1) return null;
    const matching = view.elements.filter(element => view.completeName(element) === value);
    // Partial inventory can omit another same-name option. Demand an exact,
    // unique native semantic-name candidate in addition to complete name data.
    if (matching.length !== 1) return null;
    const target = matching[0], scope = view.proxy(target) ? target.selection_option.menu_scope : undefined;
    const locator = target.locator_candidates.find(candidate => scope
      ? scopedSelectionLocator(candidate)?.name === value && scopedSelectionLocator(candidate)?.scope === scope
      : optionLocator(candidate)?.name === value);
    return locator ? { target, locator, scope } : null;
  }
  function resolveOptionRequest(request, { snapshot } = {}) {
    const binding = request?.name === 'browser_click' && selectionLocatorNameBinding(request.arguments?.locator);
    if (!binding) return request;
    const target = targetFor(binding.key, request.arguments, snapshot);
    if (!target || target.scope !== binding.scope) throw Object.assign(new Error('Use an original public selection parameter and a unique current observed exact option. Inspect the open menu before selecting. No click was made.'), {
      code: 'AUTOMATION_OPTION_PARAMETER_BINDING_INVALID', action_outcome: 'not_attempted', retry_safe: true
    });
    return { ...request, arguments: { ...request.arguments, locator: target.locator } };
  }
  function canonicalize(request, { snapshot } = {}) {
    if (request?.name !== 'browser_click' || typeof request.arguments?.locator !== 'string') return request;
    const view = evidence(request.arguments, snapshot);
    if (!view) return request;
    const targets = view.elements.filter(element => element.locator_candidates.includes(request.arguments.locator));
    if (targets.length !== 1) return request;
    const name = view.completeName(targets[0]);
    const keys = [...permitted].filter(key => publicValues.get(key) === name && targetFor(key, request.arguments, snapshot, view)?.target === targets[0]);
    if (keys.length !== 1) return request;
    const args = Object.freeze({ ...request.arguments, ...(request.arguments.frame ? { frame: Object.freeze([...request.arguments.frame]) } : {}) });
    const canonical = Object.freeze({ ...args, locator: render(reference(keys[0]), view.proxy(targets[0]) ? targets[0].selection_option.menu_scope : undefined) });
    issued.set(args, { stepId, snapshot, fingerprint: fingerprint(snapshot), canonical });
    return { ...request, arguments: args };
  }
  return Object.freeze({ canonicalize, resolveOptionRequest });
}

module.exports = { optionLocatorNameBinding, selectionLocatorNameBinding, recordedScopedSelectionLocatorSource,
  scopedSelectionLocator, canonicalIssuedOptionRequest, createOptionParameterBinding };
