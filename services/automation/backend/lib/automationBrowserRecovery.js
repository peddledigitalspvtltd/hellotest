const { createHash } = require('node:crypto');
const { sanitizeAiText } = require('@hellotest/platform/backend/src/security/aiTextPolicy');
const { browserReceipt } = require('./automationInteractiveEvidence');

const checks = new WeakMap();
const checkTools = new Set(['browser_assert', 'browser_validate_locator']);
const mutations = new Set(['browser_navigate', 'browser_click', 'browser_fill', 'browser_press_key', 'browser_select_option', 'browser_hover', 'browser_check', 'browser_uncheck']);
const pageAssertionSubject = assertion => ['url', 'url_contains'].includes(assertion) ? 'address_bar_url' : ['title', 'title_normalized'].includes(assertion) ? 'document_title' : undefined;
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const safeText = (value, max = 1000) => typeof value === 'string' ? sanitizeAiText(value).text.slice(0, max) : undefined;

function groundedAssertionTarget(page, request, location) {
  const locator = request?.name === 'browser_assert' && request.arguments?.locator;
  if (typeof locator !== 'string' || !page || !Array.isArray(page.elements) || location && page.url !== location
    || page.partial || page.elements_truncated || page.scope && page.scope !== 'body') return null;
  const matches = page.elements.filter(element => Array.isArray(element?.locator_candidates) && element.locator_candidates.includes(locator));
  if (matches.length !== 1) return null;
  const target = matches[0];
  // Global field/text truncation may come from an unrelated marketing card.
  // The matched target's own completeness flags govern this scoped identity.
  if (target.locators_validated !== true || target.text_truncated || target.label_truncated || target.accessible_name_truncated || target.options_truncated
    || target.truncated_attributes?.length || target.options?.some(option => option.value_truncated)) return null;
  // Native input values are deliberately absent from ordinary DOM metadata.
  // Without observed value state retain accessibility in the fallback hash so
  // an external value change can reopen the check without a host mutation.
  if (request.arguments.assertion === 'value' && !Object.hasOwn(target, 'value') && !Array.isArray(target.options)) return null;
  return {
    locator, tag: target.tag, role: target.accessible_role || target.role,
    name: target.accessible_name || target.name || target.label, text: target.text,
    attributes: Object.fromEntries(Object.entries(target.attributes || {}).sort(([left], [right]) => left.localeCompare(right))),
    displayed: target.displayed, disabled: target.disabled, checked: target.checked,
    ...(Object.hasOwn(target, 'value') ? { value: target.value } : {}), options: target.options
  };
}

function unsuccessfulBrowserCheck(observation) {
  if (!checkTools.has(observation?.tool) || observation.mcp_call === false) return null;
  const receipt = browserReceipt(observation);
  let fault;
  if (observation.result?.isError) for (const item of observation.result.content || []) if (item.type === 'text') {
    try { const parsed = JSON.parse(item.text); if (parsed?.source === 'playwright') fault = parsed; } catch {}
  }
  const invalidLocator = observation.tool === 'browser_validate_locator' && receipt && (receipt.unique === false || Number.isFinite(receipt.match_count) && receipt.match_count !== 1);
  const failedAssertion = observation.tool === 'browser_assert' && (observation.result?.isError || receipt?.assertion_outcome === 'not_satisfied');
  if (!invalidLocator && !failedAssertion && !observation.result?.isError) return null;
  return {
    tool: observation.tool,
    code: typeof fault?.code === 'string' && /^[A-Z][A-Z0-9_]{1,99}$/.test(fault.code) ? fault.code : invalidLocator ? 'BROWSER_LOCATOR_NOT_UNIQUE' : 'BROWSER_ASSERTION_NOT_SATISFIED',
    ...(typeof observation.arguments?.assertion === 'string' ? { assertion: observation.arguments.assertion.slice(0, 80) } : {}),
    ...(pageAssertionSubject(observation.arguments?.assertion) ? { assertion_subject: pageAssertionSubject(observation.arguments.assertion) } : {}),
    ...(typeof observation.arguments?.locator === 'string' ? { locator: safeText(observation.arguments.locator, 500) } : {}),
    ...(Number.isSafeInteger(receipt?.match_count) && receipt.match_count >= 0 ? { match_count: receipt.match_count } : {}),
    ...(typeof receipt?.unique === 'boolean' ? { unique: receipt.unique } : {}),
    ...(typeof fault?.action_outcome === 'string' ? { action_outcome: fault.action_outcome } : {}),
    ...(typeof fault?.assertion_outcome === 'string' ? { assertion_outcome: fault.assertion_outcome } : {}),
    message: invalidLocator ? `The observed locator ${Number.isSafeInteger(receipt.match_count) ? `matches ${receipt.match_count} elements` : 'is not unique'}. Choose a different locator from the current page evidence.` : safeText(fault?.message) || 'The expected browser condition was not satisfied.'
  };
}

