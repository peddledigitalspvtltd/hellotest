const assert = require('node:assert/strict');
const test = require('node:test');

test('analytics and readiness preserve scoped inventory, attempts and frozen data rows in PostgreSQL', { skip: process.env.QUALITY_OVERVIEW_POSTGRES !== '1', timeout: 30000 }, async (t) => {
  assert.match(new URL(process.env.DATABASE_URL).pathname.slice(1), /^agent_verify_[a-z0-9_]+$/);
  const db = require('../../src/db');
  const overview = require('../../src/services/qualityOverview.service');
  const visibility = { stories: true, cases: true, suites: true, runs: true, bugs: true, automation: true };
  try {
    assert.equal((await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public'")).rows.length, 0, 'Disposable empty database required');
    await db.query(`
      CREATE TABLE app_types(id text PRIMARY KEY, project_id text);
      CREATE TABLE requirements(id text PRIMARY KEY, project_id text);
      CREATE TABLE test_cases(id text PRIMARY KEY, app_type_id text, automated text, requirement_id text);
      CREATE TABLE requirement_test_cases(requirement_id text, test_case_id text);
      CREATE TABLE test_steps(id text, test_case_id text);
      CREATE TABLE test_suites(id text, app_type_id text);
      CREATE TABLE feedback(id text, project_id text, status text);
      CREATE TABLE executions(id text PRIMARY KEY, project_id text, name text, status text, started_at timestamptz, ended_at timestamptz, created_at timestamptz, test_data_set_snapshot jsonb);
      CREATE TABLE execution_results(id text PRIMARY KEY, execution_id text, test_case_id text, status text, data_set_iteration_index int, data_set_iteration_key text, created_at timestamptz, started_at timestamptz, timer_started_at timestamptz, ended_at timestamptz, lifecycle_history jsonb);
      CREATE TABLE execution_case_snapshots(execution_id text, test_case_id text, test_data_set_snapshot jsonb, test_data_set_id text);
      INSERT INTO app_types VALUES ('a','p'),('foreign-app','other');
      INSERT INTO requirements SELECT 'story-'||n,'p' FROM generate_series(1,250)n;
      INSERT INTO test_cases(id,app_type_id,automated) SELECT 'case-'||n,'a',CASE WHEN n<=150 THEN 'yes' ELSE 'no' END FROM generate_series(1,250)n;
      INSERT INTO test_cases(id,app_type_id,automated) VALUES('foreign-case','foreign-app','yes');
      INSERT INTO test_steps SELECT 'step-'||n,'case-'||n FROM generate_series(1,200)n;
      INSERT INTO requirement_test_cases SELECT 'story-'||n,'case-'||n FROM generate_series(1,125)n;
      INSERT INTO requirement_test_cases VALUES('story-126','foreign-case'),('story-127','deleted-case');
      UPDATE test_cases SET requirement_id='story-128' WHERE id='case-128';
      INSERT INTO test_suites VALUES('suite','a'),('private-suite','foreign-app');
      INSERT INTO feedback VALUES('open','p','Open'),('closed','p','RESOLVED'),('cancelled','p','cancelled'),('foreign','other','open');
      INSERT INTO executions(id,project_id,name,status,started_at,ended_at,created_at) VALUES
        ('run','p','Current run','running','2026-09-09T10:00Z',NULL,'2026-09-09T09:00Z'),
        ('edge','p','UTC boundary','completed','2026-08-28T00:00Z','2026-08-28T00:00Z','2026-08-27T23:00Z'),
        ('past','p','Too old','completed','2026-08-27T23:59:59Z','2026-08-27T23:59:59Z','2026-08-27T22:00Z'),
        ('future','p','Future','completed','2026-09-11T01:00Z','2026-09-11T02:00Z','2026-09-10T10:00Z'),
        ('private','other','Private','completed','2026-09-09T01:00Z','2026-09-09T02:00Z','2026-09-09T00:00Z');
      INSERT INTO execution_case_snapshots(execution_id,test_case_id,test_data_set_snapshot) VALUES ('run','case-1','{"rows":[{},{},{}]}'::jsonb),('run','case-2','{"mode":"key_value","rows":[{},{}]}'::jsonb),('edge','case-3','{"template_rows":[{},{}]}'::jsonb);
      INSERT INTO execution_results VALUES
        ('old','run','case-1','failed',0,'set:1','2026-09-09T10:00Z',NULL,NULL,'2026-09-10T11:50Z','[]'),
        ('new','run','case-1','passed',0,'set:1','2026-09-09T11:00Z',NULL,NULL,'2026-09-09T11:10Z','[]'),
        ('row1','run','case-1','blocked',1,'set:2','2026-09-09T11:00Z',NULL,NULL,'2026-09-09T11:15Z','[]'),
        ('a','run','case-2','failed',NULL,NULL,'2026-09-09T11:00Z',NULL,NULL,NULL,'[]'),
        ('z','run','case-2','paused',NULL,NULL,'2026-09-09T11:00Z',NULL,NULL,NULL,'[{"at":"2026-09-10T11:30:00.000Z"}]'),
        ('skipped','edge','case-3','skipped',0,'set:1','2026-08-28T00:00Z',NULL,NULL,'2026-08-28T00:00Z','[]'),
        ('future-attempt','run','case-1','failed',0,'set:1','2026-09-11T01:00Z',NULL,NULL,NULL,'[]');
    `);
    const result = await overview.getOverview({ projectId: 'p', days: 14, visibility, now: Date.parse('2026-09-10T12:00Z') });
    assert.deepEqual(result.inventory, { stories: 250, covered_stories: 126, cases: 250, designed_cases: 200, automated_cases: 150, suites: 1, open_defects: 1 });
    assert.deepEqual(result.execution, { passed: 1, failed: 0, blocked: 1, pending: 3, other: 1, total: 6, latest_evidence_at: '2026-09-10T11:30:00.000Z', completed_runs: 1, active_runs: 1 });
    assert.equal(result.trend.length, 14);
    assert.equal(result.trend[0].date, '2026-08-28');
    assert.equal(result.trend[0].runs, 1);
    assert.equal(result.trend.at(-1).date, '2026-09-10');
    assert.deepEqual(result.recent_runs.map(run => run.id), ['run','edge']);
    assert.equal(result.recent_runs[0].total, 4, 'Frozen rows stay in the denominator without results');
    assert.equal(result.evidence.complete, true);
    const privateResponse = await overview.getOverview({ projectId: 'p', days: 14, visibility: { stories: true }, now: Date.parse('2026-09-10T12:00Z') });
    assert.equal(privateResponse.inventory.stories, 250);
    assert.equal(privateResponse.inventory.covered_stories, null);
    assert.equal(privateResponse.inventory.cases, null);
    assert.equal(privateResponse.execution.total, null);
    assert.deepEqual(privateResponse.attention, []);
    assert.deepEqual(privateResponse.trend, []);

    await db.query(`ALTER TABLE executions ADD COLUMN app_type_id text, ADD COLUMN release text, ADD COLUMN sprint text, ADD COLUMN build text, ADD COLUMN start_date date, ADD COLUMN end_date date, ADD COLUMN direct_test_case_ids jsonb;
      ALTER TABLE execution_results ADD COLUMN app_type_id text, ADD COLUMN defects jsonb, ADD COLUMN external_references jsonb;
      UPDATE executions SET release='Release A', sprint='Sprint A', test_data_set_snapshot='{"rows":[{},{},{},{}]}' WHERE id='run';
      UPDATE executions SET release='Release B', build='Release A' WHERE id='edge';
      UPDATE execution_results SET created_at=created_at-interval '6 years';
      UPDATE execution_results SET created_at='2999-01-01' WHERE id='future-attempt';
      INSERT INTO execution_case_snapshots(execution_id,test_case_id,test_data_set_snapshot) VALUES('run','case-4',NULL);`);
    const Fastify = require('fastify');
    const projectService = require('../../src/services/project.service');
    t.mock.method(projectService, 'getProject', async id => ({id}));
    const app = Fastify({logger:false});
    app.decorate('authenticate', async req => { req.user={id:'fixture'}; });
    app.decorate('validate',()=>{});
    app.decorate('requirePermission',()=>async()=>{});
    try {
      await app.register(require('../../src/routes/executionResults.routes'));
      const response = await app.inject('/execution-results/release-readiness?project_id=p&release=%20release%20a%20&sprint=SPRINT%20A&result_limit=20');
      assert.equal(response.statusCode,200,response.body);
      const body=response.json();
      assert.deepEqual(body.executions.map(run=>run.id),['run'],'Build values must not widen the release filter');
      assert.equal(body.complete,true);
      assert.equal(body.results.length,3,'Old retry attempts and future rows do not consume the evidence budget');
      assert.ok(body.results.some(row=>row.id==='new'&&row.status==='passed'));
      assert.ok(body.results.some(row=>row.id==='z'&&row.status==='paused'));
      assert.ok(body.results.every(row=>row.updated_at));
      assert.deepEqual(Object.fromEntries(body.executions[0].case_snapshots.map(snapshot=>[snapshot.test_case_id,snapshot.expected_iterations])),{'case-1':3,'case-2':1,'case-4':4});
      assert.equal(body.executions[0].test_data_set_snapshot,undefined,'Readiness must not expose raw data values');
      assert.equal(body.results[0].data_set_row_snapshot,undefined);
      const summaries = await require('../../src/services/qualityAnalytics.service').loadRunResultSummaries({projectId:'p',release:' Release A ',sprint:'SPRINT A'});
      assert.deepEqual(summaries.map(row=>({id:row.execution_id,total:Number(row.result_count),passed:Number(row.passed_count),failed:Number(row.failed_count),blocked:Number(row.blocked_count)})),[{id:'run',total:3,passed:1,failed:0,blocked:1}]);
    } finally { await app.close(); }
  } finally { await db.close(); }
});
