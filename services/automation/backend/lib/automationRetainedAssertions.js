const { createHash } = require('node:crypto');
const { parse } = require('acorn');
const { prepareVerificationSections } = require('./automationVerificationPipeline');
const { compileRecordedProgram } = require('./automationRecordedProgram');
const { parameterReference, referenceKey } = require('./automationBrowserParameters');

// A model, JSON copy or persisted UI history cannot authorize extra checks.
const issued = new WeakMap();
const digest = text => createHash('sha256').update(text, 'utf8').digest('hex');
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).filter(([key]) => !['start', 'end', 'loc', 'raw'].includes(key)).map(([key, item]) => [key, stable(item)])) : value;
const failure = (code, message) => Object.assign(new Error(message), { code, statusCode: 422, nonRetryable: true });
const unavailable = { code: 'AUTOMATION_RETAINED_ASSERTIONS_UNAVAILABLE', message: 'Saved instructions include checks outside the closed native assertion contract. Review the retained source; no saved check was executed or removed.' };

function operationKey(operation) {
  try {
    const input = structuredClone(operation);
    // These are whole explicit bindings, never interpolated values. Normalize
    // their spelling without reading data or equating distinct scopes/keys.
    for (const field of ['value', 'key']) {
      const key = referenceKey(input?.arguments?.[field]);
      if (key) input.arguments[field] = parameterReference(key);
    }
    const compiled = compileRecordedProgram([input]);
    return compiled ? digest(JSON.stringify(stable(parse(compiled.source, { ecmaVersion: 'latest', sourceType: 'module', allowAwaitOutsideFunction: true })))) : null;
  } catch { return null; }
}

const frozenOperation = operation => Object.freeze({ name: operation.name, arguments: Object.freeze({ ...operation.arguments }) });

/** Inspect the entire saved program atomically. The existing verifier proves
 * derive -> compile AST equality, including native callback bodies, parameter
 * expressions and waits. Its identity resolver never reads/materializes data.
 * No source, browser operation or callback is executed by this helper. */
function createRetainedAssertionContract({ step } = {}) {
  const source = step?.automation_code;
  const base = { schema_version: 1, step_id: typeof step?.id === 'string' ? step.id : null,
    source_fingerprint: typeof source === 'string' ? digest(source) : null };
  const checkpoints = new Map(), actionKeys = [];
  let operations;
  const finish = (status, entries = [], final = [], earlier = [], diagnostic) => {
    const contract = Object.freeze({ ...base, status, assertions: Object.freeze(entries), final_assertions: Object.freeze(final),
      earlier_assertions: Object.freeze(earlier), ...(diagnostic ? { diagnostic: Object.freeze({ ...diagnostic }) } : {}) });
    issued.set(contract, { entries, final, earlier, prefixes: checkpoints, action_keys: actionKeys, operations: (operations||[]).map(frozenOperation) });
    return contract;
  };
  if (!step || typeof step.id !== 'string' || !step.id.trim() || step.id.length > 200 || step.step_type && step.step_type !== 'web') return finish('unavailable', [], [], [], unavailable);
  if (source === undefined || source === null || typeof source === 'string' && !source.trim()) return finish('empty');
  if (typeof source !== 'string') return finish('unavailable', [], [], [], unavailable);
  try {
    operations = prepareVerificationSections([{ id: step.id, step_type: 'web', automation_code: source }], { resolve: (_name, args) => args }, { allowLegacyFieldValidationRequirements: true }).sections[0].operations;
  } catch { return finish('unavailable', [], [], [], unavailable); }
  let lastBarrier = -1;
  for (let index = 0; index < operations.length; index++) if (operations[index].name !== 'browser_assert') lastBarrier = index;
  const entries = [], final = [], earlier = [], prefix = [];
  let previousAssertion;
  for (const [index, operation] of operations.entries()) {
    const key = operationKey(operation);
    if (!key) return finish('unavailable', [], [], [], unavailable);
    if (operation.name !== 'browser_assert') { prefix.push(key); actionKeys.push(key); previousAssertion = undefined; continue; }
    // Only adjacent identical pure native assertions are redundant. A later
    // action or different check retains the original checkpoint multiplicity.
    if (key === previousAssertion) continue;
    previousAssertion = key;
    const entry = Object.freeze({ key, operation_index: index + 1, operation: frozenOperation(operation) });
    entries.push(entry);
    if (index > lastBarrier) final.push(entry);
    else { earlier.push(entry); checkpoints.set(entry.operation_index, [...prefix]); }
  }
  return finish('available', entries, final, earlier, undefined);
}

