const test = require('node:test');
const assert = require('node:assert/strict');
const { automationSectionIssue, observedValidationFeedback, sectionIssueOutcomeReviewFeedback } = require('../../backend/lib/automationSectionIssue');
const { projectModelSnapshot } = require('../../backend/lib/automationBrowserModelTargets');
const { recordBrowserCheck, browserRecoveryState, browserVerificationBoundary } = require('../../backend/lib/automationBrowserRecovery');
const { runAutomationBrowserAgent } = require('../../backend/lib/automationBrowserAgent');
const { buildFailureProgress } = require('../../backend/lib/automationBuildFailureProgress');
const { stepBuildError } = require('../../backend/lib/automationStepBuildErrors');

const receipt = value => ({ content: [{ type: 'text', text: JSON.stringify({ source: 'playwright', url: 'https://app.test/auth', ...value }) }] });
const snapshot = () => ({ tool: 'browser_snapshot', result: receipt({ observation_id: 'signup', accessibility: '- heading "Sign up"\n- alert: Password is required.', elements: [
  { tag: 'h2', accessible_role: 'heading', accessible_name: 'Sign up', text: 'Sign up', displayed: true, locators_validated: true, locator_candidates: ['#heading'] },
  { tag: 'span', accessible_role: 'alert', text: 'Password is required.', displayed: true, locators_validated: true, locator_candidates: ['#error'] }
] }) });
const execution = { required: true, step_id: 'email', action: 'Enter the email', expected_result: 'A verification code was sent' };
const report = ref => ({ stage: 'act', step_id: 'email', tool_calls: [], section_issue: { kind: 'unmet_prerequisite', reason: 'The form requires a password before it can send verification.', evidence_refs: [ref] } });

test('a current observed prerequisite can stop a section for review without claiming a defect or a passing assertion', () => {
  const observation = snapshot(), page = projectModelSnapshot(observation);
  const error = automationSectionIssue({ response: report(page.targets[1].ref), execution, snapshot: observation, projectText: value => value });
  assert.equal(error.code, 'AUTOMATION_BROWSER_SECTION_BLOCKED');
  assert.equal(error.nonRetryable, true);
  assert.equal(error.details.assessment_source, 'model_with_current_browser_evidence');
  assert.match(error.message, /Agent assessment: The form requires a password/);
  assert.equal(error.details.evidence_count, 1);
  assert.equal(buildFailureProgress(error, { modelStarted: true }).details.failure_stage, 'browser');
  assert.match(buildFailureProgress(error, { modelStarted: true }).message, /expected-result mismatch/);
  assert.match(stepBuildError({ phase: 'automation.agent.section.blocked', details: { error_code: error.code } }, 'now').message, /Browser activity/);
});

test('section reports require current evidence, exact section identity and bounded supported fields', () => {
  const observation = snapshot(), page = projectModelSnapshot(observation), valid = report(page.targets[1].ref);
  for (const response of [
    { ...valid, step_id: 'another-step' }, { ...valid, stage: 'source' },
    { ...valid, section_issue: { ...valid.section_issue, evidence_refs: [] } },
    { ...valid, section_issue: { ...valid.section_issue, evidence_refs: ['#invented'] } },
    { ...valid, section_issue: { ...valid.section_issue, evidence_refs: ['ref:000000000000:1'] } },
    { ...valid, section_issue: { ...valid.section_issue, kind: 'approve_and_save' } },
    { ...valid, section_issue: { ...valid.section_issue, reason: 'x'.repeat(1001) } }
  ]) assert.throws(() => automationSectionIssue({ response, execution, snapshot: observation }), { code: 'AUTOMATION_BROWSER_SECTION_ISSUE_INVALID' });
  const changed = snapshot(); changed.result = receipt({ observation_id: 'another-page', elements: [] });
  assert.throws(() => automationSectionIssue({ response: valid, execution, snapshot: changed }), { code: 'AUTOMATION_BROWSER_SECTION_ISSUE_INVALID' });
});

