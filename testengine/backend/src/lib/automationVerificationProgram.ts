import { parseExpressionAt } from "acorn";
import { normalizeScopedParameterKey, STEP_PARAMETER_PATTERN } from "./stepParameterReferences.js";
import { readNativeConstraintValidity, readFieldValidationState, readEffectiveInputType } from "./automationMcp.js";

// Independently packaged renderer: parity tests bind this closed grammar to the
// application compiler. No model-authored JavaScript is accepted by the runner.
const nativeConstraintValiditySource = readNativeConstraintValidity.toString();
const fieldValidationStateSource = readFieldValidationState.toString();
const effectiveInputTypeSource = readEffectiveInputType.toString();
const normalizeParameterKey = normalizeScopedParameterKey;
const MAX_SOURCE = 64_000, MAX_OPERATIONS = 250, MAX_STRING = 2_000;
const methods = new Map([
  ['getbyrole', 'getByRole'], ['getbylabel', 'getByLabel'], ['getbyplaceholder', 'getByPlaceholder'],
  ['getbytext', 'getByText'], ['getbytestid', 'getByTestId'], ['getbytitle', 'getByTitle'], ['getbyalttext', 'getByAltText']
]);
const actions = new Map([
  ['browser_click', 'click'], ['browser_fill', 'fill'], ['browser_press_key', 'press'],
  ['browser_select_option', 'selectOption'], ['browser_hover', 'hover'],
  ['browser_check', 'check'], ['browser_uncheck', 'uncheck']
]);
const conditions = new Map([
  ['visible', 'toBeVisible'], ['hidden', 'toBeHidden'], ['enabled', 'toBeEnabled'],
  ['disabled', 'toBeDisabled'], ['editable', 'toBeEditable'], ['checked', 'toBeChecked'], ['unchecked', 'not.toBeChecked']
]);
const pageAssertions = new Set(['url', 'url_contains', 'title', 'title_normalized']);
const valueAssertions = new Set(['text', 'text_contains', 'text_content', 'text_content_contains', 'value', 'input_type', 'count', ...pageAssertions]);
const record = (value: unknown): value is Record<string, any> => value !== null && typeof value === 'object' && !Array.isArray(value);
const bounded = (value: unknown): value is string => typeof value === 'string' && value.length <= MAX_STRING;
const literal = (node: any): string | null => node?.type === 'Literal' && typeof node.value === 'string' && !node.regex ? node.value
  : node?.type === 'TemplateLiteral' && node.expressions.length === 0 ? node.quasis[0].value.cooked : null;
