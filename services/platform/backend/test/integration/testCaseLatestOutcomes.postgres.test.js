const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('failed and blocked metrics count the latest finalized outcome once per scoped case', {
  skip: process.env.TEST_CASE_LATEST_OUTCOMES_POSTGRES !== '1', timeout: 120000
}, async () => {
  const url = new URL(process.env.DATABASE_URL);
  assert.match(url.pathname, /^\/agent_verify_latest_outcomes_[a-z0-9_]+$/);
  process.env.POSTGRES_URL = process.env.OBS_DATABASE_URL = process.env.OBS_POSTGRES_URL = url.toString();
  const db = require('../../src/db');
  const obsDb = require('../../src/obsDb');
  const catalog = require('../../../../testing/backend/services/testCaseCatalog.service');
  try {
    assert.equal((await db.prepare("SELECT to_regclass('public.projects') AS name").get()).name, null);
    await db.query(fs.readFileSync(path.resolve(__dirname, '../../instance-setup-data/schema-setup/schema.sql'), 'utf8'));
    await require('../../src/db/bootstrap').ensureRuntimeSchema();
    await db.query(`
      INSERT INTO projects(id,name) VALUES ('project','Outcome metrics'),('other','Other project');
      INSERT INTO app_types(id,project_id,name,type) VALUES ('app','project','Web','web'),('other-app','other','Other','web');
      INSERT INTO test_case_modules(id,app_type_id,name) VALUES ('module-a','app','First'),('module-b','app','Second');
      INSERT INTO test_cases(id,app_type_id,title,automated) VALUES
        ('failed','app','Failure with pending retries','no'),
        ('blocked','app','Blocked with skipped retry','no'),
        ('recovered','app','Recovered failure','no'),
        ('unexecuted','app','Only pending runs','no'),
        ('never-run','app','No runs','no'),
        ('automated','app','Automation outside manual catalog','yes'),
        ('foreign','other-app','Outside project','no');
      INSERT INTO test_case_module_cases(module_id,test_case_id) VALUES
        ('module-a','failed'),('module-a','blocked');
      INSERT INTO requirements(id,project_id,title) VALUES ('story','project','Related Story');
      INSERT INTO test_case_module_requirements(module_id,requirement_id) VALUES ('module-b','story');
      INSERT INTO requirement_test_cases(requirement_id,test_case_id) VALUES ('story','failed');
      INSERT INTO executions(id,project_id,app_type_id,name,status) VALUES
        ('run','project','app','Historical outcomes','completed'),
        ('other-run','other','other-app','Foreign run','completed');
      INSERT INTO execution_results(id,execution_id,test_case_id,app_type_id,status,created_at) VALUES
        ('failure-1','run','failed','app','failed','2026-09-01'),
        ('failure-2','run','failed','app','failed','2026-09-02'),
        ('block-1','run','blocked','app','blocked','2026-09-01'),
        ('block-2','run','blocked','app','skipped','2026-09-02'),
        ('recovery-1','run','recovered','app','failed','2026-09-01'),
        ('recovery-2','run','recovered','app','passed','2026-09-02'),
        ('pending-1','run','unexecuted','app','running','2026-09-03'),
        ('auto-1','run','automated','app','failed','2026-09-03'),
        ('foreign-1','other-run','foreign','other-app','blocked','2026-09-03');
      INSERT INTO execution_results(id,execution_id,test_case_id,app_type_id,status,created_at)
        SELECT 'retry-' || n, 'run', 'failed', 'app',
          CASE WHEN n % 2 = 0 THEN 'queued' ELSE 'running' END,
          '2026-09-03'::timestamptz + n * interval '1 minute'
        FROM generate_series(1,12) n;
    `);
    const scope = { project_id: 'project', app_type_id: 'app', exclude_automated: true, include_execution: true };
    const metrics = await catalog.getMetrics(scope);
    assert.equal(metrics.catalog.total, 5);
    assert.equal(metrics.catalog.failed, 1, 'Repeated failures and pending retries count as one failing case');
    assert.equal(metrics.catalog.blocked, 1, 'A skipped retry does not resolve a blocked outcome');
    assert.equal(metrics.catalog.critical, 2, 'Cases in multiple modules are not duplicated');
    assert.equal(metrics.modules['module-a'].executionPercent, 100);
    assert.equal(metrics.modules['module-b'].executionPercent, 100, 'Health finds the result beyond ten pending retries');
    assert.equal(metrics.modules['module-b'].latestPassRatePercent, 0);
    assert.equal((await catalog.getMetrics({ ...scope, search: 'Recovered' })).catalog.critical, 0);
    const unavailable = await catalog.getMetrics({ ...scope, include_execution: false });
    assert.equal(unavailable.catalog.failed, 0);
    assert.equal(unavailable.catalog.blocked, 0);
    await db.prepare(`INSERT INTO execution_results(id,execution_id,test_case_id,app_type_id,status,created_at)
      VALUES ('resolved','run','failed','app','passed','2026-09-04')`).run();
    assert.equal((await catalog.getMetrics(scope)).catalog.failed, 0, 'A finalized pass clears the previous failure');
  } finally {
    await Promise.all([db.close(), obsDb.close()]);
  }
});
