const { createHash } = require('node:crypto');
const { parse, parseExpressionAt } = require('acorn');
const { browserReceipt } = require('./automationInteractiveEvidence');
const { deriveProgramTools } = require('./automationProgramTools');
const { normalizeParameterKey } = require('@hellotest/platform/backend/src/utils/stepParameterResolution');

// Host-only proof survives in-memory history, never JSON, spread, model output
// or a later activity. Hash the original request, before public value redaction.
const requestStamp = Symbol('automation.executedRequest');
const pageTransitions=new WeakSet();
const tools = {
  browser_navigate: ['url'],
  browser_click: ['locator'], browser_fill: ['locator', 'value'], browser_press_key: ['key', 'locator'],
  browser_select_option: ['locator', 'value'], browser_check: ['locator'], browser_uncheck: ['locator'], browser_hover: ['locator']
};
const methods = { click: 'browser_click', fill: 'browser_fill', press: 'browser_press_key', selectOption: 'browser_select_option',
  check: 'browser_check', uncheck: 'browser_uncheck', hover: 'browser_hover' };
const textLocators = new Set(['getByLabel', 'getByPlaceholder', 'getByText', 'getByTitle', 'getByAltText']);
const readMethods = new Set(['inputValue', 'textContent', 'innerText', 'getAttribute', 'isVisible', 'isHidden', 'isEnabled', 'isDisabled', 'isChecked', 'count', 'title', 'url']);
const expectationMethods = new Set(['soft', 'objectContaining', 'stringContaining', 'stringMatching', 'arrayContaining', 'any', 'anything', 'closeTo',
  'toBe', 'toEqual', 'toStrictEqual', 'toBeTruthy', 'toBeFalsy', 'toBeNull', 'toBeUndefined', 'toBeDefined', 'toBeNaN', 'toBeInstanceOf',
  'toBeGreaterThan', 'toBeGreaterThanOrEqual', 'toBeLessThan', 'toBeLessThanOrEqual', 'toBeCloseTo', 'toContain', 'toContainEqual', 'toMatch', 'toMatchObject',
  'toHaveLength', 'toHaveProperty', 'toThrow', 'toThrowError', 'toBeVisible', 'toBeHidden', 'toBeEnabled', 'toBeDisabled', 'toBeChecked', 'toBeAttached',
  'toHaveText', 'toContainText', 'toHaveURL', 'toHaveTitle', 'toHaveAttribute', 'toHaveCount', 'toHaveValue', 'toHaveValues', 'toHaveClass', 'toHaveCSS', 'toHaveJSProperty']);
const member = node => node?.type === 'MemberExpression' && !node.computed ? node.property.name : null;
const string = node => node?.type === 'Literal' && typeof node.value === 'string' ? node.value
  : node?.type === 'TemplateLiteral' && node.expressions.length === 0 ? node.quasis[0].value.cooked : null;
const hash = value => createHash('sha256').update(value).digest('hex');
const own = (record, key) => typeof key === 'string' && Object.hasOwn(record, key) ? record[key] : undefined;

function actionValueIdentity(value){
  // References name a normalized scoped binding. Literal inputs retain every
  // byte; neither embedded tokens nor executable-looking strings are aliases.
  if(typeof value==='string'&&/^@[tsr]\.(?:[A-Za-z][A-Za-z0-9_-]*|\[(?:\\.|[^\]\\\r\n])+\])$/i.test(value)){
    const key=normalizeParameterKey(value);
    if(key)return ['scoped_parameter',key];
  }
  return value;
}

function requestSignature(request) {
  const keys = own(tools, request?.name), args = request?.arguments;
  if (!keys || !args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).length !== keys.length
    || keys.some(key => !Object.hasOwn(args, key) || typeof args[key] !== 'string' || args[key].length > 2000)) return null;
  const canonical = keys.map(key => [key, key === 'url' ? navigationUrlIdentity(args[key])
    : key === 'locator' ? requestedLocator(args[key]) : actionValueIdentity(args[key])]);
  if (canonical.some(([, value]) => value === null)) return null;
  return hash(JSON.stringify([request.name, canonical]));
}