/** Select only an immediate saved input+value+field-validation contract. This
 * is a conservative read-before-input gate, never a selector repair or a
 * heuristic match. Earlier navigation/disclosure actions must already be
 * confirmed at their exact original action prefix. No values leave this read. */
function retainedInputSubjectForRequest({ contract, request, operations = [], allowCompleted = false } = {}) {
  const retained = issued.get(contract);
  if (!retained || contract.status !== 'available' || !Array.isArray(operations) || operations.length > 250
    || !['browser_fill','browser_select_option'].includes(request?.name)) return null;
  const saved = retained.operations, inputIndex = saved.findIndex(operation => ['browser_fill','browser_select_option'].includes(operation.name));
  if (inputIndex < 0) return null;
  const input = saved[inputIndex], binding = referenceKey(input.arguments.value);
  if (request.name !== input.name || !binding || referenceKey(request.arguments?.value) !== binding) return null;
  const priorActions = saved.slice(0,inputIndex).filter(operation => operation.name !== 'browser_assert').map(operationKey);
  const confirmedActions = operations.filter(operation => operation.name !== 'browser_assert').map(operationKey);
  if (priorActions.some(key => !key) || confirmedActions.some(key => !key)) return null;
  const beforeInput = JSON.stringify(priorActions) === JSON.stringify(confirmedActions);
  const afterInput = allowCompleted === true && JSON.stringify([...priorActions,operationKey(input)]) === JSON.stringify(confirmedActions);
  if (!beforeInput && !afterInput) return null;
  const nextAction = saved.findIndex((operation,index) => index > inputIndex && operation.name !== 'browser_assert');
  const checks = saved.slice(inputIndex+1,nextAction < 0 ? undefined : nextAction);
  if (!checks.some(operation => operation.name === 'browser_assert' && operation.arguments.assertion === 'value'
      && operation.arguments.locator === input.arguments.locator && referenceKey(operation.arguments.value) === binding)
    || !checks.some(operation => operation.name === 'browser_assert' && operation.arguments.assertion === 'field_valid' && operation.arguments.locator === input.arguments.locator)) return null;
  return Object.freeze({ locator: input.arguments.locator, operation_index: inputIndex + 1, tool: input.name });
}

/** The next original input oracle may use a fresh same-control alias only
 * after the entire preceding closed program is confirmed exactly. No later,
 * missing or reordered predicate can acquire equivalence through this read. */
function retainedNextInputAssertionSubjectForRequest({contract,request,operations=[]}={}) {
  const retained=issued.get(contract);
  if(!retained||contract.status!=='available'||!Array.isArray(operations)||operations.length>250||request?.name!=='browser_assert'
    ||!['value','field_valid'].includes(request.arguments?.assertion))return null;
  const saved=retained.operations,input=saved.find(operation=>['browser_fill','browser_select_option'].includes(operation.name));
  if(!input)return null;
  const subject=retainedInputSubjectForRequest({contract,request:input,operations,allowCompleted:true});
  if(!subject||operations.length>=saved.length||operations.some((operation,index)=>operationKey(operation)!==operationKey(saved[index])))return null;
  const next=saved[operations.length];
  if(next.name!=='browser_assert'||next.arguments.assertion!==request.arguments.assertion||next.arguments.locator!==subject.locator)return null;
  if(next.arguments.assertion==='value'){
    const binding=referenceKey(next.arguments.value);
    if(!binding||referenceKey(request.arguments.value)!==binding)return null;
  }else if(Object.hasOwn(request.arguments,'value'))return null;
  return subject;
}

/** Inputs must be confirmed requests from recordedSectionRequests, not model
 * proposals. Earlier checks must match the original action-prefix checkpoint;
 * they can never be discharged by appending a terminal recheck. Final checks
 * count only after the current last action/navigation. Failed observations are
 * outside this ledger: the caller must separately enforce failure freshness. */
