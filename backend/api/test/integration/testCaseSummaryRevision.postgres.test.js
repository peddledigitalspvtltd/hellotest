const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('Test Case summary pages load against the real schema and expose version-backed review revisions', {
  skip: process.env.TEST_CASE_SUMMARY_POSTGRES !== '1', timeout: 120_000
}, async t => {
  const url = new URL(process.env.DATABASE_URL);
  assert.match(url.pathname, /^\/agent_verify_case_summary_[a-z0-9_]+$/);
  process.env.POSTGRES_URL = process.env.OBS_DATABASE_URL = process.env.OBS_POSTGRES_URL = url.toString();
  const db = require('../../src/db');
  const obsDb = require('../../src/obsDb');
  const catalog = require('../../src/services/testCaseCatalog.service');
  const versions = require('../../src/services/testCaseVersion.service');
  try {
    assert.equal((await db.prepare("SELECT to_regclass('public.projects') AS name").get()).name, null,
      'This regression requires an empty disposable PostgreSQL database');
    await db.query(fs.readFileSync(path.resolve(__dirname, '../../../db/schema.sql'), 'utf8'));
    await require('../../src/db/bootstrap').ensureRuntimeSchema();
    assert.equal((await db.prepare(`SELECT COUNT(*)::int AS count FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'test_cases' AND column_name = 'revision'`).get()).count, 0,
    'Test Case revisions come from version history, not a synthetic test_cases.revision fixture column');
    await db.query(`
      INSERT INTO users(id,email,password_hash) VALUES ('reviewer','reviewer@example.test','not-a-login');
      INSERT INTO projects(id,name) VALUES ('project','Summary regression'),('foreign','Other project');
      INSERT INTO app_types(id,project_id,name,type) VALUES ('app','project','Web','web'),('other-app','foreign','Other','web');
      INSERT INTO test_case_modules(id,app_type_id,name) VALUES ('module','app','Assigned module');
      INSERT INTO test_cases(id,app_type_id,title,reviewer_id,review_status,created_at,updated_at)
        SELECT 'case-' || LPAD(n::text,2,'0'), 'app', 'Case ' || n, 'reviewer', 'pending',
          '2026-09-20T00:00:00.123456Z'::timestamptz, '2026-09-20T00:00:00.123456Z'::timestamptz
        FROM generate_series(1,26) n;
      INSERT INTO test_cases(id,app_type_id,title,automated) VALUES
        ('automated','app','Excluded automated case','yes'),
        ('assigned','app','Excluded assigned case','no'),
        ('foreign-case','other-app','Excluded foreign case','no');
      INSERT INTO test_case_module_cases(module_id,test_case_id) VALUES ('module','assigned');
      INSERT INTO test_steps(id,test_case_id,step_order,action) VALUES ('step','case-26',1,'Verify response');
      INSERT INTO test_case_versions(id,test_case_id,revision,snapshot) VALUES
        ('version-one','case-26',1,'{}'),('version-three','case-26',3,'{}');
      INSERT INTO executions(id,project_id,app_type_id,name,status) VALUES ('run','project','app','Recorded run','completed');
      INSERT INTO execution_results(id,execution_id,test_case_id,app_type_id,status,duration_ms,created_at)
        SELECT 'result-' || LPAD(n::text,2,'0'), 'run', 'case-26', 'app',
          CASE WHEN n = 12 THEN 'passed' ELSE 'failed' END, 100,
          '2026-09-20T01:00:00Z'::timestamptz + n * interval '1 minute'
        FROM generate_series(1,12) n;
    `);
    const query = {
      exclude_automated: 'true', include_total: 'false', include_execution: 'true',
      project_id: 'project', app_type_id: 'app', unassigned_module: 'true',
      page_size: '25', projection: 'summary', include_page: 'true'
    };
    await t.test('the reported summary query paginates unassigned cases with execution summaries and accurate revisions', async () => {
      const first = await catalog.listPage(query);
      assert.equal(first.items.length, 25);
      assert.equal(first.is_last, false);
      assert.equal('total' in first, false);
      const versioned = first.items.find(row => row.id === 'case-26');
      assert.equal(versioned.revision, 4);
      assert.equal(versioned.revision, await versions.currentRevision(versioned.id));
      assert.equal(versioned.step_count, 1);
      assert.equal(versioned.run_count, 12);
      assert.equal(versioned.recent_results.length, 10);
      assert.equal(versioned.recent_results[0].status, 'passed');
      assert.ok(first.items.filter(row => row.id !== versioned.id).every(row => row.revision === 1));
      assert.ok(first.items.every(row => !('gherkin_document' in row) && !('review_history' in row)));
      const second = await catalog.listPage({ ...query, cursor: first.next_cursor });
      assert.equal(second.items.length, 1);
      assert.equal(second.is_last, true);
      assert.equal(second.next_cursor, null);
      assert.equal(new Set([...first.items, ...second.items].map(row => row.id)).size, 26);
      assert.ok([...first.items, ...second.items].every(row => /^case-\d{2}$/.test(row.id)));
    });
    await t.test('summary and full review pages share the current revision used by review mutations', async () => {
      for (const projection of ['summary', undefined]) {
        const result = await catalog.listPage({ ...query, projection, ids: 'case-26', review_queue: 'mine', review_user_id: 'reviewer' });
        assert.equal(result.items.length, 1);
        assert.equal(result.items[0].revision, 4);
      }
      const picker = await catalog.listPage({ ...query, projection: 'picker', ids: 'case-26' });
      assert.equal(picker.items.length, 1);
      assert.equal('revision' in picker.items[0], false, 'Lightweight pickers do not hydrate review history');
    });
  } finally {
    await Promise.all([db.close(), obsDb.close()]);
  }
});
