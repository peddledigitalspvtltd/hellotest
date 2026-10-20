const ACTION_PHASE = /^automation\.agent\.action\.(started|completed|failed|unknown)$/;
const TOOL = /^browser_[a-z0-9_]{1,48}$/;
const CODE = /^[A-Z][A-Z0-9_]{1,99}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const FATAL_CODES = new Set(['BATCH_LEASE_LOST', 'BATCH_JOB_LEASE_LOST']);

const identifier = value => typeof value === 'string' && IDENTIFIER.test(value) ? value : undefined;
const errorCode = value => typeof value === 'string' && CODE.test(value) ? value : undefined;

/** Evidence is optional; cancellation, revoked access and lost ownership are not. */
function isCriticalAutomationError(error) {
  return [401, 403].includes(error?.statusCode) || error?.name === 'AbortError' || FATAL_CODES.has(error?.code);
}

/** Action events are public receipts. Never persist tool arguments, selectors,
 * page text or entered values in this channel, even when a caller supplies them. */
function actionDetails(input = {}) {
  const details = {};
  for (const key of ['test_case_id', 'active_step_id', 'step_id', 'action_id']) {
    const value = identifier(input[key]);
    if (value && (key !== 'action_id' || value.length <= 100)) details[key] = value;
  }
  if (typeof input.tool === 'string' && TOOL.test(input.tool)) details.tool = input.tool;
  if (typeof input.assertion === 'string' && /^[a-z_]{1,50}$/.test(input.assertion)) details.assertion = input.assertion;
  if (errorCode(input.error_code)) details.error_code = input.error_code;
  if (['completed', 'failed', 'unknown', 'not_attempted'].includes(input.action_outcome)) details.action_outcome = input.action_outcome;
  if (['satisfied', 'not_satisfied'].includes(input.assertion_outcome)) details.assertion_outcome = input.assertion_outcome;
  for (const key of ['attempt', 'section_attempt']) {
    if (Number.isSafeInteger(input[key]) && input[key] > 0 && input[key] <= 1000) details[key] = input[key];
  }
  details.active_manual_step_ids = [...new Set((Array.isArray(input.active_manual_step_ids) ? input.active_manual_step_ids : [])
    .filter(value => identifier(value) && value.length <= 100))].slice(0, 20);
  return details;
}

/** Identity comes from the host transaction/context. A model cannot choose the
 * activity correlation or supply the timestamp used for operation duration. */
function progressEvent(event = {}, { activityId, caseId, context = {}, now = Date.now() } = {}) {
  const action = ACTION_PHASE.exec(event.phase || '');
  const details = action ? actionDetails(event.details) : { ...event.details };
  if (identifier(caseId)) details.test_case_id = caseId;
  const correlation = {};
  if (identifier(activityId)) correlation.activity_id = activityId;
  for (const key of ['request_id', 'trace_id']) if (identifier(context[key])) correlation[key] = context[key];
  if (Object.keys(correlation).length) details.correlation = correlation;
  details.occurred_at = new Date(Number.isFinite(now) ? now : Date.now()).toISOString();
  if (!action) return { ...event, details };
  const tool = details.tool?.replace(/^browser_/, '').replace(/_/g, ' ') || 'operation';
  const message = `Browser ${tool}: ${action[1]}.`;
  return { ...event, message, details, ...(event.metadata ? { metadata: { current_phase: event.phase, phase_message: message } } : {}) };
}

/** Support logging is bounded and contains classifications only. First/every
 * hundredth failure is enough to expose an outage without flooding worker logs. */
function createDiagnosticReporter({ warn = message => console.warn(message) } = {}) {
  const counts = new Map();
  return ({ activityId, operation, error } = {}) => {
    const name = typeof operation === 'string' && /^[a-z_]{1,48}$/.test(operation) ? operation : 'optional_diagnostic';
    // A fixed-size counter table avoids retaining activity IDs or error objects.
    if (!counts.has(name) && counts.size >= 32) counts.delete(counts.keys().next().value);
    const count = (counts.get(name) || 0) + 1;
    counts.set(name, count);
    if (count !== 1 && count % 100 !== 0) return;
    const record = { event: 'automation.diagnostic.unavailable', operation: name, failed_writes: count };
    if (identifier(activityId)) record.activity_id = activityId;
    if (errorCode(error?.code)) record.error_code = error.code;
    if (Number.isInteger(error?.statusCode) && error.statusCode >= 400 && error.statusCode <= 599) record.status_code = error.statusCode;
    try { warn(JSON.stringify(record)); } catch { /* A log sink cannot change browser work. */ }
  };
}

const reportDiagnosticFailure = createDiagnosticReporter();
module.exports = { actionDetails, progressEvent, isCriticalAutomationError, createDiagnosticReporter, reportDiagnosticFailure };
