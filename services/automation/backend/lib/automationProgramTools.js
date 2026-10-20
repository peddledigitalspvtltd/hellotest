const { parse, parseExpressionAt } = require('acorn');
const { nativeConstraintValiditySource } = require('./automationNativeValidity');
const { fieldValidationStateSource, legacyFieldValidationStateSource } = require('./automationFieldValidity');
const { compileRecordedProgram, recordedLocatorSource } = require('./automationRecordedProgram');
const { normalizeParameterKey } = require('@hellotest/platform/backend/src/utils/stepParameterResolution');

const MAX_SOURCE = 64_000, MAX_NODES = 10_000, MAX_TOOLS = 12, MAX_STRING = 2_000;
const pages = new Set(['page', 'playwrightPage']);
const actions = new Map([
  ['click', 'browser_click'], ['fill', 'browser_fill'], ['press', 'browser_press_key'],
  ['selectOption', 'browser_select_option'], ['check', 'browser_check'],
  ['uncheck', 'browser_uncheck'], ['hover', 'browser_hover']
]);
const textLocators = new Set(['getByLabel', 'getByText', 'getByPlaceholder', 'getByTitle', 'getByAltText']);
const conditions = new Map([
  ['toBeVisible', ['visible', 'hidden']], ['toBeHidden', ['hidden', 'visible']],
  ['toBeEnabled', ['enabled', 'disabled']], ['toBeDisabled', ['disabled', 'enabled']],
  ['toBeChecked', ['checked', 'unchecked']]
]);
const valueConditions = new Map([['toHaveValue', 'value'], ['toHaveText', 'text_content'], ['toContainText', 'text_content_contains']]);
const member = node => node?.type === 'MemberExpression' && !node.computed && !node.optional
  && node.property?.type === 'Identifier' ? node.property.name : null;
const quoted = node => node?.type === 'Literal' && typeof node.value === 'string' && !node.regex ? node.value
  : node?.type === 'TemplateLiteral' && node.expressions.length === 0 ? node.quasis[0].value.cooked : null;
