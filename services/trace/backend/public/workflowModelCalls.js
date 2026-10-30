const traces = require('../services/llmTraceQuery.service');

function scope({ projectId, runId, nodeId }) {
  if ([projectId, runId, nodeId].some(value => typeof value !== 'string' || !value.trim() || value.length > 255)) {
    throw Object.assign(new Error('Select a project, workflow run and node.'), { statusCode: 400 });
  }
}

// Callers authorize the current run and project before entering this boundary.
// Filters and chronological order are host-owned, never supplied by the browser.
exports.list = async (context, { cursor } = {}) => {
  scope(context);
  return traces.list(context.projectId, { run_id: context.runId, node_id: context.nodeId, cursor,
    since: new Date(Date.now() - 14 * 86400000).toISOString() }, { chronological: true });
};
exports.detail = async (context, callId, { includeContent = false } = {}) => {
  scope(context);
  return traces.detail(context.projectId, callId, { includeContent, runId: context.runId, nodeId: context.nodeId });
};
