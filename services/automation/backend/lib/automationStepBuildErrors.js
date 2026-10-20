const codeOf=value=>typeof value==='string'&&/^[A-Z][A-Z0-9_]{1,99}$/.test(value)?value:undefined;
const actionIdOf=value=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value)?value:undefined;
const semanticIssueCodes=new Set(['action_not_supported','expected_result_not_covered','unrelated_assertion','weakened_expectation','unmet_prerequisite','source_order_conflict','insufficient_evidence','unsupported_claim','unnecessary_action']);
const providerFailureMessages = Object.freeze({
  LLM_REQUEST_TOO_LARGE: 'The model provider rejected this request because it is too large. Reduce the request size or select an integration that supports it. Previously saved Plan sections remain available.',
  LLM_RATE_LIMIT_REQUEST_TOO_LARGE: 'This model request exceeds the provider token capacity even when idle. Reduce the request size or select an integration with sufficient capacity. Previously saved Plan sections remain available.',
  LLM_RATE_LIMITED: 'The model provider rate limit stopped generation. Wait for the provider limit to reset before retrying. Previously saved Plan sections remain available.',
  LLM_QUOTA_EXCEEDED: 'The model provider has exhausted its available quota or billing allowance. Review the selected integration usage and billing settings before retrying. Previously saved Plan sections remain available.',
  LLM_AUTHENTICATION_FAILED: 'The model provider rejected authentication. Check the selected integration credentials, model access and base URL before retrying. Previously saved Plan sections remain available.'
});
const prerequisiteFailureMessages = Object.freeze({
  AUTOMATION_PREREQUISITE_INVALID: 'The missing-step proposal did not identify one current observed UI target and its evidence. No inferred action ran. Review the manual prerequisite and current page.',
  AUTOMATION_PREREQUISITE_UNSUPPORTED: 'The missing prerequisite requires more than an observed same-origin link, tab or explicit UI disclosure. Add the required business action or setup to the manual case; no action was guessed.',
  AUTOMATION_PREREQUISITE_REJECTED: 'The proposed missing step conflicts with the current goal, whole case intent, test data or authored order. Review the observed application and the prerequisite assessment before retrying.',
  AUTOMATION_PREREQUISITE_REVIEW_INVALID: 'The missing-step assessment did not return a valid decision. No prerequisite action ran and no expectations were changed.',
  AUTOMATION_PREREQUISITE_CONTEXT_TOO_LARGE: 'The complete case intent and ordering exceed the missing-step review allowance. Add an explicit prerequisite or split the manual flow; no requirement was truncated.',
  AUTOMATION_PREREQUISITE_RECOVERY_EXHAUSTED: 'Missing-step recovery reached its bounded allowance or the outcome-check phase was already closed. Review the manual setup and original outcome; no further inferred action ran.',
  AUTOMATION_CASE_JOURNEY_INVALID: 'The overall case intent or ordered section snapshot could not be matched to this step. Refresh the case before rebuilding; no inferred action ran.'
});
const retainedSubjectFailureMessages = Object.freeze({
  AUTOMATION_RETAINED_SUBJECT_REVIEW_REQUIRED: 'The saved input and its value and validation checks use a field subject that cannot be confirmed on the current page. Review or reselect that field in the saved Plan before rebuilding. The new input was not performed, and the saved assertions were retained.'
});
/** Only host-validated classifications and pinned identities belong in public
 * progress. Reviewer rationale and expanded requirement text stay protected. */
function semanticIssues(value) {
  if(!Array.isArray(value))return [];
  const unique=new Map();
  for(const issue of value.slice(0,20))if(issue&&semanticIssueCodes.has(issue.code)&&typeof issue.obligation_id==='string'&&issue.obligation_id.length>0&&issue.obligation_id.length<=4000&&!/[\u0000-\u001f\u007f]/.test(issue.obligation_id)){
    const safe={code:issue.code,obligation_id:issue.obligation_id};unique.set(JSON.stringify(safe),safe);
  }
  return [...unique.values()];
}

/** Public step diagnostics contain typed failure facts, never browser inputs,
 * generated source, raw provider exceptions or page-supplied error messages. */