const bounded = value => typeof value === 'string' && value.length <= MAX_STRING;
const isPage = node => node?.type === 'Identifier' && pages.has(node.name);
const isCall = node => node?.type === 'CallExpression' && !node.optional;
const nativeSelector = value => bounded(value) && value.trim()
  && !/^(?:page\.|playwrightPage\.)?(?:getBy\w+|locator)\s*\(/.test(value.trim())
  && !/\.(?:(?:first|last)\(\s*\)|nth\(\s*\d+\s*\))$/.test(value.trim()) ? value : null;

// A parameter expression is a reference, not JS to execute or a value to copy
// into a tool request. The existing authorized resolver supplies its value.
function inputValue(node) {
  const value = quoted(node);
  if (bounded(value)) return value;
  if (node?.type !== 'MemberExpression' || node.optional || !node.computed || node.object?.name !== 'params') return null;
  const key = quoted(node.property);
  if (!bounded(key) || !/^@?[tsr]\..+/i.test(key) || /[\u0000-\u001f\u007f]/.test(key)
    || !key.replace(/^@?[tsr]\./i, '').trim()) return null;
  // Direct params access stores the normalized flat key; bracket syntax is
  // the portable reference spelling for names containing spaces, dots or ].
  // Keep this AST parser independent of resolver/database initialization;
  // this spelling matches the resolver's parameterReference contract.
  const normalized = normalizeParameterKey(key), name = normalized.slice(2);
  const reference = /^[a-z][a-z0-9_-]*$/i.test(name) ? `@${normalized}`
    : `@${normalized[0]}.[${name.replace(/\\/g, '\\\\').replace(/\]/g, '\\]')}]`;
  return bounded(reference) ? reference : null;
}

function locator(node, aliases) {
  if (node?.type === 'Identifier') return aliases.get(node.name) || null;
  if (!isCall(node) || !member(node.callee)) return null;
  const method = member(node.callee);
  if (['first', 'last', 'nth'].includes(method)) {
    const base = locator(node.callee.object, aliases);
    // Repository locator parsing permits one explicit suffix, never an
    // implicit first match or an arbitrary locator chain.
    if (!base || /\.(?:first|last|nth)\(/.test(base)) return null;
    if (method !== 'nth') return node.arguments.length === 0 ? `${base}.${method}()` : null;
    const index = node.arguments[0];
    return node.arguments.length === 1 && index?.type === 'Literal' && Number.isInteger(index.value)
      && index.value >= 0 && index.value <= 2_000 ? `${base}.nth(${index.value})` : null;
  }
  if (!isPage(node.callee.object) || node.arguments.length < 1 || node.arguments.length > 2) return null;
  const value = quoted(node.arguments[0]);
  if (!bounded(value) || !value.trim()) return null;
  if (method === 'locator') {
    // Native Playwright treats this argument as a selector. Encoded getBy
    // expressions require a source correction, not a guessed reinterpretation.
    return node.arguments.length === 1 ? nativeSelector(value) : null;
  }
  if (method === 'getByTestId') return node.arguments.length === 1 ? `getByTestId(${JSON.stringify(value)})` : null;
  if (method !== 'getByRole' && !textLocators.has(method)) return null;
  const options = new Map([['exact', false]]);
  if (node.arguments.length === 2) {
    const argument = node.arguments[1];
    if (argument?.type !== 'ObjectExpression') return null;
    const seen = new Set();
    for (const property of argument.properties) {
      const key = property.key?.name ?? property.key?.value;
      if (property.type !== 'Property' || property.computed || property.method || property.shorthand || seen.has(key)) return null;
      seen.add(key);
      if (key === 'name' && method === 'getByRole' && bounded(quoted(property.value))) options.set(key, quoted(property.value));
      else if (key === 'exact' && property.value?.type === 'Literal' && typeof property.value.value === 'boolean') options.set(key, property.value.value);
      else return null;
    }
  }
  // Native getBy matching defaults to false, while MCP's expression parser
  // defaults to true. Spell it out so lowering cannot narrow the locator.
  const rendered = { ...(options.has('name') ? { name: options.get('name') } : {}), exact: options.get('exact') };
  return `${method}(${JSON.stringify(value)}, ${JSON.stringify(rendered)})`;
}

function absoluteUrl(node) {
  const value = quoted(node);
  if (!bounded(value)) return null;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? value : null;
  } catch { return null; }
}

// A flagless regex made solely of literal characters is exactly a substring
// check. Decode escaped punctuation only; never compile model-authored regex
// or approximate anchors, flags, character classes or repetition.
function literalUrlPattern(node) {
  if (node?.type !== 'Literal' || !node.regex || node.regex.flags !== '') return null;
  const pattern = node.regex.pattern;
  if (!bounded(pattern) || !pattern) return null;
  let value = '';
  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index];
    if (char === '\\') {
      const escaped = pattern[++index];
      if (!escaped || !'^$\\.*+?()[]{}|/-'.includes(escaped)) return null;
      value += escaped;
    } else {
      if ('^$.*+?()[]{}|'.includes(char) || /[\r\n\u2028\u2029]/.test(char)) return null;
      value += char;
    }
  }
  return value || null;
}