function pendingFinalAssertions({ contract, operations = [], refreshFinalAssertions = false } = {}) {
  const retained = issued.get(contract);
  if (!retained || !Array.isArray(operations) || operations.length > 250 || typeof refreshFinalAssertions !== 'boolean') throw failure('AUTOMATION_RETAINED_ASSERTIONS_INVALID', 'The retained assertion contract or confirmed operation ledger is invalid.');
  if (contract.status === 'unavailable') throw failure(unavailable.code, unavailable.message);
  if (contract.status === 'empty') return [];
  const current = [], prefix = [];
  let lastBarrier = -1;
  for (const [index, operation] of operations.entries()) {
    const key = operationKey(operation);
    if (!key) throw failure('AUTOMATION_RETAINED_ASSERTIONS_INVALID', 'The retained assertion contract or confirmed operation ledger is invalid.');
    if (operation.name !== 'browser_assert') { prefix.push(key); lastBarrier = index; }
    else current.push({ key, index, prefix: [...prefix], used: false });
  }
  if (JSON.stringify(prefix) !== JSON.stringify(retained.action_keys)) throw failure('AUTOMATION_RETAINED_ASSERTION_ACTION_ORDER_GAP', 'The saved action sequence is not confirmed with the same targets, data bindings and order. Retained final checks cannot replace missing actions; review the saved requirements without replaying actions.');
  // Reconstruct original checkpoint prefixes from the closed saved program.
  // Prefix keys remain private host metadata, never execution proof in JSON.
  const originalPrefixes = retained.prefixes;
  let lastEarlierPosition = -1;
  for (const entry of retained.earlier) {
    const expected = originalPrefixes?.get(entry.operation_index);
    const match = current.find(row => !row.used && row.index > lastEarlierPosition && row.key === entry.key && JSON.stringify(row.prefix) === JSON.stringify(expected));
    if (!match) throw failure('AUTOMATION_RETAINED_ASSERTION_ORDER_GAP', 'A retained earlier browser checkpoint is missing at its original action boundary. Review the saved checks; a terminal recheck or action replay cannot establish it.');
    match.used = true; lastEarlierPosition = match.index;
  }
  if (refreshFinalAssertions) return [...retained.final];
  let cursor = lastBarrier;
  for (const [index, entry] of retained.final.entries()) {
    const match = current.find(row => !row.used && row.index > cursor && row.key === entry.key);
    // Later successful predicates cannot establish an earlier checkpoint.
    // Recheck the remaining read-only suffix in its original order without
    // rewriting or discarding any existing protected browser receipt.
    if (!match) return retained.final.slice(index);
    match.used = true; cursor = match.index;
  }
  return [];
}

/** Hints describe the saved oracle, never current locator authority or proof.
 * Expected literals can contain historical secrets unknown to today's data
 * resolver, so none are exposed. Whole bindings are symbolic names only: do
 * not pass them to a projector that could materialize a public input value. */
function retainedFinalAssertionHints(contract, { projectText } = {}) {
  const retained = issued.get(contract);
  if (!retained || typeof projectText !== 'function') throw failure('AUTOMATION_RETAINED_ASSERTIONS_INVALID', 'Retained assertion hints require a genuine host contract and privacy projector.');
  const hints = { checks: [], omitted_count: retained.final.length,
    instruction: 'Follow these retained checks in order after the current action, using current observed targets and authored expectations. Saved locators are requirements, not fresh evidence. If an omitted expectation is unavailable, leave that check and following retained checks to host preflight; never guess values or emit out-of-order substitutes.' };
  for (const entry of retained.final) {
    const args = entry.operation.arguments, descriptor = { assertion: args.assertion };
    if (Object.hasOwn(args, 'locator')) {
      let projected;
      try { projected = projectText(args.locator); }
      catch { throw failure('AUTOMATION_RETAINED_ASSERTIONS_INVALID', 'Saved assertion subjects could not be privacy-projected.'); }
      if (typeof projected !== 'string') throw failure('AUTOMATION_RETAINED_ASSERTIONS_INVALID', 'Saved assertion subjects could not be privacy-projected.');
      // A privacy placeholder must never look like an executable locator.
      if (projected === args.locator) descriptor.locator = projected;
      else descriptor.subject_omitted = true;
    }
    if (Object.hasOwn(args, 'value')) {
      const key = referenceKey(args.value);
      if (key) descriptor.parameter_reference = parameterReference(key);
      else descriptor.expected_value_omitted = true;
    }
    const candidate = { ...hints, checks: [...hints.checks, descriptor], omitted_count: retained.final.length - hints.checks.length - 1 };
    // Retain an ordered prefix of complete descriptors. Never clip selectors,
    // bindings or expectations, or skip an oversized check to show later ones.
    if (Buffer.byteLength(JSON.stringify(candidate), 'utf8') > 2000) break;
    hints.checks.push(descriptor); hints.omitted_count--;
  }
  return hints;
}

module.exports = { createRetainedAssertionContract, pendingFinalAssertions, retainedFinalAssertionHints, retainedInputSubjectForRequest, retainedNextInputAssertionSubjectForRequest };
