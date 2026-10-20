const {semanticIssues,providerFailureMessages,prerequisiteFailureMessages,retainedSubjectFailureMessages}=require('./automationStepBuildErrors');
const {navigationHttpStatus,navigationHttpFailureMessage}=require('./automationBrowserBootstrapFailure');

function buildFailureProgress(error, { modelStarted = false } = {}) {
  const code = typeof error?.code === 'string' ? error.code : null;
  const httpStatus = code === 'AUTOMATION_BROWSER_NAVIGATION_HTTP_ERROR' ? navigationHttpStatus(error.http_status) : null;
  let stage;
  if (Object.hasOwn(providerFailureMessages, code)) stage = 'model';
  else if (Object.hasOwn(prerequisiteFailureMessages, code)) stage = 'context';
  else if (Object.hasOwn(retainedSubjectFailureMessages, code)) stage = 'context';
  else if (['AUTOMATION_DEPENDENCY_MISSING','AUTOMATION_FLOW_PLAN_INVALID','AUTOMATION_FLOW_PLAN_CONTEXT_INVALID','AUTOMATION_FLOW_BRIEF_REQUIRED','AUTOMATION_REPAIR_PLAN_REQUIRED','AUTOMATION_MANUAL_ORDER_CONFLICT','AUTOMATION_GOAL_OBLIGATIONS_INVALID'].includes(code)) stage = 'context';
  else if (error?.automation_stage === 'save') stage = 'save';
  else if (code === 'AUTOMATION_BROWSER_STARTUP_FAILED') stage = 'browser_startup';
  else if (/^(?:AUTOMATION_BROWSER_|AUTOMATION_SEMANTIC_REVIEW_|BROWSER_)/.test(code || '') || code==='AUTOMATION_MCP_CAPABILITY_MISSING' || !modelStarted) stage = 'browser';
  else stage = 'model';
  const phase = { context: 'automation.agent.blocked', save: 'automation.agent.save.failed', browser_startup: 'automation.agent.browser.startup.failed',
    browser: 'automation.agent.browser.failed', model: 'automation.llm.failed' }[stage];
  const issues=code?.startsWith('AUTOMATION_SEMANTIC_REVIEW_')?semanticIssues(error.details?.semantic_issues):[];
  const message = Object.hasOwn(providerFailureMessages, code) ? providerFailureMessages[code]
    : Object.hasOwn(prerequisiteFailureMessages, code) ? prerequisiteFailureMessages[code]
    : Object.hasOwn(retainedSubjectFailureMessages, code) ? retainedSubjectFailureMessages[code]
    : code === 'AUTOMATION_FLOW_PLAN_CONTEXT_INVALID' ? 'The manual-flow context or parameter references could not be prepared. Review the brief and configured parameters before retrying. Previously saved Plan sections remain available.'
    : stage === 'context' ? error.message
    : stage === 'browser_startup' ? 'The browser could not start before generation. No model request or test action was performed; check TestEngine and retry.'
      : stage === 'browser' ? httpStatus ? navigationHttpFailureMessage(httpStatus) : code?.startsWith('AUTOMATION_SEMANTIC_REVIEW_')
        ? 'The confirmed browser work could not establish every manual action and expected result. The unfinished section was not saved; review its instructions and browser evidence.'
        : code === 'AUTOMATION_BROWSER_SECTION_BLOCKED'
        ? 'This step has an observed prerequisite or expected-result mismatch. Review its Browser activity and manual expected result before retrying.'
        : code === 'AUTOMATION_BROWSER_CHECK_STALLED'
          ? 'The expected-result check is still unsatisfied after recovery. This step stopped repeating checks; review its Browser activity, prerequisites and expected result.'
        : code === 'AUTOMATION_BROWSER_ASSERTION_PROPOSAL_STALLED'
          ? 'The same unsupported assertion was proposed after correction feedback. This step stopped before another browser check; review the selected target and authored expected result.'
        : code === 'AUTOMATION_BROWSER_TARGET_PROPOSAL_STALLED'
          ? 'The same unobserved browser target was proposed after correction feedback. No browser action ran for the repeated proposal. Use a current observed target reference or scoped discovery before retrying. Previously saved Plan sections remain available.'
        : code === 'AUTOMATION_BROWSER_SNAPSHOT_READ_STALLED'
          ? 'The same unchanged page was requested after evidence feedback. This step stopped before another snapshot or model retry; review the remaining action, expected result or prerequisite.'
        : code === 'AUTOMATION_BROWSER_TOOL_BUDGET_EXHAUSTED'
        ? 'The browser tool budget was reached before this section completed. Review the last unsuccessful browser check; completed Plan sections remain saved.'
        : 'Browser inspection could not continue. Previously saved Plan sections were retained; review the browser failure before retrying.'
        : stage === 'save' ? 'This section could not be saved. Previously committed Plan sections remain available and current edits were preserved.'
          : 'Automation generation could not continue. Previously saved Plan sections remain available; review the reported issue before retrying.';
  return { level: stage === 'context' ? 'warning' : 'error', phase, message,
    details: { error_code: code, failure_stage: stage, saved_sections: Number(error?.saved_sections) || 0,
      ...(issues.length?{semantic_issues:issues}:{}),
      ...(issues.length&&error.details?.requirement==='independent_field_validation_predicate'?{requirement:error.details.requirement}:{}),
      ...(typeof error?.active_step_id==='string'&&error.active_step_id.length<=100?{active_step_id:error.active_step_id}:{}),
      ...(Array.isArray(error?.active_manual_step_ids)?{active_manual_step_ids:error.active_manual_step_ids.filter(id=>typeof id==='string'&&id.length<=100).slice(0,40)}:{}),
      ...(stage === 'context' ? { blocked_steps: error.blocked_steps } : {}),
      ...(error?.browser_code ? { browser_code: error.browser_code } : {}),
      ...(httpStatus ? { http_status: httpStatus } : {}),
      ...(['unknown', 'not_attempted', 'completed'].includes(error?.action_outcome) ? { action_outcome: error.action_outcome } : {}),
      ...(typeof error?.retry_safe === 'boolean' ? { retry_safe: error.retry_safe } : {}),
      ...(code === 'AUTOMATION_BROWSER_TOOL_BUDGET_EXHAUSTED' ? {
        ...(Number.isSafeInteger(error.details?.tool_calls) ? { tool_calls: error.details.tool_calls } : {}),
        ...(Number.isSafeInteger(error.details?.tool_call_limit) ? { tool_call_limit: error.details.tool_call_limit } : {}),
        ...(typeof error.details?.latest_browser_failure?.code === 'string' && /^[A-Z][A-Z0-9_]{1,99}$/.test(error.details.latest_browser_failure.code)
          ? { browser_code: error.details.latest_browser_failure.code } : {})
      } : {}),
      ...(error?.automatic_retry_exhausted ? { automatic_retry_exhausted: true } : {}) } };
}

module.exports = { buildFailureProgress };