function stampObservation(observation, request, {pageTransition=false,bootstrap=false}={}) {
  const signature = requestSignature(request);
  if (!signature || !observation || observation.tool !== request.name || observation.mcp_call === false || observation[requestStamp]) return observation;
  // This function is called only on the actual browser.call observation, never
  // model feedback. Receipt text cannot assert an original-request signature.
  const action = requestActionKey(request);
  const original = hash(JSON.stringify([request.name, tools[request.name].map(key => [key, request.arguments[key]])]));
  Object.defineProperty(observation, requestStamp, { value: Object.freeze({ signature, original, action: action ? hash(action) : null,
    page_transition:pageTransition===true,bootstrap:bootstrap===true }), enumerable: false });
  return observation;
}
function markPageTransition(observation){if(observation?.[requestStamp]&&browserReceipt(observation)?.action_outcome==='completed')pageTransitions.add(observation);}
function isNavigationPrerequisite(observation){const stamp=observation?.[requestStamp];return Boolean(stamp?.action&&!stamp.bootstrap&&browserReceipt(observation)?.action_outcome==='completed'&&(observation.tool==='browser_navigate'||stamp.page_transition||pageTransitions.has(observation)));}

function locatorCall(node, aliases, requestDefaults = false) {
  if (node?.type === 'Identifier') return aliases.get(node.name) || null;
  if (node?.type !== 'CallExpression' || node.optional || node.callee?.type !== 'MemberExpression'
    || !['page', 'playwrightPage'].includes(node.callee.object?.name)) return null;
  const method = member(node.callee), value = string(node.arguments[0]);
  if (value === null || node.arguments.length < 1 || node.arguments.length > 2) return null;
  if (method === 'locator') return node.arguments.length === 1 ? ['css', value.trim()] : null;
  if (method === 'getByTestId') return node.arguments.length === 1 ? [method, value] : null;
  if (method !== 'getByRole' && !textLocators.has(method)) return null;
  const options = { exact: requestDefaults };
  if (node.arguments.length === 2) {
    const object = node.arguments[1];
    if (object.type !== 'ObjectExpression') return null;
    const seen = new Set();
    for (const property of object.properties) {
      const key = property.key?.name ?? property.key?.value;
      if (property.type !== 'Property' || property.computed || property.method || property.shorthand || seen.has(key)) return null;
      seen.add(key);
      if (key === 'name' && method === 'getByRole' && string(property.value) !== null) options.name = string(property.value);
      else if (key === 'exact' && property.value?.type === 'Literal' && typeof property.value.value === 'boolean') options.exact = property.value.value;
      else return null;
    }
  }
  return method === 'getByRole' ? [method, value, options.name ?? null, options.name === undefined ? null : options.exact]
    : [method, value, options.exact];
}

