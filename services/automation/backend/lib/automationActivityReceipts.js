const { actionDetails } = require('./automationProgressDiagnostics');

const ACTION_PHASES = new Set(['automation.agent.action.started', 'automation.agent.action.completed',
  'automation.agent.action.failed', 'automation.agent.action.unknown']);
const MAX_ACTIONS = 100;

function operationDuration(startedAt, completedAt) {
  const start = Date.parse(startedAt), end = Date.parse(completedAt);
  return Number.isFinite(start) && Number.isFinite(end) && end >= start && end - start <= 24 * 60 * 60 * 1000
    ? end - start : undefined;
}

/** One bounded operation receipt per host action ID. A delayed duplicate must
 * not reverse a terminal receipt or replace its original failure diagnosis. */
function reduceBrowserActions(previous, event, timestamp) {
  if (!ACTION_PHASES.has(event.phase)) return previous;
  const details = actionDetails(event.details);
  if (!details.action_id || !details.tool) return previous;
  const actions = Array.isArray(previous) ? previous.map(action => ({ ...action })) : [];
  const existing = actions.find(action => action.action_id === details.action_id);
  // A repeated ID from a different tool is not a receipt for this operation.
  if (existing && existing.tool !== details.tool) return previous;
  const action = existing || { action_id: details.action_id, tool: details.tool,
    active_manual_step_ids: details.active_manual_step_ids };
  if (event.phase === 'automation.agent.action.started') {
    if (!existing?.status || existing.status === 'running') {
      Object.assign(action, { status: 'running', started_at: existing?.started_at || timestamp });
    }
  } else if (!existing?.status || existing.status === 'running') {
    const completed = event.phase === 'automation.agent.action.completed'
      && (details.tool === 'browser_assert' ? details.assertion_outcome === 'satisfied' : details.action_outcome === 'completed');
    const status = details.action_outcome === 'unknown' || event.phase === 'automation.agent.action.unknown'
      ? 'unknown' : completed ? 'completed' : 'failed';
    Object.assign(action, { status, completed_at: timestamp });
    if (details.action_outcome) action.action_outcome = details.action_outcome;
    if (details.tool === 'browser_assert' && details.assertion_outcome) action.assertion_outcome = details.assertion_outcome;
    if (details.assertion) action.assertion = details.assertion;
    if (details.error_code && status !== 'completed') action.error_code = details.error_code;
    const duration = operationDuration(action.started_at, timestamp);
    if (duration !== undefined) action.duration_ms = duration;
  }
  if (!existing) actions.push(action);
  return actions.slice(-MAX_ACTIONS);
}

module.exports = { reduceBrowserActions, operationDuration };
