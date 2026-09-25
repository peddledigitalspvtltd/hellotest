const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('Test Case summaries and successive saves use the real schema and version-backed revisions', {
  skip: process.env.TEST_CASE_SUMMARY_POSTGRES !== '1', timeout: 120_000
}, async t => {
  const url = new URL(process.env.DATABASE_URL);
  assert.match(url.pathname, /^\/agent_verify_case_summary_[a-z0-9_]+$/);
  process.env.POSTGRES_URL = process.env.OBS_DATABASE_URL = process.env.OBS_POSTGRES_URL = url.toString();
  const db = require('../../src/db');
  const obsDb = require('../../src/obsDb');
  const catalog = require('../../../../testing/backend/services/testCaseCatalog.service');
  const cases = require('../../../../testing/backend/services/testCase.service');
  const versions = require('../../../../testing/backend/services/testCaseVersion.service');
  try {
    assert.equal((await db.prepare("SELECT to_regclass('public.projects') AS name").get()).name, null,
      'This regression requires an empty disposable PostgreSQL database');
    await db.query(fs.readFileSync(path.resolve(__dirname, '../../instance-setup-data/schema-setup/schema.sql'), 'utf8'));
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
    await db.query(`
      INSERT INTO roles(id,name) VALUES ('save-role','Save regression role');
      INSERT INTO project_members(id,project_id,user_id,role_id) VALUES ('save-member','project','reviewer','save-role');
    `);
    const loadSteps = id => db.prepare('SELECT step_order, action, expected_result, group_id, reusable_group_id FROM test_steps WHERE test_case_id = ? ORDER BY step_order, id').all(id);
    await t.test('successive metadata and step saves return success and retain each previous version', async () => {
      const created = await cases.createTestCase({
        app_type_id: 'app', title: 'Save regression 0', created_by: 'reviewer',
        description: 'Description 0', labels: ['checkout'], parameter_values: { account: 'customer-0' },
        steps: [{ action: 'Pay 0', expected_result: 'Receipt 0' }]
      });
      for (let edit = 1; edit <= 3; edit++) {
        const result = await cases.updateTestCase(created.id, {
          title: `Save regression ${edit}`, description: `Description ${edit}`,
          labels: ['checkout', `edit-${edit}`], parameter_values: { account: `customer-${edit}` },
          priority: edit, updated_by: 'reviewer', expected_revision: edit,
          steps: [{ step_order: 1, action: `Pay ${edit}`, expected_result: `Receipt ${edit}` }]
        });
        assert.equal(result.updated, true);
        assert.equal(result.revision, edit + 1, 'Each save returns its committed revision');
        const saved = await cases.getTestCase(created.id);
        assert.equal(saved.title, `Save regression ${edit}`);
        assert.equal(saved.description, `Description ${edit}`);
        assert.deepEqual(saved.labels, ['checkout', `edit-${edit}`]);
        assert.deepEqual(saved.parameter_values, { account: `customer-${edit}` });
        assert.equal(saved.priority, edit);
        assert.equal((await loadSteps(created.id))[0].action, `Pay ${edit}`);
        assert.equal((await loadSteps(created.id))[0].expected_result, `Receipt ${edit}`);
        assert.equal(await versions.currentRevision(created.id), edit + 1);
        const previous = await versions.get(created.id, edit);
        assert.equal(previous.content.title, `Save regression ${edit - 1}`);
        assert.equal(previous.content.steps[0].action, `Pay ${edit - 1}`);
      }
      await assert.rejects(cases.updateTestCase(created.id, {
        title: 'Stale update', steps: [], expected_revision: 1, updated_by: 'reviewer'
      }), { statusCode: 409, code: 'REVISION_CONFLICT' });
      assert.equal((await cases.getTestCase(created.id)).title, 'Save regression 3');
      assert.equal((await loadSteps(created.id))[0].action, 'Pay 3');
      assert.equal(await versions.currentRevision(created.id), 4);
      assert.deepEqual(await cases.updateTestCase(created.id, {
        description: 'Metadata-only change', expected_revision: 4, updated_by: 'reviewer'
      }), { updated: true, revision: 5 });
      assert.equal((await loadSteps(created.id))[0].action, 'Pay 3');
      assert.deepEqual(await cases.updateTestCase(created.id, {
        steps: [], expected_revision: 5, updated_by: 'reviewer'
      }), { updated: true, revision: 6 });
      assert.deepEqual(await loadSteps(created.id), []);
      assert.equal(await versions.currentRevision(created.id), 6);
    });
    await t.test('Suite-only saves return authoritative revisions and preserve peer memberships and authoring content', async () => {
      await db.query(`
        INSERT INTO test_suites(id,app_type_id,name) VALUES
          ('revision-suite-a','app','Original Suite'),('revision-suite-b','app','Second Suite');
        INSERT INTO test_cases(id,app_type_id,title,suite_id) VALUES
          ('suite-mapped-peer','app','Mapped peer','revision-suite-a'),
          ('suite-legacy-peer','app','Legacy primary Suite peer','revision-suite-a');
        INSERT INTO suite_test_cases(suite_id,test_case_id,sort_order) VALUES
          ('revision-suite-a','suite-mapped-peer',7),('revision-suite-b','suite-mapped-peer',12);
      `);
      const created = await cases.createTestCase({
        app_type_id: 'app', suite_ids: ['revision-suite-a'], title: 'Suite revision case',
        description: 'Saved authoring description', labels: ['saved-label'],
        parameter_values: { account: 'saved-account' }, created_by: 'reviewer',
        steps: [{ action: 'Open checkout', expected_result: 'Checkout is available' }]
      });
      const peerMappings = () => db.prepare(`SELECT suite_id, test_case_id, sort_order FROM suite_test_cases
        WHERE test_case_id IN ('suite-mapped-peer', 'suite-legacy-peer') ORDER BY suite_id, test_case_id`).all();
      const peerPrimarySuites = () => db.prepare(`SELECT id, suite_id FROM test_cases
        WHERE id IN ('suite-mapped-peer', 'suite-legacy-peer') ORDER BY id`).all();
      const originalPeerMappings = await peerMappings();
      const originalPeerSuites = await peerPrimarySuites();
      const originalSteps = await loadSteps(created.id);
      let revision = await versions.currentRevision(created.id);
      const selections = [[], ['revision-suite-a', 'revision-suite-b'], ['revision-suite-b']];
      for (const suiteIds of selections) {
        const result = await cases.updateTestCase(created.id, {
          suite_ids: suiteIds, expected_revision: revision, updated_by: 'reviewer'
        });
        assert.deepEqual(result, { updated: true, revision: revision + 1 });
        revision = result.revision;
        const saved = await cases.getTestCase(created.id);
        assert.equal(saved.revision, revision, 'Response revision matches the refreshed detail used to preserve drafts');
        assert.equal(await versions.currentRevision(created.id), revision);
        assert.deepEqual([...saved.suite_ids].sort(), [...suiteIds].sort());
        assert.equal(saved.suite_id, suiteIds[0] || null);
        assert.equal(saved.title, 'Suite revision case');
        assert.equal(saved.description, 'Saved authoring description');
        assert.deepEqual(saved.labels, ['saved-label']);
        assert.deepEqual(saved.parameter_values, { account: 'saved-account' });
        assert.deepEqual(await loadSteps(created.id), originalSteps);
        assert.deepEqual(await peerMappings(), originalPeerMappings, 'Other cases keep their mappings and sort order');
        assert.deepEqual(await peerPrimarySuites(), originalPeerSuites, 'Legacy-only peer membership is retained');
      }
      await assert.rejects(cases.updateTestCase(created.id, {
        suite_ids: [], expected_revision: revision - 1, updated_by: 'reviewer'
      }), { statusCode: 409, code: 'REVISION_CONFLICT' });
      assert.equal(await versions.currentRevision(created.id), revision);
      assert.deepEqual((await cases.getTestCase(created.id)).suite_ids, ['revision-suite-b']);
      assert.deepEqual(await peerMappings(), originalPeerMappings);
      assert.deepEqual(await peerPrimarySuites(), originalPeerSuites);
    });
    await t.test('editing shared reference steps updates the canonical group and other cases without losing adjacent steps', async () => {
      await db.prepare('INSERT INTO shared_step_groups(id,app_type_id,name,steps) VALUES (?,?,?,?)')
        .run('save-shared-group', 'app', 'Shared login', [{ step_order: 1, action: 'Sign in', expected_result: 'Home opens', step_type: 'web' }]);
      const sharedStep = (instance, index, action) => ({
        step_order: index, action, expected_result: `Result: ${action}`, group_id: instance,
        group_name: 'Shared login', group_kind: 'reusable', reusable_group_id: 'save-shared-group'
      });
      const source = await cases.createTestCase({
        app_type_id: 'app', title: 'Shared source', created_by: 'reviewer',
        steps: [sharedStep('source-instance', 1, 'Sign in')]
      });
      const linked = await cases.createTestCase({
        app_type_id: 'app', title: 'Shared linked case', created_by: 'reviewer',
        steps: [
          { step_order: 1, action: 'Local setup' },
          sharedStep('linked-instance', 2, 'Sign in'),
          { step_order: 3, action: 'Local teardown' }
        ]
      });
      for (const actions of [['Open login', 'Enter credentials', 'Submit login'], ['Use saved session']]) {
        assert.equal((await cases.updateTestCase(source.id, {
          description: `Shared steps: ${actions.length}`, updated_by: 'reviewer',
          expected_revision: await versions.currentRevision(source.id),
          steps: actions.map((action, index) => sharedStep('source-instance', index + 1, action))
        })).updated, true);
        const canonical = await db.prepare('SELECT steps FROM shared_step_groups WHERE id = ?').get('save-shared-group');
        assert.deepEqual(canonical.steps.map(step => step.action), actions);
        assert.deepEqual((await loadSteps(source.id)).map(step => step.action), actions);
        const linkedSteps = await loadSteps(linked.id);
        assert.deepEqual(linkedSteps.map(step => step.action), ['Local setup', ...actions, 'Local teardown']);
        assert.deepEqual(linkedSteps.map(step => step.step_order), Array.from({ length: actions.length + 2 }, (_, index) => index + 1));
        assert.ok(linkedSteps.slice(1, -1).every(step => step.group_id === 'linked-instance' && step.reusable_group_id === 'save-shared-group'));
      }
    });
  } finally {
    await Promise.all([db.close(), obsDb.close()]);
  }
});