function assertion(call, aliases) {
  const matcher = member(call.callee);
  if (!matcher) return null;
  let expectation = call.callee.object, negated = false;
  if (member(expectation) === 'not') { negated = true; expectation = expectation.object; }
  if (!isCall(expectation) || expectation.callee?.type !== 'Identifier' || expectation.callee.name !== 'expect'
    || expectation.arguments.length !== 1) return null;
  const target = expectation.arguments[0];
  if (matcher === 'toHaveURL' || matcher === 'toHaveTitle') {
    if (negated || !isPage(target) || call.arguments.length !== 1) return null;
    if (matcher === 'toHaveURL' && call.arguments[0]?.regex) {
      const value = literalUrlPattern(call.arguments[0]);
      return value === null ? null : { name: 'browser_assert', arguments: { assertion: 'url_contains', value } };
    }
    const value = matcher === 'toHaveURL' ? absoluteUrl(call.arguments[0]) : inputValue(call.arguments[0]);
    if (value === null) return null;
    return { name: 'browser_assert', arguments: { assertion: matcher === 'toHaveURL' ? 'url' : 'title_normalized',
      // Playwright resolves a literal absolute URL before its exact check.
      value: matcher === 'toHaveURL' ? new URL(value).href : value } };
  }
  const targetLocator = locator(target, aliases);
  if (!targetLocator || targetLocator.length > MAX_STRING) return null;
  const condition = conditions.get(matcher);
  if (condition) return call.arguments.length === 0
    ? { name: 'browser_assert', arguments: { assertion: condition[negated ? 1 : 0], locator: targetLocator } } : null;
  if (negated || call.arguments.length !== 1) return null;
  if (matcher === 'toHaveCount') {
    const count = call.arguments[0];
    return count?.type === 'Literal' && Number.isInteger(count.value) && count.value >= 0 && count.value <= 2_000
      ? { name: 'browser_assert', arguments: { assertion: 'count', locator: targetLocator, value: String(count.value) } } : null;
  }
  const valueCondition = valueConditions.get(matcher), value = inputValue(call.arguments[0]);
  return valueCondition && value !== null
    ? { name: 'browser_assert', arguments: { assertion: valueCondition, locator: targetLocator, value } } : null;
}

// A synchronous equality check of a fully awaited inputValue is exactly the
// same string comparison as the existing MCP value assertion. Do not coerce
// numeric/boolean/null expectations, weaken polarity or approximate text/URL
// matcher semantics.
function inputValueAssertion(call,aliases){
  if(!isCall(call)||!['toBe','toEqual','toStrictEqual'].includes(member(call.callee))||call.arguments.length!==1)return null;
  const expectation=call.callee.object;
  if(!isCall(expectation)||expectation.callee?.name!=='expect'||expectation.arguments.length!==1)return null;
  const awaited=expectation.arguments[0];
  const reader=awaited?.type==='AwaitExpression'?awaited.argument:null;
  if(!isCall(reader)||member(reader.callee)!=='inputValue'||reader.arguments.length)return null;
  const target=locator(reader.callee.object,aliases),value=inputValue(call.arguments[0]);
  return target&&value!==null?{name:'browser_assert',arguments:{assertion:'value',locator:target,value}}:null;
}

const stableSyntax = value => Array.isArray(value) ? value.map(stableSyntax) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).filter(([key]) => !['start', 'end', 'loc', 'raw'].includes(key)).map(([key, item]) => [key, stableSyntax(item)])) : value;
const nativeValidityReaderSyntax = JSON.stringify(stableSyntax(parseExpressionAt(nativeConstraintValiditySource, 0, { ecmaVersion: 'latest' })));
const fieldValidityReaderSyntax = JSON.stringify(stableSyntax(parseExpressionAt(fieldValidationStateSource, 0, { ecmaVersion: 'latest' })));
const legacyFieldValidityReaderSyntax = JSON.stringify(stableSyntax(parseExpressionAt(legacyFieldValidationStateSource, 0, { ecmaVersion: 'latest' })));

/** Recover only exact output of the host compiler. Candidate extraction is not
 * authority: recompilation must reproduce the entire assertion AST, including
 * its visible-text read, normalization, polling shape and matcher. No callback
 * is executed, and arbitrary evaluate/poll JavaScript remains unsupported. */
function expandRecordedAliases(node, aliases) {
  if (Array.isArray(node)) return node.map(value => expandRecordedAliases(value, aliases));
  if (!node || typeof node !== 'object') return node;
  if (node.type === 'Identifier' && aliases.has(node.name)) {
    const source = recordedLocatorSource(aliases.get(node.name));
    if (source) return stableSyntax(parseExpressionAt(source, 0, { ecmaVersion: 'latest' }));
  }
  return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, expandRecordedAliases(value, aliases)]));
}

