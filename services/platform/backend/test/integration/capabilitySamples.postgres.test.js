const assert = require('node:assert/strict');
const test = require('node:test');

test('fresh schema, role grants and the full capability sample project work through native readers', {
  skip: process.env.CAPABILITY_SAMPLES_POSTGRES !== '1', timeout: 180000
}, async t => {
  assert.match(new URL(process.env.DATABASE_URL).pathname, /^\/agent_verify_capability_[a-z0-9_]+$/);
  const db = require('../../src/db'), obs = require('../../src/obsDb');
  const setup = require('../../services/adminPortal.service');
  const repository = require('../../services/sampleData/repository');
  const { DEFAULT_ROLE_PERMISSIONS } = require('../../src/security/permissions.catalog');
  const actorId = 'sample-review-admin';
  try {
    await require('../../src/migrate').migrate();
    for (const [name, expected] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
      const grants = await db.prepare('SELECT p.code FROM roles r JOIN role_permissions rp ON rp.role_id=r.id JOIN permissions p ON p.id=rp.permission_id WHERE r.name=?').all(name);
      assert.deepEqual(grants.map(row => row.code).sort(), [...expected].sort(), `${name} has grants on first schema setup`);
    }
    for (const [id, admin, status] of [[actorId, true, 'active'], ['sample-second-admin', true, 'active'], ['sample-suspended-admin', true, 'suspended']]) {
      await db.prepare('INSERT INTO users(id,email,password_hash,name,is_workspace_admin,status) VALUES (?,?,?,?,?,?) ON CONFLICT DO NOTHING').run(id, id + '@example.test', 'no-login', id, admin, status);
    }
    const result = await setup.seedSampleData({ actorId });
    assert.equal(result.file_results.length, repository.loadManifest().manifest.files.length);
    assert.ok(result.file_results.every(file => file.status === 'completed'));
    const memberships = await db.prepare("SELECT user_id FROM project_members WHERE project_id='sample-project'").all();
    assert.ok(memberships.some(row => row.user_id === actorId));
    assert.ok(memberships.some(row => row.user_id === 'sample-second-admin'));
    assert.ok(!memberships.some(row => row.user_id === 'sample-suspended-admin'));

    await t.test('page metrics contain real denominators, varied evidence and overdue delivery', async () => {
      const stories = await require('../../../../manual/backend/services/requirementCatalog.service').getMetrics({ project_id: 'sample-project', include_execution: true, include_sprints: true });
      for (const key of ['total', 'mapped', 'notGroomed', 'groomed', 'devCompleted', 'completed', 'slipped', 'onCourse']) assert.ok(stories.all[key] > 0, key);
      assert.ok(stories.all.mapped < stories.all.total, 'Uncovered Stories remain visible');
      const cases = await require('../../../../testing/backend/services/testCaseCatalog.service').getMetrics({ project_id: 'sample-project', app_type_id: 'sample-app-web', include_execution: true });
      assert.ok(cases.catalog.failed > 0 && cases.catalog.blocked > 0);
      assert.equal(cases.catalog.critical, cases.catalog.failed + cases.catalog.blocked);
      assert.ok(cases.catalog.averageExecutionMs > 0);
      const shared = await require('../../../../testing/backend/services/sharedStepMetrics.service').getSharedStepMetrics({ project_id: 'sample-project', app_type_id: 'sample-app-web', now: '2026-09-25T12:00:00Z' });
      assert.ok(shared.reused_case_count >= 59);
      assert.ok(shared.failure_cluster_count > 0 && shared.open_defect_count > 0);
      assert.ok(shared.reusability_index > 0 && shared.reusability_index < 100);
      const overview = await require('../../../../dashboard/backend/services/qualityOverview.service').getOverview({ projectId: 'sample-project', days: 14, now: Date.parse('2026-09-25T12:00:00Z'), visibility: { stories: true, cases: true, suites: true, bugs: true, runs: true, automation: true } });
      for (const key of ['passed', 'failed', 'blocked', 'pending']) assert.ok(overview.execution[key] > 0, key);
      assert.ok(overview.trend.filter(day => day.runs > 0).length >= 3);
      const releases = await require('../../../../manual/backend/services/requirementRelease.service').listReleases({ project_id: 'sample-project' });
      assert.ok(releases.some(row => row.id === 'sample-v7-ht-release-overdue' && row.state === 'overdue'));
      console.log(JSON.stringify({ story_metrics: stories.all, case_metrics: cases.catalog, shared_clusters: shared.failure_cluster_count, shared_defects: shared.open_defect_count, dashboard_execution: overview.execution }));
    });

    await t.test('all prompt scopes and synthetic histories are readable', async () => {
      const templates = require('../../../../integration/backend/services/aiPromptTemplate.service');
      for (const scope of ['requirement_creation', 'requirement_completion', 'test_case_generation', 'test_case_steps', 'bug_creation']) {
        const items = await templates.listPromptTemplates({ project_id: 'sample-project', app_type_id: 'sample-app-web', scope });
        assert.ok(items.some(item => item.id === 'sample-v7-ht-template-' + scope));
      }
      const conversations = await require('../../../../chatbot/backend/services/knowledgeAssistant.service').listSessions({ projectId: 'sample-project', user: { id: actorId, role: 'admin', is_workspace_admin: true } });
      assert.equal(conversations.filter(row => row.id.startsWith('sample-v7-ht-conversation-')).length, 2);
      const runs = await db.prepare("SELECT status FROM agentic_workflow_runs WHERE id LIKE 'sample-v7-ht-%'").all();
      assert.deepEqual(new Set(runs.map(row => row.status)), new Set(['completed', 'needs_review', 'failed']));
      assert.equal((await db.prepare('SELECT COUNT(*)::int AS count FROM execution_schedules WHERE is_active = TRUE').get()).count, 0);
      assert.equal((await db.prepare('SELECT COUNT(*)::int AS count FROM integrations WHERE is_active = TRUE').get()).count, 0);
    });

    await t.test('reinstall preserves user edits, customized base-role grants and memberships', async () => {
      await db.prepare("UPDATE projects SET name='User-owned sample title' WHERE id='sample-project'").run();
      await db.prepare("DELETE FROM role_permissions WHERE role_id='role-member' AND permission_id=(SELECT id FROM permissions WHERE code='testcase.create')").run();
      await require('../../services/rolePreset.service').ensureFoundationRoles();
      assert.equal((await db.prepare("SELECT COUNT(*)::int AS count FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.role_id='role-member' AND p.code='testcase.create'").get()).count, 0);
      const again = await setup.seedSampleData({ actorId });
      assert.equal(again.inserted_records, 0);
      assert.equal(again.administrator_memberships, 0);
      assert.equal((await db.prepare("SELECT name FROM projects WHERE id='sample-project'").get()).name, 'User-owned sample title');
    });
  } finally { await Promise.allSettled([db.close(), obs.close()]); }
});