/** Ignore observation IDs/timestamps; a repeated identical snapshot is not new
 * evidence. A confirmed mutation or changed controls/read values is new state. */
function browserRecoveryState(observations = [], request) {
  const invalidated = observations.findLastIndex(item => item.tool === 'browser_navigate' && item.result?.isError);
  const snapshot = observations.findLast((item, index) => index > invalidated && item.tool === 'browser_snapshot' && !item.result?.isError);
  const page = snapshot && browserReceipt(snapshot);
  const actionIndex = observations.findLastIndex(item => item.mcp_call !== false && mutations.has(item.tool) && browserReceipt(item)?.action_outcome === 'completed');
  const location = [...observations].reverse().map(browserReceipt).find(item => typeof item?.url === 'string')?.url;
  const action = actionIndex < 0 ? null : observations[actionIndex].action_id || actionIndex;
  const subject = request?.name === 'browser_assert' && pageAssertionSubject(request.arguments?.assertion);
  // A clock, loading indicator or unrelated form update is not new evidence for
  // the address bar or document title. Otherwise each automatic post-failure
  // snapshot can reset the retry allowance while the actual subject stays the
  // same. Confirmed actions still reopen the check because they can initiate a
  // delayed navigation; observed subject changes do too.
  if (subject) return hash({ subject, url: location, action,
    ...(subject === 'document_title' ? { title: [...observations].reverse().map(browserReceipt).find(item => typeof item?.title === 'string' && (!location || !item.url || item.url === location))?.title } : {}),
    navigation_invalidated: invalidated < 0 ? null : invalidated,
    snapshot_available: Boolean(page && (!location || page.url === location)) });
  const target = groundedAssertionTarget(page, request, location);
  // Unrelated carousels, live counters and viewport movement do not change the
  // condition checked on this exact, uniquely grounded target. An unavailable
  // or incomplete target never establishes absence; retain the full evidence
  // fingerprint when the scoped state cannot be observed reliably.
  if (target) {
    if (request?.arguments?.assertion === 'field_valid') {
      // Validation can change on a described/error node while the input's own
      // attributes stay identical. Do not mistake that change for the same
      // failed subject merely because its selector/value did not change.
      const ids = [...new Set(['aria-describedby', 'aria-errormessage'].flatMap(name => String(target.attributes[name] || '').trim().split(/[\t\n\f\r ]+/).filter(Boolean)))];
      const associated = ids.map(id => ({ id, nodes: page.elements.filter(element => element.attributes?.id === id) }));
      if (associated.every(item => item.nodes.length === 1)) return hash({ url: location, action, target, associated });
      // Missing/duplicate associations cannot be inferred from a filtered DOM
      // inventory. Keep the complete observed state as the conservative fallback.
    } else return hash({ url: location, action, target });
  }
  return hash({
    url: location,
    action,
    page: page ? { url: page.url, title: page.title, accessibility: page.accessibility, elements: page.elements } : null
  });
}

