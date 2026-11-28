const { createHash } = require('node:crypto');
const apiRepair = require('../lib/verification/automationApiRepair');

const MAX_PROJECTION_BYTES = 24_000;
const MODEL_CONTRACT = Object.freeze({
  schema: 'automation-repair/3', target: 'only the pinned first failed case-owned section',
  source_contract: 'Native Web repair uses the Automation Engineer compiler, including existing awaited web helpers. Native API repair changes only a request URL path on the same origin to the exact authored target.',
  changes: 'Correct observed locators consistently across actions and assertions. For API, preserve method, query, body, authentication, captures, explicit assertions and every parameter binding. Preserve every action, predicate, expected value, timeout and checkpoint in order.',
  diagnosis: 'Use the selected Run’s first-failure report for Web context. A recorded candidate establishes uniqueness at observation time, not the intended subject. Match it to the saved case intent before proposing. For a timing, environment or expected-result route, explain the recorded finding and return no patch. For missing evidence, return null when the trace and case do not establish a replacement.',
  evidence_freshness: 'The exact failed result, frozen fixture and complete source are pinned. A changed failure or edited source invalidates this proposal. Missing prerequisite evidence requires a new recorded Run, not guessed setup or a weaker assertion.',
  output: 'For Web, choose replace_locator with step_id/new_locator/rationale or replace_instructions with step_id/automation_code/rationale. For API, choose replace_api_url with step_id/new_url/rationale and one supplied authored endpoint. Return null for insufficient evidence.',
  verification: 'A proposal is unverified. Pinned runs must reproduce the original failure, pass the entire repaired case including following steps and hooks, and exercise the selected known-negative oracle. API checks require HTTP assertion evidence; browser checks use fresh sessions.'
});
const sourceDigest = source => createHash('sha256').update(String(source || ''), 'utf8').digest('hex');

/** Keep the failed section exact and early in context. Unchanged sections
 * contribute their intent and pinned source identities, rather than sending
 * their complete programs to the model again. An oversized contract is
 * rejected atomically by the caller, never sliced into incomplete JSON. */
function repairProjection({ test, steps, focus, base, failureEvidence, sourceChanged }) {
  const focused = steps.find(step => step.id === focus.id);
  const request = apiRepair.executableRequest(focused);
  const apiFocus = request ? {
    runtime: 'api', method: request.method, endpoint: request.url.split('?')[0],
    allowed_endpoints: apiRepair.authoredTargets(focused, base.api_base_url),
    assertion_kinds: request.validations.map(assertion => assertion.kind)
  } : null;
  const projection = {
    contract: {
      alternatives: apiFocus ? [
        { kind: 'replace_api_url', step_id: focus.id, new_url: 'one exact endpoint from focus.allowed_endpoints', rationale: 'evidence-backed reason, at least 20 characters' }
      ] : [
        { kind: 'replace_locator', step_id: focus.id, new_locator: 'observed literal locator for a section with one saved subject', rationale: 'evidence-backed reason, at least 20 characters' },
        { kind: 'replace_instructions', step_id: focus.id, automation_code: 'complete native Playwright section or existing awaited web helper statements', rationale: 'evidence-backed reason, at least 20 characters' }
      ],
      preserve: ['Every saved action and assertion in order', 'Input data and exact parameter scope', 'Assertion predicate, expected value and timeouts', apiFocus ? 'Request method, query, body, authentication and captures' : 'One consistent subject across each control’s actions and checks'],
      workflow: 'Diagnose the first failed section in the whole case intent. Change only that section. Reproduce its original failure, then execute the complete repaired case with pinned runtime evidence so its prerequisites and every successor are verified. A proposal alone is unverified.'
    },
    focus: { id: focus.id, order: focus.step_order, action: focused.action, expected_result: focused.expected_result, ...(apiFocus || { code: focused.automation_code }) },
    observed_failure: failureEvidence,
    case: { id: test.id, title: test.title, description: test.description, gherkin_document: test.gherkin_document },
    verification_scope: {
      focused_step_id: focus.id, focused_step_order: focus.step_order,
      preceding_step_ids: steps.filter(step => step.step_order < focus.step_order).map(step => step.id),
      successor_step_ids: steps.filter(step => step.step_order > focus.step_order).map(step => step.id),
      execution: steps.some(step=>step.step_type==='api')?'whole_case_frozen_runtime':'whole_case_fresh_browser',
      linked_cases: 'Pinned before/after case links and execution hooks remain part of every validation Run; repair does not inline or omit their steps.'
    },
    code_changed_since_failure: sourceChanged,
    test_case_id: base.test_case_id, execution_id: base.execution_id, build: base.build,
    environment_id: base.environment_id, source_hash: base.source_hash, failed_step_ids: [focus.id],
    steps: steps.map(step => ({ id: step.id, order: step.step_order, action: step.action,
      expected_result: step.expected_result, source_hash: sourceDigest(step.step_type==='api' ? JSON.stringify(step.api_request) : step.automation_code) })),
    limitations: [
      'Only the focused case-owned section can change. Current Playwright sections use the same closed native program contract as Automation Engineer. Existing web helpers remain supported.',
      'No extra actions, removed checks, arbitrary scripts, fixture/data changes, assertion weakening or changed waits are accepted by native repair. A different requirement needs an explicit authored change.',
      'Unchanged code is withheld to conserve context; its complete intent and source fingerprint remain pinned. Runner verification executes every saved section and rejects stale evidence.',
      'The failed result and frozen fixture are fingerprinted before model review and checked again before proposal save and validation planning. They are observations, never authorization to execute or apply a repair.'
    ]
  };
  return Buffer.byteLength(JSON.stringify(projection)) <= MAX_PROJECTION_BYTES ? projection : null;
}

module.exports = { repairProjection, MAX_PROJECTION_BYTES, MODEL_CONTRACT };
