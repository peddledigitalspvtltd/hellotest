const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { buildFailureProgress } = require('../../backend/lib/automationBuildFailureProgress');
const { browserBootstrapFailure } = require('../../backend/lib/automationBrowserBootstrapFailure');
const { reduceActivityProgress } = require('../../backend/lib/automationActivityProgress');

test('repeated unobserved targets receive actionable safe browser diagnostics while invalid flow context stays context',()=>{
 const stalled=Object.assign(new Error('Private selector #password-internal and provider response'),{code:'AUTOMATION_BROWSER_TARGET_PROPOSAL_STALLED',saved_sections:2,active_step_id:'active',details:{locator:'#password-internal'}});
 for(const modelStarted of [false,true]){
  const event=buildFailureProgress(stalled,{modelStarted});assert.equal(event.phase,'automation.agent.browser.failed');assert.equal(event.details.failure_stage,'browser');assert.equal(event.details.saved_sections,2);
  assert.match(event.message,/No browser action ran for the repeated proposal/);assert.match(event.message,/current observed target reference or scoped discovery/);assert.match(event.message,/Previously saved Plan sections/);
  assert.doesNotMatch(JSON.stringify(event),/Private selector|password-internal|provider response/);
  const context=buildFailureProgress(Object.assign(new Error('Private planning payload'),{code:'AUTOMATION_FLOW_PLAN_CONTEXT_INVALID',saved_sections:2}),{modelStarted});
  assert.equal(context.details.failure_stage,'context');assert.equal(context.phase,'automation.agent.blocked');assert.equal(context.level,'warning');assert.equal(context.details.saved_sections,2);
  assert.match(context.message,/brief and configured parameters/);assert.doesNotMatch(JSON.stringify(context),/Private planning payload/);
 }
});

test('known provider failures remain model failures before or after generation starts with safe actionable messages', () => {
  const cases = [
    ['LLM_REQUEST_TOO_LARGE', /Reduce the request size/],
    ['LLM_RATE_LIMIT_REQUEST_TOO_LARGE', /provider token capacity/],
    ['LLM_RATE_LIMITED', /Wait for the provider limit to reset/],
    ['LLM_QUOTA_EXCEEDED', /usage and billing settings/],
    ['LLM_AUTHENTICATION_FAILED', /credentials, model access and base URL/]
  ];
  for (const [code, expected] of cases) for (const modelStarted of [false, true]) {
    const error = Object.assign(new Error('private organization detail and raw provider body'), { code, saved_sections: 2, active_step_id: 'unfinished' });
    const event = buildFailureProgress(error, { modelStarted });
    assert.equal(event.phase, 'automation.llm.failed'); assert.equal(event.details.failure_stage, 'model'); assert.equal(event.details.error_code, code);
    assert.equal(event.details.saved_sections, 2); assert.equal(event.details.active_step_id, 'unfinished');
    assert.match(event.message, expected); assert.match(event.message, /Previously saved Plan sections remain available/);
    assert.doesNotMatch(JSON.stringify(event), /private organization|raw provider body|browser inspection/i);
  }
});

test('the actual pre-model launch failure stays in browser startup with a typed public outcome', () => {
  const error = browserBootstrapFailure({ isError: true, content: [{ type: 'text', text: JSON.stringify({ code: 'BROWSER_LAUNCH_FAILED', launch_phase: 'startup',
    action_outcome: 'not_attempted', retry_safe: true, message: 'private browser command arguments' }) }] });
  Object.assign(error, { automatic_retry_exhausted: true, nonRetryable: true });
  const event = buildFailureProgress(error);
  assert.equal(event.phase, 'automation.agent.browser.startup.failed');
  assert.equal(event.details.error_code, 'AUTOMATION_BROWSER_STARTUP_FAILED');
  assert.equal(event.details.failure_stage, 'browser_startup');
  assert.equal(event.details.automatic_retry_exhausted, true);
  assert.match(event.message, /No model request or test action/);
  assert.doesNotMatch(JSON.stringify(event), /private browser command/);
});

