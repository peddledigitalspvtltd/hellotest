const { sanitizeAiText } = require('@hellotest/platform/backend/src/security/aiTextPolicy');

const codes = new Set(['locator_missing', 'locator_ambiguous', 'assertion_mismatch', 'navigation_timeout', 'environment_unavailable', 'operation_timeout', 'unclassified']);
const documentStates = new Set(['loading', 'interactive', 'complete']);
const controls = new Set(['a', 'button', 'input', 'select', 'textarea', 'summary', 'h1', 'h2', 'output']);
const waitStates = new Set(['navigation', 'domcontentloaded', 'networkidle']);
const diagnostic = (value, limit) => typeof value === 'string' ? sanitizeAiText(value.slice(0, limit)).text : '';
const validDuration = value => Number.isSafeInteger(value) && value >= 0 && value <= 3_600_000;

function projectFailureReport(web) {
  const recorded = web?.first_failure;
  if (recorded?.schema !== 'web-failure-report/1' || !codes.has(recorded.code)) return null;
  const report = { schema: recorded.schema, code: recorded.code };
  if (Number.isSafeInteger(recorded.line) && recorded.line > 0) report.line = recorded.line;
  if (validDuration(recorded.operation_duration_ms)) report.operation_duration_ms = recorded.operation_duration_ms;
  const page = recorded.page;
  if (documentStates.has(page?.document_state) && typeof page?.at_environment_start === 'boolean' && typeof page?.document_busy === 'boolean') {
    const candidates = (Array.isArray(page.candidates) ? page.candidates.slice(0, 12) : []).flatMap(candidate => {
      const id = candidate?.test_id;
      if (typeof id !== 'string' || !/^[a-z][a-z0-9_-]{1,49}$/i.test(id) || /\d{5,}|[a-z0-9]{24}/i.test(id) || !controls.has(candidate.control) || diagnostic(id, 50) !== id) return [];
      return [{ method: 'getByTestId', value: id, control: candidate.control }];
    });
    report.page = { at_environment_start: page.at_environment_start, document_state: page.document_state, document_busy: page.document_busy, candidates };
  }
  const waits = Array.isArray(web.readiness_waits) ? web.readiness_waits.slice(-20) : [];
  const timeout = waits.find(wait => wait?.status === 'timed_out' && waitStates.has(wait.state) && validDuration(wait.duration_ms) && validDuration(wait.timeout_ms));
  if (timeout) report.readiness_timeout = { state: timeout.state, duration_ms: timeout.duration_ms, timeout_ms: timeout.timeout_ms };
  return report;
}

function triageWebFailure(report, provider) {
  const loading = report?.page?.document_busy || report?.page?.document_state === 'loading';
  if (report?.code === 'environment_unavailable') {
    return { classification: 'Runner or environment unavailable', route: 'environment', next_action: 'Check the recorded runner session and environment connectivity. Record another failure after the environment is available.' };
  }
  if (report?.code === 'navigation_timeout' || (loading && ['operation_timeout', 'locator_missing'].includes(report?.code)) || (report?.code === 'operation_timeout' && report.readiness_timeout)) {
    return { classification: 'Page readiness timeout', route: 'timing', next_action: 'Review the selected Run’s timing and the application readiness state. Rerun with the intended environment and timing configuration.' };
  }
  if (report?.code === 'assertion_mismatch') {
    return { classification: 'Observed result differs from the saved assertion', route: 'expected_result', next_action: 'Compare the observed result with the expected behavior and frozen test data to determine whether the product or fixture needs correction.' };
  }
  if (report?.code === 'locator_missing' || report?.code === 'locator_ambiguous') {
    if (report.page?.candidates.length) return { classification: report.code === 'locator_missing' ? 'Saved locator returned no match' : 'Saved locator returned multiple matches', route: 'locator_review', next_action: 'Compare the observed candidates with the intended control. Any proposed locator still needs runner verification.' };
    return { classification: 'Locator failure without a recorded replacement candidate', route: 'more_evidence', next_action: 'Inspect the failed section in its Run evidence before replacing the saved locator.' };
  }
  return { classification: 'Cause undetermined', route: 'more_evidence', next_action: provider === 'selenium'
    ? 'Inspect the failed step’s trace and recorded artifacts for evidence of the intended locator.'
    : 'Inspect the selected Run or capture a new failure if the recorded evidence does not identify the intended control.' };
}

function collectRepairEvidence(observed, oldFocus, error, resultId) {
  const id = oldFocus.snapshot_step_id;
  const web = observed.stepWebDetails?.[id];
  const report = projectFailureReport(web);
  const triage = oldFocus.step_type === 'web' ? {
    ...triageWebFailure(report, web?.provider),
    step_order: oldFocus.step_order,
    ...(report?.line ? { line: report.line } : {}),
    ...(report?.page ? { observed_candidate_count: report.page.candidates.length } : {})
  } : null;
  return {
    error: diagnostic(error, 1200), stepStatuses: { [id]: 'failed' },
    stepNotes: { [id]: diagnostic(observed.stepNotes?.[id], 1300) },
    artifact_steps: observed.stepEvidence?.[id] ? [id] : [],
    ...(report ? { web_failure: { ...report, step_id: id, result_id: resultId } } : {}),
    ...(triage ? { triage } : {}),
    limitations: ['Diagnostics describe the recorded failed section. Authorized Run evidence provides the full trace and attachments. Candidate test IDs describe controls in the main document and require confirmation against the case intent.']
  };
}

module.exports = { collectRepairEvidence };
