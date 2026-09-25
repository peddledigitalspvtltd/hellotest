const CASE_ACTION_STATUS = Object.freeze({ start: "running", resume: "running", pause: "paused", abort: "aborted", block: "blocked", skip: "skipped", reset: "pending", pass: "passed", fail: "failed" });
const FINAL_CASE_STATUSES = new Set(["passed", "failed", "blocked", "aborted", "skipped"]);
const lifecycleError = (message, code = "INVALID_CASE_TRANSITION", statusCode = 409) => Object.assign(new Error(message), { code, statusCode });
const timestamp = value => value ? new Date(value).getTime() : NaN;
const parseHistory = value => {
  if (Array.isArray(value)) return value;
  try { const parsed = JSON.parse(value || "[]"); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
};

function getExecutionResultDurationMs(result, now = Date.now()) {
  const accumulated = Math.max(0, Number(result?.duration_ms) || 0);
  const activeSince = timestamp(result?.timer_started_at);
  return Math.round(accumulated + (result?.status === "running" && Number.isFinite(activeSince) ? Math.max(0, now - activeSince) : 0));
}

function transitionCaseTimer(existing, action, actorId, now = Date.now()) {
  const status = CASE_ACTION_STATUS[action];
  if (!status) throw lifecycleError("Unknown case lifecycle action", "INVALID_CASE_ACTION", 400);
  const from = existing?.status || "pending";
  const active = from === "running" && Boolean(existing?.timer_started_at);
  const newAttempt = Boolean(existing && (action === "reset" && from !== "pending" || action === "start" && FINAL_CASE_STATUSES.has(from)));
  if (action === "resume" && !["paused", "running"].includes(from)) throw lifecycleError("Only a paused case can resume; start a new attempt for a finished case.");
  if (action === "pause" && !["running", "paused"].includes(from)) throw lifecycleError("Start the case before pausing it.");
  if (["pass", "fail"].includes(action) && !existing?.started_at) throw lifecycleError("Start the case before recording its result.", "CASE_NOT_STARTED");
  const unchanged = !newAttempt && existing && from === status && (status !== "running" || active);
  if (unchanged) return { ...existing, unchanged: true, newAttempt: false };
  const at = new Date(now).toISOString();
  const base = newAttempt ? null : existing;
  const duration = getExecutionResultDurationMs(base, now);
  const history = parseHistory(base?.lifecycle_history);
  return {
    newAttempt,
    unchanged: false,
    status,
    duration_ms: duration,
    started_at: base?.started_at || (status === "running" ? at : null),
    timer_started_at: status === "running" ? at : null,
    ended_at: FINAL_CASE_STATUSES.has(status) ? at : null,
    lifecycle_history: [...history, { action, from_status: from, to_status: status, actor_id: typeof actorId === "object" ? actorId?.id || null : actorId || null, actor_name: typeof actorId === "object" ? actorId?.name || null : null, actor_email: typeof actorId === "object" ? actorId?.email || null : null, at, duration_ms: duration, previous_result_id: newAttempt ? existing.id : null }]
  };
}

module.exports = { CASE_ACTION_STATUS, FINAL_CASE_STATUSES, lifecycleError, parseHistory, getExecutionResultDurationMs, transitionCaseTimer };
