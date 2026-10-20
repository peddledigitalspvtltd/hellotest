const { prepareVerificationSections } = require('./automationVerificationPipeline');
const { compileRecordedProgram } = require('./automationRecordedProgram');
const { referenceKey } = require('./automationBrowserParameters');
const { parse } = require('acorn');

const MAX_OPERATIONS = 80;
const invalid = message => Object.assign(new Error(message), { code: 'AUTOMATION_REPAIR_PROGRAM_UNSUPPORTED', statusCode: 422 });
const identityResolver = { resolve: (_name, args) => args };
const equivalentValue = (left, right) => {
  const leftKey = referenceKey(left), rightKey = referenceKey(right);
  return leftKey || rightKey ? leftKey !== null && leftKey === rightKey : left === right;
};

function nativeRepairProgramSummary(step) {
  try {
    const operations = prepareVerificationSections([{ ...step, step_type: 'web' }], identityResolver,
      { allowLegacyFieldValidationRequirements: true }).sections[0].operations;
    const statements=parse(step.automation_code,{ecmaVersion:'latest',sourceType:'module',allowAwaitOutsideFunction:true,locations:true}).body
      .filter(statement=>statement.type==='ExpressionStatement'&&statement.expression?.type==='AwaitExpression');
    if(statements.length!==operations.length)return null;
    return { operation_count: operations.length, assertion_count: operations.filter(operation => operation.name === 'browser_assert').length,
      operation_lines: operations.map((operation,index)=>({line:statements[index].loc.start.line,assertion:operation.name==='browser_assert'})) };
  } catch { return null; }
}

/** A repair may rebind an observed control, never redesign the saved test.
 * Both programs pass the engineer's exact closed-program decoder before any
 * comparison. This inspects syntax only; it neither runs code nor reads data.
 * One original subject must retain one replacement throughout its actions
 * and assertions, and distinct original subjects cannot be silently merged.
 */
function nativeProgramPatch({ step, automationCode } = {}) {
  if (!step || typeof step.id !== 'string' || typeof automationCode !== 'string'
    || !automationCode.trim() || automationCode.length > 30_000) throw invalid('Provide a complete native Playwright section within the repair budget.');
  let before, after;
  try {
    before = prepareVerificationSections([{ ...step, step_type: 'web' }], identityResolver,
      { allowLegacyFieldValidationRequirements: true }).sections[0].operations;
    after = prepareVerificationSections([{ ...step, step_type: 'web', automation_code: automationCode }], identityResolver).sections[0].operations;
  } catch {
    throw invalid('Native repair accepts only the same closed Playwright action and assertion contract as Automation Engineer. Arbitrary scripts, changed callbacks, custom timeouts and hidden work require authored review.');
  }
  if (!after.length || after.length > MAX_OPERATIONS || before.length !== after.length) {
    throw invalid('Preserve every saved action and assertion in order; a focused repair cannot add or remove operations.');
  }
  const forward = new Map(), reverse = new Map();
  let changes = 0;
  for (let index = 0; index < before.length; index++) {
    const original = before[index], candidate = after[index];
    if (original.name !== candidate.name) throw invalid('Preserve the complete saved action and assertion sequence.');
    const originalKeys = Object.keys(original.arguments).sort(), candidateKeys = Object.keys(candidate.arguments).sort();
    if (JSON.stringify(originalKeys) !== JSON.stringify(candidateKeys)) throw invalid('Preserve the saved operation arguments and assertion predicates.');
    for (const key of originalKeys) {
      const oldValue = original.arguments[key], newValue = candidate.arguments[key];
      if (key !== 'locator') {
        if (!equivalentValue(oldValue, newValue)) throw invalid('Preserve every input binding, assertion value, predicate and navigation target. Change test data or expected behavior explicitly outside repair.');
        continue;
      }
      if (typeof oldValue !== 'string' || typeof newValue !== 'string'
        || forward.has(oldValue) && forward.get(oldValue) !== newValue
        || reverse.has(newValue) && reverse.get(newValue) !== oldValue) {
        throw invalid('Rebind each saved subject consistently across its actions and assertions; distinct subjects must remain distinct.');
      }
      forward.set(oldValue, newValue); reverse.set(newValue, oldValue);
      if (oldValue !== newValue) changes++;
    }
  }
  if (!changes) throw invalid('A native locator repair must correct an observed subject; formatting-only changes are unnecessary.');
  return {
    automation_code: automationCode.trim(), operation_count: after.length,
    assertion_count: after.filter(operation => operation.name === 'browser_assert').length,
    locator_rebindings: [...forward].filter(([beforeLocator, afterLocator]) => beforeLocator !== afterLocator)
      .map(([beforeLocator, afterLocator]) => ({ before: beforeLocator, after: afterLocator }))
  };
}

function nativeLocatorPatch({ step, newLocator } = {}) {
  let operations;
  try { operations = prepareVerificationSections([{ ...step, step_type: 'web' }], identityResolver,
    { allowLegacyFieldValidationRequirements: true }).sections[0].operations; }
  catch { throw invalid('The saved section is outside the closed native repair contract.'); }
  const subjects = new Set(operations.map(operation => operation.arguments.locator).filter(Boolean));
  if (subjects.size !== 1) throw invalid('A literal locator proposal requires one saved subject. Propose the complete section when it uses several controls.');
  const candidate = operations.map(operation => ({ ...operation, arguments: {
    ...operation.arguments, ...(operation.arguments.locator ? { locator: newLocator } : {})
  } }));
  const compiled = compileRecordedProgram(candidate);
  if (!compiled) throw invalid('Provide an observed supported locator.');
  return nativeProgramPatch({ step, automationCode: compiled.source });
}

module.exports = { nativeProgramPatch, nativeLocatorPatch, nativeRepairProgramSummary };
