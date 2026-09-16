const assert = require('node:assert/strict');
const test = require('node:test');

test('review queue includes every owned pending source and pages safely after a decision', {
  skip: !process.env.REVIEW_QUEUE_TEST_DATABASE_URL, timeout: 30000
}, async () => {
  const url = new URL(process.env.REVIEW_QUEUE_TEST_DATABASE_URL);
  assert.match(url.pathname.slice(1), /^agent_verify_review_queue_[a-z0-9_]+$/);
  process.env.DATABASE_URL = url.toString();
  const db = require('../../src/db');
  const service = require('../../src/services/testCaseCatalog.service');
  try {
      assert.equal((await db.prepare("SELECT to_regclass('public.test_cases') AS name").get()).name, null, 'An empty disposable database is required');
      await db.query(`CREATE TABLE app_types(id text PRIMARY KEY, project_id text);
        CREATE TABLE test_cases(id text PRIMARY KEY, app_type_id text, reviewer_id text, review_status text,
          ai_generation_source text, ai_generation_review_status text, created_by text,
          updated_at timestamptz DEFAULT '2026-09-16T00:00:00Z', created_at timestamptz DEFAULT '2026-09-16T00:00:00Z',
          labels jsonb DEFAULT '[]', external_references jsonb DEFAULT '[]', requirement_id text, suite_id text,
          status text DEFAULT 'draft', automated text DEFAULT 'no', title text DEFAULT 'Review fixture');
        CREATE TABLE test_steps(test_case_id text);
        CREATE TABLE suite_test_cases(test_case_id text,suite_id text,sort_order integer);
        CREATE TABLE requirement_test_cases(test_case_id text,requirement_id text);
        CREATE TABLE test_case_module_cases(test_case_id text,module_id text);
        CREATE TABLE test_case_defects(test_case_id text,issue_id text);
        INSERT INTO app_types VALUES ('app-a','project'),('app-b','project'),('foreign-app','foreign');
        INSERT INTO test_cases(id,app_type_id,reviewer_id,review_status,created_by)
          SELECT 'manual-'||lpad(n::text,2,'0'),'app-a','actor','pending','author' FROM generate_series(1,30) n;
        INSERT INTO test_cases(id,app_type_id,reviewer_id,review_status,ai_generation_source,ai_generation_review_status,created_by) VALUES
          ('ai-scheduler','app-a','actor','pending','scheduler','pending','actor'),
          ('ai-legacy','app-a',NULL,'not_requested','scheduler','pending','actor'),
          ('ai-interactive','app-a','actor','pending','interactive','pending','actor'),
          ('ai-repository','app-a','actor','pending','repository','pending','author'),
          ('resubmitted','app-a','actor','pending','interactive','accepted','actor'),
          ('unassigned-manual','app-a',NULL,'pending',NULL,NULL,'actor'),
          ('assigned-other','app-a','other','pending','scheduler','pending','actor'),
          ('approved-legacy','app-a',NULL,'accepted','scheduler','pending','actor'),
          ('rejected-legacy','app-a','actor','changes_requested','scheduler','pending','actor'),
          ('other-reviewer','app-a','other','pending',NULL,NULL,'actor'),
          ('other-app','app-b','actor','pending',NULL,NULL,'actor'),
          ('foreign-project','foreign-app','actor','pending',NULL,NULL,'actor');`);
      const scope = {project_id:'project', app_type_id:'app-a', review_user_id:'actor'};
      assert.deepEqual(await service.getReviewSummary(scope), {pending:35});
      assert.deepEqual(await service.getReviewSummary({project_id:'project',review_user_id:'actor'}), {pending:36});
      assert.deepEqual(await service.getReviewSummary({...scope,review_user_id:'other'}), {pending:2});
      const first = await service.listPage({...scope,review_queue:'mine',include_total:false,page_size:25});
      assert.equal(first.items.length,25);assert.equal(first.is_last,false);
      const reviewedId=first.items[0].id;
      await db.prepare("UPDATE test_cases SET review_status='accepted',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(reviewedId);
      assert.deepEqual(await service.getReviewSummary(scope), {pending:34});
      const second = await service.listPage({...scope,review_queue:'mine',include_total:false,page_size:25,cursor:first.next_cursor});
      assert.equal(second.items.length,10);assert.equal(second.is_last,true);
      const actual = [...first.items,...second.items].map(item=>item.id).sort();
      const expected = [...Array.from({length:30},(_,n)=>'manual-'+String(n+1).padStart(2,'0')),'ai-scheduler','ai-legacy','ai-interactive','ai-repository','resubmitted'].sort();
      assert.deepEqual(actual,expected,'Manual and every AI source are included once; other owners and resolved/foreign records are excluded');
      await assert.rejects(service.listPage({...scope,review_queue:'mine',review_user_id:'other',cursor:first.next_cursor}), {statusCode:400});
      // Exercise real, competing transactions and history writes after the
      // pagination fixture, so row-lock behavior is verified by PostgreSQL.
      await db.query(`
        ALTER TABLE test_cases ADD COLUMN author_id text, ADD COLUMN updated_by text,
          ADD COLUMN review_history jsonb DEFAULT '[]';
        ALTER TABLE test_case_module_cases ADD COLUMN sort_order integer;
        ALTER TABLE test_steps ADD COLUMN id text, ADD COLUMN step_order integer,
          ADD COLUMN action text, ADD COLUMN expected_result text, ADD COLUMN step_type text,
          ADD COLUMN automation_code text, ADD COLUMN api_request jsonb, ADD COLUMN group_id text,
          ADD COLUMN group_name text, ADD COLUMN group_kind text, ADD COLUMN reusable_group_id text;
        CREATE TABLE requirements(id text,title text,project_id text);
        CREATE TABLE users(id text,name text,email text);
        CREATE TABLE test_suites(id text,app_type_id text);
        CREATE TABLE automation_case_links(automation_test_case_id text,manual_test_case_id text,is_primary boolean,created_at timestamptz);
        CREATE TABLE test_case_data_sets(test_case_id text,test_data_set_id text,sort_order integer);
        CREATE TABLE test_data_sets(id text,project_id text,app_type_id text,name text,description text,mode text,columns jsonb,rows jsonb);
        CREATE TABLE test_case_versions(id text PRIMARY KEY,test_case_id text,revision integer,snapshot jsonb,change_summary text,created_by text,UNIQUE(test_case_id,revision));
        INSERT INTO test_cases(id,app_type_id,reviewer_id,review_status,created_by,ai_generation_source,ai_generation_review_status)
          VALUES ('race-case','app-a','actor','pending','actor','interactive','pending'),
            ('legacy-decision','app-a',NULL,'not_requested','actor','scheduler','pending');
      `);
      const mutations = require('../../src/services/testCase.service');
      const competing = await Promise.allSettled(['accepted','changes_requested'].map(review_status =>
        mutations.reviewTestCase('race-case', {review_status, reviewed_by:'actor',expected_revision:1})));
      assert.equal(competing.filter(result=>result.status==='fulfilled').length,1);
      assert.equal(competing.find(result=>result.status==='rejected').reason.statusCode,409);
      const decided = await db.prepare('SELECT * FROM test_cases WHERE id=?').get('race-case');
      assert.equal(decided.review_history.length,1);
      assert.equal(decided.review_history[0].user_id,'actor');
      assert.equal(decided.ai_generation_review_status,decided.review_status==='accepted'?'accepted':'rejected');
      assert.equal((await db.prepare('SELECT COUNT(*)::integer AS count FROM test_case_versions WHERE test_case_id=?').get('race-case')).count,1);
      await assert.rejects(mutations.reviewTestCase('legacy-decision', {review_status:'accepted',reviewed_by:'other'}),{statusCode:403});
      await assert.rejects(mutations.reviewTestCase('legacy-decision', {review_status:'accepted',reviewed_by:'actor',expected_updated_at:'2026-09-15T00:00:00Z'}),{statusCode:409});
      await mutations.reviewTestCase('legacy-decision', {review_status:'changes_requested',reviewed_by:'actor'});
      const rejected = await db.prepare('SELECT * FROM test_cases WHERE id=?').get('legacy-decision');
      assert.equal(rejected.review_status,'changes_requested');
      assert.equal(rejected.status,'draft');
      assert.equal(rejected.ai_generation_review_status,'rejected');
  }
  finally {await db.close();}
});
