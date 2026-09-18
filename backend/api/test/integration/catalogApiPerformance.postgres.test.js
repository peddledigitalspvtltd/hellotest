const assert = require('node:assert/strict');
const test = require('node:test');

test('catalog batches preserve suite order, transaction isolation, defect scope and release membership in PostgreSQL', {
  skip: !process.env.CATALOG_PERFORMANCE_TEST_DATABASE_URL, timeout: 30_000
}, async t => {
  const url = process.env.CATALOG_PERFORMANCE_TEST_DATABASE_URL;
  assert.match(new URL(url).pathname.slice(1), /^agent_verify_[a-z0-9_]+$/);
  process.env.DATABASE_URL = url;
  process.env.POSTGRES_URL = url;
  const db = require('../../src/db');
  const statements = [];
  const prepare = db.prepare.bind(db);
  t.mock.method(db, 'prepare', sql => {
    const statement = prepare(sql);
    return Object.fromEntries(['all', 'get', 'run'].map(method => [method, async (...args) => {
      statements.push(sql);
      return statement[method](...args);
    }]));
  });
  const suites = require('../../src/services/suiteTestCase.service');
  const defects = require('../../src/services/testCaseDefect.service');
  const releases = require('../../src/services/requirementRelease.service');
  const issueLinks = require('../../src/services/issueLink.service');
  const iterations = require('../../src/services/requirementIteration.service');
  const rollback = new Error('ROLLBACK_CATALOG_PERFORMANCE_FIXTURE');
  try {
    assert.equal((await db.prepare("SELECT to_regclass('public.projects') AS name").get()).name, null, 'An empty disposable database is required');
    await db.transaction(async () => {
      await db.query(`
        CREATE TABLE projects(id text PRIMARY KEY);
        CREATE TABLE app_types(id text PRIMARY KEY, project_id text);
        CREATE TABLE test_suites(id text PRIMARY KEY, app_type_id text, revision integer DEFAULT 1, updated_at timestamptz);
        CREATE TABLE test_cases(id text PRIMARY KEY, app_type_id text, suite_id text, requirement_id text, automated text, automation_status text);
        CREATE TABLE suite_test_cases(suite_id text REFERENCES test_suites(id), test_case_id text REFERENCES test_cases(id), sort_order integer, PRIMARY KEY(suite_id,test_case_id));
        CREATE TABLE requirements(id text PRIMARY KEY, project_id text, title text, description text, iteration_id text, status text, priority integer, dev_completion_target_date timestamptz, qa_completion_target_date timestamptz, created_at timestamptz DEFAULT now(), updated_at timestamptz);
        CREATE TABLE requirement_iterations(id text PRIMARY KEY, project_id text);
        CREATE TABLE test_environments(id text PRIMARY KEY, project_id text, app_type_id text, name text, created_at timestamptz DEFAULT now());
        CREATE TABLE test_configurations(LIKE test_environments INCLUDING ALL);
        CREATE TABLE test_data_sets(LIKE test_environments INCLUDING ALL);
        CREATE TABLE requirement_test_cases(requirement_id text, test_case_id text);
        CREATE TABLE feedback(id text PRIMARY KEY, project_id text, status text);
        CREATE TABLE test_case_defects(test_case_id text REFERENCES test_cases(id), issue_id text REFERENCES feedback(id), link_source text, PRIMARY KEY(test_case_id,issue_id));
        CREATE TABLE requirement_releases(id text PRIMARY KEY, project_id text, name text, fix_version text, sprint_ids jsonb DEFAULT '[]', state text DEFAULT 'planned', target_date timestamptz, updated_at timestamptz DEFAULT now());
        CREATE TABLE requirement_release_items(release_id text, requirement_id text, source text DEFAULT 'manual', PRIMARY KEY(release_id,requirement_id));
        CREATE TABLE requirement_defects(requirement_id text, issue_id text, link_source text, PRIMARY KEY(requirement_id,issue_id));
        CREATE TABLE executions(id text PRIMARY KEY, project_id text, release text);
        CREATE TABLE execution_results(id text, execution_id text, test_case_id text, status text, created_at timestamptz, ended_at timestamptz, data_set_iteration_index integer, data_set_iteration_key text, defects jsonb DEFAULT '[]');
        CREATE TABLE execution_case_snapshots(execution_id text, test_case_id text, test_data_set_snapshot jsonb);
        INSERT INTO projects VALUES('project'),('foreign');
        INSERT INTO app_types VALUES('app','project'),('other-app','foreign');
        INSERT INTO test_suites(id,app_type_id) VALUES('suite','app'),('alternative','app'),('foreign-suite','other-app');
        INSERT INTO test_cases(id,app_type_id,automated,automation_status) SELECT 'case-'||n,'app','yes','ready' FROM generate_series(1,1000) n;
        INSERT INTO test_cases(id,app_type_id) VALUES('foreign-case','other-app');
        INSERT INTO feedback(id,project_id,status) SELECT 'bug-'||n,'project','open' FROM generate_series(1,1000) n;
        INSERT INTO feedback(id,project_id) VALUES('foreign-bug','foreign');
      `);
      for (const [table, serviceName, method] of [
        ['test_environments', 'testEnvironment', 'getTestEnvironments'],
        ['test_configurations', 'testConfiguration', 'getTestConfigurations'],
        ['test_data_sets', 'testDataSet', 'getTestDataSets']
      ]) {
        await db.query(`INSERT INTO ${table}(id,project_id,app_type_id,name) VALUES ('own-shared','project',NULL,'Shared'),('own-app','project','app','App'),('foreign-shared','foreign',NULL,'Private'),('foreign-app','foreign','other-app','Private app')`);
        const service = require(`../../src/services/${serviceName}.service`);
        assert.deepEqual((await service[method]({ app_type_id: 'app' })).map(row => row.id), ['own-shared', 'own-app']);
        assert.deepEqual(await service[method]({ app_type_id: 'missing' }), []);
      }
      const ids = Array.from({ length: 1000 }, (_, index) => `case-${index + 1}`);
      statements.length = 0;
      const start = performance.now();
      assert.deepEqual(await suites.replaceMappingsForSuite('suite', ids, { expectedRevision: 1 }), { updated: true, assigned: 1000, revision: 2 });
      const elapsedMs = performance.now() - start;
      assert.equal(statements.length, 7, '1,000 assignments use seven service statements instead of 3,003');
      t.diagnostic(`1,000 suite assignments: ${statements.length} service statements, ${elapsedMs.toFixed(1)} ms local fixture`);
      assert.deepEqual((await suites.listMappings({ suite_id: 'suite' })).map(row => row.test_case_id), ids);
      statements.length = 0;
      await suites.reorderMappingsForSuite('suite', [...ids].reverse(), { expectedRevision: 2 });
      assert.equal(statements.length, 4, 'reorder has constant query count');
      assert.deepEqual((await suites.listMappings({ suite_id: 'suite' })).map(row => row.test_case_id), [...ids].reverse());
      await assert.rejects(suites.replaceMappingsForSuite('suite', ['foreign-case'], { expectedRevision: 3 }), { statusCode: 403 });
      await assert.rejects(suites.replaceMappingsForSuite('suite', ['missing'], { expectedRevision: 3 }), { statusCode: 404 });
      await assert.rejects(suites.reorderMappingsForSuite('suite', ['case-1'], { expectedRevision: 3 }), /include every/);
      await assert.rejects(suites.replaceMappingsForSuite('suite', [], { expectedRevision: 2 }), { code: 'REVISION_CONFLICT' });
      assert.equal((await suites.listMappings({ suite_id: 'suite' })).length, 1000, 'failed validation leaves all existing mappings');
      await suites.syncMappingsForTestCase('case-1', ['suite', 'alternative', 'suite']);
      await suites.replaceMappingsForSuite('suite', ['case-2'], { expectedRevision: 3 });
      assert.equal((await db.prepare("SELECT suite_id FROM test_cases WHERE id = 'case-1'").get()).suite_id, 'alternative');
      assert.equal((await db.prepare("SELECT suite_id FROM test_cases WHERE id = 'case-3'").get()).suite_id, null);
      await suites.replaceMappingsForSuite('suite', ['case-4', 'case-2'], { append: true, expectedRevision: 4 });
      assert.deepEqual((await suites.listMappings({ suite_id: 'suite' })).map(row => row.test_case_id), ['case-2', 'case-4']);
      statements.length = 0;
      await suites.syncMappingsForTestCase('case-1', ['alternative', 'suite']);
      assert.equal(statements.length, 5);
      await assert.rejects(suites.syncMappingsForTestCase('case-1', ['foreign-suite']), { statusCode: 403 });
      assert.deepEqual(await suites.getSuiteIdsForTestCase('case-1'), ['alternative', 'suite']);

      const bugs = Array.from({ length: 1000 }, (_, index) => `bug-${index + 1}`);
      statements.length = 0;
      assert.deepEqual(await defects.replaceMappingsForTestCase('case-1', [...bugs, bugs[0]]), { updated: true, mapped: 1000 });
      assert.equal(statements.length, 5, 'defect validation and inserts are batched');
      await assert.rejects(defects.replaceMappingsForTestCase('case-1', ['foreign-bug']), { statusCode: 403 });
      await assert.rejects(defects.replaceMappingsForTestCase('case-1', ['missing']), { statusCode: 404 });
      assert.equal((await defects.getDefectIdsForTestCase('case-1')).length, 1000);
      await defects.replaceMappingsForTestCase('case-1', []);
      assert.deepEqual(await defects.getDefectIdsForTestCase('case-1'), []);

      await db.query(`
        INSERT INTO requirements(id,project_id,title,description,iteration_id) VALUES
          ('direct','project','Direct','Full description',NULL),
          ('sprint-story','project','Sprint','Sprint description','sprint'),
          ('foreign-story','foreign','Foreign','Hidden','sprint');
        INSERT INTO requirement_releases(id,project_id,name,fix_version,sprint_ids) VALUES
          ('release','project','Release','v1','["sprint"]'),
          ('manual','project','Manual','v2','[]'),
          ('empty','project','Empty','v3','[]');
        INSERT INTO requirement_release_items VALUES('release','direct','manual'),('release','sprint-story','manual'),('release','foreign-story','manual'),('manual','direct','manual');
        INSERT INTO requirement_test_cases VALUES('direct','case-1'),('sprint-story','case-1');
        UPDATE test_cases SET requirement_id='direct' WHERE id='case-1';
        INSERT INTO executions VALUES('run','project',' V1 '),('other','project','v10');
        INSERT INTO execution_results(id,execution_id,test_case_id,status,created_at) VALUES('pass','run','case-1','passed','2026-09-01'),('foreign-evidence','other','case-1','failed','2026-09-02');
      `);
      await db.query("INSERT INTO requirement_iterations VALUES('sprint','project')");
      statements.length = 0;
      const healthStories = await iterations.listRequirements('sprint', { limit: 5001, projection: 'health' });
      assert.equal(statements.length, 2, 'existence uses summary, without fetching the entire sprint membership first');
      assert.equal(healthStories.length, 1, "foreign Stories cannot enter Sprint health through historical links");
      assert.equal(Object.hasOwn(healthStories[0], 'description'), false);
      statements.length = 0;
      await issueLinks.replaceManualLinks({ issueId: 'bug-1', projectId: 'project', testCaseIds: ids, requirementIds: ['direct'] });
      assert.equal(statements.length, 6, '1,001 Bug links validate and persist with six statements');
      for (const selection of [
        { testCaseIds: ['foreign-case'] }, { requirementIds: ['foreign-story'] },
        { testCaseIds: ['missing'] }, { requirementIds: ['missing'] }
      ]) {
        await assert.rejects(db.transaction(() => issueLinks.replaceManualLinks({ issueId: 'bug-1', projectId: 'project', ...selection }))(),
          { statusCode: Object.values(selection)[0][0] === 'missing' ? 404 : 403 });
      }
      assert.equal((await db.prepare("SELECT COUNT(*)::integer AS total FROM test_case_defects WHERE issue_id = 'bug-1'").get()).total, 1000);
      await issueLinks.replaceManualLinks({ issueId: 'bug-1', projectId: 'project' });
      assert.equal((await db.prepare("SELECT COUNT(*)::integer AS total FROM test_case_defects WHERE issue_id = 'bug-1'").get()).total, 0);
      statements.length = 0;
      const catalog = await releases.listReleases({ project_id: 'project' });
      assert.equal(statements.length, 2);
      const release = catalog.find(row => row.id === 'release');
      assert.equal(release.requirement_count, 2, 'manual+sprint overlap deduplicates and foreign Story is excluded');
      assert.equal(release.requirements.find(row => row.id === 'sprint-story').release_membership_source, 'manual');
      assert.equal(release.requirements.find(row => row.id === 'direct').description, 'Full description');
      assert.equal(catalog.find(row => row.id === 'empty').requirement_count, 0);
      const readiness = await releases.listReadiness({ project_id: 'project' });
      const ready = readiness.find(row => row.release_id === 'release');
      assert.equal(ready.total_stories, 2);
      assert.equal(ready.linked_cases, 1);
      assert.equal(ready.passed_cases, 1);
      assert.equal(ready.readiness_score, 100);
      assert.equal(readiness.find(row => row.release_id === 'manual').readiness_score, null);
      assert.equal(readiness.find(row => row.release_id === 'empty').total_stories, 0);
      assert.deepEqual(await releases.getReadiness('release'), ready);
      throw rollback;
    })();
  } catch (error) {
    if (error !== rollback) throw error;
  } finally { await db.close(); }
});
