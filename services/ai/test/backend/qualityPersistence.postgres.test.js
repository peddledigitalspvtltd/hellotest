const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

test('quality decisions and revision graphs preserve PostgreSQL isolation, JSONB and retry semantics', {
  skip: process.env.QUALITY_PERSISTENCE_POSTGRES !== '1', timeout: 120_000
}, async t => {
  const target = new URL(process.env.DATABASE_URL);
  assert.match(target.pathname, /^\/agent_verify_quality_\d+$/);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(target.hostname));
  assert.equal(process.env.DATABASE_URL, process.env.OBS_DATABASE_URL);
  const db = require('@hellotest/platform/backend/src/db');
  const obs = require('@hellotest/platform/backend/src/obsDb');
  try {
    assert.equal((await db.prepare("SELECT to_regclass('public.projects') AS projects").get()).projects, null);
    await db.query(fs.readFileSync(path.resolve(__dirname, '../../../platform/backend/instance-setup-data/schema-setup/schema.sql'), 'utf8'));
    await require('../../../platform/backend/src/db/bootstrap').ensureRuntimeSchema();
    const user = { id: randomUUID() }, project = randomUUID(), foreign = randomUUID(), app = randomUUID(), storyId = randomUUID(), caseId = randomUUID(), stepId = randomUUID();
    await db.prepare("INSERT INTO users(id,email,password_hash,name,is_workspace_admin,status) VALUES(?,?,?, ?,TRUE,'active')")
      .run(user.id, 'quality-persistence@example.test', 'not-a-login', 'Quality fixture');
    for (const id of [project, foreign]) await db.prepare('INSERT INTO projects(id,name,created_by) VALUES(?,?,?)').run(id, `Quality fixture ${id}`, user.id);
    await db.prepare("INSERT INTO app_types(id,project_id,name,type) VALUES(?,?,?,'web')").run(app, project, 'Quality fixture application');
    await db.prepare('INSERT INTO requirements(id,project_id,title,additional_fields) VALUES(?,?,?,?)')
      .run(storyId, project, 'Review payment', { acceptance_criteria: ['Record the payment reference'] });
    await db.prepare('INSERT INTO test_cases(id,app_type_id,requirement_id,title) VALUES(?,?,?,?)').run(caseId, app, storyId, 'Payment reference');
    await db.prepare('INSERT INTO test_steps(id,test_case_id,step_order,action,expected_result) VALUES(?,?,1,?,?)')
      .run(stepId, caseId, 'Submit payment', 'Payment reference is visible');

    await t.test('concurrent policy approvals serialize and JSONB policy versions survive reload', async () => {
      const policies = require('../../backend/services/qualityReleasePolicy.service');
      const policy = { name: 'Release approval', minimum_completed_attempts: 2, max_evidence_age_hours: 24, waivable_gates: ['execution-outcomes'] };
      const approve = () => policies.approve(project, user, { policy, expected_version: 0, rationale: 'Approve these reviewed release evidence requirements.' });
      const results = await Promise.allSettled([approve(), approve(), approve()]);
      assert.equal(results.filter(row => row.status === 'fulfilled').length, 1);
      assert.ok(results.filter(row => row.status === 'rejected').every(row => row.reason.statusCode === 409));
      const current = await policies.current(project);
      assert.equal(current.version, 1);
      assert.deepEqual(current.policy.waivable_gates, policy.waivable_gates);
      assert.equal(current.policy.minimum_completed_attempts, 2);
      assert.equal(await policies.current(foreign), null);
      await policies.approve(project, user, { policy: { ...policy, name: 'Revised approval' }, expected_version: 1, rationale: 'Approve a new explicit version after reviewing its evidence.' });
      assert.equal((await policies.current(project)).version, 2);
      assert.equal((await db.prepare('SELECT policy FROM quality_release_policies WHERE project_id=? AND version=1').get(project)).policy.name, policy.name);
    });

    const story = await db.prepare('SELECT * FROM requirements WHERE id=?').get(storyId);
    const specification = await db.prepare('SELECT * FROM test_cases WHERE id=?').get(caseId);
    specification.steps = await db.prepare('SELECT * FROM test_steps WHERE test_case_id=? ORDER BY step_order').all(caseId);
    const rules = require('../../backend/services/qualityCoverageRules');
    await t.test('concurrent review retries share one receipt and reject changed or foreign requests', async () => {
      const reviews = require('../../backend/services/qualityCoverageReview.service');
      const input = { request_id: randomUUID(), story_id: storyId, story_revision: rules.storyRevision(story),
        test_case_id: caseId, test_revision: rules.testRevision(specification), obligation_id: rules.obligationId(story, 0),
        step_id: stepId, decision: 'approved', rationale: 'Visible payment reference verifies the recorded payment criterion.' };
      const save = data => reviews.save({ projectId: project, user, input: data });
      const results = await Promise.all([save(input), save(input), save(input)]);
      assert.ok(results.every(row => row.id === input.request_id));
      assert.equal((await db.prepare('SELECT COUNT(*)::int AS count FROM quality_assertion_reviews WHERE id=?').get(input.request_id)).count, 1);
      await assert.rejects(save({ ...input, decision: 'rejected' }), { statusCode: 409 });
      await assert.rejects(reviews.save({ projectId: foreign, user, input: { ...input, request_id: randomUUID() } }), { statusCode: 404 });
      await db.prepare("UPDATE test_steps SET expected_result='A different observable result' WHERE id=?").run(stepId);
      await assert.rejects(save({ ...input, request_id: randomUUID() }), { statusCode: 409 });
    });

    await t.test('graphs retain immutable revisions and only complete newer captures establish absence', async () => {
      const graphs = require('../../backend/services/qualityGraphStore.service');
      const changes = require('../../backend/services/qualityGraphChanges');
      await changes.processPending();
      const now = Date.now();
      const snapshot = { project_id: project, scope: { story_id: storyId }, as_of: new Date(now).toISOString(), complete: true,
        limitations: [], stories: [story], tests: [], runs: [], attempts: [], defects: [], assertion_reviews: [] };
      const initial = await graphs.persist(snapshot, user);
      assert.equal(initial.freshness, 'current');
      const historical = await db.prepare('SELECT entity_id,revision FROM quality_graph_snapshot_nodes WHERE snapshot_id=?').all(initial.snapshot_id);
      assert.ok(historical.some(row => row.entity_id === `story:${storyId}`));
      const partial = await graphs.persist({ ...snapshot, as_of: new Date(now + 1000).toISOString(), complete: false, stories: [] }, user);
      assert.equal((await db.prepare('SELECT COUNT(*)::int AS count FROM quality_graph_tombstones WHERE snapshot_id=?').get(partial.snapshot_id)).count, 0);
      // A partial inventory must not erase the baseline for a later complete inventory.
      const removed = await graphs.persist({ ...snapshot, as_of: new Date(now + 2000).toISOString(), stories: [] }, user);
      assert.equal((await db.prepare('SELECT COUNT(*)::int AS count FROM quality_graph_tombstones WHERE snapshot_id=? AND entity_id=?').get(removed.snapshot_id, `story:${storyId}`)).count, 1);
      assert.deepEqual(await db.prepare('SELECT entity_id,revision FROM quality_graph_snapshot_nodes WHERE snapshot_id=?').all(initial.snapshot_id), historical);
      const old = await graphs.persist({ ...snapshot, as_of: new Date(now - 1000).toISOString(), stories: [] }, user);
      assert.equal((await db.prepare('SELECT COUNT(*)::int AS count FROM quality_graph_tombstones WHERE snapshot_id=?').get(old.snapshot_id)).count, 0);
      await db.prepare("UPDATE requirements SET title='Changed source' WHERE id=?").run(storyId);
      assert.equal((await changes.freshness(project, initial.snapshot_id)).freshness, 'changes_pending');
      await changes.processPending();
      assert.equal((await changes.freshness(project, initial.snapshot_id)).freshness, 'stale');
    });
  } finally { await Promise.all([db.close(), obs.close()]); }
});