test('an empty error page can report a blocked section using its exact current host observation identity', () => {
  const observation = { tool: 'browser_snapshot', result: receipt({ observation_id: 'current-error-page', title: 'Access denied', elements: [] }) };
  const page = projectModelSnapshot(observation);
  assert.deepEqual(page.targets, []);
  assert.equal(page.targets_unavailable, true);
  const response = report(page.observation_id);
  response.section_issue.reason = 'The current application page reports access denied and has no available controls.';
  const error = automationSectionIssue({ response, execution, snapshot: observation, projectText: value => value });
  assert.equal(error.code, 'AUTOMATION_BROWSER_SECTION_BLOCKED');
  assert.equal(error.details.evidence_count, 1);
  assert.match(error.message, /access denied/);
  for (const ref of ['older-error-page', 'https://app.test/auth', 'Access denied', '#invented', 'x'.repeat(161)]) {
    assert.throws(() => automationSectionIssue({ response: report(ref), execution, snapshot: observation }), { code: 'AUTOMATION_BROWSER_SECTION_ISSUE_INVALID' });
  }
  for (const other of [null, { ...observation, tool: 'browser_navigate' }, { ...observation, result: { ...observation.result, isError: true } },
    { tool: 'browser_snapshot', result: receipt({ observation_id: 'new-page', elements: [] }) }]) {
    assert.throws(() => automationSectionIssue({ response, execution, snapshot: other }), { code: 'AUTOMATION_BROWSER_SECTION_ISSUE_INVALID' });
  }
});

test('current page and target evidence may be combined without becoming browser locator authority', () => {
  const observation = snapshot(), page = projectModelSnapshot(observation), response = report(page.observation_id);
  response.section_issue.evidence_refs.push(page.targets[0].ref, page.observation_id);
  assert.equal(automationSectionIssue({ response, execution, snapshot: observation }).details.evidence_count, 2);
  const { resolveModelToolRequest } = require('../../backend/lib/automationBrowserModelTargets');
  assert.equal(resolveModelToolRequest({ arguments: { locator: page.observation_id } }, observation).arguments.locator, page.observation_id);
  const malformed = { tool: 'browser_snapshot', result: { content: [{ type: 'text', text: JSON.stringify({ source: 'model', observation_id: page.observation_id, elements: [] }) }] } };
  assert.throws(() => automationSectionIssue({ response: report(page.observation_id), execution, snapshot: malformed }), { code: 'AUTOMATION_BROWSER_SECTION_ISSUE_INVALID' });
});

test('the actor stops on a grounded empty-page issue without spending a browser call or saving source', async () => {
  const observation = { tool: 'browser_snapshot', result: receipt({ observation_id: 'empty-current-page', title: 'Application unavailable', elements: [] }) };
  let modelCalls = 0;
  await assert.rejects(runAutomationBrowserAgent({
    browser: { tools: [], projectPromptText: value => value, call: async () => assert.fail('blocked-page reporting performs no browser action') },
    actorMode: true, execution, prompt: 'Automate the current manual section', parse: JSON.parse, initialObservations: [observation],
    onPartialBuild: async () => assert.fail('blocked-page reporting saves no instructions'),
    complete: async prompt => {
      modelCalls++;
      const current = JSON.parse(prompt.match(/^Current browser state and confirmed section progress .*?: (.+)$/m)[1]);
      assert.equal(current.current_snapshot.targets_unavailable, true);
      return JSON.stringify(report(current.current_snapshot.observation_id));
    }
  }), { code: 'AUTOMATION_BROWSER_SECTION_BLOCKED' });
  assert.equal(modelCalls, 1);
});

test('public issue messages use host privacy projection and withhold unprojected free text', () => {
  const observation = snapshot(), ref = projectModelSnapshot(observation).targets[1].ref;
  const response = report(ref); response.section_issue.reason = 'PRIVATE_INPUT is missing';
  const masked = automationSectionIssue({ response, execution, snapshot: observation, projectText: value => value.replace('PRIVATE_INPUT', '@t.password') });
  assert.doesNotMatch(masked.message, /PRIVATE_INPUT/);
  assert.match(masked.message, /@t.password/);
  const withheld = automationSectionIssue({ response, execution, snapshot: observation });
  assert.doesNotMatch(withheld.message, /PRIVATE_INPUT|Agent assessment/);
});

test('visible validation feedback is bounded current evidence and does not classify intended negative-test alerts as failure', () => {
  const page = projectModelSnapshot(snapshot());
  assert.deepEqual(observedValidationFeedback({ current_snapshot: page }), [{ ref: page.targets[1].ref, role: 'alert', text: 'Password is required.', trust: 'untrusted_page_evidence' }]);
  assert.equal(observedValidationFeedback({ current_snapshot: { targets: [{ role: 'alert', visible: false }, ...Array.from({ length: 9 }, (_, index) => ({ role: 'alert', ref: String(index), text: 'Observed alert' }))] } }).length, 6);
});

