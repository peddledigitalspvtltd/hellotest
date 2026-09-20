const assert = require('node:assert/strict');
const test = require('node:test');

test('backlog flow survives deletion, deduplicates memberships, and preserves tracking start', {
  skip: !process.env.REQUIREMENT_CATALOG_TEST_DATABASE_URL, timeout: 30000
}, async () => {
  const url = process.env.REQUIREMENT_CATALOG_TEST_DATABASE_URL;
  assert.match(new URL(url).pathname.slice(1), /^agent_verify_[a-z0-9_]+$/);
  process.env.DATABASE_URL = url;
  const db = require('../../src/db');
  const rollback = new Error('ROLLBACK_BACKLOG_FIXTURE');
  try {
    await db.transaction(async () => {
      await db.query("INSERT INTO projects(id,name) VALUES('history-project','History test'),('history-other','Other')");
      const events = async (id) => (await db.query('SELECT event_kind FROM requirement_backlog_events WHERE requirement_id = ? ORDER BY id', [id])).rows.map(row => row.event_kind);
      await db.query("INSERT INTO requirements(id,project_id,title,status) VALUES('history-story','history-project','Original','open')");
      assert.deepEqual(await events('history-story'), ['added']);
      await db.query("UPDATE requirements SET description='A normal edit',title='Renamed' WHERE id='history-story'");
      assert.deepEqual(await events('history-story'), ['added']);
      await db.query("UPDATE requirements SET status=' QA--Done ' WHERE id='history-story'");
      assert.deepEqual(await events('history-story'), ['added', 'completed']);
      await db.query("UPDATE requirements SET status='open' WHERE id='history-story'");
      await db.query("UPDATE requirements SET sprint='Sprint 1' WHERE id='history-story'");
      await db.query("UPDATE requirements SET sprint='' WHERE id='history-story'");
      assert.deepEqual(await events('history-story'), ['added', 'completed', 'added', 'removed', 'added']);
      await db.query("INSERT INTO requirement_releases(id,project_id,name,fix_version) VALUES('history-release','history-project','R1','v1'),('history-release2','history-project','R2','v2'),('history-foreign','history-other','Foreign','foreign')");
      await db.query("INSERT INTO requirement_release_items(release_id,requirement_id) VALUES('history-release','history-story'),('history-release2','history-story')");
      assert.equal((await events('history-story')).at(-1), 'removed');
      const afterAssignment = await events('history-story');
      await db.query("UPDATE requirements SET release='R1',fix_version='v1' WHERE id='history-story'");
      await db.query("DELETE FROM requirement_release_items WHERE release_id='history-release'");
      assert.deepEqual(await events('history-story'), afterAssignment, 'Duplicate stamp/link and remaining membership do not change flow');
      await db.query("UPDATE requirements SET release='',fix_version='' WHERE id='history-story'");
      assert.deepEqual(await events('history-story'), afterAssignment, 'Remaining direct membership excludes backlog');
      await db.query("DELETE FROM requirement_releases WHERE id='history-release2'");
      assert.equal((await events('history-story')).at(-1), 'added', 'Release deletion returns an active unassigned Story');
      await db.query("INSERT INTO requirement_release_items(release_id,requirement_id) VALUES('history-foreign','history-story')");
      assert.equal((await events('history-story')).at(-1), 'added', 'Corrupt foreign membership cannot change project scope');
      await db.query("DELETE FROM requirements WHERE id='history-story'");
      assert.equal((await events('history-story')).at(-1), 'removed');
      assert.equal((await db.query("SELECT snapshot->>'title' AS title FROM requirement_backlog_events WHERE requirement_id='history-story' ORDER BY id DESC LIMIT 1")).rows[0].title, 'Renamed');
      assert.equal((await db.query("SELECT count(*)::int AS count FROM requirement_backlog_current_state WHERE requirement_id='history-story'")).rows[0].count, 0);
      await db.query("INSERT INTO requirements(id,project_id,title,status) VALUES('history-done','history-project','Already completed','done')");
      await db.query("DELETE FROM requirements WHERE id='history-done'");
      assert.deepEqual(await events('history-done'), [], 'Already completed import/deletion never invents backlog flow');
      const catalog = require('../../src/services/requirementCatalog.service');
      const growth = (await catalog.getMetrics({ project_id:'history-project' })).backlog.growth;
      assert.equal(growth.added, 4);
      assert.equal(growth.completed, 1);
      assert.equal(growth.removed, 3);
      assert.equal(growth.net, 0);
      assert.equal(growth.partial, true);
      assert.equal(growth.percent, null, 'Incomplete prior month evidence cannot imply a historic growth percentage');
      await db.query("INSERT INTO users(id,email,password_hash) VALUES('history-reviewer','history@example.test','test-only')");
      await db.query("INSERT INTO requirements(id,project_id,title,status) VALUES('history-reviewed','history-project','Review candidate','open')");
      const reviews = require('../../src/services/storyReadiness.service');
      const reviewed = await reviews.update('history-reviewed', { expected_revision:1, updated_by:'history-reviewer', checks:{ story_points:{status:'met',evidence:'Team estimated 3 points at refinement.'} } });
      assert.equal(reviewed.revision, 2);
      const saved = (await db.query("SELECT additional_fields FROM requirements WHERE id='history-reviewed'")).rows[0].additional_fields;
      assert.equal(saved._story_readiness.checks.story_points.verified_by, 'history-reviewer');
      assert.ok(saved._story_readiness.checks.story_points.content_hash);
      await assert.rejects(reviews.update('history-reviewed', { expected_revision:1, updated_by:'history-reviewer', checks:{ code_review:{status:'met',evidence:'Stale approval'} } }), { statusCode:409 });
      await assert.rejects(reviews.update('history-reviewed', { expected_revision:2, updated_by:'history-reviewer', checks:{ wireframe:{status:'met',evidence:'Foreign attachment',attachment_id:'missing'} } }), { statusCode:400 });
      await assert.rejects(reviews.update('history-reviewed', { expected_revision:2, updated_by:'history-reviewer', checks:{ unknown:{status:'met',evidence:'Not a check'} } }), { statusCode:400 });
      assert.deepEqual(await events('history-reviewed'), ['added'], 'Review-only updates do not inflate backlog additions');
      const facts = (await catalog.withCatalogMetrics([{id:'history-reviewed'}]))[0].catalog_metrics;
      assert.equal(facts.readiness.score, 20);
      assert.equal(facts.readiness.mode, 'backlog');
      await db.query("UPDATE requirements SET title='Changed after approval' WHERE id='history-reviewed'");
      assert.equal((await catalog.withCatalogMetrics([{id:'history-reviewed'}]))[0].catalog_metrics.readiness.score, null);
      const start = (await db.query('SELECT tracking_started_at FROM requirement_backlog_history_state')).rows[0].tracking_started_at;
      for (const sql of require('../../src/db/requirementBacklogHistorySchema')) await db.query(sql);
      assert.equal((await db.query('SELECT tracking_started_at FROM requirement_backlog_history_state')).rows[0].tracking_started_at.getTime(), start.getTime(), 'Restart preserves the historic observation boundary');
      const { deleteProjectData } = require('../../src/services/projectDeletion.repository');
      await deleteProjectData({ client: { query: db.query }, projectId: 'history-project', batchSize: 2 });
      assert.equal((await db.query("SELECT count(*)::int AS count FROM requirement_backlog_events WHERE project_id='history-project'")).rows[0].count, 0, 'Project deletion batches ledger cleanup');
      assert.equal((await db.query("SELECT count(*)::int AS count FROM projects WHERE id='history-other'")).rows[0].count, 1);
      throw rollback;
    })();
  } catch (error) { if (error !== rollback) throw error; }
  finally { await db.close(); }
});