function checkKey(request) {
  if (!checkTools.has(request?.name) || !request.arguments || typeof request.arguments !== 'object' || Array.isArray(request.arguments)) return null;
  return hash([request.name, Object.entries(request.arguments).sort(([left], [right]) => left.localeCompare(right))]);
}

function checkFamilyKey(request) {
  if (!checkKey(request)) return null;
  // Rephrasing the expected text on the same target is not a browser state
  // change. Keep modes distinct: switching from URL to visible content or from
  // inner text to native textContent can be a legitimate correction.
  return hash([request.name, request.arguments.assertion, request.arguments.locator]);
}

function promptCheckRequest(request, projectText) {
  const value = request.arguments?.value;
  if (typeof value !== 'string') return null;
  // The caller supplies original model arguments before the browser parameter
  // resolver materializes private bindings. Never accept resolved receipts or
  // serialized observation arguments as the source of this private context.
  if (/^@(?:(?:t|s|r)\.)?(?:[A-Za-z][A-Za-z0-9_-]*|\[(?:\\.|[^\]\\\r\n])+\])$/i.test(value)
    || /^params\s*\[/.test(value) && require('./automationBrowserParameters').referenceKey(value)) return { expected_reference: value.slice(0, 2_000) };
  if (typeof projectText !== 'function') return { expected_value_withheld: true };
  const projected = projectText(value);
  if (typeof projected !== 'string') return { expected_value_withheld: true };
  const text = safeText(projected, 2_000);
  return { expected_value: text, ...(text !== value ? { expected_value_redacted: true } : {}) };
}

/** Only original host observations can establish a failed check fingerprint. */
function recordBrowserCheck(observation, request, state, { projectText, verificationRequested = false } = {}) {
  const key = checkKey(request);
  if (!key || observation?.tool !== request.name || observation.mcp_call === false || checks.has(observation)) return;
  checks.set(observation, { key, family: checkFamilyKey(request), state, failure: unsuccessfulBrowserCheck(observation), verificationRequested: verificationRequested === true, promptRequest: promptCheckRequest(request, projectText) });
}

/** A failed expected-result check after the actor closes its action phase
 * cannot authorize new business mutations to manufacture a passing outcome.
 * Only host-recorded checks confer this boundary; copied/model history cannot.
 * Earlier exploratory checks and argument/subject corrections do not close it. */
function browserVerificationBoundary(observations = [], stepId) {
  if (!stepId || !observations.some(item => item.execution_step_id === stepId && item.tool === 'browser_assert'
    && checks.get(item)?.verificationRequested && checks.get(item)?.failure?.code === 'BROWSER_ASSERTION_NOT_SATISFIED')) return null;
  return { phase: 'verification_observation_only', actions_allowed: false, reason: 'failed_expected_result_check',
    next_required: 'inspect_current_evidence_correct_check_preserving_authored_meaning_or_report_section_issue' };
}

/** Private prompt projection, never included in public browser failures or
 * retained activity artifacts. Copies of observations have no such authority. */
function browserCheckPromptDetails(observation) {
  const recorded = checks.get(observation);
  return recorded?.failure && recorded.promptRequest ? { ...recorded.promptRequest } : null;
}

