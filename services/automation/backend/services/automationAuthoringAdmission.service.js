const fail = (message, code = 'AUTOMATION_AUTHORING_BUSY', statusCode = 409, details) => Object.assign(new Error(message), { code, statusCode, ...(details ? { details } : {}) });

function createAuthoringAdmission(dependencies = {}) {
  const database = () => dependencies.db || require('@hellotest/platform/backend/src/db');
  const observability = () => dependencies.obsDb || require('@hellotest/platform/backend/src/obsDb');
  const scope = async ({ testCase, caseIds = [testCase?.id] } = {}) => {
    if (!Array.isArray(caseIds)) throw fail('Choose an available case scope.', 'AUTOMATION_AUTHORING_SCOPE_INVALID', 400);
    const ids = [...new Set(caseIds)];
    if (!testCase?.id || !testCase.app_type_id || !testCase.project_id || !ids.length || ids.length > 2000 || ids.some(id => typeof id !== 'string' || !id)) throw fail('Choose an available case scope.', 'AUTOMATION_AUTHORING_SCOPE_INVALID', 400);
    const marks = ids.map(() => '?').join(',');
    const rows = await database().prepare(`SELECT tc.id,tc.app_type_id,app.project_id FROM test_cases tc JOIN app_types app ON app.id=tc.app_type_id WHERE tc.id IN (${marks}) AND tc.app_type_id=? AND app.project_id=? FOR SHARE OF tc`).all(...ids, testCase.app_type_id, testCase.project_id);
    if (rows.length !== ids.length) throw fail('The case scope changed. Refresh before starting another authoring operation.', 'AUTOMATION_AUTHORING_SCOPE_CHANGED');
    const links = await database().prepare(`SELECT manual_test_case_id AS id FROM automation_case_links WHERE automation_test_case_id IN (${marks}) UNION SELECT automation_test_case_id AS id FROM automation_case_links WHERE manual_test_case_id IN (${marks}) LIMIT 4001`).all(...ids, ...ids);
    const all = [...new Set([...ids, ...links.map(row => row.id)])];
    if (all.length > 4000) throw fail('This linked case scope exceeds the authoring admission limit.', 'AUTOMATION_AUTHORING_SCOPE_INVALID', 422);
    return all;
  };
  const state = async input => {
    const ids = await scope(input), marks = ids.map(() => '?').join(',');
    // The plan and receipt commit atomically in the main store. Optional activity
    // delivery may lag; a durable receipt is authoritative for releasing admission.
    const completed = new Set((await database().prepare(`SELECT transaction_id FROM automation_recording_imports WHERE project_id=? AND (source_test_case_id IN (${marks}) OR test_case_id IN (${marks})) AND transaction_id IS NOT NULL`).all(input.testCase.project_id, ...ids, ...ids)).map(row => row.transaction_id));
    const rows = await observability().prepare(`SELECT id,status,action,metadata->>'current_phase' AS phase FROM workspace_transactions WHERE project_id=? AND app_type_id=? AND category='automation_build' AND status IN ('queued','running') AND id NOT IN (SELECT jsonb_array_elements_text(?::jsonb)) AND ((related_kind='test_case' AND related_id IN (${marks})) OR metadata->>'test_case_id' IN (${marks}) OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(metadata->'input_test_case_ids')='array' THEN metadata->'input_test_case_ids' ELSE '[]'::jsonb END) AS item(value) WHERE item.value IN (${marks})) OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(metadata->'output_test_case_ids')='array' THEN metadata->'output_test_case_ids' ELSE '[]'::jsonb END) AS item(value) WHERE item.value IN (${marks}))) ORDER BY CASE WHEN action='test_case_recorder' THEN 0 ELSE 1 END,created_at,id LIMIT 51`).all(input.testCase.project_id, input.testCase.app_type_id, JSON.stringify([...completed]), ...ids, ...ids, ...ids, ...ids);
    const recording = rows.find(row => row.action === 'test_case_recorder' && row.id !== input.excludeTransactionId);
    let build = rows.find(row => row.action !== 'test_case_recorder' && row.id !== input.excludeTransactionId);
    if (!build) build = await observability().prepare(`SELECT transaction_id AS id,status FROM automation_generator_jobs WHERE project_id=? AND test_case_id IN (${marks}) AND status IN ('queued','leased','running') AND (?::text IS NULL OR transaction_id<>?) ORDER BY created_at,id LIMIT 1`).get(input.testCase.project_id, ...ids, input.excludeTransactionId || null, input.excludeTransactionId || null);
    const safe = row => row ? { activity_id: row.id, status: row.status, ...(typeof row.phase === 'string' && /^[a-z._-]{1,100}$/.test(row.phase) ? { phase: row.phase } : {}) } : null;
    return { case_id: input.testCase.id, state: recording && build ? 'conflict' : recording ? 'recording' : build ? 'building' : 'idle', recording: safe(recording), build: safe(build), can_build: !recording, can_record: !recording && !build };
  };
  const admit = (kind, input, reserve) => database().transaction(async () => {
    // Queue admission already uses this same application lock. Reserve a
    // durable activity here, then release before browser/model/network work.
    await database().prepare("SELECT pg_advisory_xact_lock(hashtext('hellotest.automation-build'),hashtext(?))").get(input.testCase.app_type_id);
    const current = await state(input), blocked = current.recording || kind === 'recording' && current.build;
    if (blocked) throw fail(current.recording ? 'A recording is active for this case. Save or stop it before building or recording again.' : 'Automation is queued or building for this case. Finish or cancel that build before recording.', undefined, 409, { operation: current.recording ? 'recording' : 'build', ...blocked });
    return reserve();
  })();
  return {
    state,
    withBuild: (input, reserve) => admit('build', input, reserve),
    withRecorder: (input, reserve) => admit('recording', input, reserve),
    assertNoRecorder: async input => {
      const current = await state(input);
      if (current.recording) throw fail('A recording is active for this case. Save or stop it before starting a build.', undefined, 409, { operation: 'recording', ...current.recording });
      return current;
    }
  };
}
module.exports = { ...createAuthoringAdmission(), createAuthoringAdmission };
