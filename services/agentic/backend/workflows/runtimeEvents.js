const { sanitizeAiText } = require("@hellotest/platform/backend/src/security/aiTextPolicy");
const safeMessage = (value, fallback = "This node failed. Review its configuration and connection.") =>
  sanitizeAiText(typeof value === "string" && value ? value : fallback).text.slice(0, 2000);
const canRetry = (kind, data = {}) => ["agent", "llmAgent", "customAI"].includes(kind)
  || (kind === "loop" && data.loopAction === "customAI")
  || (["apiTool", "apiAgent", "webAgent"].includes(kind) && ["GET", "HEAD"].includes(kind === "webAgent" ? "GET" : data.apiMethod || "GET"));
const retryable = failure => [408, 429, 500, 502, 503, 504].includes(failure.statusCode) && failure.code !== "NODE_TIMEOUT";
const failureInfo = failure => ({
  code: failure.code === "NODE_TIMEOUT" ? "NODE_TIMEOUT" : failure.code === "DEADLINE_EXCEEDED" ? "WORKFLOW_DEADLINE" : failure.name === "AbortError" || failure.statusCode === 499 ? "WORKFLOW_CANCELLED" : failure.statusCode === 403 ? "ACCESS_DENIED" : "NODE_EXECUTION_FAILED",
  ...(Number.isInteger(failure.statusCode) ? { status_code: failure.statusCode } : {}),
  message: safeMessage(failure.publicMessage), retryable: retryable(failure),
});
function log(result, event) {
  const entries = result.logs || (result.logs = []);
  entries.push({ at: new Date().toISOString(), level: "info", ...event, message: safeMessage(event.message, "Execution event") });
  if (entries.length > 150) entries.splice(0, entries.length - 150);
}
const duration = result => Math.max(0, Date.parse(result.completed_at) - Date.parse(result.started_at)) || 0;
module.exports = { safeMessage, canRetry, retryable, failureInfo, log, duration };