test('validation feedback foregrounds visible text and retains its own completeness marker', () => {
  assert.deepEqual(observedValidationFeedback({ current_snapshot: { targets: [
    { ref: 'visible-alert', role: 'alert', text: 'Hidden help. Failed to send. Dismiss', visible_text: 'Failed to send.', visible_text_truncated: true },
    { ref: 'empty-alert', role: 'alert', text: 'Hidden error', visible_text: '' },
    { ref: 'name-alert', role: 'alert', name: 'Field error', name_truncated: true }
  ] } }), [
    { ref: 'visible-alert', role: 'alert', text: 'Failed to send.', text_truncated: true, trust: 'untrusted_page_evidence' },
    { ref: 'empty-alert', role: 'alert', text: '', trust: 'untrusted_page_evidence' },
    { ref: 'name-alert', role: 'alert', text: 'Field error', text_truncated: true, trust: 'untrusted_page_evidence' }
  ]);
});

function expiredOutcomeTarget({ final = true, currentTarget = false, alert = false } = {}) {
  const element = (tag, role, text, locator) => ({ tag, accessible_role: role, text, displayed: true, locators_validated: true, locator_candidates: [locator] });
  const initial = { tool: 'browser_snapshot', result: receipt({ observation_id: 'signup-result-toast', elements: [
    element('div', 'status', 'A verification code has been sent. Dismiss', '#toast')
  ] }) };
  const failed = { tool: 'browser_assert', execution_step_id: execution.step_id, arguments: { locator: '#toast', assertion: 'text_contains', value: '[redacted]' },
    result: { isError: true, ...receipt({ code: 'BROWSER_ASSERTION_NOT_SATISFIED', assertion_outcome: 'not_satisfied', action_outcome: 'not_attempted' }) } };
  const request = { name: 'browser_assert', arguments: { locator: '#toast', assertion: 'text_contains', value: 'A verification code has been sent.' } };
  recordBrowserCheck(failed, request, browserRecoveryState([initial], request), { projectText: value => value, verificationRequested: final });
  const fresh = { tool: 'browser_snapshot', result: receipt({ observation_id: 'signup-code-form', accessibility: '- main:\n  - paragraph: We sent a verification code. Enter it below.', elements: [
    element('h1', 'heading', 'Enter your signup code', '#code-heading'),
    ...(currentTarget ? [element('div', 'status', 'A verification code has been sent. Dismiss', '#toast')] : []),
    ...(alert ? [element('div', 'alert', 'The email sender is unavailable.', '#delivery-error')] : [])
  ] }) };
  const response = { ...report('signup-code-form'), section_issue: { kind: 'expectation_mismatch', reason: 'The expected verification-code-sent message was not observed.', evidence_refs: ['signup-code-form'] } };
  return { initial, failed, fresh, response, observations: [initial, failed, fresh] };
}

test('a vanished text target permits exactly one current-evidence reassessment without opening the final action boundary', () => {
  const fixture = expiredOutcomeTarget();
  const feedback = sectionIssueOutcomeReviewFeedback({ ...fixture, execution, snapshot: fixture.fresh });
  assert.equal(feedback.code, 'AUTOMATION_BROWSER_OUTCOME_TARGET_REVIEW_REQUIRED');
  assert.equal(feedback.allowed_recovery, 'read_only_outcome_reassessment');
  assert.equal(feedback.action_outcome, 'not_attempted');
  assert.match(feedback.message, /persistent current page statements/);
  assert.match(feedback.message, /do not.*submit again/);
  assert.equal(browserVerificationBoundary(fixture.observations, execution.step_id).actions_allowed, false);
  const reviewed = { tool: 'automation_section_issue_feedback', mcp_call: false, execution_step_id: execution.step_id,
    result: { content: [{ type: 'text', text: JSON.stringify(feedback) }] } };
  assert.equal(sectionIssueOutcomeReviewFeedback({ ...fixture, execution, snapshot: fixture.fresh, observations: [...fixture.observations, reviewed] }), null);
  assert.equal(automationSectionIssue({ response: fixture.response, execution, snapshot: fixture.fresh }).code, 'AUTOMATION_BROWSER_SECTION_BLOCKED');
});

