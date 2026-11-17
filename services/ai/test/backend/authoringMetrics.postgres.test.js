const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID: uuid } = require('node:crypto');

test('AI live metrics and agentic workflow rollups use real scoped PostgreSQL cohorts', {
  skip: process.env.AUTHORING_METRICS_POSTGRES !== '1', timeout: 120000
}, async t => {
  assert.match(new URL(process.env.DATABASE_URL).pathname, /^\/agent_verify_authoring_metrics_\d+$/);
  const db = require('@hellotest/platform/backend/src/db');
  const obs = require('@hellotest/platform/backend/src/obsDb');
  try {
    await db.query(fs.readFileSync(path.resolve(__dirname, '../../../platform/backend/instance-setup-data/schema-setup/schema.sql'), 'utf8'));
    await require('../../../platform/backend/src/db/bootstrap').ensureRuntimeSchema();
    const admin = { id: uuid(), role: 'admin' }, reader = { id: uuid() }, restricted = { id: uuid() };
    for (const user of [admin, reader, restricted]) await db.prepare("INSERT INTO users(id,email,password_hash,name,status,is_workspace_admin) VALUES(?,?,?,'Metric fixture','active',?)")
      .run(user.id, `${user.id}@example.test`, 'not-a-login', user === admin);
    const project = uuid(), foreign = uuid(), app = uuid(), secondApp = uuid(), foreignApp = uuid();
    for (const id of [project, foreign]) await db.prepare('INSERT INTO projects(id,name,created_by) VALUES(?,?,?)').run(id, 'Disposable metric project', admin.id);
    for (const [id, owner] of [[app, project], [secondApp, project], [foreignApp, foreign]]) await db.prepare("INSERT INTO app_types(id,project_id,name,type) VALUES(?,?,?,'web')").run(id, owner, `Application ${id}`);
    for (const [user, codes] of [[reader, ['requirement.view', 'testcase.view', 'feedback.view', 'run.view', 'result.view', 'agentic_workflow.view']], [restricted, ['requirement.view', 'run.view']]]) {
      const role = uuid(); await db.prepare('INSERT INTO roles(id,name) VALUES(?,?)').run(role, role);
      await db.prepare('INSERT INTO project_members(id,project_id,user_id,role_id) VALUES(?,?,?,?)').run(uuid(), project, user.id, role);
      for (const code of codes) await db.prepare('INSERT INTO role_permissions(role_id,permission_id) SELECT ?,id FROM permissions WHERE code=?').run(role, code);
    }
    const stories = [uuid(), uuid(), uuid()], cases = [uuid(), uuid(), uuid()];
    for (const id of stories) await db.prepare("INSERT INTO requirements(id,project_id,title,status) VALUES(?,?,'Metric Story','open')").run(id, project);
    for (const [index, id] of cases.entries()) await db.prepare('INSERT INTO test_cases(id,app_type_id,requirement_id,title,automated,authoring_mode,gherkin_document) VALUES(?,?,?,?,?,?,?)')
      .run(id, app, index === 1 ? null : stories[index === 0 ? 0 : 1], `Metric case ${index}`, index === 1 ? 'yes' : 'no', index === 2 ? 'gherkin' : 'structured', index === 2 ? 'Feature: Invoice\nScenario: View\nGiven an invoice\nWhen viewed\nThen its reference appears' : null);
    // Multiple Story links and steps must not inflate authored case totals.
    for (const story of [stories[0], stories[1]]) await db.prepare('INSERT INTO requirement_test_cases(requirement_id,test_case_id) VALUES(?,?)').run(story, cases[0]);
    for (let step = 1; step <= 2; step++) await db.prepare('INSERT INTO test_steps(id,test_case_id,step_order,action,expected_result) VALUES(?,?,?,?,?)').run(uuid(), cases[0], step, 'Observe the invoice', 'Reference is visible');
    const foreignCase = uuid(); await db.prepare("INSERT INTO test_cases(id,app_type_id,title,automated) VALUES(?,?,'Foreign case','yes')").run(foreignCase, foreignApp);
    for (const [status, severity] of [['open', 'high'], ['Verified', 'high'], ['fixed', 'critical'], ['cancelled', 'medium'], [null, 'medium']]) await db.prepare("INSERT INTO feedback(id,project_id,user_id,message,title,status,severity,linked_test_case_ids) VALUES(?,?,?,'Fixture evidence',?,?,?,?)")
      .run(uuid(), project, admin.id, `Defect ${status || 'unknown'}`, status, severity, [cases[0]]);
    await db.prepare("INSERT INTO feedback(id,project_id,user_id,message,title,status,severity) VALUES(?,?,?,'Fixture evidence','Foreign defect','open','critical')").run(uuid(), foreign, admin.id);
    const run = uuid(); await db.prepare("INSERT INTO executions(id,project_id,app_type_id,name,status,trigger) VALUES(?,?,?,'Latest case fixture','failed','manual')").run(run, project, app);
    await db.prepare('INSERT INTO execution_case_snapshots(execution_id,test_case_id,test_case_title) VALUES(?,?,?)').run(run, cases[0], 'Frozen selected case');
    for (const [caseId, status, created] of [[cases[0], 'failed', '2026-11-17T08:00:00Z'], [cases[0], 'passed', '2026-11-17T09:00:00Z'], [cases[1], 'passed', '2026-11-17T09:01:00Z']]) await db.prepare('INSERT INTO execution_results(id,execution_id,test_case_id,app_type_id,status,created_at) VALUES(?,?,?,?,?,?)').run(uuid(), run, caseId, app, status, created);
    const context = require('../../backend/services/aiContextOrchestrator.service');
    const evidence = async (scopes, user = reader, extra = {}) => {
      const response = await require('../../../knowledge/backend/services/knowledgeExecution.service').run({}, () => context.buildLiveProjectEvidence({ projectId: project, prompt: 'Inspect the current metric fixture', user, route: { live_scopes: scopes }, ...extra }));
      return response.hits.map(hit => JSON.parse(hit.content)).filter(item => item.evidence_type);
    };

    await t.test('AI Story and case numerators/denominators exclude foreign records and duplicate links', async () => {
      const all = await evidence(['stories', 'test-cases']);
      const story = all.find(item => item.evidence_type === 'authoritative_live_story_snapshot');
      const catalog = all.find(item => item.evidence_type === 'authoritative_live_test_case_snapshot');
      assert.equal(story.total_records, 3); assert.equal(story.covered_records, 2); assert.equal(story.uncovered_records, 1);
      assert.equal(catalog.total_records, 3); assert.equal(catalog.automated_or_ready, 1); assert.equal(catalog.without_steps, 1); assert.equal(catalog.without_story_traceability, 1);
      assert.equal(catalog.records.find(row => row.title === 'Metric case 0').step_count, 2);
      const one = (await evidence(['test-cases'], reader, { evidenceScope: { test_case_id: cases[0] }, appTypeId: app })).find(item => item.evidence_type === 'authoritative_live_test_case_snapshot');
      assert.equal(one.total_records, 1); assert.equal(one.without_steps, 0); assert.equal(one.automated_or_ready, 0);
      const foreignScope = await evidence(['test-cases'], reader, { evidenceScope: { test_case_id: foreignCase } });
      assert.equal(foreignScope.find(item => item.evidence_type === 'authoritative_live_test_case_snapshot').total_records, 0);
    });
    await t.test('AI defect counts share terminal status vocabulary with the product', async () => {
      const defects = (await evidence(['bugs'])).find(item => item.evidence_type === 'authoritative_live_bug_snapshot');
      assert.equal(defects.total_records, 5); assert.equal(defects.open_records, 2); assert.equal(defects.critical_or_high, 3);
      assert.equal(defects.open_critical_or_high_records.length, 1);
    });
    await t.test('AI run result metrics use the latest frozen case instance, excluding old attempts and out-of-scope identities', async () => {
      const outcomes = (await evidence(['runs'], reader, { evidenceScope: { execution_id: run } })).find(item => item.evidence_type === 'authoritative_live_execution_snapshot');
      assert.equal(outcomes.total_records, 1); assert.equal(outcomes.failed_results, 0);
      assert.equal(outcomes.records[0].result_count, 1); assert.equal(outcomes.records[0].passed_count, 1);
      const selected = (await evidence(['runs'], reader, { appTypeId: app, evidenceScope: { execution_id: run, test_case_id: cases[0] } })).find(item => item.evidence_type === 'authoritative_live_execution_snapshot');
      assert.equal(selected.total_records, 1); assert.equal(selected.records[0].result_count, 1);
      const excluded = (await evidence(['runs'], reader, { appTypeId: app, evidenceScope: { execution_id: run, test_case_id: foreignCase } })).find(item => item.evidence_type === 'authoritative_live_execution_snapshot');
      assert.equal(excluded.total_records, 0); assert.deepEqual(excluded.records, []);
    });
    await t.test('AI native-run instance totals exclude linked-manual projections and retain distinct data rows', async () => {
      const nativeRun = uuid();
      await db.prepare("INSERT INTO executions(id,project_id,app_type_id,name,status,trigger) VALUES(?,?,?,'Native matrix fixture','passed','manual')").run(nativeRun, project, app);
      await db.prepare('INSERT INTO execution_case_snapshots(execution_id,test_case_id,test_case_title) VALUES(?,?,?)').run(nativeRun, cases[1], 'Frozen native case');
      await db.prepare('INSERT INTO automation_case_links(automation_test_case_id,manual_test_case_id,is_primary) VALUES(?,?,TRUE)').run(cases[1], cases[2]);
      for (const index of [0, 1]) await db.prepare("INSERT INTO execution_results(id,execution_id,test_case_id,app_type_id,status,data_set_iteration_index,created_at) VALUES(?,?,?,?,'passed',?,'2026-11-17T09:00:00Z')").run(uuid(), nativeRun, cases[1], app, index);
      assert.equal((await db.prepare('SELECT count(*)::int AS count FROM test_case_effective_results WHERE execution_id=? AND derived=TRUE').get(nativeRun)).count, 1, 'The fixture must contain a genuine linked-manual projection.');
      const outcomes = (await evidence(['runs'], reader, { evidenceScope: { execution_id: nativeRun } })).find(item => item.evidence_type === 'authoritative_live_execution_snapshot');
      assert.equal(outcomes.records[0].result_count, 2); assert.equal(outcomes.records[0].passed_count, 2); assert.equal(outcomes.failed_results, 0);
    });
    await t.test('revoked source permissions omit unavailable ratios rather than manufacture zero', async () => {
      const restrictedEvidence = await evidence(['stories', 'test-cases', 'runs', 'bugs'], restricted);
      assert.ok(!restrictedEvidence.some(item => item.evidence_type === 'authoritative_live_test_case_snapshot' || item.evidence_type === 'authoritative_live_bug_snapshot'));
      const story = restrictedEvidence.find(item => item.evidence_type === 'authoritative_live_story_snapshot');
      assert.equal(story.coverage_available, false); assert.equal(story.covered_records, null);
      const outcomes = restrictedEvidence.find(item => item.evidence_type === 'authoritative_live_execution_snapshot');
      assert.equal(outcomes.results_available, false); assert.equal(outcomes.failed_results, null); assert.equal(outcomes.records[0].result_count, null);
      await db.prepare('DELETE FROM role_permissions WHERE role_id=(SELECT role_id FROM project_members WHERE project_id=? AND user_id=?) AND permission_id=(SELECT id FROM permissions WHERE code=?)').run(project, reader.id, 'feedback.view');
      assert.ok(!(await evidence(['bugs'])).some(item => item.evidence_type === 'authoritative_live_bug_snapshot'));
    });

    const workflow = uuid(), emptyWorkflow = uuid(), archived = uuid(), otherWorkflow = uuid();
    for (const [id, owner, appId, status] of [[workflow, project, app, 'active'], [emptyWorkflow, project, secondApp, 'draft'], [archived, project, app, 'archived'], [otherWorkflow, foreign, foreignApp, 'active']]) await db.prepare('INSERT INTO agentic_workflows(id,project_id,app_type_id,name,status) VALUES(?,?,?,?,?)').run(id, owner, appId, `Workflow ${id}`, status);
    for (const [id, owner, appId, status, created] of [[workflow, project, app, 'failed', '2026-11-17T08:00:00Z'], [workflow, project, app, 'completed', '2026-11-17T09:00:00Z'], [workflow, project, app, 'cancelled', '2026-11-17T10:00:00Z'], [workflow, foreign, foreignApp, 'failed', '2026-11-17T11:00:00Z'], [otherWorkflow, foreign, foreignApp, 'running', '2026-11-17T11:30:00Z']]) await db.prepare('INSERT INTO agentic_workflow_runs(id,workflow_id,project_id,app_type_id,workflow_name,status,created_at) VALUES(?,?,?,?,?,?,?)').run(uuid(), id, owner, appId, 'Metric workflow', status, created);
    const workflows = require('../../../agentic/backend/services/agenticWorkflow.service');
    await t.test('agentic workflow rollups count all own statuses and deterministically select the latest scoped run', async () => {
      const listed = await workflows.listWorkflows({ project_id: project, user: reader });
      assert.equal(listed.length, 2); const target = listed.find(row => row.id === workflow);
      assert.equal(target.run_count, 3); assert.equal(target.latest_run_status, 'cancelled');
      assert.equal(listed.find(row => row.id === emptyWorkflow).run_count, 0);
      assert.equal(listed.find(row => row.id === emptyWorkflow).latest_run_status, null);
      assert.equal((await workflows.listWorkflows({ project_id: project, app_type_id: app, user: reader })).length, 1);
      assert.equal((await workflows.listWorkflows({ project_id: project, status: 'archived', user: reader }))[0].id, archived);
    });
    await t.test('agentic metric queries enforce project ACLs and current permission revocation', async () => {
      assert.deepEqual(await workflows.listWorkflows({ project_id: foreign, user: reader }), []);
      assert.deepEqual(await workflows.listWorkflows({ project_id: project, user: restricted }), []);
      await db.prepare('DELETE FROM role_permissions WHERE role_id=(SELECT role_id FROM project_members WHERE project_id=? AND user_id=?) AND permission_id=(SELECT id FROM permissions WHERE code=?)').run(project, reader.id, 'agentic_workflow.view');
      assert.deepEqual(await workflows.listWorkflows({ project_id: project, user: reader }), []);
    });
  } finally { await Promise.all([db.close(), obs.close()]); }
});
