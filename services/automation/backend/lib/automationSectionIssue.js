const { sanitizeAiText } = require('@hellotest/platform/backend/src/security/aiTextPolicy');
const { resolveModelToolRequest, projectModelSnapshot, modelTargetForLocator } = require('./automationBrowserModelTargets');
const { browserReceipt } = require('./automationInteractiveEvidence');
const { browserCheckPromptDetails, unsuccessfulBrowserCheck, browserVerificationBoundary } = require('./automationBrowserRecovery');

const kinds = new Set(['unmet_prerequisite', 'expectation_mismatch', 'unexpected_application_state']);
const invalid = () => Object.assign(new Error('Report the current section issue with its exact step ID, a supported kind, a short reason and 1 to 6 evidence_refs from the current snapshot: its exact observation_id or observed target refs. No browser action was performed.'), { code: 'AUTOMATION_BROWSER_SECTION_ISSUE_INVALID' });

/** A model may identify why the current goal cannot be completed. Such a
 * report stops the build for review; it never proves a defect or saves source.
 * Evidence must still refer to the host's current observed page. */
function automationSectionIssue({ response, execution, snapshot, projectText }) {
  const issue = response?.section_issue;
  if (!execution?.required || response?.stage !== 'act' || response.step_id !== execution.step_id || !issue || typeof issue !== 'object' || Array.isArray(issue)
    || !kinds.has(issue.kind) || typeof issue.reason !== 'string' || !issue.reason.trim() || issue.reason.length > 1000
    || !Array.isArray(issue.evidence_refs) || !issue.evidence_refs.length || issue.evidence_refs.length > 6
    || issue.evidence_refs.some(ref => typeof ref !== 'string' || !ref || ref.length > 160)) throw invalid();
  // Empty, error and access-denied pages can be meaningful current evidence
  // without exposing a validated element. Their host observation identity is
  // a read-only evidence reference, never a locator or an execution grant.
  const page = snapshot?.tool === 'browser_snapshot' && !snapshot.result?.isError ? browserReceipt(snapshot) : null;
  const observationId = typeof page?.observation_id === 'string' && page.observation_id.length <= 160 ? page.observation_id : null;
  for (const ref of issue.evidence_refs) {
    if (observationId && ref === observationId) continue;
    if (!ref.startsWith('ref:')) throw invalid();
    try { resolveModelToolRequest({ name: 'browser_assert', arguments: { locator: ref } }, snapshot); }
    catch { throw invalid(); }
  }
  const projected = typeof projectText === 'function' ? projectText(issue.reason) : undefined;
  const reason = typeof projected === 'string' ? sanitizeAiText(projected).text.trim().slice(0, 1000) : undefined;
  const label = { unmet_prerequisite: 'An observed prerequisite prevents this step from completing.', expectation_mismatch: 'The required expected result has not been established from current browser evidence.', unexpected_application_state: 'The application did not reach the expected state.' }[issue.kind];
  return Object.assign(new Error(`${label}${reason ? ` Agent assessment: ${reason}` : ''} Review this step and its browser evidence before retrying. Previously saved sections remain in Plan.`), {
    code: 'AUTOMATION_BROWSER_SECTION_BLOCKED', statusCode: 422, nonRetryable: true,
    details: { step_id: execution.step_id, issue_kind: issue.kind, evidence_count: new Set(issue.evidence_refs).size, assessment_source: 'model_with_current_browser_evidence' }
  });
}

/** Foreground observed form feedback; role=alert is evidence, not automatically
 * a failure (negative tests can intentionally expect it). The model must compare
 * it with the pinned goal instead of assuming that a completed click succeeded. */
function observedValidationFeedback(current) {
  return (current?.current_snapshot?.targets || []).filter(target => target.role === 'alert' && target.visible !== false)
    .slice(0, 6).map(target => {
      // The native text assertions read visible innerText. text is a DOM
      // textContent excerpt and may also include hidden help or dismiss labels.
      const key = typeof target.visible_text === 'string' ? 'visible_text' : target.text ? 'text' : 'name';
      return { ref: target.ref, role: 'alert', text: target[key] || '',
        ...(target[`${key}_truncated`] === true ? { text_truncated: true } : {}), trust: 'untrusted_page_evidence' };
    });
}

const outcomeReviewCode = 'AUTOMATION_BROWSER_OUTCOME_TARGET_REVIEW_REQUIRED';
const textChecks = new Set(['text', 'text_contains', 'text_content', 'text_content_contains']);

/** A disappearing toast can fail a text check even after the application has
 * reached the required state. Give the actor one existing-budget read-only
 * reassessment before accepting an absence-only issue. This never proves the
 * outcome, grants an action, changes an assertion or repeats a submission. */
function sectionIssueOutcomeReviewFeedback({ response, execution, snapshot, observations = [] } = {}) {
  if (!execution?.required || !['expectation_mismatch', 'unexpected_application_state'].includes(response?.section_issue?.kind)
    || snapshot?.tool !== 'browser_snapshot' || snapshot.mcp_call === false || snapshot.result?.isError) return null;
  if (!browserVerificationBoundary(observations, execution.step_id)) return null;
  if (observations.some(item => item.execution_step_id === execution.step_id && item.tool === 'automation_section_issue_feedback'
    && item.mcp_call === false && item.result?.content?.some(part => {
      if (part.type !== 'text') return false;
      try { return JSON.parse(part.text)?.code === outcomeReviewCode; } catch { return false; }
    }))) return null;
  const failed = observations.findLast(item => item.execution_step_id === execution.step_id && item.tool === 'browser_assert' && item.mcp_call !== false);
  if (!failed || unsuccessfulBrowserCheck(failed)?.code !== 'BROWSER_ASSERTION_NOT_SATISFIED'
    || !textChecks.has(failed.arguments?.assertion) || typeof failed.arguments?.locator !== 'string'
    // The private check ledger establishes a real host-dispatched text check;
    // copied JSON history cannot request this recovery allowance.
    || !browserCheckPromptDetails(failed) || observations.indexOf(snapshot) <= observations.indexOf(failed)) return null;
  const page = projectModelSnapshot(snapshot);
  if (!page?.targets?.some(target => target.visible !== false && (target.text || target.name))
    || modelTargetForLocator(failed.arguments.locator, snapshot)) return null;
  // A cited current alert is concrete application/validation feedback. Preserve
  // its immediate review path rather than challenging it as a transient toast.
  const refs = new Set(response.section_issue.evidence_refs || []);
  if (page.targets.some(target => refs.has(target.ref) && target.role === 'alert' && target.visible !== false
    && (typeof target.visible_text === 'string' ? target.visible_text : target.text || target.name || '').trim())) return null;
  return { code: outcomeReviewCode, step_id: execution.step_id, action_outcome: 'not_attempted', retry_safe: true,
    reason: 'failed_text_target_not_in_current_snapshot', evidence_scope: 'current_snapshot',
    allowed_recovery: 'read_only_outcome_reassessment', additional_outcome_reviews: 0,
    message: 'The failed text target is not among the fresh snapshot targets; do not repeat completed actions or submit again. Reassess the original outcome using persistent current page statements and destination controls. This bounded snapshot does not establish that the manual outcome failed. Use advertised read-only discovery if their targets are missing, then perform only a supported read-only check on a current observed target. Preserve explicit authored text and every outcome; never copy descriptive manual prose as invented UI text or weaken the expectation. If the current evidence still cannot establish the required outcome, report section_issue again with that evidence.' };
}

module.exports = { automationSectionIssue, observedValidationFeedback, sectionIssueOutcomeReviewFeedback };
