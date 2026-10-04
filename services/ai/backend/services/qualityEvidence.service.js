const db = require('@hellotest/platform/backend/src/db');
const { getOptionalEvidenceAccess } = require('@hellotest/platform/backend/services/optionalEvidenceAccess.service');
const { releaseStoryMembershipSql, releaseExecutionMembershipSql } = require('@hellotest/platform/backend/src/utils/deliveryScopeSql');
const engine = require('./qualityEvidenceRules');
const coverageRules = require('./qualityCoverageRules');
const LIMIT = 2000;
const text = value => typeof value === 'string' ? value.trim().slice(0, 255) : '';
const list = value => Array.isArray(value) ? value : [];
const failure = message => Object.assign(new Error(message), { statusCode: 400, publicMessage: message });

async function collect({ projectId, appTypeId, user, input = {}, scopes, existingTransaction = false }) {
  const scope = { project_id: projectId, app_type_id: appTypeId || null, release_id: text(input.release_id), build: text(input.build), environment_id: text(input.environment_id), story_id: text(input.story_id), test_case_id: text(input.test_case_id), execution_id: text(input.execution_id) };
  const access = await getOptionalEvidenceAccess(user, projectId, ['requirement.view', 'testcase.view', 'run.view', 'result.view', 'feedback.view', 'quality_gate.view']);
  const enabled = new Set(scopes || ['stories', 'test-cases', 'runs', 'bugs']);
  for (const [permission, name] of [['requirement.view','stories'], ['testcase.view','test-cases'], ['run.view','runs'], ['feedback.view','bugs']]) access[permission] = access[permission] && enabled.has(name);
  const limitations = [];
  if (!access["testcase.view"] || !access["run.view"]) access["result.view"] = false;
  const readSnapshot = async () => {
    if (!existingTransaction) await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    await db.query("SET LOCAL statement_timeout = '8000ms'");
    const observed = await db.prepare('SELECT CURRENT_TIMESTAMP AS as_of').get();
    if (scope.release_id && !await db.prepare('SELECT id FROM requirement_releases WHERE id = ? AND project_id = ?').get(scope.release_id, projectId)) throw failure('Choose a Release in the current project.');
    if (scope.environment_id && !await db.prepare('SELECT id FROM test_environments WHERE id = ? AND project_id = ?').get(scope.environment_id, projectId)) throw failure('Choose an environment in the current project.');
    const storyWhere = `r.project_id = ? AND (? = '' OR r.id = ?) AND (? = '' OR EXISTS (SELECT 1 FROM requirement_releases rel WHERE rel.id = ? AND rel.project_id = r.project_id AND ${releaseStoryMembershipSql('r', 'rel')}))`;
    const runWhere = `e.project_id = ? AND (? = '' OR e.id = ?) AND (? = '' OR e.build = ?) AND (? = '' OR e.test_environment_id = ?) AND (? = '' OR e.app_type_id = ?) AND (? = '' OR EXISTS (SELECT 1 FROM requirement_releases rel WHERE rel.id = ? AND rel.project_id = e.project_id AND ${releaseExecutionMembershipSql('e', 'rel')}))`;
    const runArgs = [projectId, scope.execution_id, scope.execution_id, scope.build, scope.build, scope.environment_id, scope.environment_id, appTypeId || '', appTypeId || '', scope.release_id, scope.release_id];
    const stories = access['requirement.view'] ? await db.prepare(`SELECT r.id, r.title, r.status, r.priority, r.additional_fields, r.updated_at,
      COALESCE((SELECT jsonb_agg(links.id ORDER BY links.id) FROM (SELECT test_case_id AS id FROM requirement_test_cases WHERE requirement_id = r.id UNION SELECT id FROM test_cases WHERE requirement_id = r.id) links), '[]'::jsonb) AS test_case_ids
      FROM requirements r WHERE ${storyWhere} ORDER BY r.id LIMIT ${LIMIT + 1}`).all(projectId, scope.story_id, scope.story_id, scope.release_id, scope.release_id) : [];
    const tests = access['testcase.view'] ? await db.prepare(`SELECT t.id, t.title, t.description, t.status, t.updated_at, t.automated,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id', s.id, 'action', s.action, 'expected_result', s.expected_result, 'step_type', s.step_type, 'automation_code', s.automation_code, 'api_request', s.api_request) ORDER BY s.step_order) FROM test_steps s WHERE s.test_case_id = t.id), '[]'::jsonb) AS steps
      FROM test_cases t JOIN app_types a ON a.id = t.app_type_id WHERE a.project_id = ? AND (? = '' OR t.app_type_id = ?) AND (? = '' OR t.id = ?)
      AND (? = '' OR t.requirement_id = ? OR EXISTS (SELECT 1 FROM requirement_test_cases l WHERE l.test_case_id = t.id AND l.requirement_id = ?))
      ORDER BY t.id LIMIT ${LIMIT + 1}`).all(projectId, appTypeId || '', appTypeId || '', scope.test_case_id, scope.test_case_id, scope.story_id, scope.story_id, scope.story_id) : [];
    const runs = access['run.view'] ? await db.prepare(`SELECT e.id, e.name, e.status, e.build, e.release_id, e.test_environment_id, e.test_configuration_snapshot, e.test_environment_snapshot FROM executions e WHERE ${runWhere} ORDER BY e.id LIMIT ${LIMIT + 1}`).all(...runArgs) : [];
    const attempts = access['run.view'] && access['result.view'] && access['testcase.view'] ? await db.prepare(`SELECT result.id, result.execution_id, result.test_case_id, result.status, result.revision, result.created_at, result.data_set_row_snapshot, result.logs,
      (SELECT jsonb_build_object('title', cs.test_case_title, 'description', cs.test_case_description) FROM execution_case_snapshots cs WHERE cs.execution_id = result.execution_id AND cs.test_case_id = result.test_case_id) AS case_snapshot,
      (SELECT jsonb_agg(jsonb_build_object('action', es.action, 'expected_result', es.expected_result, 'step_type', es.step_type, 'snapshot_step_id', es.snapshot_step_id, 'automation_code', es.automation_code, 'api_request', es.api_request) ORDER BY es.step_order) FROM execution_step_snapshots es WHERE es.execution_id = result.execution_id AND es.test_case_id = result.test_case_id) AS step_snapshot
      FROM execution_results result JOIN executions e ON e.id = result.execution_id WHERE ${runWhere} AND (? = '' OR result.test_case_id = ?) ORDER BY result.created_at, result.id LIMIT ${LIMIT + 1}`).all(...runArgs, scope.test_case_id, scope.test_case_id) : [];
    // Defects are project-wide until filtered against the selected release's recorded story/test/run links below.
    const defects = access['feedback.view'] ? await db.prepare(`SELECT f.id, f.title, f.status, f.severity, f.priority, f.updated_at, f.linked_test_run_id,
      COALESCE(f.linked_requirement_ids, '[]'::jsonb) || COALESCE((SELECT jsonb_agg(requirement_id) FROM requirement_defects WHERE issue_id = f.id), '[]'::jsonb) AS requirement_ids,
      COALESCE(f.linked_test_case_ids, '[]'::jsonb) || COALESCE((SELECT jsonb_agg(test_case_id) FROM test_case_defects WHERE issue_id = f.id), '[]'::jsonb) AS test_case_ids
      FROM feedback f WHERE f.project_id = ? ORDER BY f.id LIMIT ${LIMIT + 1}`).all(projectId) : [];
    const assertion_reviews = access['requirement.view'] && access['testcase.view'] ? await db.prepare(`SELECT * FROM (SELECT DISTINCT ON (obligation_id,test_case_id,step_id) * FROM quality_assertion_reviews WHERE project_id = ? AND (? = '' OR story_id = ?) AND (? = '' OR test_case_id = ?) ORDER BY obligation_id,test_case_id,step_id,created_at DESC,id DESC) latest ORDER BY created_at DESC,id DESC LIMIT 10001`).all(projectId,scope.story_id,scope.story_id,scope.test_case_id,scope.test_case_id) : [];
    if (assertion_reviews.length > 10000) { limitations.push('Assertion reviews exceed the evidence budget. Narrow the scope.'); assertion_reviews.length=10000; }
    const release_policy = access['quality_gate.view'] ? await db.prepare('SELECT * FROM quality_release_policies WHERE project_id=? ORDER BY version DESC LIMIT 1').get(projectId) : null;
    const release_waivers = release_policy ? await db.prepare(`SELECT DISTINCT ON (gate_id) * FROM quality_release_waivers WHERE project_id=? AND policy_version=? AND release_id=? AND build=? AND environment_id=? ORDER BY gate_id,approved_at DESC,id DESC`).all(projectId,release_policy.version,scope.release_id,scope.build,scope.environment_id) : [];
    return { release_policy, release_waivers, assertion_reviews, project_id: projectId, as_of: new Date(observed.as_of).toISOString(), scope, stories, tests, runs, attempts, defects };
  };
  const snapshot = existingTransaction ? await readSnapshot() : await db.transaction(readSnapshot)();
  snapshot.coverage_complete = Boolean(access['requirement.view'] && access['testcase.view'] && snapshot.stories.length <= LIMIT && snapshot.tests.length <= LIMIT && !appTypeId && !scope.test_case_id);
  for (const [source, permission] of [['stories','requirement.view'], ['tests','testcase.view'], ['runs','run.view'], ['attempts','result.view'], ['defects','feedback.view']]) {
    if (!access[permission]) limitations.push(`${source}: unavailable under selected tools, scopes or permissions.`);
    if (snapshot[source].length > LIMIT) limitations.push(`${source}: exceeds the ${LIMIT}-record evidence budget; absence cannot be concluded.`);
    snapshot[source] = snapshot[source].slice(0, LIMIT);
  }
  if (scope.story_id && access['requirement.view'] && !snapshot.stories.some(row => row.id === scope.story_id)) throw failure('The selected Story is unavailable in this scope.');
  if (scope.test_case_id && access['testcase.view'] && !snapshot.tests.some(row => row.id === scope.test_case_id)) throw failure('The selected Test Case is unavailable in this scope.');
  if (appTypeId) {
    const applicationTests = new Set(snapshot.tests.map(row => row.id));
    snapshot.stories = snapshot.stories.filter(row => list(row.test_case_ids).some(id => applicationTests.has(id)));
    limitations.push('Application scope includes only Stories linked to accessible application tests; unlinked obligations remain unknown.');
  }
  if (scope.test_case_id) snapshot.stories = snapshot.stories.filter(row => list(row.test_case_ids).includes(scope.test_case_id));
  const storyIds = new Set(snapshot.stories.map(row => row.id));
  const scopedTestIds = new Set(snapshot.stories.flatMap(row => list(row.test_case_ids)));
  if (scope.release_id || scope.story_id) {
    snapshot.tests = snapshot.tests.filter(row => scopedTestIds.has(row.id));
    snapshot.attempts = snapshot.attempts.filter(row => scopedTestIds.has(row.test_case_id));
    const runIds = new Set(snapshot.runs.map(row => row.id));
    const unscopedDefectCount = snapshot.defects.length;
    snapshot.defects = snapshot.defects.filter(row => list(row.requirement_ids).some(id => storyIds.has(id)) || list(row.test_case_ids).some(id => scopedTestIds.has(id)) || scope.release_id && runIds.has(row.linked_test_run_id));
    if (snapshot.defects.length < unscopedDefectCount) limitations.push('Unlinked Defects cannot be assigned to this release or Story; their absence does not establish a clear release.');
  }
  if (scope.test_case_id) snapshot.defects = snapshot.defects.filter(row => list(row.test_case_ids).includes(scope.test_case_id));
  const visibleTests = new Set(snapshot.tests.map(row => row.id));
  const visibleStories = new Set(snapshot.stories.map(row => row.id));
  const visibleRuns = new Set(snapshot.runs.map(row => row.id));
  if (appTypeId) snapshot.defects = snapshot.defects.filter(row => list(row.requirement_ids).some(id => visibleStories.has(id)) || list(row.test_case_ids).some(id => visibleTests.has(id)) || visibleRuns.has(row.linked_test_run_id));
  snapshot.attempts = snapshot.attempts.filter(row => visibleTests.has(row.test_case_id) && visibleRuns.has(row.execution_id));
  for (const story of snapshot.stories) story.test_case_ids = list(story.test_case_ids).filter(id => visibleTests.has(id));
  for (const defect of snapshot.defects) {
    defect.requirement_ids = list(defect.requirement_ids).filter(id => visibleStories.has(id));
    defect.test_case_ids = list(defect.test_case_ids).filter(id => visibleTests.has(id));
    if (!visibleRuns.has(defect.linked_test_run_id)) delete defect.linked_test_run_id;
  }
  for (const run of snapshot.runs) { run.configuration_hash = run.test_configuration_snapshot && run.test_environment_snapshot ? engine.hash([run.test_configuration_snapshot, run.test_environment_snapshot]) : null; delete run.test_configuration_snapshot; delete run.test_environment_snapshot; }
  for (const attempt of snapshot.attempts) {
    attempt.case_revision = attempt.case_snapshot && attempt.step_snapshot ? engine.hash([attempt.case_snapshot, attempt.step_snapshot]) : null;
    attempt.specification_hash = attempt.case_snapshot && attempt.step_snapshot ? coverageRules.specificationHash({ ...attempt.case_snapshot, steps: attempt.step_snapshot }) : null;
    attempt.data_hash = attempt.data_set_row_snapshot ? engine.hash(attempt.data_set_row_snapshot) : null;
    const statuses = require('@hellotest/platform/backend/src/domain/executionStepEvidence').parseStructuredLogs(attempt.logs).stepStatuses;
    attempt.assertions = list(attempt.step_snapshot).filter(step => step.expected_result?.trim()).map(step => ({ hash: coverageRules.assertionHash(step), status: statuses[step.snapshot_step_id] || 'unknown' }));
    delete attempt.case_snapshot; delete attempt.step_snapshot; delete attempt.data_set_row_snapshot; delete attempt.logs;
  }
  snapshot.assertion_reviews = snapshot.assertion_reviews.filter(review => visibleStories.has(review.story_id) && visibleTests.has(review.test_case_id));
  // Remove free-form metadata before packaging the snapshot; only acceptance obligations are needed.
  for (const story of snapshot.stories) { story.acceptance_criteria = list(story.additional_fields?.acceptance_criteria); delete story.additional_fields; if (!access['testcase.view']) story.test_case_ids = []; }
  if (!access['requirement.view']) for (const defect of snapshot.defects) defect.requirement_ids = [];
  if (!access['testcase.view']) for (const defect of snapshot.defects) defect.test_case_ids = [];
  if (Buffer.byteLength(JSON.stringify(snapshot)) > 2000000) throw Object.assign(failure("This evidence snapshot exceeds the review budget. Select a Story, Test Case, or release to narrow the scope."), { code: "AI_EVIDENCE_BUDGET" });
  snapshot.complete = limitations.length === 0;
  snapshot.limitations = limitations;
  return snapshot;
}