function requestedLocator(value) {
  const source = value.trim();
  const indexed = source.match(/\.(first\(\s*\)|last\(\s*\)|nth\(\s*(\d+)\s*\))$/);
  if (indexed) {
    const base = source.slice(0, indexed.index);
    if (/\.(?:first|last|nth)\(/.test(base)) return null;
    const target = requestedLocator(base), index = indexed[2] === undefined ? null : Number(indexed[2]);
    if (!target || index !== null && (!Number.isSafeInteger(index) || index > 2000)) return null;
    return ['index', target, indexed[1].startsWith('last') ? 'last' : 'nth', index ?? (indexed[1].startsWith('first') ? 0 : null)];
  }
  if (/^(?:page\.)?(?:locator|getBy\w+)\s*\(/.test(source)) {
    const expression = source.startsWith('page.') ? source : `page.${source}`;
    try {
      const node = parseExpressionAt(expression, 0, { ecmaVersion: 'latest' });
      return node.end === expression.length ? locatorCall(node, new Map(), true) : null;
    } catch { return null; }
  }
  const role = source.match(/^role=([^\[\]]+)(?:\[name=(["'])(.*?)\2\])?$/);
  if (role) return ['getByRole', role[1].trim(), role[3] ?? null, role[3] === undefined ? null : true];
  // Other semantic encodings, indices, repository field references and chained
  // selectors require their own runtime semantics; never guess equivalence.
  if (/^(?:text|label|placeholder|title|alt|alttext|testid|data-testid)=/.test(source) || /\.\w+\(/.test(source)) return null;
  return source ? ['css', source] : null;
}

function actionKey(tool, target, value) { return JSON.stringify([tool, target, actionValueIdentity(value) ?? null]); }
function callRoot(node) {
  while (node?.type === 'CallExpression' || node?.type === 'MemberExpression') node = node.type === 'CallExpression' ? node.callee : node.object;
  return node?.name;
}
function requestActionKey(request) {
  if (request.name === 'browser_navigate') { const url = navigationUrlIdentity(request.arguments.url); return url ? actionKey(request.name, ['url', url]) : null; }
  const target = requestedLocator(request.arguments.locator);
  return target ? actionKey(request.name, target, request.arguments.value ?? request.arguments.key) : null;
}

function literalUrl(value) {
  if (typeof value !== 'string' || !value || value.length > 2000) return null;
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}

function navigationUrlIdentity(value){
  const reference=actionValueIdentity(value);
  return Array.isArray(reference)?reference:literalUrl(value);
}

function candidateActions(source) {
  if (typeof source !== 'string' || !source.trim() || source.length > 64000) return null;
  let tree;
  try { tree = parse(source, { ecmaVersion: 'latest', sourceType: 'module', allowAwaitOutsideFunction: true }); }
  catch { return null; }
  const aliases = new Map(), actions = [];
  let nodes = 0, unsafe = false;
  const inspect = node => {
    if (!node || typeof node !== 'object' || unsafe) return;
    if (++nodes > 10000 || /(?:Statement|Declaration)$/.test(node.type || '') && !['ExpressionStatement', 'VariableDeclaration', 'EmptyStatement'].includes(node.type)
      || ['ConditionalExpression', 'LogicalExpression', 'AssignmentExpression', 'UpdateExpression', 'FunctionExpression', 'ArrowFunctionExpression', 'SpreadElement', 'ChainExpression'].includes(node.type)) { unsafe = true; return; }
    for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(inspect); else if (value && typeof value === 'object') inspect(value);
  };
  inspect(tree);
  if (unsafe) return null;
  for (const statement of tree.body) {
    if (statement.type === 'EmptyStatement') continue;
    if (statement.type === 'VariableDeclaration') {
      if (statement.kind !== 'const') return null;
      for (const declaration of statement.declarations) {
        if (declaration.id.type !== 'Identifier' || ['page', 'playwrightPage'].includes(declaration.id.name) || aliases.has(declaration.id.name)) return null;
        const target = locatorCall(declaration.init, aliases);
        if (!target) return null;
        aliases.set(declaration.id.name, target);
      }
      continue;
    }
    if (statement.type !== 'ExpressionStatement') return null;
    const expression = statement.expression, call = expression.type === 'AwaitExpression' ? expression.argument : expression;
    if (call?.type !== 'CallExpression' || call.callee?.type !== 'MemberExpression') return null;
    const method = member(call.callee), tool = own(methods, method);
    if (tool) {
      if (expression.type !== 'AwaitExpression') return null;
      const directPage = ['page', 'playwrightPage'].includes(call.callee.object?.name);
      const target = directPage ? requestedLocator(string(call.arguments[0]) ?? '') : locatorCall(call.callee.object, aliases);
      const argumentsForAction = call.arguments.slice(directPage ? 1 : 0);
      const needsValue = ['fill', 'press', 'selectOption'].includes(method);
      if (!target || argumentsForAction.length !== (needsValue ? 1 : 0) || needsValue && string(argumentsForAction[0]) === null) return null;
      actions.push(actionKey(tool, target, needsValue ? string(argumentsForAction[0]) : undefined));
      if (actions.length > 250) return null;
    } else {
      // Only ordinary expectation chains may accompany these linear actions.
      // Reject hidden actions inside assertions or arbitrary helper calls.
      if (callRoot(call.callee) !== 'expect' || !/^to[A-Z]/.test(method || '')) return null;
      let unsupported = false;
      const scan = node => {
        if (!node || typeof node !== 'object') return;
        if (node.type === 'CallExpression') {
          const name = member(node.callee), root = callRoot(node.callee);
          const expectation = node.callee?.type === 'Identifier' && node.callee.name === 'expect'
            || root === 'expect' && expectationMethods.has(name);
          const locator = locatorCall(node, aliases);
          const read = readMethods.has(name) && (['page', 'playwrightPage'].includes(node.callee?.object?.name) || locatorCall(node.callee?.object, aliases));
          if (!expectation && !locator && !read) unsupported = true;
        }
        for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(scan); else if (value && typeof value === 'object') scan(value);
      };
      scan(call);
      if (unsupported) return null;
    }
  }
  return actions;
}

function currentCandidate(payload, execution) {
  // Use the same complete, bounded native-source contract as the fallback
  // executor. Dominated load waits, parameter expressions and explicit
  // locator indices retain exactly the semantics used to issue MCP requests.
  const derived = deriveProgramTools({ payload, execution });
  if (derived) {
    const actions = derived.filter(request => request.name !== 'browser_assert').map(requestActionKey);
    return actions.every(Boolean) ? actions : null;
  }
  const candidates = (Array.isArray(payload?.steps) ? payload.steps : []).filter(step => (step?.step_id || step?.id) === execution.step_id);
  return candidates.length === 1 ? candidateActions(candidates[0].automation_code) : null;
}

function freshProofs(actions, execution, observations) {
  const keys = new Set(actions.map(hash)), proofs = [], seen = new Set();
  for (const observation of observations) {
    if (!observation || typeof observation !== 'object') continue;
    const receipt = browserReceipt(observation), stamp = observation[requestStamp];
    // A failed mutation may have reached the application even though there is
    // no successful receipt. Earlier successes cannot establish the state
    // after that uncertainty. Only the original host dispatch plus an explicit
    // native pre-dispatch rejection proves that the old state was untouched.
    if (own(tools, observation.tool) && observation.mcp_call !== false && observation.result?.isError) {
      let notAttempted = false;
      if (stamp) for (const part of observation.result.content || []) {
        if (part?.type !== 'text' || typeof part.text !== 'string' || part.text.length > 64 * 1024) continue;
        try {
          const fault = JSON.parse(part.text);
          if (fault?.source === 'playwright' && fault.action_outcome === 'not_attempted' && fault.retry_safe === true) notAttempted = true;
        } catch {}
      }
      if (!notAttempted || observation.tool === 'browser_navigate') proofs.length = 0;
      continue;
    }
    if (receipt?.action_outcome !== 'completed') continue;
    const mutation = own(tools, observation.tool);
    let expected = 0;
    if (observation.tool === 'browser_navigate') for (const proof of proofs) if (expected < actions.length && proof.action === hash(actions[expected])) expected++;
    const plannedNavigation = observation.tool === 'browser_navigate' && stamp?.action && observation.execution_step_id === execution.step_id
      && actions[expected] && hash(actions[expected]) === stamp.action;
    if (observation.tool === 'browser_navigate' && !plannedNavigation
      || /^browser_(?:close|reset|context_reset|new_context|open_tab|close_tab|switch_tab)$/.test(observation.tool)
      || mutation && (observation.execution_step_id !== execution.step_id || !stamp?.action || !keys.has(stamp.action))) {
      proofs.length = 0;
    }
    if (!mutation || !stamp?.action || observation.execution_step_id !== execution.step_id || observation.mcp_call === false
      || typeof observation.action_id !== 'string' || !observation.action_id || observation.action_id.length > 200 || seen.has(observation.action_id)) continue;
    seen.add(observation.action_id);
    proofs.push({ action: stamp.action, signature: stamp.signature, action_id: observation.action_id });
  }
  return proofs;
}

const eligible = (execution, observations) => execution?.required === true && typeof execution.step_id === 'string' && execution.step_id
  && Array.isArray(observations) && observations.length <= 2000;

function alignActions(actions, proofs) {
  const missing = {}, missingKeys = new Set();
  let cursor = 0, missingCount = 0;
  for (const action of actions) {
    const key = hash(action);
    let found = -1;
    for (let index = cursor; index < proofs.length; index++) if (proofs[index].action === key) { found = index; break; }
    if (found >= 0) cursor = found + 1;
    else { const tool = JSON.parse(action)[0]; missing[tool] = (missing[tool] || 0) + 1; missingCount++; missingKeys.add(key); }
  }
  return { missing_actions: missing, missing_action_count: missingCount, missingKeys };
}

/** Additional exact guard for supported linear source; never publish targets or parameter values. */
function exactLinearCoverage({ payload, execution, observations = [] }) {
  if (!eligible(execution, observations)) return null;
  const actions = currentCandidate(payload, execution);
  if (!actions) return null;
  const { missingKeys, ...coverage } = alignActions(actions, freshProofs(actions, execution, observations));
  // Successful navigation is a prerequisite for the observed form, even when
  // the high-level manual action omitted that click. Do not save source that
  // would start filling a screen only the development browser has reached.
  // A later explicit navigation resets earlier exploratory navigation; ordinary
  // non-navigating corrections are not blindly copied into the saved script.
  const prerequisites=[],seenNavigation=new Set();
  for(const observation of observations){
    const stamp=observation?.[requestStamp],receipt=browserReceipt(observation);
    if(receipt?.action_outcome!=='completed')continue;
    if(stamp&&typeof observation.action_id==='string'){if(seenNavigation.has(observation.action_id))continue;seenNavigation.add(observation.action_id);}
    if(observation.tool==='browser_navigate')prerequisites.length=0;
    if(observation.execution_step_id!==execution.step_id||!stamp?.action||stamp.bootstrap||observation.mcp_call===false)continue;
    if(observation.tool==='browser_navigate'||stamp.page_transition||pageTransitions.has(observation))prerequisites.push({key:stamp.action,tool:observation.tool});
  }
  const sourceKeys=actions.map(hash),missingSource={};let cursor=0;
  for(const prerequisite of prerequisites){
    const index=sourceKeys.indexOf(prerequisite.key,cursor);
    if(index<0)missingSource[prerequisite.tool]=(missingSource[prerequisite.tool]||0)+1;else cursor=index+1;
  }
  const missingSourceCount=Object.values(missingSource).reduce((total,count)=>total+count,0);
  return { supported: true, ...coverage,...(missingSourceCount?{missing_source_actions:missingSource,missing_source_action_count:missingSourceCount}:{}) };
}

/** Reuse a confirmed receipt only when the revised linear source needs no new instance of this exact action. */
function reconcileAction({ payload, execution, request, observations = [] }) {
  if (!eligible(execution, observations)) return null;
  const signature = requestSignature(request);
  if (!signature) return null;
  const key = requestActionKey(request), actions = currentCandidate(payload, execution);
  if (!key || !actions) return null;
  const candidateCount = actions.filter(action => action === key).length;
  if (!candidateCount) return null;
  const proofs = freshProofs(actions, execution, observations);
  if (alignActions(actions, proofs).missingKeys.has(hash(key))) return null;
  const confirmed = proofs.filter(proof => proof.signature === signature);
  if (candidateCount > confirmed.length) return null;
  return { action_id: confirmed.at(-1).action_id, matching_count: confirmed.length, candidate_count: candidateCount };
}

module.exports = { stampObservation, markPageTransition, isNavigationPrerequisite, reconcileAction, exactLinearCoverage };
