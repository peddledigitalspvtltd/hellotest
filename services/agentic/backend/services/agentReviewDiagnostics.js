const workspaceTransactionService = require("@hellotest/platform/backend/services/workspaceTransaction.service");
const execution = require("@hellotest/knowledge/backend/services/knowledgeExecution.service");
const normalizeText = (value, max) => (typeof value === "string" ? value : "").trim().slice(0, max);

function revisionFeedback(candidate, issues, round) {
  // Prior model output remains explicitly untrusted proposal data. Keep whole
  // objects, or omit them with a recorded limit; never slice serialized JSON.
  const draft = candidate && typeof candidate === 'object' && !Array.isArray(candidate)
    ? Object.fromEntries(['response', 'findings', 'deliverables', 'artifacts', 'evidence_gaps'].filter(key => Object.hasOwn(candidate, key)).map(key => [key, candidate[key]])) : null;
  const retained = draft && Buffer.byteLength(JSON.stringify(draft)) <= 12000 ? draft : null;
  return { round, issues: issues.slice(0, 20), previous_draft: retained, previous_draft_omitted: Boolean(draft && !retained), draft_status: 'untrusted_proposal' };
}
function providerUsage(value) {
  const fields = { input_tokens: 'prompt_tokens', output_tokens: 'completion_tokens', total_tokens: 'total_tokens' };
  return value && typeof value === 'object' ? Object.fromEntries(Object.entries(fields).map(([name, key]) => {const count=value[key]??value[name];return [name,
    Number.isSafeInteger(count) && count >= 0 ? count : null];})) : null;
}
function aggregateUsage(records) {
  const keys = ['input_tokens', 'output_tokens', 'total_tokens'];
  return { usage: Object.fromEntries(keys.map(key => [key, records.length && records.every(record => record.usage?.[key] != null)
    ? records.reduce((sum, record) => sum + record.usage[key], 0) : null])),
    usage_unknown_calls: records.filter(record => keys.some(key => record.usage?.[key] == null)).length };
}
const correctableOutputError = error => !error?.outcome_unknown && !error?.transactionOutcomeUnknown
  && (error instanceof SyntaxError || ['AI_INVALID_JSON', 'AI_INVALID_RESPONSE', 'AI_MANAGED_SCHEMA_INVALID', 'AI_OUTPUT_SCHEMA_VIOLATION'].includes(error?.code));
function outputErrorIssues(error) {
  if (['AI_MANAGED_SCHEMA_INVALID', 'AI_OUTPUT_SCHEMA_VIOLATION'].includes(error.code) || error.code === 'AI_INVALID_RESPONSE' && error.validation_errors?.length) return (error.validation_errors?.length ? error.validation_errors : [{ path: 'output', keyword: 'published_schema_constraint' }]).slice(0, 5).map(item => ({
    path: normalizeText(item.path, 255), issue: normalizeText(item.keyword, 80) || 'published_schema_constraint',
    ...(typeof item.required_property === 'string' ? { required_property: normalizeText(item.required_property, 120) } : {})
  }));
  return [{ path: error.validation_path || 'output', issue: error instanceof SyntaxError || error.code === 'AI_INVALID_JSON'
    ? 'valid_json_object_required' : 'native_artifact_fields_or_references_invalid' }];
}

async function recordFailure({ transactionId, error, modelCallRecords, evidencePermissions, failureCitations, lastRejectedDraft }) {
  const diagnostic = require('../workflows/runtimeEvents').failureInfo(error);
  const failed = { progress: 100, failure: true, error_code: error.code || "AGENT_EXECUTION_FAILED", error_message: diagnostic.message,
    error_details: diagnostic, validation_errors: diagnostic.validation_errors || [], cancelled: Boolean(execution.current()?.signal?.aborted),
    model_usage: aggregateUsage(modelCallRecords).usage, model_calls: modelCallRecords.length, evidence_permissions: evidencePermissions, citations: failureCitations,
    ...(error.code === 'AGENT_OUTPUT_INVALID' && lastRejectedDraft ? { rejected_draft: lastRejectedDraft } : {}) };
  await workspaceTransactionService.appendTransactionEvent(transactionId, {
    level: "error",
    phase: "failed",
    message: failed.cancelled ? "The review was cancelled or exceeded its deadline." : diagnostic.message,
    status: "failed",
    metadata: failed,
    details: { progress: 100 }
  }).catch(() => null);
  await workspaceTransactionService.updateTransaction(transactionId, {
    status: "failed", completed_at: new Date().toISOString(),
    metadata: failed
  }).catch(() => null);
}

module.exports = { revisionFeedback, providerUsage, aggregateUsage, correctableOutputError, outputErrorIssues, recordFailure };
