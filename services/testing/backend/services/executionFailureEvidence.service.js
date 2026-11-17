const db = require('@hellotest/platform/backend/src/db');
const { buildExecutionReportModel } = require('./executionReportModel');

const list = value => {
  try { const parsed = typeof value === 'string' ? JSON.parse(value) : value; return Array.isArray(parsed) ? parsed : []; }
  catch { return []; }
};
const references = value => [...new Set(list(value).map(String).map(item => item.trim()).filter(Boolean))];
const unavailable = () => ({
  availability: 'unavailable', population: 'latest_frozen_failed_or_blocked_instances',
  failed_instance_count: null, referenced_instance_count: null, ambiguous_instance_count: null,
  defect_count: null, external_reference_count: null, reference_count: null, known_reference_count: 0, instances: []
});

// The same frozen instance/attempt and ACL-scoped defect projection used by
// reports owns readiness and AI context. A case link is not an exact row origin.
async function loadFailureEvidence(execution, { resultAccess, defectAccess, database = db } = {}) {
  if (!resultAccess || execution.frozen_scope_evidence?.availability === 'unavailable') return unavailable();
  const rows = await database.prepare(`SELECT id, execution_id, test_case_id, status, error, created_at,
    data_set_iteration_index, data_set_iteration_key, external_references, derived, covers_entire_case
    FROM test_case_effective_results WHERE execution_id = ?
      AND (NOT derived OR EXISTS (SELECT 1 FROM execution_case_snapshots selected
        WHERE selected.execution_id = test_case_effective_results.execution_id
          AND selected.test_case_id = test_case_effective_results.test_case_id))`).all(execution.id);
  const covered = new Set(rows.filter(row => row.derived && row.covers_entire_case).map(row => row.test_case_id));
  const report = buildExecutionReportModel(execution, rows.filter(row => row.derived || row.status !== 'pending' || !covered.has(row.test_case_id)));
  const snapshots = new Map((execution.case_snapshots || []).map(row => [row.test_case_id, row]));
  const results = new Map(rows.map(row => [row.id, row]));
  const defects = new Map((execution.linked_defects || []).map(row => [row.display_id || row.id, row]));
  const instanceCounts = new Map();
  for (const row of report.cases) instanceCounts.set(row.id, (instanceCounts.get(row.id) || 0) + 1);
  const capturedDefects = new Set(), capturedReferences = new Set();
  const instances = report.cases.filter(row => ['failed', 'blocked'].includes(row.status)).map(row => {
    const result = results.get(row.result_id);
    const resultReferences = references(result?.external_references);
    const external = resultReferences.length ? resultReferences : references(snapshots.get(row.id)?.external_references);
    external.forEach(value => capturedReferences.add(value));
    const linked = row.defects.map(label => defects.get(label)).filter(Boolean);
    linked.forEach(defect => capturedDefects.add(defect.id));
    const exactDefects = linked.filter(defect => defect.provenance.some(origin => origin.result_id === row.result_id));
    const exact = resultReferences.length || exactDefects.length;
    const caseScoped = linked.length > exactDefects.length || !resultReferences.length && external.length;
    const ambiguous = row.data_iteration_ambiguous || caseScoped && instanceCounts.get(row.id) > 1 && !exact;
    const coverage = ambiguous ? 'ambiguous' : exact || linked.length || external.length ? 'referenced'
      : defectAccess ? 'unreferenced' : 'unavailable';
    return {
      test_case_id: row.id, result_id: row.result_id, instance_key: row.instance_key, status: row.status,
      data_set_iteration_index: row.data_set_iteration_index, data_set_iteration_key: row.data_set_iteration_key,
      error: row.error, external_references: external,
      defects: linked.map(defect => ({ id: defect.id, display_id: defect.display_id || null })), coverage
    };
  });
  const ambiguous = instances.filter(row => row.coverage === 'ambiguous').length;
  const known = capturedDefects.size + capturedReferences.size;
  return {
    availability: defectAccess ? 'available' : 'partial', population: 'latest_frozen_failed_or_blocked_instances',
    failed_instance_count: instances.length,
    referenced_instance_count: defectAccess && !ambiguous ? instances.filter(row => row.coverage === 'referenced').length : null,
    ambiguous_instance_count: ambiguous, defect_count: defectAccess ? capturedDefects.size : null,
    external_reference_count: capturedReferences.size, reference_count: defectAccess ? known : null,
    known_reference_count: known, instances
  };
}

module.exports = { loadFailureEvidence };