function stepBuildError(event,timestamp) {
  const details=event.details||{};
  let message,code=codeOf(details.error_code)||codeOf(details.code);
  if(event.phase==='automation.agent.action.failed'){
    code=code||'AUTOMATION_BROWSER_ACTION_FAILED';
    message=details.tool==='browser_assert'&&code==='BROWSER_ASSERTION_SUBJECT_UNSUPPORTED'
      ? details.assertion==='field_valid'
        ? 'The selected field cannot establish this validation check. Inspect its native control and the IDs referenced by its accessible hints and errors; missing or duplicate associations need correction before retrying.'
        : 'The selected element does not support this assertion. Inspect its control type and the advertised assertion contract before retrying.'
      : details.tool==='browser_assert'?'The expected-result check did not pass. Review the current browser evidence and model response.':'The browser action did not complete. Review the current screen and the requested action.';
  }else if(event.phase==='automation.agent.action.unknown'){
    code=code||'AUTOMATION_BROWSER_OUTCOME_UNKNOWN';message='The browser action outcome is unknown. Inspect the application before retrying to avoid repeating an operation.';
  }else if(event.phase==='automation.agent.output.invalid'){
    code=code||'AI_INVALID_JSON';message=['AUTOMATION_GENERATED_ASSERTION_NOT_PRESERVED','AUTOMATION_RECORDED_SECTION_VALIDATION_REJECTED'].includes(code)
      ? 'The recorded instructions did not satisfy saved Plan assertions or source requirements. Review the retained assertions and source validation feedback before retrying.'
      : code==='AUTOMATION_GENERATED_SOURCE_INVALID'?'The generated source is invalid. The agent must correct it before browser actions or saving.':'The model response is invalid and needs correction before this section can continue.';
  }else if(event.phase==='automation.agent.blocked'||event.phase==='automation.agent.dependencies'){
    code=code||'AUTOMATION_DEPENDENCY_MISSING';message=prerequisiteFailureMessages[code]||retainedSubjectFailureMessages[code]||'This section needs additional context or configured test data. Review its required context before retrying.';
  }else if(event.phase==='automation.agent.section.blocked'){
    code='AUTOMATION_BROWSER_SECTION_BLOCKED';message='This step has an observed prerequisite or expected-result mismatch. Review Browser activity and the manual expected result before retrying.';
  }else if(event.phase==='automation.agent.semantic.rejected'){
    code='AUTOMATION_SEMANTIC_REVIEW_REJECTED';message='The confirmed browser work does not yet cover every manual action and expected result. Review this step before saving.';
  }else if(event.phase==='automation.agent.save.failed'){
    code=code||'AUTOMATION_SECTION_SAVE_FAILED';message='This section could not be saved. Previously committed sections remain in Plan.';
  }else if(['automation.llm.failed','automation.agent.browser.failed','automation.agent.browser.startup.failed'].includes(event.phase)){
    code=code||'AUTOMATION_BUILD_INCOMPLETE';message=Object.hasOwn(providerFailureMessages,code)?providerFailureMessages[code]:code==='AUTOMATION_BROWSER_NAVIGATION_HTTP_ERROR'
      ? require('./automationBrowserBootstrapFailure').navigationHttpFailureMessage(details.http_status)
      : code==='AUTOMATION_BROWSER_ASSERTION_PROPOSAL_STALLED'
        ? 'The same unsupported assertion was proposed after correction feedback. Review the selected target and authored expected result; no repeated browser check was performed.'
      : code==='AUTOMATION_BROWSER_TARGET_PROPOSAL_STALLED'
        ? 'The same unobserved target was repeated after correction feedback. No browser action ran for that proposal. Use a current observed target reference or scoped discovery before retrying.'
      : code==='AUTOMATION_BROWSER_SNAPSHOT_READ_STALLED'
        ? 'The agent requested the same unchanged page after evidence feedback. Review the remaining action, expected result or prerequisite; no repeated snapshot was requested.'
      : ['AUTOMATION_RECORDED_SECTION_VALIDATION_STALLED','AUTOMATION_RECORDED_SECTION_VALIDATION_REJECTED'].includes(code)
        ? 'The compiled instructions did not satisfy Plan validation. Review the saved assertions and source validation feedback; repeated model acknowledgements cannot correct them.' : null;
    message=message||'This section could not finish building. Review its browser evidence and model request and response.';
  }else return null;
  const actionId=actionIdOf(details.action_id);
  const issues=code?.startsWith('AUTOMATION_SEMANTIC_REVIEW_')?semanticIssues(details.semantic_issues):[];
  return {id:`${event.phase}:${actionId||code}:${timestamp}`,code,message,phase:event.phase,created_at:timestamp,
    ...(code==='AUTOMATION_BROWSER_NAVIGATION_HTTP_ERROR'&&Number.isInteger(details.http_status)&&details.http_status>=400&&details.http_status<=599?{http_status:details.http_status}:{}),
    ...(issues.length?{semantic_issues:issues}:{}),
    ...(issues.length&&details.requirement==='independent_field_validation_predicate'?{semantic_requirement:details.requirement}:{}),
    ...(actionId?{action_id:actionId}:{}),
    ...(typeof details.tool==='string'&&/^browser_[a-z0-9_]{1,48}$/.test(details.tool)?{tool:details.tool}:{}),
    ...(typeof details.assertion==='string'&&/^[a-z_]{1,50}$/.test(details.assertion)?{assertion:details.assertion}:{}),
    ...(Number.isSafeInteger(details.attempt)&&details.attempt>0?{attempt:details.attempt}:{})};
}

function appendStepBuildError(row,event,timestamp) {
  const error=stepBuildError(event,timestamp);if(!error)return;
  const errors=Array.isArray(row.build_errors)?row.build_errors:[];
  row.build_errors=[...errors.filter(item=>item.id!==error.id),error].slice(-24);
}

module.exports={stepBuildError,appendStepBuildError,semanticIssues,providerFailureMessages,prerequisiteFailureMessages,retainedSubjectFailureMessages};