function repeatedUnsuccessfulCheck({ request, observations, stepId }) {
  const key = checkKey(request);
  if (!key) return null;
  const family = checkFamilyKey(request);
  const state = browserRecoveryState(observations, request);
  if (request.name === 'browser_assert') {
    const matching = observations.filter(item => item.execution_step_id === stepId && checks.get(item)?.family === family && checks.get(item)?.state === state);
    const lastSuccess = matching.findLastIndex(item => !checks.get(item)?.failure);
    const failures = matching.slice(lastSuccess + 1).filter(item => checks.get(item)?.failure);
    const unsupported = failures.findLast(item => checks.get(item)?.failure?.code === 'BROWSER_ASSERTION_SUBJECT_UNSUPPORTED');
    if (unsupported) return { ...checks.get(unsupported).failure, failed_check_count: failures.length, remaining_unchanged_state_retries: 0,
      recovery_required: 'inspect_native_subject_and_associations_or_correct_target',
      message: 'This selected native subject cannot support the requested validation check. Repeating it on unchanged evidence cannot establish validity. Inspect the native control and its associated error/hint targets, select a supported equivalent check preserving the authored outcome, or report the unsupported requirement. No second browser check was attempted.' };
    if (failures.length >= 2) return { ...checks.get(failures.at(-1)).failure, failed_check_count: failures.length, remaining_unchanged_state_retries: 0,
      recovery_required: 'inspect_observed_failure_or_correct_target',
      message: 'This assertion mode already failed twice on the same target and unchanged browser state. Changing the expected value does not resolve the observed failure. Inspect current page feedback, correct the target or unfinished action, or report the unmet prerequisite before another check.' };
    return null;
  }
  const previous = observations.findLast(item => item.execution_step_id === stepId && checks.get(item)?.key === key);
  const recorded = previous && checks.get(previous);
  if (!recorded?.failure || recorded.state !== state) return null;
  // Locator discovery has no retrying assertion semantics: one failed exact
  // lookup on unchanged evidence already requires a corrected selector.
  return recorded.failure;
}

/** A validated locator is discovery, never an expected-result assertion. Reuse
 * only the host's actual successful receipt on the same rendered/action state;
 * JSON history and model text cannot populate this cache. */
function confirmedLocatorValidation({ request, observations, stepId }) {
  if (request?.name !== 'browser_validate_locator') return null;
  const key = checkKey(request);
  if (!key) return null;
  const state = browserRecoveryState(observations, request);
  const previous = observations.findLast(item => item.execution_step_id === stepId && checks.get(item)?.key === key);
  const recorded = previous && checks.get(previous);
  const receipt = previous && browserReceipt(previous);
  if (!recorded || recorded.state !== state || recorded.failure || receipt?.match_count !== 1 || receipt.unique !== true) return null;
  return { match_count: 1, unique: true, source_observation: previous };
}

function unresolvedBrowserFailure(observations, stepId) {
  let assertionFailure, locatorFailure;
  for (const item of observations) {
    if (item.execution_step_id !== stepId || item.mcp_call === false) continue;
    const failure = unsuccessfulBrowserCheck(item), receipt = browserReceipt(item);
    if (failure) {
      if (item.tool === 'browser_assert') assertionFailure = failure;
      else if (item.tool === 'browser_validate_locator') locatorFailure = failure;
    } else if (item.tool === 'browser_assert' && receipt?.assertion_outcome === 'satisfied') {
      assertionFailure = undefined; locatorFailure = undefined;
    } else if (item.tool === 'browser_validate_locator' && receipt?.match_count === 1 && receipt.unique === true) locatorFailure = undefined;
  }
  return locatorFailure || assertionFailure;
}

function browserToolBudgetError({ observations, stepId, calls, maxCalls }) {
  const failure = unresolvedBrowserFailure(observations, stepId);
  return Object.assign(new Error(`The browser tool budget was reached before this section completed.${failure ? ` Latest observed issue: ${failure.message}` : ' Completed sections remain saved; review the unfinished work before retrying.'}`), {
    code: 'AUTOMATION_BROWSER_TOOL_BUDGET_EXHAUSTED', statusCode: 422, nonRetryable: true,
    details: { step_id: stepId, tool_calls: calls, tool_call_limit: maxCalls, ...(failure ? { latest_browser_failure: failure } : {}) }
  });
}

module.exports = { browserVerificationBoundary, unsuccessfulBrowserCheck, browserRecoveryState, recordBrowserCheck, browserCheckPromptDetails, repeatedUnsuccessfulCheck, confirmedLocatorValidation, unresolvedBrowserFailure, browserToolBudgetError };
