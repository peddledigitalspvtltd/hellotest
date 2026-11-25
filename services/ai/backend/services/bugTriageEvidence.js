const db = require('@hellotest/platform/backend/src/db');
const { hasPermission } = require('@hellotest/platform/backend/services/permission.service');
const { sanitizeAiText } = require('@hellotest/platform/backend/src/security/aiTextPolicy');
const { sanitizeInternalErrorText } = require('@hellotest/platform/backend/src/utils/serviceErrors');
const reproduction = require('@hellotest/testing/backend/services/defectReproduction.service');
const failureEvidence = require('./agentFailureEvidence');

const failed = (status) => status === 'failed' || status === 'blocked';
const caseLimit = 5;
const plain = (value) => String(value ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const publicText = (value, limit = 500) => sanitizeAiText(sanitizeInternalErrorText(plain(value))).text.slice(0, limit);
const frozenStep = (packet, stepId) => {
  const steps = packet.steps.filter((step) => failed(step.observed_status));
  return stepId ? steps.find((step) => step.id === stepId) : steps.length === 1 ? steps[0] : null;
};

function selectFailure(packets, issue, exactResultId) {
  if (exactResultId) return packets.find((packet) => packet.result_id === exactResultId) || null;
  const cases = new Set(issue.linked_test_case_ids || []);
  const candidates = cases.size ? packets.filter((packet) => cases.has(packet.test_case_id)) : packets;
  return candidates.length === 1 && !candidates[0].coverage?.omitted_failed_cases ? candidates[0] : null;
}

function findSwappedOutcomes(issue, step) {
  if (!step) return [];
  const frozenExpected = plain(step.expected_result);
  if (!frozenExpected) return [];
  const observations = [step.api_observation, step.browser_observation].filter(Boolean);
  const actuals = [...new Set(observations.flatMap((observation) => [
    ...(Array.isArray(observation.assertions) ? observation.assertions : []), observation
  ]).filter((observation) => observation.passed !== true && plain(observation.expected) === frozenExpected)
    .map((observation) => plain(observation.actual)).filter(Boolean))];
  if (actuals.length !== 1 || actuals[0] === frozenExpected
    || plain(issue.expected_result) !== actuals[0] || plain(issue.actual_result) !== frozenExpected) return [];
  const rationale = 'The recorded Expected and Actual results are reversed against the frozen step expectation and its observed assertion.';
  const evidence_refs = [`issue:${issue.id}:expected_result`, `issue:${issue.id}:actual_result`, `issue:${issue.id}:failed_step`];
  return [
    { field: 'expected_result', before: issue.expected_result, after: issue.actual_result, rationale, evidence_refs },
    { field: 'actual_result', before: issue.actual_result, after: issue.expected_result, rationale, evidence_refs }
  ];
}

function summarizeFailure(issue, packets, exactResultId = issue.linked_execution_result_id, canLinkCase = false) {
  const packet = selectFailure(packets, issue, exactResultId);
  if (!packet) return {
    state: packets.length > 1 ? 'ambiguous' : 'unavailable',
    detail: packets.length > 1 ? 'Multiple failed attempts match the recorded links. Select the exact failing attempt before using it to correct fields.' : 'No failed or blocked result could be matched to the recorded run and case links.',
    sources: [], corrections: []
  };
  const step = frozenStep(packet, issue.linked_step_id);
  const displayCase = publicText(packet.title) || packet.test_case_id;
  const attempt = {
    run_id: packet.execution_id, result_id: packet.result_id, test_case_id: packet.test_case_id,
    test_case_title: displayCase, status: packet.status,
    step_id: step?.id, step_order: step?.order, step_action: publicText(step?.action)
  };
  const sources = [{
    ref: `issue:${issue.id}:failed_result`, type: 'execution-result', id: packet.result_id, issue_id: issue.id,
    field: 'failed_result', title: `${displayCase} · ${packet.status} result`,
    excerpt: publicText([packet.error, packet.description].filter(Boolean).join(' · ')), trust: 'workspace'
  }];
  if (step) {
    const observations = [step.api_observation, step.browser_observation].filter(Boolean).map(({ expected, actual, assertions }) => ({ expected, actual, assertions: (assertions || []).map(({ passed, expected, actual }) => ({ passed, expected, actual })) }));
    sources.push({
      ref: `issue:${issue.id}:failed_step`, type: 'execution-step', id: step.id, issue_id: issue.id,
      field: 'failed_step', title: `${displayCase} · step ${step.order} (${step.observed_status})`,
      excerpt: publicText([step.action, step.expected_result && `Expected: ${step.expected_result}`, step.note, ...observations.map((value) => JSON.stringify(value))].filter(Boolean).join(' · '), 1100), trust: 'workspace'
    });
  }
  const corrections = exactResultId ? findSwappedOutcomes(issue, step) : [];
  if (canLinkCase) {
    const current = issue.linked_test_case_ids || [];
    corrections.push({
      field: 'linked_test_case_ids', before: current, after: [...current, packet.test_case_id],
      rationale: 'The exact linked failed result identifies a Test Case missing from this Defect.',
      evidence_refs: [`issue:${issue.id}:failed_result`]
    });
  }
  return { state: 'identified', detail: exactResultId ? 'Matched the exact linked failed attempt.' : 'Matched one failed attempt in the linked run.', attempt, sources, corrections };
}

async function recordedFailureLinks(issue, database) {
  const references = [...new Set([issue.id, issue.display_id, issue.jira_bug_key].filter(Boolean))];
  const placeholders = references.map(() => '?').join(', ');
  return database.prepare(`SELECT result.id FROM execution_results result JOIN executions run ON run.id = result.execution_id
    WHERE run.project_id = ? AND run.id = ? AND result.status IN ('failed', 'blocked') AND (
      EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(result.defects, '[]'::jsonb) || COALESCE(result.case_defects, '[]'::jsonb)) ref(value) WHERE ref.value IN (${placeholders}))
      OR EXISTS (SELECT 1 FROM jsonb_each(COALESCE(result.step_defects, '{}'::jsonb)) step
        CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(step.value) = 'array' THEN step.value ELSE '[]'::jsonb END) ref(value)
        WHERE ref.value IN (${placeholders}))
    ) ORDER BY result.created_at DESC, result.id LIMIT 2`).all(issue.project_id, issue.linked_test_run_id, ...references, ...references);
}

async function readIssueContext(issue, user, { database = db, canView = (permission) => hasPermission(user, permission, issue.project_id) } = {}) {
  const unavailable = (detail) => ({ state: 'unavailable', detail, sources: [], corrections: [] });
  const linkedCases = [...new Set((issue.linked_test_case_ids || []).filter(Boolean))];
  if (!issue.linked_test_run_id && !linkedCases.length) return unavailable('Link a failed Test Run or Test Case to add execution context.');
  if (!user || !await canView('testcase.view')) return unavailable('Test Case view permission is required to assess linked test evidence.');
  if (!issue.linked_test_run_id || !await canView('run.view') || !await canView('result.view')) {
    const cases = await reproduction.loadCaseReproduction({ projectId: issue.project_id, testCaseIds: linkedCases.slice(0, caseLimit) });
    return {
      ...unavailable(issue.linked_test_run_id ? 'Run and result view permissions are required to verify the failed attempt.' : 'Current Test Case details were included. Link a failed attempt to verify its observed result.'),
      sources: cases.map((item, index) => ({
        ref: `issue:${issue.id}:test_case:${index + 1}`, type: 'test-case', id: item.id, issue_id: issue.id,
        field: 'test_case', title: publicText(item.title),
        excerpt: publicText([item.description, item.expected_result].filter(Boolean).join(' · ')), trust: 'workspace'
      }))
    };
  }
  // Scope is derived entirely from the existing Defect. Exclude unrelated
  // comments and attachments from this decision and its provider request.
  const reverseLinks = issue.linked_execution_result_id ? [] : await recordedFailureLinks(issue, database);
  if (reverseLinks.length > 1) return {
    state: 'ambiguous', detail: 'Multiple failed attempts reference this Defect. Link the exact result to verify the reported failure.', sources: [], corrections: []
  };
  const exactResult = issue.linked_execution_result_id || reverseLinks[0]?.id;
  if (!exactResult && linkedCases.length > 10) return unavailable('Too many Test Cases are linked to identify one failed attempt. Link the exact result to verify the failure.');
  const packets = await failureEvidence.collect({
    projectId: issue.project_id,
    runIds: [issue.linked_test_run_id],
    testCaseIds: exactResult ? [] : linkedCases,
    resultIds: exactResult ? [exactResult] : [],
    canView: (permission) => ['result.view', 'testcase.view'].includes(permission),
    read: (sql, values) => database.prepare(sql).all(...values)
  });
  const failedCaseId = exactResult && packets.find((packet) => packet.result_id === exactResult)?.test_case_id;
  const canLinkCase = failedCaseId && !linkedCases.includes(failedCaseId) && Boolean(await database.prepare(`SELECT tc.id FROM test_cases tc
    JOIN app_types app ON app.id = tc.app_type_id WHERE tc.id = ? AND app.project_id = ?`).get(failedCaseId, issue.project_id));
  return summarizeFailure(issue, packets, exactResult, canLinkCase);
}

module.exports = { readIssueContext, summarizeFailure };
