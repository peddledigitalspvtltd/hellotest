const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('review queue includes every owned pending source and pages safely after a decision', {
  skip: !process.env.REVIEW_QUEUE_TEST_DATABASE_URL, timeout: 120000
}, async () => {
  const url = new URL(process.env.REVIEW_QUEUE_TEST_DATABASE_URL);
  assert.match(url.pathname.slice(1), /^agent_verify_review_queue_[a-z0-9_]+$/);
  process.env.DATABASE_URL = process.env.POSTGRES_URL = process.env.OBS_DATABASE_URL = process.env.OBS_POSTGRES_URL = url.toString();
  const db = require('../../src/db');
  const obsDb = require('../../src/obsDb');
  const service = require('../../../../testing/backend/services/testCaseCatalog.service');
  try {
      assert.equal((await db.prepare("SELECT to_regclass('public.test_cases') AS name").get()).name, null, 'An empty disposable database is required');
      await db.query(fs.readFileSync(path.resolve(__dirname, '../../instance-setup-data/schema-setup/schema.sql'), 'utf8'));
      await require('../../src/db/bootstrap').ensureRuntimeSchema();
      await db.query(`
        INSERT INTO projects(id,name) VALUES ('project','Review queue'),('foreign','Other project');
        INSERT INTO users(id,email,password_hash) VALUES
          ('actor','actor@example.test','not-a-login'),('author','author@example.test','not-a-login'),('other','other@example.test','not-a-login');
        INSERT INTO app_types(id,project_id,name) VALUES ('app-a','project','A'),('app-b','project','B'),('foreign-app','foreign','Other');
        INSERT INTO test_cases(id,title,app_type_id,reviewer_id,review_status,created_by)
          SELECT 'manual-'||lpad(n::text,2,'0'),'Review fixture','app-a','actor','pending','author' FROM generate_series(1,30) n;
        INSERT INTO test_cases(id,title,app_type_id,reviewer_id,review_status,ai_generation_source,ai_generation_review_status,created_by) VALUES
          ('ai-scheduler','Review fixture','app-a','actor','pending','scheduler','pending','actor'),
          ('ai-legacy','Review fixture','app-a',NULL,'not_requested','scheduler','pending','actor'),
          ('ai-interactive','Review fixture','app-a','actor','pending','interactive','pending','actor'),
          ('ai-repository','Review fixture','app-a','actor','pending','repository','pending','author'),
          ('resubmitted','Review fixture','app-a','actor','pending','interactive','accepted','actor'),
          ('unassigned-manual','Review fixture','app-a',NULL,'pending',NULL,NULL,'actor'),
          ('assigned-other','Review fixture','app-a','other','pending','scheduler','pending','actor'),
          ('approved-legacy','Review fixture','app-a',NULL,'accepted','scheduler','pending','actor'),
          ('rejected-legacy','Review fixture','app-a','actor','changes_requested','scheduler','pending','actor'),
          ('other-reviewer','Review fixture','app-a','other','pending',NULL,NULL,'actor'),
          ('other-app','Review fixture','app-b','actor','pending',NULL,NULL,'actor'),
          ('foreign-project','Review fixture','foreign-app','actor','pending',NULL,NULL,'actor');`);
      await db.prepare("UPDATE test_cases SET automated='yes' WHERE id='assigned-other'").run();
      const scope = {project_id:'project', app_type_id:'app-a', review_user_id:'actor', projection:'summary'};
      assert.deepEqual(await service.getReviewSummary(scope), {pending:35, overall_pending:38});
      assert.deepEqual(await service.getReviewSummary({project_id:'project',review_user_id:'actor'}), {pending:36, overall_pending:39});
      assert.deepEqual(await service.getReviewSummary({...scope,review_user_id:'other'}), {pending:2, overall_pending:38});
      const first = await service.listPage({...scope,review_queue:'mine',include_total:false,page_size:25});
      assert.equal(first.items.length,25);assert.equal(first.is_last,false);
      assert.ok(first.items.every(item=>item.revision===1));
      const reviewedId=first.items[0].id;
      await db.prepare("UPDATE test_cases SET review_status='accepted',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(reviewedId);
      assert.deepEqual(await service.getReviewSummary(scope), {pending:34, overall_pending:37});
      const second = await service.listPage({...scope,review_queue:'mine',include_total:false,page_size:25,cursor:first.next_cursor});
      assert.equal(second.items.length,10);assert.equal(second.is_last,true);
      const actual = [...first.items,...second.items].map(item=>item.id).sort();
      const expected = [...Array.from({length:30},(_,n)=>'manual-'+String(n+1).padStart(2,'0')),'ai-scheduler','ai-legacy','ai-interactive','ai-repository','resubmitted'].sort();
      assert.deepEqual(actual,expected,'Manual and every AI source are included once; other owners and resolved/foreign records are excluded');
      await assert.rejects(service.listPage({...scope,review_queue:'mine',review_user_id:'other',cursor:first.next_cursor}), {statusCode:400});
      // Exercise real, competing transactions and history writes after the
      // pagination fixture, so row-lock behavior is verified by PostgreSQL.
      await db.query(`
        INSERT INTO test_cases(id,title,app_type_id,reviewer_id,review_status,created_by,ai_generation_source,ai_generation_review_status)
          VALUES ('race-case','Review fixture','app-a','actor','pending','actor','interactive','pending'),
            ('legacy-decision','Review fixture','app-a',NULL,'not_requested','actor','scheduler','pending');
      `);
      const mutations = require('../../../../testing/backend/services/testCase.service');
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
  finally {await Promise.all([db.close(),obsDb.close()]);}
});
