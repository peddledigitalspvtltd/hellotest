const runtime = require("@hellotest/platform/backend/src/domain/executionStepEvidence");
const { getExecutionResultDurationMs } = require("@hellotest/platform/backend/src/utils/executionCaseLifecycle");

const parse = (value, fallback = {}) => {
  try { return typeof value === "string" ? JSON.parse(value) : value ?? fallback; } catch { return fallback; }
};
const array = value => { const parsed = parse(value, []); return Array.isArray(parsed) ? parsed : []; };
const STATUS = new Set(["passed", "failed", "blocked", "running", "pending", "paused", "skipped", "aborted"]);
const statusOf = value => STATUS.has(value) ? value : "pending";
const counts = cases => cases.reduce((total, item) => { total.total++; total[statusOf(item.status)]++; return total; }, { total: 0, passed: 0, failed: 0, blocked: 0, running: 0, pending: 0, paused: 0, skipped: 0, aborted: 0 });
const rowIndex = value => value !== null && value !== undefined && value !== "" && Number.isInteger(Number(value)) && Number(value) >= 0 ? Number(value) : null;
const keyOf = result => rowIndex(result.data_set_iteration_index) !== null ? `row:${rowIndex(result.data_set_iteration_index)}` : result.data_set_iteration_key ? `key:${result.data_set_iteration_key}` : "single";
const time = value => { const n = new Date(value || 0).getTime(); return Number.isFinite(n) ? n : 0; };
const deriveSteps = (snapshots, logs) => snapshots.map(step => {
  const id = step.snapshot_step_id || step.id;
  const web = logs.stepWebDetails[id] || {};
  const api = logs.stepApiDetails[id] || {};
  const evidence = logs.stepEvidence[id] || null;
  return {
    id, order: step.step_order, type: step.step_type || "web", action: step.action || "",
    expected_result: step.expected_result || "", status: statusOf(logs.stepStatuses[id]),
    note: logs.stepNotes[id] || "", evidence, has_evidence: Boolean(evidence?.dataUrl || evidence?.attachmentId),
    captures: logs.stepCaptures[id] || api.captures || {}, console_count: array(web.console).length,
    network_count: array(web.network).length, page_url: web.url || "", web_details: web, api_details: api
  };
});

