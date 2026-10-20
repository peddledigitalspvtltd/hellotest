const { retainedInputSubjectForRequest, retainedNextInputAssertionSubjectForRequest } = require('./automationRetainedAssertions');
const { modelTargetForLocator, repositoryTargetEvidence, resolveModelToolRequest } = require('./automationBrowserModelTargets');
const { retainedSubjectFailureMessages } = require('./automationStepBuildErrors');

const message = retainedSubjectFailureMessages.AUTOMATION_RETAINED_SUBJECT_REVIEW_REQUIRED;
const reviewRequired = reason => Object.assign(new Error(message), {
  code: 'AUTOMATION_RETAINED_SUBJECT_REVIEW_REQUIRED', statusCode: 422, nonRetryable: true,
  action_outcome: 'not_attempted', retry_safe: false, details: { retained_subject_issue: reason }
});
const targetRef = (locator,snapshot) => modelTargetForLocator(resolveModelToolRequest({name:'browser_assert',arguments:{locator}},snapshot).arguments.locator,snapshot);
const currentNativeInput = (request,snapshot) => {
  const current = repositoryTargetEvidence(request?.arguments?.locator,snapshot);
  return Boolean(current && ['input','textarea','select'].includes(current.tag)
    && (request.name !== 'browser_select_option' || current.tag === 'select'));
};

/** Canonicalize only aliases independently grounded to the very same current
 * native control. The actual dispatch and ledger use the retained locator;
 * neither a historical label nor scalar match count supplies identity proof.
 * Include the just-completed input boundary so a later alias proposal still
 * reconciles with that protected action instead of repeating its mutation. */
function canonicalizeRetainedInputRequest({contract,stepId,request,operations,snapshot}={}) {
  if(contract?.step_id!==stepId || !currentNativeInput(request,snapshot))return {request,canonicalized:false};
  const subject=request.name==='browser_assert'?retainedNextInputAssertionSubjectForRequest({contract,request,operations})
    :retainedInputSubjectForRequest({contract,request,operations,allowCompleted:true});
  if(!subject || request.arguments.locator===subject.locator)return {request,canonicalized:false};
  const savedRef=targetRef(subject.locator,snapshot),proposedRef=targetRef(request.arguments.locator,snapshot);
  if(!savedRef || savedRef!==proposedRef)return {request,canonicalized:false};
  return {request:{...request,arguments:{...request.arguments,locator:subject.locator}},canonicalized:true};
}

/** A current input proposal cannot silently replace an old saved oracle's
 * subject. Inspect only the eligible first input, at its action boundary;
 * missing destinations before navigation/disclosure never enter this gate. */
async function assertRetainedInputSubject({ contract, stepId, request, operations, snapshot, read } = {}) {
  if (contract?.step_id !== stepId) return false;
  if (!currentNativeInput(request,snapshot)) return false;
  const subject = retainedInputSubjectForRequest({contract,request,operations});
  if (!subject) return false;
  const savedRef = targetRef(subject.locator,snapshot), proposedRef = targetRef(request.arguments.locator,snapshot);
  if (savedRef && proposedRef) {
    if (savedRef !== proposedRef) throw reviewRequired('different_observed_field');
    return false;
  }
  const observed = await read(subject);
  if (!observed || observed.available !== true || !Number.isSafeInteger(observed.match_count) || observed.match_count < 0) throw reviewRequired('read_unavailable');
  if (observed.match_count !== 1) throw reviewRequired(observed.match_count === 0 ? 'missing_saved_field' : 'ambiguous_saved_field');
  // A scalar count proves uniqueness, never that an otherwise uncaptured old
  // subject is the proposed current control. No label/name heuristic fills
  // that evidence gap or authorizes a mutation before source review.
  throw reviewRequired('saved_subject_identity_unproven');
}

module.exports = { assertRetainedInputSubject, canonicalizeRetainedInputRequest, retainedSubjectReviewMessage: message };