function recordedAssertion(call, aliases) {
  if (!isCall(call)) return null;
  const recordedValue = node => {
    const value = inputValue(node);
    return value && node?.type === 'MemberExpression' && node.object?.name === 'params'
      ? `params[${JSON.stringify(normalizeParameterKey(value))}]` : value;
  };
  const exact = operation => {
    const compiled = compileRecordedProgram([operation], { layout: 'inline' });
    if (!compiled) return null;
    const statement = parse(compiled.source, { ecmaVersion: 'latest', sourceType: 'module', allowAwaitOutsideFunction: true }).body[0];
    return JSON.stringify(stableSyntax(statement?.expression?.argument)) === JSON.stringify(stableSyntax(expandRecordedAliases(call, aliases))) ? operation : null;
  };
  const matcher = member(call.callee), expectation = call.callee?.object;
  if (!isCall(expectation) || call.arguments.length !== 1) return null;
  if (matcher === 'toHaveCount' && expectation.callee?.name === 'expect' && expectation.arguments.length === 1) {
    const number = call.arguments[0], value = isCall(number) && number.callee?.name === 'Number' && number.arguments.length === 1 ? inputValue(number.arguments[0]) : null;
    const target = locator(expectation.arguments[0], aliases);
    return target && value && value.startsWith('@') ? exact({ name: 'browser_assert', arguments: { assertion: 'count', locator: target, value } }) : null;
  }
  if (member(expectation.callee) !== 'poll' || expectation.callee.object?.name !== 'expect' || expectation.arguments.length !== 1) return null;
  const callback = expectation.arguments[0];
  if (callback?.type !== 'ArrowFunctionExpression' || callback.params.length || callback.generator) return null;
  let read = callback.body;
  if (read?.type === 'AwaitExpression') read = read.argument;
  if (isCall(read) && isPage(read.callee?.object) && read.arguments.length === 0) {
    const property = member(read.callee), value = recordedValue(call.arguments[0]);
    const assertion = property === 'url' ? matcher === 'toBe' ? 'url' : matcher === 'toContain' ? 'url_contains' : null
      : property === 'title' && matcher === 'toBe' ? 'title' : null;
    return assertion && value !== null ? exact({ name: 'browser_assert', arguments: { assertion, value } }) : null;
  }
  if (matcher !== 'toBe' || call.arguments[0]?.type !== 'Literal' || call.arguments[0].value !== true
    || callback.body?.type !== 'LogicalExpression' || callback.body.operator !== '&&') return null;
  const comparison = callback.body.right;
  const assertion = comparison?.type === 'BinaryExpression' && comparison.operator === '===' ? 'text'
    : isCall(comparison) && member(comparison.callee) === 'includes' && comparison.arguments.length === 1 ? 'text_contains' : null;
  if (!assertion) return null;
  const expected = assertion === 'text' ? comparison.right : comparison.arguments[0];
  let value = inputValue(expected);
  if (value === null) {
    // Normalized scoped values compile as String(params[key]).replace(...).
    // Locate the candidate binding, then let exact recompilation prove every
    // wrapper and option; additional expressions cannot survive that check.
    const pending = [expected], refs = [];
    while (pending.length) {
      const node = pending.pop();
      if (!node || typeof node !== 'object') continue;
      if (node.type === 'MemberExpression' && node.computed && node.object?.name === 'params') {
        const ref = inputValue(node); if (ref) refs.push(ref);
      }
      for (const item of Object.values(node)) if (Array.isArray(item)) pending.push(...item); else if (item && typeof item === 'object') pending.push(item);
    }
    if (refs.length === 1) value = refs[0];
  }
  if (value === null) return null;
  const pending = [callback.body], targets = [];
  while (pending.length) {
    const node = pending.pop();
    if (!node || typeof node !== 'object') continue;
    if (isCall(node) && member(node.callee) === 'innerText' && node.arguments.length === 0) targets.push(locator(node.callee.object, aliases));
    for (const item of Object.values(node)) if (Array.isArray(item)) pending.push(...item); else if (item && typeof item === 'object') pending.push(item);
  }
  return targets.length === 1 && targets[0] ? exact({ name: 'browser_assert', arguments: { assertion, locator: targets[0], value } }) : null;
}
/** Recognize only the compiler's exact read-only poll. No arbitrary evaluate
 * callback, validation method, changed polarity, option or extra argument can
 * be lowered into a claimed native-validity operation. */
