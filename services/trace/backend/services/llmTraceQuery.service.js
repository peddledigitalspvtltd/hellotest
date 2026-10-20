const db = require('@hellotest/platform/backend/src/obsDb');
const fail = message => Object.assign(new Error(message), { statusCode: 400 });
const columns = `id, project_id, actor_id, request_id, trace_id, run_id, node_id, session_id, operation, feature,
  integration_id, integration_name, provider_origin, requested_model, effective_model, status, attempt, correction_of,
  started_at, completed_at, duration_ms, http_status, provider_request_id, usage, capture, error_code`;

function filters(projectId, input = {}) {
  for (const key of ['since','status','run_id','node_id','session_id','request_id','search','cursor','test_case_id']) {
    if (input[key] != null && (typeof input[key] !== 'string' || input[key].length > (key === 'cursor' ? 1024 : 255))) throw fail(`Invalid ${key.replaceAll('_',' ')} filter.`);
  }
  if (input.status && !['running','succeeded','failed','invalid','cancelled'].includes(input.status)) throw fail('Choose a supported model call outcome.');
  const values = [projectId], conditions = ['project_id = $1', 'expires_at > CURRENT_TIMESTAMP'];
  const since = input.since ? new Date(input.since) : new Date(Date.now() - 24 * 60 * 60 * 1000);
  if (!Number.isFinite(since.getTime()) || since.getTime() < Date.now() - 15 * 86400000) throw fail('Choose a start time within the 14-day trace retention window.');
  values.push(since); conditions.push(`started_at >= $${values.length}`);
  for (const key of ['status', 'run_id', 'node_id', 'session_id', 'request_id']) {
    if (input[key]) { values.push(String(input[key]).slice(0, 255)); conditions.push(`${key} = $${values.length}`); }
  }
  if (input.completion_attempt != null && (!/^[1-9][0-9]?$|^100$/.test(String(input.completion_attempt)) || !['string','number'].includes(typeof input.completion_attempt))) throw fail('Choose a valid generation attempt.');
  if ((input.test_case_id || input.completion_attempt != null || input.trace_ids != null) && (!input.session_id || !input.test_case_id)) throw fail('A case and activity are required for scoped model calls.');
  if (input.test_case_id) {
    values.push(input.test_case_id); const caseParameter = `$${values.length}`;
    let attempt = '', legacyAttempt = '';
    if (input.completion_attempt != null) {
      values.push(String(input.completion_attempt));
      attempt = ` AND capture->>'completion_attempt' = $${values.length}`;
      legacyAttempt = ` AND e.details->>'completion_attempt' = $${values.length}`;
    }
    // Older captures have no case metadata. Only a trusted event for this exact
    // call, activity, project and case may supply the missing correlation.
    conditions.push(`((capture->>'test_case_id' = ${caseParameter}${attempt}) OR
      (COALESCE(capture->>'test_case_id','') = '' AND EXISTS (
        SELECT 1 FROM workspace_transaction_events e JOIN workspace_transactions t ON t.id=e.transaction_id
        WHERE e.transaction_id=llm_request_traces.session_id AND t.project_id=$1 AND t.category='automation_build'
        AND e.phase='model.call' AND (e.details->>'call_id'=llm_request_traces.id::text OR e.details->>'trace_id'=llm_request_traces.id::text)
        AND e.details->>'test_case_id' = ${caseParameter}${legacyAttempt}
      )))`);
  }
  if (input.trace_ids != null) {
    let ids;
    try { ids = typeof input.trace_ids === 'string' && input.trace_ids.length <= 5000 ? JSON.parse(input.trace_ids) : null; } catch {}
    if (!Array.isArray(ids) || !ids.length || ids.length > 20 || ids.some(id => typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(id))) throw fail('Choose valid retained model call references.');
    values.push([...new Set(ids)]);conditions.push(`id::text = ANY($${values.length}::text[])`);
  }
  if (input.search?.trim()) {
    values.push(`%${String(input.search).trim().slice(0, 150).replace(/[\\%_]/g, '\\$&')}%`);
    conditions.push(`concat_ws(' ', operation, feature, effective_model, requested_model, integration_name, id, run_id, session_id, request_id, trace_id) ILIKE $${values.length}`);
  }
  return { values, where: conditions.join(' AND ') };
}

async function list(projectId, input) {
  const { values, where } = filters(projectId, input);
  const limit = 50;
  let cursor = '';
  const pageValues = [...values];
  if (input.cursor) {
    try {
      const decoded = JSON.parse(Buffer.from(input.cursor, 'base64url').toString());
      if (!Number.isFinite(Date.parse(decoded.time)) || typeof decoded.id !== 'string' || decoded.id.length > 64) throw fail('Invalid cursor.');
      pageValues.push(decoded.time, decoded.id);
      cursor = ` AND (started_at,id) < ($${pageValues.length - 1}::timestamptz,$${pageValues.length})`;
    } catch { throw fail('Invalid trace page cursor.'); }
  }
  const [page, totals] = await Promise.all([
    db.pool.query({ text: `SELECT ${columns} FROM llm_request_traces WHERE ${where}${cursor} ORDER BY started_at DESC,id DESC LIMIT ${limit + 1}`, values: pageValues, query_timeout: 4000 }),
    db.pool.query({ text: `SELECT COUNT(*)::integer AS calls, COUNT(*) FILTER (WHERE status IN ('failed','invalid','cancelled'))::integer AS failures,
      ROUND(AVG(duration_ms))::integer AS average_ms, percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95_ms,
      COALESCE(SUM(CASE WHEN usage->>'total_tokens' ~ '^[0-9]{1,16}$' THEN (usage->>'total_tokens')::bigint ELSE 0 END),0)::text AS total_tokens,
      COUNT(*) FILTER (WHERE usage->>'total_tokens' IS NULL)::integer AS usage_unknown
      FROM llm_request_traces WHERE ${where}`, values, query_timeout: 4000 })
  ]);
  const items = page.rows.slice(0, limit), last = items.at(-1);
  return { items, summary: totals.rows[0], next_cursor: page.rows.length > limit ? Buffer.from(JSON.stringify({ time: last.started_at, id: last.id })).toString('base64url') : null, retention_days: 14 };
}
async function detail(projectId, id, { includeContent = false } = {}) {
  const result = await db.pool.query({ text: `SELECT ${columns}${includeContent ? ',request_payload,response_payload,request_hash' : ''}
    FROM llm_request_traces WHERE project_id=$1 AND id=$2 AND expires_at > CURRENT_TIMESTAMP`, values: [projectId, id], query_timeout: 4000 });
  if (!result.rows.length) throw Object.assign(new Error('Trace not found or its retention period has ended.'), { statusCode: 404 });
  return { ...result.rows[0], content_access: includeContent };
}
module.exports = { list, detail, _internals: { filters } };