test('typed HTTP navigation errors remain actionable in public activity and per-step build errors', () => {
  const error = browserBootstrapFailure({ isError: true, content: [{ type: 'text', text: JSON.stringify({ code: 'BROWSER_NAVIGATION_FAILED', http_status: 502,
    action_outcome: 'completed', retry_safe: false, message: 'raw https://private.example/hidden?token=fixture-secret' }) }] });
  error.active_step_id = 'active';
  const event = buildFailureProgress(error);
  assert.equal(event.phase, 'automation.agent.browser.failed');
  assert.equal(event.details.failure_stage, 'browser');
  assert.equal(event.details.error_code, 'AUTOMATION_BROWSER_NAVIGATION_HTTP_ERROR');
  assert.equal(event.details.http_status, 502); assert.equal(event.details.retry_safe, false);
  assert.match(event.message, /HTTP 502/); assert.match(event.message, /upstream services/);
  const state = { step_progress: [{ test_case_id: 'case', step_id: 'active', status: 'in_progress', instruction_status: 'requested' }] };
  const progress = reduceActivityProgress(state, { ...event, details: { ...event.details, test_case_id: 'case' } });
  const issue = progress.step_progress[0].build_errors[0];
  assert.equal(issue.http_status, 502); assert.match(issue.message, /HTTP 502/);
  assert.doesNotMatch(JSON.stringify({ event, progress }), /https?:|private.example|hidden|fixture-secret|raw /);
});

test('browser, save, missing-context and model failures retain their actual stage and saved count', () => {
  assert.equal(buildFailureProgress(new Error('Browser connection failed')).phase, 'automation.agent.browser.failed');
  assert.equal(buildFailureProgress(Object.assign(new Error('Storage rejected'), { code: '23514', automation_stage: 'save', saved_sections: 2 }), { modelStarted: true }).details.failure_stage, 'save');
  const blocker = { step_id: 'section', dependency_type: 'mailbox', reason: 'Configure the inbox' };
  const context = buildFailureProgress(Object.assign(new Error('Inbox needed'), { code: 'AUTOMATION_DEPENDENCY_MISSING', blocked_steps: [blocker], saved_sections: 3 }), { modelStarted: true });
  assert.equal(context.phase, 'automation.agent.blocked');
  assert.equal(context.details.saved_sections, 3);
  assert.deepEqual(context.details.blocked_steps, [blocker]);
  assert.equal(buildFailureProgress(Object.assign(new Error('Provider unavailable'), { code: 'HTTP_503' }), { modelStarted: true }).phase, 'automation.llm.failed');
  assert.equal(buildFailureProgress(Object.assign(new Error('Action outcome unknown'), { code: 'AUTOMATION_BROWSER_OUTCOME_UNKNOWN' }), { modelStarted: true }).details.failure_stage, 'browser');
  assert.equal(buildFailureProgress(Object.assign(new Error('Update runner'), { code: 'AUTOMATION_MCP_CAPABILITY_MISSING' }), { modelStarted: true }).details.failure_stage,'browser');
  assert.equal(buildFailureProgress(Object.assign(new Error('Explain the intended flow'), { code:'AUTOMATION_FLOW_PLAN_INVALID' }),{modelStarted:true}).details.failure_stage,'context');
});

test('browser-stage failure stops manual and section loaders while preserving already-saved Plan work', () => {
  const metadata = { step_progress: [
    { test_case_id: 'case', step_id: 'saved', status: 'completed', instruction_status: 'saved' },
    { test_case_id: 'case', step_id: 'active', status: 'in_progress', instruction_status: 'requested' }
  ], manual_step_progress: [
    { test_case_id: 'case', manual_step_id: 'manual-active', section_step_id: 'active', status: 'in_progress' },
    { test_case_id: 'case', manual_step_id: 'manual-unmapped', status: 'queued' }
  ] };
  for (const phase of ['automation.agent.browser.failed', 'automation.agent.browser.startup.failed']) {
    const progress = reduceActivityProgress(metadata, { phase, details: { test_case_id: 'case' } });
    assert.equal(progress.step_progress[0].instruction_status, 'saved');
    assert.equal(progress.step_progress[0].status, 'completed');
    assert.equal(progress.step_progress[1].status, 'needs_attention');
    assert.equal(progress.manual_step_progress[0].status,'needs_attention');
    assert.equal(progress.manual_step_progress[1].status,'queued','future unstarted manual work is not a failed step');
  }
});

test('a typed browser budget failure after successful model calls retains its real stage and last check code', () => {
  const error = Object.assign(new Error('Private lower-level detail'), {code:'AUTOMATION_BROWSER_TOOL_BUDGET_EXHAUSTED',saved_sections:2,
    details:{tool_calls:12,tool_call_limit:12,latest_browser_failure:{code:'BROWSER_LOCATOR_NOT_UNIQUE',message:'Private page content'}}});
  const progress = buildFailureProgress(error, {modelStarted:true});
  assert.equal(progress.phase,'automation.agent.browser.failed'); assert.equal(progress.details.failure_stage,'browser');
  assert.equal(progress.details.error_code,error.code); assert.equal(progress.details.browser_code,'BROWSER_LOCATOR_NOT_UNIQUE');
  assert.equal(progress.details.tool_calls,12); assert.equal(progress.details.tool_call_limit,12); assert.equal(progress.details.saved_sections,2);
  assert.doesNotMatch(JSON.stringify(progress),/Private/); assert.match(progress.message,/last unsuccessful browser check/);
});

