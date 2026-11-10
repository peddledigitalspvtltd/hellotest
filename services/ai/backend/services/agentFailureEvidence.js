const { parseStructuredLogs } = require('@hellotest/platform/backend/src/domain/executionStepEvidence');
const scopeSql = require('./agentEvidenceScope');

const text = (value, max = 1600) => typeof value === 'string' ? value.slice(0, max) : '';
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
// Logs are untrusted evidence. Select observed fields rather than serializing
// request headers, credentials, captures, binary images or arbitrary payloads.
function observedDetails(value) {
  const item = object(value);
  return Object.fromEntries(['error', 'message', 'status', 'statusCode', 'method', 'url', 'actual', 'expected', 'selector']
    .filter(key => ['string', 'number', 'boolean'].includes(typeof item[key]))
    .map(key => [key, typeof item[key] === 'string' ? text(item[key], 1000) : item[key]]));
}

async function collect({ projectId, appTypeId, runIds, testCaseIds = [], resultIds = [], evidenceScope, canView, read }) {
  if (!runIds.length || !await canView('result.view') || !await canView('testcase.view')) return [];
  const caseScope = scopeSql.predicate('test_case', 'tc', evidenceScope);
  const boundedCaseIds = [...new Set((Array.isArray(testCaseIds) ? testCaseIds : []).filter(value => typeof value === 'string' && value.trim()))].slice(0, 10);
  const caseClause = boundedCaseIds.length ? `AND tc.id IN (${boundedCaseIds.map(() => '?').join(',')})` : '';
  const boundedResultIds = [...new Set(resultIds.filter(value => typeof value === 'string' && value.trim()))].slice(0, 20);
  const resultClause = boundedResultIds.length ? `AND r.id IN (${boundedResultIds.map(() => '?').join(',')})` : '';
  const args = [projectId, ...runIds, ...(appTypeId ? [appTypeId] : []), ...boundedCaseIds, ...boundedResultIds, ...caseScope.params];
  const rows = await read(`WITH latest AS (
    SELECT DISTINCT ON (r.execution_id, r.test_case_id, COALESCE(r.data_set_iteration_index, -1))
      r.id, r.execution_id, r.test_case_id, r.status, r.revision, r.created_at, r.error, r.logs,
      r.data_set_iteration_index, cs.test_case_title AS title, cs.test_case_description AS description
    FROM execution_results r
    JOIN executions e ON e.id = r.execution_id
    JOIN execution_case_snapshots cs ON cs.execution_id = r.execution_id AND cs.test_case_id = r.test_case_id
    JOIN test_cases tc ON tc.id = r.test_case_id
    JOIN app_types app ON app.id = tc.app_type_id AND app.project_id = e.project_id
    WHERE e.project_id = ? AND e.id IN (${runIds.map(() => '?').join(',')})
      ${appTypeId ? 'AND e.app_type_id = ? AND tc.app_type_id = e.app_type_id' : ''} ${caseClause} ${resultClause} ${caseScope.sql}
    ORDER BY r.execution_id, r.test_case_id, COALESCE(r.data_set_iteration_index, -1), r.created_at DESC, r.id DESC
  ) SELECT *, COUNT(*) OVER()::INTEGER AS total_failed_cases FROM latest
    WHERE status IN ('failed', 'blocked') ORDER BY created_at DESC, id LIMIT 20`, args);
  const [commentAccess, attachmentAccess] = await Promise.all([canView('comment.view'), canView('attachment.view')]);
  const packets = [];
  for (const row of rows) {
    const logs = parseStructuredLogs(row.logs);
    const failedStepIds = Object.keys(logs.stepStatuses).filter(id => logs.stepStatuses[id] === 'failed').slice(0, 30);
    const stepPriority = failedStepIds.length ? `CASE WHEN snapshot_step_id IN (${failedStepIds.map(() => '?').join(',')}) THEN 0 ELSE 1 END, ` : '';
    const unavailable = [];
    const optionalRead = async (kind, sql, values) => {
      try { return await read(sql, values); }
      catch (error) {
        if (error?.name === 'AbortError' || [401, 403, 499].includes(error?.statusCode) || error?.code === 'REQUEST_CANCELLED') throw error;
        unavailable.push(kind);
        return [];
      }
    };
    const [steps, comments, attachments] = await Promise.all([read(`SELECT snapshot_step_id, step_order, action, expected_result, step_type,
      COUNT(*) OVER()::INTEGER AS total_steps FROM execution_step_snapshots
      WHERE execution_id = ? AND test_case_id = ? ORDER BY ${stepPriority}step_order, snapshot_step_id LIMIT 30`, [row.execution_id, row.test_case_id, ...failedStepIds]),
    commentAccess ? optionalRead('Comments', `SELECT id, entity_type, LEFT(body, 1200) AS body, updated_at,
      COUNT(*) OVER()::INTEGER AS total_comments
      FROM entity_comments WHERE project_id = ? AND
      ((entity_type = 'execution_result' AND entity_id = ?) OR (entity_type = 'execution' AND entity_id = ?))
      ORDER BY updated_at DESC NULLS LAST, id LIMIT 8`, [projectId, row.id, row.execution_id]) : [],
    attachmentAccess ? optionalRead('Attachment metadata', `SELECT id, entity_type, file_name, mime_type, size_bytes
      FROM attachments WHERE project_id = ? AND
      ((entity_type = 'execution_result' AND entity_id = ?) OR (entity_type = 'execution' AND entity_id = ?))
      ORDER BY created_at DESC, id LIMIT 8`, [projectId, row.id, row.execution_id]) : []]);
    steps.sort((a, b) => a.step_order - b.step_order || String(a.snapshot_step_id).localeCompare(String(b.snapshot_step_id)));
    packets.push({ evidence_type: 'authoritative_live_execution_failures',
      evidence_permissions: ['run.view', 'result.view', 'testcase.view', ...(commentAccess ? ['comment.view'] : []), ...(attachmentAccess ? ['attachment.view'] : [])],
      execution_id: row.execution_id, test_case_id: row.test_case_id, result_id: row.id, revision: row.revision,
      status: row.status, observed_at: row.created_at, data_set_iteration_index: row.data_set_iteration_index,
      error: text(row.error, 2400),
      title: text(row.title, 500), description: text(row.description, 2400),
      steps: steps.map(step => ({ id: step.snapshot_step_id, order: step.step_order, action: text(step.action),
        expected_result: text(step.expected_result), step_type: step.step_type,
        observed_status: text(logs.stepStatuses[step.snapshot_step_id], 80) || 'unknown',
        note: text(logs.stepNotes[step.snapshot_step_id]),
        api_observation: observedDetails(logs.stepApiDetails[step.snapshot_step_id]),
        browser_observation: observedDetails(logs.stepWebDetails[step.snapshot_step_id]),
        evidence_available: Boolean(logs.stepEvidence[step.snapshot_step_id]) })),
      comments, attachments,
      coverage: { total_failed_cases: Number(row.total_failed_cases), returned_failed_cases: rows.length,
        omitted_failed_cases: Math.max(0, Number(row.total_failed_cases) - rows.length),
        total_steps: Number(steps[0]?.total_steps || 0), omitted_steps: Math.max(0, Number(steps[0]?.total_steps || 0) - steps.length) },
      limitations: [boundedResultIds.length ? 'Only the selected result attempts are included. Omitted steps or cases are unknown.' : 'Only the latest attempt per case and data row is included. Omitted steps or cases are unknown.',
        'Attachment metadata does not establish screenshot contents; image interpretation requires the actual image parts.',
        ...unavailable.map(kind => `${kind} could not be retrieved; their contents are unknown.`)] });
    packets[packets.length - 1].coverage.total_comments = Number(comments[0]?.total_comments || 0);
    packets[packets.length - 1].coverage.omitted_comments = Math.max(0, Number(comments[0]?.total_comments || 0) - comments.length);
  }
  return packets;
}

module.exports = { collect, observedDetails };