function nativeValidityAssertion(call, aliases, readers = new Map()) {
  if (!isCall(call) || member(call.callee) !== 'toBe' || call.arguments.length !== 1
    || call.arguments[0]?.type !== 'Literal' || typeof call.arguments[0].value !== 'boolean') return null;
  const poll = call.callee.object;
  if (!isCall(poll) || member(poll.callee) !== 'poll' || poll.callee.object?.type !== 'Identifier' || poll.callee.object.name !== 'expect' || poll.arguments.length !== 2) return null;
  const options = poll.arguments[1];
  if (options?.type !== 'ObjectExpression' || options.properties.length !== 1) return null;
  const timeout = options.properties[0];
  if (timeout.type !== 'Property' || timeout.computed || timeout.method || timeout.shorthand || (timeout.key?.name ?? timeout.key?.value) !== 'timeout'
    || timeout.value?.type !== 'Literal' || timeout.value.value !== 8000) return null;
  const callback = poll.arguments[0];
  if (callback?.type !== 'ArrowFunctionExpression' || callback.async || callback.params.length) return null;
  const read = callback.body;
  if (!isCall(read) || member(read.callee) !== 'evaluate' || read.arguments.length !== 1) return null;
  const reader = read.arguments[0]?.type === 'Identifier' ? readers.get(read.arguments[0].name) : read.arguments[0];
  const syntax = JSON.stringify(stableSyntax(reader));
  const assertion = syntax === nativeValidityReaderSyntax ? call.arguments[0].value ? 'valid' : 'invalid'
    : [fieldValidityReaderSyntax, legacyFieldValidityReaderSyntax].includes(syntax) && call.arguments[0].value === true ? 'field_valid' : null;
  if (!assertion) return null;
  const target = locator(read.callee.object, aliases);
  return target ? { name: 'browser_assert', arguments: { assertion, locator: target } } : null;
}

function visibilityWaitCondition(call,aliases=new Map(),{allowCustomTimeout=false}={}){
  if(!isCall(call))return null;
  const method=member(call.callee),page=isPage(call.callee?.object);
  const target=page&&method==='waitForSelector'?nativeSelector(quoted(call.arguments[0])):method==='waitFor'?locator(call.callee.object,aliases):null;
  const options=call.arguments.slice(page&&method==='waitForSelector'?1:0);
  if(!target||options.length>1)return null;
  let state='visible';
  if(options.length){
    if(options[0]?.type!=='ObjectExpression')return null;
    const seen=new Set();
    for(const property of options[0].properties){
      const key=property.key?.name??property.key?.value;
      if(property.type!=='Property'||property.computed||property.method||property.shorthand||seen.has(key))return null;seen.add(key);
      if(key==='state'&&['visible','hidden'].includes(quoted(property.value)))state=quoted(property.value);
      // Existing MCP assertions use the runner's timeout. Never discard a
      // model's explicit wait deadline when deriving executable tool calls.
      // Source inspection may still recognize the real native check when
      // the agent observes it through explicit typed tools instead.
      else if(key==='timeout'&&allowCustomTimeout&&property.value?.type==='Literal'&&Number.isFinite(property.value.value)&&property.value.value>0&&property.value.value<=60000)continue;
      else return null;
    }
  }
  return {name:'browser_assert',arguments:{assertion:state,locator:target}};
}

/** Lower only a complete, bounded linear section into typed MCP calls. Parsing
 * does not execute model JavaScript, resolve credentials, grant browser access
 * or manufacture execution evidence. Any unsupported statement rejects all. */