function buildExecutionReportModel(execution, results = [], now = Date.now()) {
  const validResults = results.filter(result => !result.execution_id || String(result.execution_id) === String(execution.id));
  const snapshots = new Map(array(execution.case_snapshots).map(snapshot => [String(snapshot.test_case_id), snapshot]));
  // Preserve legacy result-only runs without reading today's mutable test-case content.
  for (const result of validResults) if (!snapshots.has(String(result.test_case_id))) snapshots.set(String(result.test_case_id), {
    test_case_id: result.test_case_id, test_case_title: result.test_case_title || "Unnamed test case", suite_id: result.suite_id, suite_name: result.suite_name, legacy: true
  });
  const resultsByCase = new Map();
  for (const result of validResults) {
    const key = String(result.test_case_id);
    if (!resultsByCase.has(key)) resultsByCase.set(key, []);
    resultsByCase.get(key).push(result);
  }
  const stepsByCase = new Map();
  for (const step of array(execution.step_snapshots)) {
    const key = String(step.test_case_id);
    if (!stepsByCase.has(key)) stepsByCase.set(key, []);
    stepsByCase.get(key).push(step);
  }
  const cases = [];
  for (const [caseId, snapshot] of snapshots) {
    const steps = (stepsByCase.get(caseId) || []).slice().sort((a, b) => Number(a.step_order || 0) - Number(b.step_order || 0));
    const groups = new Map();
    for (const result of resultsByCase.get(caseId) || []) {
      const key = keyOf(result);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(result);
    }
    const caseData = parse(snapshot.test_data_set_snapshot, null);
    const data = caseData || (snapshot.test_data_set_id ? null : execution.test_data_set?.snapshot || parse(execution.test_data_set_snapshot, null));
    const dataId = snapshot.test_data_set_id || execution.test_data_set?.id || execution.test_data_set_id;
    const dataName = snapshot.test_data_set_name || execution.test_data_set?.name || data?.name;
    const rows = array(data?.rows || data?.template_rows);
    // A legacy unindexed result cannot safely be assigned to an invented row.
    if (data && !groups.has("single") && ![...groups.keys()].some(key => key.startsWith("key:"))) {
      const total = data.mode === "key_value" ? 1 : Math.max(1, rows.length);
      for (let index = 0; index < total; index++) if (!groups.has(`row:${index}`)) groups.set(`row:${index}`, []);
    }
    if (!groups.size) groups.set("single", []);
    for (const [instanceKey, group] of [...groups].sort(([a], [b]) => a.localeCompare(b, "en", { numeric: true }))) {
      const ordered = group.slice().sort((a, b) => time(b.created_at) - time(a.created_at) || String(b.id).localeCompare(String(a.id)));
      const result = ordered[0] || null;
      const logs = runtime.parseStructuredLogs(result?.logs);
      const index = instanceKey.startsWith("row:") ? Number(instanceKey.slice(4)) : null;
      const row = parse(result?.data_set_row_snapshot, null) ?? (index !== null && data ? data.mode === "key_value" ? Object.fromEntries(rows.filter(item => item?.key).map(item => [item.key, item.value])) : rows[index] || null : null);
      const stepRows = deriveSteps(steps, logs);
      const attempts = ordered.map((attempt, offset) => {
        const attemptLogs = runtime.parseStructuredLogs(attempt.logs);
        return { id: attempt.id, number: ordered.length - offset, status: statusOf(attempt.status), duration_ms: getExecutionResultDurationMs(attempt, now),
          started_at: attempt.started_at, ended_at: attempt.ended_at, created_at: attempt.created_at, executed_by: attempt.executed_by_name || attempt.executed_by,
          error: attempt.error || "", lifecycle_history: array(attempt.lifecycle_history), logs: parse(attempt.logs, attempt.logs || ""),
          steps: offset === 0 ? stepRows : deriveSteps(steps, attemptLogs), attachments: [] };
      });
      cases.push({
        id: snapshot.test_case_id, instance_id: `case-${cases.length + 1}`, instance_key: instanceKey,
        title: snapshot.test_case_title || "Unnamed test case", description: snapshot.test_case_description || "",
        suite_id: snapshot.suite_id || result?.suite_id || null, suite_name: snapshot.suite_name || result?.suite_name || null,
        module_id: snapshot.module_id || null, module_name: snapshot.module_name || null, priority: snapshot.priority || null,
        status: statusOf(result?.status), duration_ms: attempts.reduce((sum, attempt) => sum + attempt.duration_ms, 0),
        error: result?.error || "", result_id: result?.id || null, steps: stepRows, attempts,
        data_set_iteration_index: index, data_set_iteration_key: result?.data_set_iteration_key || null,
        test_data_set_name: result?.test_data_set_name || dataName || "", test_data_set_id: result?.test_data_set_id || dataId || null,
        data_set_row: row, data_iteration_ambiguous: Boolean(instanceKey === "single" && data && rows.length > 1 && data.mode !== "key_value"), data_set_source: snapshot.data_set_source || (data ? "run" : null), parameter_values: parse(snapshot.parameter_values), suite_parameter_values: parse(snapshot.suite_parameter_values),
        defects: [...array(result?.case_defects), ...array(result?.defects)], legacy: Boolean(snapshot.legacy)
      });
    }
  }
  const summary = counts(cases);
  summary.pass_rate = summary.total ? Math.round(100 * summary.passed / summary.total) : 0;
  summary.conclusive_total = summary.passed + summary.failed;
  summary.conclusive_pass_rate = summary.conclusive_total ? Math.round(100 * summary.passed / summary.conclusive_total) : null;
  summary.duration_ms = cases.reduce((total, item) => total + item.duration_ms, 0);
  summary.distinct_cases = snapshots.size;
  summary.attempts = validResults.length;
  summary.evidence_steps = cases.reduce((total, item) => total + item.steps.filter(step => step.has_evidence).length, 0);
  const suites = new Map();
  for (const item of cases) {
    const key = item.suite_id || "__direct__";
    if (!suites.has(key)) suites.set(key, { id: item.suite_id, name: item.suite_name || "Direct cases", cases: [] });
    suites.get(key).cases.push(item);
  }
  return { execution, results: validResults, generated_at: new Date(now).toISOString(), summary, cases,
    suites: [...suites.values()].map(suite => ({ ...suite, ...counts(suite.cases), duration_ms: suite.cases.reduce((total, item) => total + item.duration_ms, 0), step_count: suite.cases.reduce((total, item) => total + item.steps.length, 0) })) };
}
module.exports = { buildExecutionReportModel };