test('the real single-case outcome retains code compatibility and exposes startup error_code and failure_stage', async () => {
  const source = fs.readFileSync(require.resolve('../../backend/services/aiAutomationBuilder.service'), 'utf8');
  const single = source.slice(source.indexOf('exports.buildAutomationForCase ='), source.indexOf('exports.buildAutomationBatch ='));
  const updates = [], exported = {};
  const error = Object.assign(new Error('Browser could not start'), { code: 'AUTOMATION_BROWSER_STARTUP_FAILED', failure_stage: 'browser_startup',
    saved_sections: 0, automation_test_case_id: 'automation' });
  const workspace = { createTransaction: async () => ({ id: 'activity' }), updateTransaction: async (id, data) => { updates.push(data); return { id }; } };
  new Function('exports', 'buildFeature', 'normalizeText', 'selectCaseWithScope', 'workspaceTransactionService', 'buildCaseCore', 'appendEvent', single)(
    exported, value => value, value => value || null, { get: async () => ({ id: 'automation', title: 'Journey', app_type_id: 'app', project_id: 'project' }) },
    workspace, async () => { throw error; }, async () => {}
  );
  await assert.rejects(exported.buildAutomationForCase({ test_case_id: 'automation', created_by: 'author' }), value => value === error);
  const outcome = updates.at(-1).metadata.case_outcomes[0];
  assert.equal(outcome.code, error.code);
  assert.equal(outcome.error_code, error.code);
  assert.equal(outcome.failure_stage, 'browser_startup');
  assert.equal(outcome.changes_saved, false);
});

test('real single and batch outcomes retain HTTP 502 without copying the browser payload or admitting a worker retry', async () => {
  const source = fs.readFileSync(require.resolve('../../backend/services/aiAutomationBuilder.service'), 'utf8');
  const single = source.slice(source.indexOf('exports.buildAutomationForCase ='), source.indexOf('exports.buildAutomationBatch ='));
  const batch = source.slice(source.indexOf('exports.buildAutomationBatch ='), source.indexOf('exports.listLearningCache ='));
  const error = browserBootstrapFailure({ isError: true, content: [{ type: 'text', text: JSON.stringify({ code: 'BROWSER_NAVIGATION_FAILED', http_status: 502,
    action_outcome: 'completed', retry_safe: false, message: 'raw https://private.example/path?token=fixture-secret' }) }] });
  Object.assign(error, { failure_stage: 'browser', automation_test_case_id: 'automation', saved_sections: 0 });
  const updates = [], events = [], exported = {};
  const workspace = { createTransaction: async () => ({ id: 'activity' }), updateTransaction: async (id, data) => { updates.push(data); return { id }; }, getTransaction: async () => ({ metadata: {} }) };
  const context = { exports: exported, buildFeature: value => value, normalizeText: value => value || null,
    normalizeIdList: value => value, DEFAULT_BATCH_FAILURE_THRESHOLD: 3,
    selectCaseWithScope: { get: async () => ({ id: 'automation', title: 'Journey', app_type_id: 'app', project_id: 'project', app_type_kind: 'web' }) },
    workspaceTransactionService: workspace, buildCaseCore: async () => { throw error; },
    appendEvent: async (id, event) => { events.push(event); }, updateTransaction: workspace.updateTransaction,
    require: name => { assert.equal(name, './automationBuildTargets.service'); return require('../../backend/services/automationBuildTargets.service'); }
  };
  new Function(...Object.keys(context), single + '\n' + batch)(...Object.values(context));
  await assert.rejects(exported.buildAutomationForCase({ test_case_id: 'automation', created_by: 'author' }), value => value === error);
  const singleOutcome = updates.at(-1).metadata.case_outcomes[0];
  assert.equal(singleOutcome.http_status, 502); assert.equal(singleOutcome.failure_stage, 'browser');
  assert.match(singleOutcome.message, /HTTP 502/);
  updates.length = 0;
  const result = await exported.buildAutomationBatch({ app_type_id: 'app', test_case_ids: ['automation'], created_by: 'author' });
  assert.equal(result.failed, 1); assert.equal(result.errors[0].http_status, 502);
  const batchOutcome = updates.at(-1).metadata.case_outcomes[0];
  assert.equal(batchOutcome.http_status, 502); assert.match(batchOutcome.message, /HTTP 502/);
  assert.doesNotMatch(JSON.stringify({ updates, events, singleOutcome, result }), /https?:|private.example|fixture-secret|raw /);
});
