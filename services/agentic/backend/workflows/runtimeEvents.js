const { sanitizeAiText } = require("@hellotest/platform/backend/src/security/aiTextPolicy");
const safeMessage = (value, fallback = "This node failed. Review its configuration and connection.") =>
  sanitizeAiText(typeof value === "string" && value ? value : fallback).text.slice(0, 2000);
const canRetry = (kind, data = {}) => ["agent", "llmAgent", "customAI"].includes(kind)
  || (kind === "loop" && data.loopAction === "customAI")
  || (["apiTool", "apiAgent", "webAgent"].includes(kind) && ["GET", "HEAD"].includes(kind === "webAgent" ? "GET" : data.apiMethod || "GET"));
const retryable = failure => !failure.outcome_unknown && failure.retryable !== false && [408, 429, 500, 502, 503, 504].includes(failure.statusCode) && failure.code !== "NODE_TIMEOUT";
const failureInfo = failure => ({
  code: failure.code === "AUTOMATION_BUILD_INCOMPLETE" ? failure.code : /^(?:AGENT|MCP)_[A-Z_]+$/.test(failure.code || "") ? failure.code : failure.code === "NODE_TIMEOUT" ? "NODE_TIMEOUT" : failure.code === "DEADLINE_EXCEEDED" ? "WORKFLOW_DEADLINE" : failure.name === "AbortError" || failure.statusCode === 499 ? "WORKFLOW_CANCELLED" : failure.statusCode === 403 ? "ACCESS_DENIED" : "NODE_EXECUTION_FAILED",
  ...(Number.isInteger(failure.statusCode) ? { status_code: failure.statusCode } : {}),
  ...(failure.operation_id ? { operation_id: failure.operation_id } : {}),
  ...(failure.outcome_unknown ? { outcome_unknown: true, reconciliation_required: true } : {}),
  ...(failure.code === "AUTOMATION_BUILD_INCOMPLETE" ? {
    ...Object.fromEntries(["completed_sections", "total_sections"].filter(key => Number.isInteger(failure[key]) && failure[key] >= 0 && failure[key] <= 200).map(key => [key, failure[key]])),
    validation_feedback: (Array.isArray(failure.validation_feedback) ? failure.validation_feedback : []).slice(0, 5)
      .filter(item => item && typeof item.message === "string").map(item => ({
        ...(typeof item.step_id === "string" && /^[\w:-]{1,255}$/.test(item.step_id) ? { step_id: item.step_id } : {}),
        ...(typeof item.code === "string" && /^[A-Z][A-Z0-9_]{0,79}$/.test(item.code) ? { code: item.code } : {}),
        message: safeMessage(item.message).slice(0, 500),
      })),
  } : {}),
  message: safeMessage(failure.publicMessage), retryable: retryable(failure),
});
function log(result, event) {
  const entries = result.logs || (result.logs = []);
  entries.push({ at: new Date().toISOString(), level: "info", ...event, message: safeMessage(event.message, "Execution event") });
  if (entries.length > 150) entries.splice(0, entries.length - 150);
}
const duration = result => Math.max(0, Date.parse(result.completed_at) - Date.parse(result.started_at)) || 0;
module.exports = { safeMessage, canRetry, retryable, failureInfo, log, duration };