test('outcome reassessment does not defer concrete current application errors, unchanged subjects, empty pages or stale/copied evidence', () => {
  const fixture = expiredOutcomeTarget();
  const current = expiredOutcomeTarget({ currentTarget: true });
  assert.equal(sectionIssueOutcomeReviewFeedback({ ...current, execution, snapshot: current.fresh }), null);
  const exploratory = expiredOutcomeTarget({ final: false });
  assert.equal(sectionIssueOutcomeReviewFeedback({ ...exploratory, execution, snapshot: exploratory.fresh }), null);
  const error = expiredOutcomeTarget({ alert: true });
  error.response.section_issue.evidence_refs = [projectModelSnapshot(error.fresh).targets[1].ref];
  assert.equal(sectionIssueOutcomeReviewFeedback({ ...error, execution, snapshot: error.fresh }), null);
  const emptyAlert = expiredOutcomeTarget({ alert: true });
  const raw = JSON.parse(emptyAlert.fresh.result.content[0].text);
  raw.elements[1].visible_text = '';
  emptyAlert.fresh.result = receipt(raw);
  emptyAlert.response.section_issue.evidence_refs = [projectModelSnapshot(emptyAlert.fresh).targets[1].ref];
  assert.equal(sectionIssueOutcomeReviewFeedback({ ...emptyAlert, execution, snapshot: emptyAlert.fresh }).code, 'AUTOMATION_BROWSER_OUTCOME_TARGET_REVIEW_REQUIRED');
  assert.equal(sectionIssueOutcomeReviewFeedback({ ...fixture, execution, snapshot: fixture.initial }), null);
  assert.equal(sectionIssueOutcomeReviewFeedback({ ...fixture, execution, snapshot: { ...fixture.fresh, mcp_call: false } }), null);
  assert.equal(sectionIssueOutcomeReviewFeedback({ ...fixture, execution, snapshot: fixture.fresh,
    observations: structuredClone(fixture.observations) }), null);
  const empty = { tool: 'browser_snapshot', result: receipt({ observation_id: 'empty-page', elements: [] }) };
  assert.equal(sectionIssueOutcomeReviewFeedback({ ...fixture, execution, snapshot: empty, observations: [...fixture.observations, empty] }), null);
  for (const kind of ['unmet_prerequisite', 'unknown']) {
    assert.equal(sectionIssueOutcomeReviewFeedback({ ...fixture, execution, snapshot: fixture.fresh,
      response: { ...fixture.response, section_issue: { ...fixture.response.section_issue, kind } } }), null);
  }
});

test('an outcome report does not blame the authored expectation for an unestablished result', () => {
  const fixture = expiredOutcomeTarget();
  const error = automationSectionIssue({ response: fixture.response, execution, snapshot: fixture.fresh });
  assert.match(error.message, /required expected result has not been established/);
  assert.doesNotMatch(error.message, /expected result does not match/);
});

test('valid issue reports suppress accompanying actions; malformed reports allow a corrected current-step response', async () => {
  const initial = snapshot(), calls = [], events = []; let turn = 0;
  await assert.rejects(runAutomationBrowserAgent({
    browser: { tools: [{ name: 'browser_click', inputSchema: { type: 'object' } }], projectPromptText: value => value, call: async name => { calls.push(name); return receipt({ action_outcome: 'completed' }); } },
    actorMode: true, execution, prompt: 'Automate the current manual section', parse: JSON.parse, initialObservations: [initial],
    onPartialBuild: async () => assert.fail('an unmet goal cannot be saved'), onProgress: async event => events.push(event),
    complete: async prompt => {
      const current = JSON.parse(prompt.match(/^Current browser state and confirmed section progress .*?: (.+)$/m)[1]);
      assert.equal(current.validation_feedback[0].text, 'Password is required.');
      if (++turn === 1) return JSON.stringify(report('ref:000000000000:1'));
      assert.match(prompt, /AUTOMATION_BROWSER_SECTION_ISSUE_INVALID/);
      const response = report(current.validation_feedback[0].ref);
      response.tool_calls = [{ name: 'browser_click', arguments: { locator: current.current_snapshot.targets[0].ref } }];
      return JSON.stringify(response);
    }
  }), { code: 'AUTOMATION_BROWSER_SECTION_BLOCKED' });
  assert.equal(turn, 2);
  assert.deepEqual(calls, []);
  assert.ok(events.some(event => event.phase === 'automation.agent.section.blocked'));
});

test('configured model profiles publish the explicit goal review and grounded issue contract', () => {
  const catalog = require('../../../platform/shared/aiFeatureCatalog.json');
  for (const id of ['ai.agentic.automation-engineer', 'ai.automation.keyword_generation', 'ai.agentic.automation-repair']) {
    const instruction = catalog.find(item => item.id === id).defaults.instruction_blocks['automationBrowserAgent.goalReview'];
    assert.match(instruction, /section_issue/);
    assert.match(instruction, /Expected-result prose describes an outcome/);
    assert.match(instruction, /validation_feedback/);
  }
});