function deriveLinearProgramTools({ payload, execution } = {},{allowCustomTimeout=false}={}) {
  if (!execution || !Object.hasOwn(execution, 'required') || !Object.hasOwn(execution, 'step_id')
    || execution.required !== true || typeof execution.step_id !== 'string' || !execution.step_id
    || !Array.isArray(payload?.steps)) return null;
  const candidates = payload.steps.filter(step => (step?.step_id || step?.id) === execution.step_id);
  if (candidates.length !== 1 || candidates[0].step_type && candidates[0].step_type !== 'web') return null;
  const source = candidates[0].automation_code;
  if (typeof source !== 'string' || !source.trim() || source.length > MAX_SOURCE) return null;
  let tree;
  try { tree = parse(source, { ecmaVersion: 'latest', sourceType: 'module', allowAwaitOutsideFunction: true }); }
  catch { return null; }
  const pending = [tree]; let nodes = 0;
  while (pending.length) {
    const node = pending.pop();
    if (++nodes > MAX_NODES) return null;
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const child of value) if (child && typeof child === 'object') pending.push(child);
      } else if (value && typeof value === 'object') pending.push(value);
    }
  }
  const aliases = new Map(), readers = new Map(), tools = []; let navigationReady = false;
  for (const statement of tree.body) {
    if (statement.type === 'EmptyStatement') continue;
    if (statement.type === 'VariableDeclaration') {
      if (statement.kind !== 'const') return null;
      for (const declaration of statement.declarations) {
        const name = declaration.id?.name;
        if (declaration.id?.type !== 'Identifier' || pages.has(name) || ['expect', 'params'].includes(name) || aliases.has(name) || readers.has(name)) return null;
        const readerSyntax = JSON.stringify(stableSyntax(declaration.init));
        if ([nativeValidityReaderSyntax, fieldValidityReaderSyntax].includes(readerSyntax)) {
          readers.set(name, declaration.init); continue;
        }
        const target = locator(declaration.init, aliases);
        if (!target || target.length > MAX_STRING) return null;
        aliases.set(name, target);
      }
      continue;
    }
    if(statement.type==='ExpressionStatement'&&statement.expression?.type!=='AwaitExpression'){
      const tool=inputValueAssertion(statement.expression,aliases);
      if(!tool||Object.values(tool.arguments).some(value=>!bounded(value)))return null;
      tools.push(tool);if(tools.length>MAX_TOOLS)return null;continue;
    }
    if (statement.type !== 'ExpressionStatement' || statement.expression?.type !== 'AwaitExpression') return null;
    const call = statement.expression.argument;
    if (!isCall(call) || !member(call.callee)) return null;
    const method = member(call.callee), page = isPage(call.callee.object);
    if (page && method === 'waitForLoadState') {
      const state = call.arguments.length ? quoted(call.arguments[0]) : 'load';
      // browser_navigate itself guarantees load plus bounded DOM readiness.
      // Only this dominated load check is redundant; networkidle, standalone
      // waits, timeouts and arbitrary waiting code are never discarded.
      if (!navigationReady || call.arguments.length > 1 || !['load', 'domcontentloaded'].includes(state)) return null;
      continue;
    }
    let tool;
    if (page && method === 'goto') {
      const url = absoluteUrl(call.arguments[0]);
      if (call.arguments.length !== 1 || url === null) return null;
      tool = { name: 'browser_navigate', arguments: { url } }; navigationReady = true;
    } else if (actions.has(method)) {
      const target = page ? nativeSelector(quoted(call.arguments[0])) : locator(call.callee.object, aliases);
      const values = call.arguments.slice(page ? 1 : 0), hasValue = ['fill', 'press', 'selectOption'].includes(method);
      if (!bounded(target) || !target.trim() || values.length !== (hasValue ? 1 : 0)) return null;
      const value = hasValue ? inputValue(values[0]) : null;
      if (hasValue && value === null) return null;
      tool = { name: actions.get(method), arguments: { locator: target,
        ...(hasValue ? { [method === 'press' ? 'key' : 'value']: value } : {}) } }; navigationReady = false;
    } else tool = nativeValidityAssertion(call,aliases,readers)||recordedAssertion(call,aliases)||visibilityWaitCondition(call,aliases,{allowCustomTimeout})||assertion(call, aliases);
    if (!tool || Object.values(tool.arguments).some(value => !bounded(value))) return null;
    tools.push(tool); if (tools.length > MAX_TOOLS) return null;
  }
  return tools.length ? tools : null;
}

function deriveProgramTools(input){return deriveLinearProgramTools(input);}

