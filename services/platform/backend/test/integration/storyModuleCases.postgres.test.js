const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('Story-derived module cases stay relational, scoped, deduplicated and consistent with paginated metrics', {
  skip: process.env.STORY_MODULE_POSTGRES !== '1', timeout: 120_000
}, async t => {
  const url = new URL(process.env.DATABASE_URL);
  assert.match(url.pathname, /^\/agent_verify_story_modules_[a-z0-9_]+$/);
  process.env.POSTGRES_URL = process.env.OBS_DATABASE_URL = process.env.OBS_POSTGRES_URL = url.toString();
  const db = require('../../src/db');
  const obsDb = require('../../src/obsDb');
  const cases = require('../../../../testing/backend/services/testCase.service');
  const modules = require('../../../../testing/backend/services/testCaseModule.service');
  const catalog = require('../../../../testing/backend/services/testCaseCatalog.service');
  const storyLinks = require('../../../../manual/backend/services/requirementTestCase.service');
  const design = require('../../../../manual/backend/services/requirementDesign.service');
  const membership = async id => (await db.prepare('SELECT module_id FROM test_case_effective_module_cases WHERE test_case_id = ? ORDER BY module_id').all(id)).map(row => row.module_id);
  try {
    assert.equal((await db.prepare("SELECT to_regclass('public.projects') AS name").get()).name, null);
    await db.query(fs.readFileSync(path.resolve(__dirname, '../../instance-setup-data/schema-setup/schema.sql'), 'utf8'));
    await require('../../src/db/bootstrap').ensureRuntimeSchema();
    await db.query(`INSERT INTO users(id,email,password_hash) VALUES ('author','author@example.test','not-a-login');
      INSERT INTO projects(id,name) VALUES ('project','Module verification'),('foreign','Other project');
      INSERT INTO app_types(id,project_id,name,type) VALUES ('web','project','Web','web'),('api','project','API','api'),('other','foreign','Other','web');
      INSERT INTO roles(id,name) VALUES ('sample-role','Module verification role');
      INSERT INTO project_members(id,project_id,user_id,role_id) VALUES ('membership','project','author','sample-role');
      INSERT INTO requirements(id,display_id,project_id,title) VALUES ('story','STORY-41','project','Secure sign in'),('foreign-story','STORY-42','foreign','Foreign Story');
      INSERT INTO test_case_modules(id,app_type_id,name) VALUES ('one','web','First'),('two','web','Second'),('explicit','web','Manual home'),('api-module','api','Other application'),('foreign-module','other','Other project');
      INSERT INTO test_case_module_requirements(module_id,requirement_id) VALUES ('one','story'),('two','story'),('api-module','story'),('foreign-module','foreign-story');`);
    let manual;
    let generated;
    await t.test('manual and accepted AI cases immediately appear in both linked modules, without assignment writes', async () => {
      manual = await cases.createTestCase({ app_type_id: 'web', title: 'Manual case', requirement_ids: ['story'], created_by: 'author', steps: [{ action: 'Sign in', expected_result: 'Home opens' }] });
      const accepted = await design.acceptRequirementTestCases({ requirement: { id: 'story', project_id: 'project', title: 'Secure sign in' }, appType: { id: 'web' }, created_by: 'author', cases: [{ title: 'Generated case', steps: [{ action: 'Submit credentials', expected_result: 'Home opens' }] }] });
      generated = accepted.created[0];
      assert.deepEqual(await membership(manual.id), ['one', 'two']);
      assert.deepEqual(await membership(generated.id), ['one', 'two']);
      assert.equal((await db.prepare('SELECT count(*)::int AS count FROM test_case_module_cases').get()).count, 0);
      const summaries = await modules.listModules({ app_type_id: 'web', projection: 'summary' });
      assert.equal(summaries.find(row => row.id === 'one').test_case_count, 2);
      assert.equal(summaries.find(row => row.id === 'two').test_case_count, 2);
      const detail = await cases.getTestCase(generated.id);
      assert.deepEqual(detail.linked_requirements, [{ id: 'story', display_id: 'STORY-41', title: 'Secure sign in' }]);
    });
    await t.test('clearing inherited-only membership reports zero removals and explains the retained Story relationship', async () => {
      const response = await modules.removeCases('one', [manual.id]);
      assert.equal(response.removed, 0);
      assert.deepEqual(response.retained_test_case_ids, [manual.id]);
      assert.match(response.message, /Change the Test Case Story assignment/);
      assert.deepEqual(await membership(manual.id), ['one', 'two']);
      assert.equal((await cases.getTestCase(manual.id)).requirement_id, 'story');
    });
    await t.test('each module page and metric counts shared cases once; the overall catalog does not double count', async () => {
      const first = await catalog.listPage({ project_id: 'project', app_type_id: 'web', module_id: 'one', projection: 'summary', page_size: 1 });
      const second = await catalog.listPage({ project_id: 'project', app_type_id: 'web', module_id: 'one', projection: 'summary', page_size: 1, cursor: first.next_cursor });
      assert.equal(first.total, 2);
      assert.equal(second.is_last, true);
      assert.notEqual(first.items[0].id, second.items[0].id);
      assert.equal(first.items[0].linked_requirements[0].display_id, 'STORY-41');
      const metrics = await catalog.getMetrics({ project_id: 'project', app_type_id: 'web', include_execution: true });
      assert.equal(metrics.catalog.total, 2);
      assert.equal(metrics.modules.one.count, 2);
      assert.equal(metrics.modules.two.count, 2);
      assert.equal(metrics.unassigned.count, 0);
      assert.equal((await catalog.listPage({ app_type_id: 'web', unassigned_module: true })).total, 0);
    });
    await t.test('explicit move stays single-owner and survives Story unlink; derived links disappear immediately', async () => {
      await modules.assignCases('explicit', [manual.id]);
      assert.deepEqual(await membership(manual.id), ['explicit', 'one', 'two']);
      await storyLinks.syncMappingsForTestCase(manual.id, []);
      assert.deepEqual(await membership(manual.id), ['explicit']);
      await modules.updateModule('two', { requirement_ids: [] });
      assert.deepEqual(await membership(generated.id), ['one']);
      assert.deepEqual((await cases.getTestCase(generated.id)).linked_requirements.map(story => story.id), ['story']);
      await modules.assignCases('one', [manual.id]);
      assert.deepEqual((await db.prepare('SELECT module_id FROM test_case_module_cases WHERE test_case_id = ?').all(manual.id)).map(row => row.module_id), ['one']);
      await modules.removeCases('one', [manual.id]);
      assert.deepEqual(await membership(manual.id), []);
    });
    await t.test('legacy links and duplicate paths deduplicate, while cross-project and cross-application links never inherit', async () => {
      await db.prepare('INSERT INTO requirement_test_cases(requirement_id,test_case_id) VALUES (?,?)').run('foreign-story', generated.id);
      assert.deepEqual(await membership(generated.id), ['one']);
      assert.deepEqual((await cases.getTestCase(generated.id)).linked_requirements.map(story => story.id), ['story']);
      await modules.assignCases('one', [generated.id]);
      assert.deepEqual(await membership(generated.id), ['one']);
      assert.equal((await catalog.getMetrics({ app_type_id: 'web' })).modules.one.count, 1);
      await db.prepare('DELETE FROM requirement_test_cases WHERE test_case_id = ?').run(generated.id);
      const cleared = await modules.removeCases('one', [generated.id]);
      assert.equal(cleared.removed, 1, 'Only the explicit row was removed');
      assert.deepEqual(cleared.retained_test_case_ids, [generated.id]);
      assert.deepEqual(await membership(generated.id), ['one'], 'legacy requirement_id still provides membership');
      await db.prepare('UPDATE test_cases SET requirement_id = NULL WHERE id = ?').run(generated.id);
      assert.deepEqual(await membership(generated.id), []);
    });
  } finally { await Promise.all([db.close(), obsDb.close()]); }
});