async function assess(input) {
  await require('./qualityGraphChanges').processPending();
  const snapshot = await collect(input);
  const persistence = await require('./qualityGraphStore.service').persist(snapshot, input.user);
  const report = engine.assess(snapshot, input.featureId, input.input);
  report.persistence = persistence;
  // The stored assessment keeps bounded evidence; the model receives a smaller explicit projection.
  const bound = value => typeof value === 'string' ? value.slice(0, 600) : Array.isArray(value) ? value.slice(0, 20).map(bound) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, bound(item)])) : value;
  const projection = bound(report);
  let reduced = JSON.stringify(projection) !== JSON.stringify(report);
  // Preserve complete JSON and authoritative metrics; reduce collections rather than slicing encoded JSON.
  const containers = [projection.data, projection.data.graph].filter(Boolean);
  while (JSON.stringify(projection).length > 11000) {
    const candidates = containers.flatMap(container => Object.entries(container).filter(([, value]) => Array.isArray(value) && value.length).map(([key, value]) => ({ container, key, value })));
    if (!candidates.length) throw Object.assign(failure('Narrow the review scope to fit its model context budget.'), { code: 'AI_EVIDENCE_BUDGET' });
    candidates.sort((a, b) => JSON.stringify(b.value).length - JSON.stringify(a.value).length);
    candidates[0].value.pop(); reduced = true;
  }
  if (reduced) projection.limitations.push('The model receives a bounded preview of this snapshot. Omitted rows cannot support negative claims; the saved report retains the bounded source assessment.');
  return { report, projection };
}
module.exports = { collect, assess };