const quoted = (value: unknown) => JSON.stringify(value);
const normalizeText = (value: string) => value.replace(/\s+/g, ' ').trim();
const validRecordedFramePath = (frame: unknown): frame is string[] => Array.isArray(frame) && frame.length >= 1 && frame.length <= 3
  && frame.every(selector => bounded(selector) && selector.trim() && !/^(?:page\.)?(?:frameLocator|locator|getBy\w+)\s*\(/.test(selector.trim()));

/** Render the same closed locator grammar as TestEngine's repository resolver.
 * MCP semantic expressions default to exact:true; native Playwright does not.
 * Spell defaults out instead of silently widening a confirmed locator. */
export function recordedLocatorSource(input: string, frame?: string[]) {
  if (frame !== undefined && !validRecordedFramePath(frame)) return null;
  if (!bounded(input) || !input.trim()) return null;
  let source = input.trim();
  if (/^(?:page\.)?(?:getByRole|getByLabel|getByPlaceholder|getByText|getByTestId|getByTitle|getByAltText|locator)\s*\(/i.test(source) && source.endsWith(';')) {
    let parsed;try { parsed = parseExpressionAt(source, 0, { ecmaVersion: 'latest' }); } catch { return null; }
    if (source.slice(parsed.end).trim() !== ';') return null;
    source = source.slice(0, parsed.end).trimEnd();
  }
  const selection = recordedScopedSelectionLocator(source);
  if (selection) {
    const root = 'page' + (frame || []).map(selector => `.frameLocator(${quoted(selector)})`).join('');
    return `${root}.locator(${quoted(selection.scope)}).getByText(${quoted(selection.name)}, {"exact":true})`;
  }
  const suffix = source.match(/\.(nth\(\s*(\d+)\s*\)|first\(\s*\)|last\(\s*\))$/);
  const base = suffix ? source.slice(0, suffix.index) : source;
  if (!base.trim()) return null;
  if (suffix && (/\.(?:first|last|nth)\(/.test(base) || suffix[2] !== undefined && Number(suffix[2]) > 2_000)) return null;
  const semantic = base.match(/^(?:page\.)?(getByRole|getByLabel|getByPlaceholder|getByText|getByTestId|getByTitle|getByAltText|locator)\s*\(/i);
  let result;
  if (semantic) {
    let node: any;
    try { node = parseExpressionAt(base, 0, { ecmaVersion: 'latest' }); } catch { return null; }
    if (node.type !== 'CallExpression' || node.optional || node.end !== base.length || node.arguments.length < 1 || node.arguments.length > 2) return null;
    const callee = node.callee;
    const calledMethod = callee.type === 'Identifier' ? callee.name : callee.type === 'MemberExpression' && !callee.computed && !callee.optional && callee.object?.type === 'Identifier' && callee.object.name.toLowerCase() === 'page' ? callee.property.name : null;
    if (calledMethod?.toLowerCase() !== semantic[1].toLowerCase()) return null;
    const value = literal(node.arguments[0]), method = semantic[1].toLowerCase(), options: Record<string, any> = { exact: true };
    if (!bounded(value)) return null;
    if (node.arguments.length === 2) {
      const object = node.arguments[1], seen = new Set();
      if (object.type !== 'ObjectExpression' || ['locator', 'getbytestid'].includes(method) && object.properties.length) return null;
      for (const property of object.properties) {
        const key = property.key?.name ?? property.key?.value;
        if (property.type !== 'Property' || property.computed || property.method || property.shorthand || seen.has(key)) return null;
        seen.add(key);
        if (key === 'name' && method === 'getbyrole' && bounded(literal(property.value))) options.name = literal(property.value);
        else if (key === 'exact' && property.value?.type === 'Literal' && typeof property.value.value === 'boolean') options.exact = property.value.value;
        else return null;
      }
    }
    if (method === 'locator') {
      if (/^(?:page\.)?(?:frameLocator|getBy\w+|locator)\s*\(/i.test(value.trim()) || /\.(?:first\(\s*\)|last\(\s*\)|nth\(\s*\d+\s*\))$/.test(value.trim())) return null;
      result = `page.locator(${quoted(value)})`;
    } else result = `page.${methods.get(method)}(${quoted(value)}${method === 'getbytestid' ? '' : `, ${JSON.stringify(options)}`})`;
  } else {
    if (/^(?:page\.)?(?:frameLocator|getBy\w+)\s*\(/i.test(base)
      || /^(?:page|playwrightPage)(?:\?\.|\.)?(?:getBy\w+|locator)\s*(?:\?\.)?\s*\(/i.test(base)
      || /^(?:page|playwrightPage)\s*\[\s*["'](?:getBy\w+|locator)["']/i.test(base)
      || /^(?:getBy\w+|locator)\s*\?\./i.test(base)) return null;
    const role = base.match(/^role=([^\[]+)(?:\[name=["']?(.+?)["']?\])?$/i);
    if (role) result = `page.getByRole(${quoted(role[1].trim())}${role[2] ? `, ${JSON.stringify({ name: role[2], exact: !/\bexact\s*:\s*false\b/i.test(base) })}` : ''})`;
    else {
      const alias = base.match(/^(text|label|placeholder|title|alt|alttext|testid|data-testid)=(.+)$/i);
      if (alias) {
        const name = alias[1].toLowerCase(), value = alias[2].replace(/^["']|["']$/g, '');
        const method = ({ text: 'getByText', label: 'getByLabel', placeholder: 'getByPlaceholder', title: 'getByTitle', alt: 'getByAltText', alttext: 'getByAltText', testid: 'getByTestId', 'data-testid': 'getByTestId' } as Record<string, string>)[name];
        const exact = ['label', 'placeholder'].includes(name) ? !/\bexact\s*:\s*false\b/i.test(base) : true;
        result = `page.${method}(${quoted(value)}${method === 'getByTestId' ? '' : `, ${JSON.stringify({ exact })}`})`;
      } else result = `page.locator(${quoted(base.replace(/^xpath=/i, 'xpath='))})`;
    }
  }
  const root = 'page' + (frame || []).map(selector => `.frameLocator(${quoted(selector)})`).join('');
  return result.replace(/^page\b/, root) + (suffix ? suffix[2] === undefined ? `.${suffix[1].startsWith('last') ? 'last' : 'first'}()` : `.nth(${Number(suffix[2])})` : '');
}

export function parameterKey(value: string) {
  if (/^@(?:(?:t|s|r)\.)?(?:[A-Za-z][A-Za-z0-9_-]*|\[(?:\\.|[^\]\\\r\n])+\])$/i.test(value)) return normalizeParameterKey(value, 'r');
  if (!/^params\s*\[/.test(value)) return null;
  try {
    const node: any = parseExpressionAt(value, 0, { ecmaVersion: 'latest' });
    const key = node.type === 'MemberExpression' && node.computed && !node.optional && node.object?.name === 'params' ? literal(node.property) : null;
    return node.end === value.length && key && /^@?[tsr]\./i.test(key) ? normalizeParameterKey(key, 't') : null;
  } catch { return null; }
}

function scopedParameterReference(key: string) {
  const [scope, ...parts] = key.split('.'), name = parts.join('.');
  return /^[a-z][a-z0-9_-]*$/i.test(name) ? `@${key}` : `@${scope}.[${name.replace(/\\/g, '\\\\').replace(/\]/g, '\\]')}]`;
}

/** A symbolic locator name is data only for this complete, exact option
 * query. CSS, fragments, aliases, indexes and other roles gain no binding. */
export function recordedOptionNameParameter(input: unknown): { key: string; reference: string } | null {
  if (!bounded(input) || !input.trim()) return null;
  const source = input.trim();
  let node: any;
  try { node = parseExpressionAt(source, 0, { ecmaVersion: 'latest' }); } catch { return null; }
  if (node.type !== 'CallExpression' || node.optional || !['', ';'].includes(source.slice(node.end).trim()) || node.arguments.length !== 2) return null;
  const callee = node.callee;
  if (!(callee.type === 'Identifier' && callee.name === 'getByRole'
    || callee.type === 'MemberExpression' && !callee.computed && !callee.optional && callee.object?.type === 'Identifier' && callee.object.name === 'page' && callee.property?.name === 'getByRole')
    || node.arguments[0]?.type !== 'Literal' || literal(node.arguments[0]) !== 'option') return null;
  const options = node.arguments[1];
  if (options.type !== 'ObjectExpression' || options.properties.length !== 2) return null;
  let reference: string | null = null, exact = false;
  const seen = new Set<string>();
  for (const property of options.properties) {
    const key = property.key?.name ?? property.key?.value;
    if (property.type !== 'Property' || property.computed || property.method || property.shorthand || seen.has(key)) return null;
    seen.add(key);
    if (key === 'name' && property.value?.type === 'Literal') reference = literal(property.value);
    else if (key === 'exact' && property.value?.type === 'Literal' && property.value.value === true) exact = true;
    else return null;
  }
  if (!exact || !reference || !/^@[tsr]\./i.test(reference)) return null;
  const key = parameterKey(reference);
  return key ? { key, reference: scopedParameterReference(key) } : null;
}

/** Static native-select proxy scope only. Arbitrary text chains, body scope,
 * interpolated CSS, aliases and indexes remain outside the closed grammar. */
export function recordedScopedSelectionLocator(input: unknown): { scope: string; name: string } | null {
  if (!bounded(input) || !input.trim()) return null;
  const source = input.trim(); let node: any;
  try { node = parseExpressionAt(source, 0, { ecmaVersion: 'latest' }); } catch { return null; }
  if (node.type !== 'CallExpression' || node.optional || !['', ';'].includes(source.slice(node.end).trim()) || node.arguments.length !== 2
    || node.callee?.type !== 'MemberExpression' || node.callee.computed || node.callee.optional || node.callee.property?.name !== 'getByText') return null;
  const root = node.callee.object, callee = root?.callee;
  if (root?.type !== 'CallExpression' || root.optional || root.arguments.length !== 1
    || !(callee?.type === 'Identifier' && callee.name === 'locator'
      || callee?.type === 'MemberExpression' && !callee.computed && !callee.optional && callee.object?.type === 'Identifier' && callee.object.name === 'page' && callee.property?.name === 'locator')) return null;
  const scope = root.arguments[0]?.type === 'Literal' ? literal(root.arguments[0]) : null;
  const name = node.arguments[0]?.type === 'Literal' ? literal(node.arguments[0]) : null;
  const options = node.arguments[1], exact = options?.properties?.[0];
  if (!scope || scope.length > 500 || !/^\.select-wrapper:has\(select#[A-Za-z_][A-Za-z0-9_-]*\) > ul\.dropdown-content$/.test(scope)
    || !bounded(name) || !name || options?.type !== 'ObjectExpression' || options.properties.length !== 1
    || exact.type !== 'Property' || exact.computed || exact.method || exact.shorthand || (exact.key?.name ?? exact.key?.value) !== 'exact'
    || exact.value?.type !== 'Literal' || exact.value.value !== true) return null;
  return { scope, name };
}

export function recordedSelectionNameParameter(input: unknown): { key: string; reference: string; scope?: string } | null {
  const option = recordedOptionNameParameter(input);
  if (option) return option;
  const selection = recordedScopedSelectionLocator(input);
  if (!selection || !/^@[tsr]\./i.test(selection.name)) return null;
  const key = parameterKey(selection.name);
  return key ? { key, reference: scopedParameterReference(key), scope: selection.scope } : null;
}

const valueSource = (value: string) => {
  const key=parameterKey(value);
  if(!key)return quoted(value);
  if(/^params\s*\[/.test(value))return `params[${quoted(key)}]`;
  return quoted(scopedParameterReference(key));
};
export type ParameterTemplatePart = { literal: string } | { key: string; reference:string };
/** Closed text templates contain only literal chunks and explicit native
 * parameter references. They never accept JavaScript expressions or calls. */
export function parameterTemplateParts(value: string): ParameterTemplatePart[] | null {
  if (typeof value!=='string' || value.length>MAX_STRING) return null;
  const parts: ParameterTemplatePart[] = [];
  let offset = 0;
  for (const match of value.matchAll(new RegExp(STEP_PARAMETER_PATTERN.source, 'gi'))) {
    if (!match[1]) continue;
    const index = match.index || 0;
    if (index > offset) parts.push({ literal:value.slice(offset,index) });
    parts.push({ key:normalizeParameterKey(match[0],'r'),reference:match[0] });
    offset = index + match[0].length;
  }
  if (!parts.some(part=>'key' in part)) return null;
  if (offset < value.length) parts.push({ literal:value.slice(offset) });
  return parts;
}
export function hasInvalidParameterTemplate(value: string) {
  if (typeof value!=='string') return false;
  const starts = new Set([...value.matchAll(new RegExp(STEP_PARAMETER_PATTERN.source,'gi'))].filter(match=>match[1]).map(match=>match.index));
  return [...value.matchAll(/(?<![A-Za-z0-9_])@[tsr]\./gi)].some(match=>!starts.has(match.index));
}
const parameterTemplateSource = (value: string) => {
  if (parameterKey(value)) return null;
  const parts = parameterTemplateParts(value);
  return parts?.some(part=>'literal' in part && part.literal.length>0)
    ? `(${parts.map(part=>'key' in part ? `String(params[${quoted(part.key)}])` : quoted(part.literal)).join(' + ')})` : null;
};
const normalizedValueSource = (value: string) => {
  const template = parameterTemplateSource(value);
  return template ? `${template}.replace(/\\s+/g, " ").trim()`
    : parameterKey(value) ? `String(params[${quoted(parameterKey(value))}]).replace(/\\s+/g, " ").trim()` : quoted(normalizeText(value));
};

function assertionSource(args: Record<string, any>, { target: reusedTarget, readers = {} }: { target?: string, readers?: Record<string, string> } = {}) {
  const page = pageAssertions.has(args.assertion), needsValue = valueAssertions.has(args.assertion);
  const keys = ['assertion', ...(page ? [] : ['locator', ...(Object.hasOwn(args, 'frame') ? ['frame'] : [])]), ...(needsValue ? ['value'] : [])];
  if (Object.keys(args).length !== keys.length || keys.some(key => !Object.hasOwn(args, key))) return null;
  if (['text','text_contains','text_content','text_content_contains','title','title_normalized'].includes(args.assertion) && hasInvalidParameterTemplate(args.value)) return null;
  const target = page ? 'page' : reusedTarget || recordedLocatorSource(args.locator, args.frame);
  if (!target) return null;
  const condition = conditions.get(args.assertion);
  if (condition) return `await expect(${target}).${condition}();`;
  if (['valid', 'invalid'].includes(args.assertion)) return `await expect.poll(() => ${target}.evaluate(${readers.native || nativeConstraintValiditySource}), { timeout: 8000 }).toBe(${args.assertion === 'valid'});`;
  if (args.assertion === 'field_valid') return `await expect.poll(() => ${target}.evaluate(${readers.field || fieldValidationStateSource}), { timeout: 8000 }).toBe(true);`;
  if (args.assertion === 'input_type') return `await expect.poll(() => ${target}.evaluate(${readers.inputType || effectiveInputTypeSource}), { timeout: 8000 }).toBe(${valueSource(args.value)});`;
  if (args.assertion === 'count') {
    if (parameterKey(args.value)) return `await expect(${target}).toHaveCount(Number(params[${quoted(parameterKey(args.value))}]));`;
    if (!/^(?:0|[1-9]\d{0,3})$/.test(args.value) || Number(args.value) > 2_000) return null;
    return `await expect(${target}).toHaveCount(${Number(args.value)});`;
  }
  if (['value', 'text_content', 'text_content_contains'].includes(args.assertion)) return `await expect(${target}).${({ value: 'toHaveValue', text_content: 'toHaveText', text_content_contains: 'toContainText' } as Record<string, string>)[args.assertion]}(${valueSource(args.value)});`;
  if (args.assertion === 'title_normalized') return `await expect(page).toHaveTitle(${valueSource(args.value)});`;
  // Native toHaveText uses textContent and strips zero-width characters. MCP's
  // visible-text modes use innerText and whitespace normalization only. Poll
  // these exact reads rather than changing the assertion's meaning.
  if (['text', 'text_contains'].includes(args.assertion)) {
    const actual = `(await ${target}.innerText()).replace(/\\s+/g, " ").trim()`, expected = normalizedValueSource(args.value);
    const compare = args.assertion === 'text' ? `${actual} === ${expected}` : `${actual}.includes(${expected})`;
    return `await expect.poll(async () => (await ${target}.isVisible()) && (${compare})).toBe(true);`;
  }
  if (args.assertion === 'title') return `await expect.poll(async () => await page.title()).toBe(${valueSource(args.value)});`;
  if (args.assertion === 'url') {
    if (!parameterKey(args.value)) try { const url = new URL(args.value); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null; } catch { return null; }
    return `await expect.poll(() => page.url()).toBe(${valueSource(args.value)});`;
  }
  if (args.assertion === 'url_contains' && args.value) return `await expect.poll(() => page.url()).toContain(${valueSource(args.value)});`;
  return null;
}

/** Compile only a host's confirmed operation ledger. This pure renderer does
 * not establish execution, validate receipts or authorize browser interaction;
 * the caller must retain that provenance outside model-controlled JSON. */
export function compileRecordedProgram(requests: unknown, { layout = 'compact' }: { layout?: string } = {}) {
  if (!['compact', 'inline'].includes(layout)) return null;
  if (!Array.isArray(requests) || !requests.length || requests.length > MAX_OPERATIONS) return null;
  const lines = []; let assertionCount = 0;
  for (const request of requests) {
    if (!record(request) || typeof request.name !== 'string' || !record(request.arguments) || Object.entries(request.arguments).some(([key, value]) => key === 'frame' ? !validRecordedFramePath(value) : !bounded(value))) return null;
    const args = request.arguments; let source;
    if (request.name === 'browser_navigate') {
      if (Object.keys(args).length !== 1 || !Object.hasOwn(args, 'url')) return null;
      if(!parameterKey(args.url))try { const url = new URL(args.url); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null; } catch { return null; }
      source = `await page.goto(${valueSource(args.url)});`;
    } else if (actions.has(request.name)) {
      const field = request.name === 'browser_press_key' ? 'key' : ['browser_fill', 'browser_select_option'].includes(request.name) ? 'value' : null;
      if (Object.keys(args).length !== (field ? 2 : 1) + (Object.hasOwn(args, 'frame') ? 1 : 0) || !Object.hasOwn(args, 'locator') || field && !Object.hasOwn(args, field)) return null;
      const target = recordedLocatorSource(args.locator, args.frame);
      if (!target) return null;
      source = `await ${target}.${actions.get(request.name)}(${field ? valueSource(args[field]) : ''});`;
    } else if (request.name === 'browser_assert') {
      source = assertionSource(args); assertionCount++;
    } else return null;
    if (!source) return null;
    lines.push(source);
    if (layout === 'inline' && lines.join('\n').length > MAX_SOURCE) return null;
  }
  if (layout === 'compact') {
    // Native locators are lazy queries and safely re-resolve after rerenders.
    const counts = new Map<string, number>(), readerCounts = { native: 0, field: 0, inputType: 0 };
    for (const request of requests) {
      const target = request.arguments.locator && recordedLocatorSource(request.arguments.locator, request.arguments.frame);
      if (target) counts.set(target, (counts.get(target) || 0) + 1);
      if (request.name === 'browser_assert') {
        if (['valid', 'invalid'].includes(request.arguments.assertion)) readerCounts.native++;
        if (request.arguments.assertion === 'field_valid') readerCounts.field++;
        if (request.arguments.assertion === 'input_type') readerCounts.inputType++;
      }
    }
    const declarations: string[] = [], targets = new Map<string, string>(), readers: Record<string, string> = {};
    for (const [target, count] of counts) if (count > 1) {
      const name = `object${targets.size + 1}`;
      targets.set(target, name); declarations.push(`const ${name} = ${target};`);
    }
    for (const [kind, count] of Object.entries(readerCounts)) if (count > 1) {
      const name = kind === 'native' ? 'readNativeValidity' : kind === 'field' ? 'readFieldValidity' : 'readInputType';
      readers[kind] = name;
      declarations.push(`const ${name} = ${kind === 'native' ? nativeConstraintValiditySource : kind === 'field' ? fieldValidationStateSource : effectiveInputTypeSource};`);
    }
    for (const [index, request] of requests.entries()) {
      const target = targets.get(recordedLocatorSource(request.arguments.locator, request.arguments.frame) || '');
      if (request.name === 'browser_assert') lines[index] = assertionSource(request.arguments, { target, readers })!;
      else if (target && actions.has(request.name)) {
        const field = request.name === 'browser_press_key' ? 'key' : ['browser_fill', 'browser_select_option'].includes(request.name) ? 'value' : null;
        lines[index] = `await ${target}.${actions.get(request.name)}(${field ? valueSource(request.arguments[field]) : ''});`;
      }
    }
    lines.unshift(...declarations);
  }
  const source = lines.join('\n');
  if (source.length > MAX_SOURCE) return null;
  return { source, operation_count: requests.length, assertion_count: assertionCount };
}

