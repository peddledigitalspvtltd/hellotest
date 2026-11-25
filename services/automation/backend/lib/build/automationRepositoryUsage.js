const { parse } = require('acorn');
const { normalizeParameterKey, normalizeParameterLayer } = require('@hellotest/platform/backend/src/utils/stepParameterResolution');
const { parseJsonValue } = require('@hellotest/platform/backend/src/utils/testStepAutomation');

// Match the runtime repository key grammar. An inline selector or an object
// mentioned in authored text remains usable after removing the repository row.
const repositoryReferenceKey = value => String(value || '').toLowerCase().replace(/page\b/g, '')
  .replace(/[^a-z0-9.]+/g, ' ').trim();
const inlineSelector = /^(?:[#.\[/]|(?:css|xpath|role|text|label|placeholder|testid|data-testid)=|(?:page\.)?(?:locator|getBy[A-Z]\w*)\s*\()/i;
const repositoryKeywordTargets = new Set([
  'click','dblclick','rightClick','hover','fill','type','select','selectOption','check','uncheck','clear','press',
  'tap','doubleTap','longPress','expectVisible','expectHidden','expectEnabled','expectDisplayed','expectNotDisplayed',
  'expectText','expectValue','waitForSelector','waitForDisplayed','waitForExist','waitForEnabled',
  'text','value','captureText','captureValue','uploadFile','uploadLocalFile','uploadRemoteFile','setInputFiles','drag'
]);
// These native Playwright methods resolve the first argument through the repository.
const playwrightRepositoryTargets = new Set([
  'locator','click','dblclick','fill','type','press','check','uncheck','selectOption','setInputFiles',
  'hover','focus','textContent','innerText','inputValue','getAttribute','waitForSelector'
]);

function stepUsesRepositoryNeedle(code, values, needles) {
  const bindings = normalizeParameterLayer(parseJsonValue(values, {}) || {}, 't');
  const literal = node => {
    if (node?.type === 'Literal' && typeof node.value === 'string') return node.value;
    if (node?.type === 'TemplateLiteral' && !node.expressions.length) return node.quasis[0].value.cooked;
    if (node?.type === 'MemberExpression' && node.object?.name === 'params' && node.computed && typeof node.property?.value === 'string') {
      return bindings[normalizeParameterKey(node.property.value, 't')];
    }
  };
  const matches = node => {
    const raw = literal(node);
    if (typeof raw !== 'string') return false;
    const value = raw.replace(/@[tsr]\.(?:\[(?:\\.|[^\]\\])+\]|[A-Za-z][\w-]*)/gi, token => bindings[normalizeParameterKey(token)] ?? token);
    return !inlineSelector.test(value.trim()) && needles.has(repositoryReferenceKey(value));
  };
  const visit = node => {
    if (!node || typeof node !== 'object') return false;
    if (node.type === 'CallExpression' && node.callee?.type === 'MemberExpression') {
      const namespace = node.callee.object?.name;
      const name = node.callee.computed ? node.callee.property?.value : node.callee.property?.name;
      const [first, second] = node.arguments;
      if (['page', 'playwrightPage'].includes(namespace) && playwrightRepositoryTargets.has(name) && matches(first)) return true;
      if (['web', 'android', 'ios', 'mobile'].includes(namespace)) {
        if (repositoryKeywordTargets.has(name) && (name !== 'expectText' || second && second.value !== null) && (matches(first) || name === 'drag' && matches(second))) return true;
        if (name === 'aiStep' && second?.type === 'ObjectExpression' && second.properties.some(property =>
          ['target','selector'].includes(property.key?.name || property.key?.value) && matches(property.value))) return true;
      }
    }
    return Object.values(node).some(value => Array.isArray(value) ? value.some(visit) : visit(value));
  };
  const source = code.trim().match(/^```(?:[\w-]+)?\s*([\s\S]*?)\s*```$/)?.[1] || code;
  try { return visit(parse(source, { ecmaVersion: 'latest', sourceType: 'module', allowAwaitOutsideFunction: true, allowReturnOutsideFunction: true })); }
  catch { return false; }
}

async function findRepositoryUsage(entries, db, buildNeedles) {
  const scopes = new Map();
  for (const entry of entries) {
    const appTypeId = entry.app_type_id?.trim() || null;
    const projectId = entry.project_id?.trim() || null;
    if (!appTypeId && !projectId) continue;
    const key = JSON.stringify([appTypeId, projectId]);
    if (!scopes.has(key)) scopes.set(key, { appTypeId, projectId, needles: new Set() });
    for (const value of buildNeedles(entry)) {
      const normalized = repositoryReferenceKey(value);
      if (normalized) scopes.get(key).needles.add(normalized);
    }
  }
  const usage = new Map();
  for (const { appTypeId, projectId, needles } of scopes.values()) {
    if (!needles.size) continue;
    const steps = await db.prepare(`
      SELECT test_cases.id, test_cases.display_id, test_cases.title, test_cases.automated,
        test_cases.parameter_values, test_steps.automation_code
      FROM test_steps JOIN test_cases ON test_cases.id = test_steps.test_case_id
        JOIN app_types ON app_types.id = test_cases.app_type_id
      WHERE (?::text IS NULL OR app_types.id = ?)
        AND (?::text IS NULL OR app_types.project_id = ?)
        AND test_steps.automation_code ~ '(web|android|ios|mobile|page|playwrightPage)[[:space:]]*(\\.|\\[)'
    `).all(appTypeId, appTypeId, projectId, projectId);
    for (const { automation_code, parameter_values, ...testCase } of steps) {
      if (!usage.has(testCase.id) && stepUsesRepositoryNeedle(automation_code, parameter_values, needles)) usage.set(testCase.id, testCase);
    }
  }
  return [...usage.values()].sort((left, right) => left.title.localeCompare(right.title));
}

module.exports = { findRepositoryUsage };