// Inspection returns only a boolean. Execution lowering can never receive a
// tool list that silently discarded an explicit source wait deadline.
function hasLinearProgramAssertion(input){
  return !!deriveLinearProgramTools(input,{allowCustomTimeout:true})?.some(tool=>tool.name==='browser_assert');
}

/** Explain a rejected source without echoing its code, selectors or values.
 * This is correction feedback only and never relaxes atomic lowering. */
function explainProgramToolsUnsupported(input) {
  if (deriveProgramTools(input)) return null;
  const { payload, execution } = input || {};
  if (!execution || !Object.hasOwn(execution, 'required') || !Object.hasOwn(execution, 'step_id') || execution.required !== true
    || !Array.isArray(payload?.steps)) return null;
  const candidates = payload.steps.filter(step => (step?.step_id || step?.id) === execution.step_id);
  if (candidates.length !== 1) return null;
  const source = candidates[0]?.automation_code;
  if (typeof source !== 'string' || !source.trim()) return null;
  const issue = (code, message) => ({ code, message });
  if (source.length > MAX_SOURCE) return issue('source_limit', 'The current section exceeds the supported source size. Split it into smaller linear sections.');
  let tree;
  try { tree = parse(source, { ecmaVersion: 'latest', sourceType: 'module', allowAwaitOutsideFunction: true }); }
  catch { return issue('source_syntax', 'Correct the current section JavaScript syntax before requesting browser execution.'); }
  const pending = [tree]; let nodes = 0;
  while (pending.length) {
    const node = pending.pop();
    if (++nodes > MAX_NODES) return issue('source_limit', 'The current section exceeds the supported syntax size. Split it into smaller linear sections.');
    if (['IfStatement', 'ForStatement', 'ForInStatement', 'ForOfStatement', 'WhileStatement', 'DoWhileStatement', 'SwitchStatement', 'TryStatement', 'ConditionalExpression', 'FunctionExpression', 'ArrowFunctionExpression', 'FunctionDeclaration'].includes(node.type)) {
      return issue('unsupported_control_flow', 'Source-derived browser execution supports a linear sequence of awaited actions and assertions. Use explicit typed browser tools for conditional, looping or callback behavior.');
    }
    if (isCall(node)) {
      const method = member(node.callee);
      if(['waitFor','waitForSelector'].includes(method)&&node.arguments.some(argument=>argument?.type==='ObjectExpression'&&argument.properties.some(property=>(property.key?.name??property.key?.value)==='timeout'))){
        return issue('unsupported_wait_timeout','A custom native wait timeout cannot be represented faithfully by source-derived browser tools. The MCP runner applies its own assertion timeout.');
      }
      if (method === 'toHaveURL' && node.arguments[0]?.regex && literalUrlPattern(node.arguments[0]) === null) {
        return issue('unsupported_url_regex', 'The URL assertion uses unsupported regex behavior. Use a literal absolute URL, a flagless regex containing literal characters only, or explicit typed browser tools. Preserve every expected-result check.');
      }
      if ((actions.has(method) && node.arguments.length > (isPage(node.callee.object) ? 1 : 0) + (['fill', 'press', 'selectOption'].includes(method) ? 1 : 0))
        || method?.startsWith('getBy') && node.arguments[1]?.type === 'ObjectExpression' && node.arguments[1].properties.some(property => !['name', 'exact'].includes(property.key?.name ?? property.key?.value))) {
        return issue('unsupported_locator_options', 'Source-derived browser execution does not support these action or locator options. Use supported unique native locators and simple awaited actions, or explicit typed browser tools without discarding the intended behavior.');
      }
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const child of value) if (child && typeof child === 'object') pending.push(child);
      }
      else if (value && typeof value === 'object') pending.push(value);
    }
  }
  return issue('unsupported_program', 'The current source cannot be translated completely into supported browser tools. Use simple awaited native Playwright actions and assertions or explicit typed browser tools; no action or assertion was executed from this source.');
}

module.exports = { deriveProgramTools, explainProgramToolsUnsupported, visibilityWaitCondition, hasLinearProgramAssertion };
