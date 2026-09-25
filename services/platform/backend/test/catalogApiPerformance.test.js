const { sourceFile } = require("./helpers/sourceFile");
const assert = require('node:assert/strict');
const test = require('node:test');
const db = require('../src/db');
const releases = require('../../../manual/backend/services/requirementRelease.service');

const releaseRows = (count) => Array.from({ length: count }, (_, index) => ({ id: `release-${index}`, project_id: 'project', sprint_ids: [], state: 'planned' }));

test('release catalogs hydrate a complete ordered batch with two reads, without exposing internal grouping keys', async t => {
  const rows = releaseRows(200), reads = [];
  t.mock.method(db, 'prepare', sql => ({ all: async (...args) => {
    reads.push(sql);
    if (sql.includes('jsonb_to_recordset')) {
      assert.equal(JSON.parse(args[0]).length, 200);
      return [{ id: 'story', title: 'Story', hydration_release_id: 'release-17', release_membership_source: 'manual' }];
    }
    return rows;
  } }));
  const catalog = await releases.listReleases({ project_id: 'project' });
  assert.equal(reads.length, 2);
  assert.deepEqual(catalog.map(row => row.id), rows.map(row => row.id));
  assert.equal(catalog[17].requirement_count, 1);
  assert.deepEqual(catalog[17].requirement_ids, ['story']);
  assert.deepEqual(catalog[0].requirements, []);
  assert.equal(Object.hasOwn(catalog[17].requirements[0], 'hydration_release_id'), false);
});

test('readiness uses compact batch membership, bounds concurrency to three, and preserves result order', async t => {
  const rows = releaseRows(40), reads = [];
  let active = 0, peak = 0, count = 0;
  t.mock.method(db, 'prepare', sql => ({ all: async () => {
    reads.push(sql);
    if (sql.includes('jsonb_to_recordset')) {
      assert.doesNotMatch(sql, /requirements\.\*/);
      return rows.map(row => ({ id: `story-${row.id}`, hydration_release_id: row.id }));
    }
    return rows;
  } }));
  t.mock.method(releases, 'getReadiness', async (id, { release }) => {
    assert.equal(release.id, id);
    assert.deepEqual(release.requirement_ids, [`story-${id}`]);
    active++; peak = Math.max(active, peak); count++;
    await new Promise(resolve => setImmediate(resolve));
    active--;
    return { release_id: id };
  });
  const results = await releases.listReadiness({ project_id: 'project' });
  assert.equal(reads.length, 2);
  assert.equal(count, 40);
  assert.equal(peak, 3);
  assert.deepEqual(results.map(row => row.release_id), rows.map(row => row.id));
});

test('failed readiness drains started work and stops scheduling more releases', async t => {
  const rows = releaseRows(40);
  let active = 0, started = 0;
  t.mock.method(db, 'prepare', sql => ({ all: async () => sql.includes('jsonb_to_recordset') ? [] : rows }));
  t.mock.method(releases, 'getReadiness', async id => {
    active++; started++;
    try {
      if (id === 'release-0') throw new Error('read failure');
      await new Promise(resolve => setImmediate(resolve));
      return {};
    } finally { active--; }
  });
  await assert.rejects(releases.listReadiness({ project_id: 'project' }), /read failure/);
  assert.equal(active, 0);
  assert.equal(started, 3);
});

async function defectRoutes(t, { denied, role = 'member' } = {}) {
  const Fastify = require('fastify');
  const scopes = require('../../../testing/backend/services/testCaseScope.service');
  const entities = require('../services/entityScope.service');
  const service = require('../../../testing/backend/services/testCaseDefect.service');
  const calls = [];
  t.mock.method(scopes, 'resolveTestCaseScopes', async ([id]) => id === 'missing' ? [] : [{ id, project_ids: id === 'ambiguous' ? ['project', 'foreign'] : [id === 'foreign' ? 'foreign' : 'project'] }]);
  t.mock.method(entities, 'resolveEntityScope', async ({ entityId }) => ({ projectId: entityId === 'foreign' ? 'foreign' : 'project' }));
  for (const name of ['listMappings', 'getDefectsForTestCase', 'replaceMappingsForTestCase']) {
    t.mock.method(service, name, async () => { calls.push(name); return []; });
  }
  const app = Fastify({ logger: false });
  t.after(() => app.close());
  app.decorate('authenticate', async req => { req.user = { id: 'reader', role }; });
  app.decorate('requirePermission', (permission, { projectId }) => async () => {
    if (permission === denied || (role !== 'admin' && projectId !== 'project')) throw Object.assign(new Error('Forbidden'), { statusCode: 403 });
  });
  await app.register(require('../src/plugins/validator'));
  await app.register(require('../../../testing/backend/routes/testCaseDefects.routes'));
  return { app, calls };
}

test('defect routes reject unscoped, foreign, conflicting and missing cases before accessing mappings', async t => {
  const { app, calls } = await defectRoutes(t);
  for (const [url, status] of [
    ['/test-case-defects', 400],
    ['/test-case-defects?test_case_id=foreign&project_id=project', 403],
    ['/test-case-defects?test_case_id=case&issue_id=foreign', 403],
    ['/test-case-defects/foreign/issues?project_id=project', 403],
    ['/test-case-defects/missing/issues', 404],
    ['/test-case-defects/ambiguous/issues', 409]
  ]) assert.equal((await app.inject(url)).statusCode, status, url);
  assert.equal((await app.inject({ method: 'PUT', url: '/test-case-defects/replace', payload: { test_case_id: 'foreign', issue_ids: [], project_id: 'project' } })).statusCode, 403);
  assert.deepEqual(calls, []);
});

for (const permission of ['testcase.view', 'feedback.view', 'feedback.manage']) {
  test(`defect mappings cannot bypass ${permission}`, async t => {
    const { app, calls } = await defectRoutes(t, { denied: permission });
    const response = await app.inject(permission === 'feedback.manage'
      ? { method: 'PUT', url: '/test-case-defects/replace', payload: { test_case_id: 'case', issue_ids: [] } }
      : '/test-case-defects/case/issues');
    assert.equal(response.statusCode, 403);
    assert.deepEqual(calls, []);
  });
}

test('authorized defect reads and replacements keep their response contracts', async t => {
  const { app, calls } = await defectRoutes(t);
  for (const url of ['/test-case-defects?test_case_id=case', '/test-case-defects?issue_id=bug', '/test-case-defects/case/issues']) {
    assert.equal((await app.inject(url)).statusCode, 200);
  }
  assert.equal((await app.inject({ method: 'PUT', url: '/test-case-defects/replace', payload: { test_case_id: 'case', issue_ids: [] } })).statusCode, 200);
  assert.equal(calls.length, 4);
});

test('Sprint health bounds the entire hydration tree and requests only metric fields', async t => {
  const iterations = require('../../../manual/backend/services/requirementIteration.service');
  const projects = require('../services/project.service');
  const rows = releaseRows(100);
  let active = 0, peak = 0;
  t.mock.method(projects, 'getProject', async id => ({ id }));
  t.mock.method(iterations, 'listIterations', async () => rows);
  t.mock.method(iterations, 'listRequirements', async (id, options) => {
    assert.equal(options.projection, 'health');
    assert.equal(options.limit, 5001);
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setImmediate(resolve));
    active--;
    return [];
  });
  const app = require('fastify')({ logger: false });
  t.after(() => app.close());
  app.decorate('authenticate', async req => { req.user = { id: 'reader' }; });
  app.decorate('requirePermission', () => async () => {});
  await app.register(require('../../../manual/backend/routes/requirementIterations.routes'));
  const response = await app.inject('/requirement-iterations/health?project_id=project');
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(peak, 3);
  assert.equal(response.json().items.length, 100);
  assert.equal(response.json().partial, false);
});

for (const permission of ['requirement.view', 'testcase.view', 'run.view', 'result.view', 'feedback.view']) {
  test(`Sprint health cannot bypass ${permission}`, async t => {
    const iterations = require('../../../manual/backend/services/requirementIteration.service');
    t.mock.method(require('../services/project.service'), 'getProject', async id => ({ id }));
    let reads = 0;
    t.mock.method(iterations, 'listIterations', async () => { reads++; return []; });
    const app = require('fastify')({ logger: false });
    t.after(() => app.close());
    app.decorate('authenticate', async req => { req.user = { id: 'reader' }; });
    app.decorate('requirePermission', code => async () => {
      if (code === permission) throw Object.assign(new Error('Forbidden'), { statusCode: 403 });
    });
    await app.register(require('../../../manual/backend/routes/requirementIterations.routes'));
    assert.equal((await app.inject('/requirement-iterations/health?project_id=project')).statusCode, 403);
    assert.equal(reads, 0);
  });
}

for (const [route, module, method] of [
  ['/test-environments', 'testEnvironment', 'getTestEnvironments'],
  ['/test-configurations', 'testConfiguration', 'getTestConfigurations']
]) {
  test(`${route} forwards the authorized project for application-only reads`, async t => {
    const resource = require(sourceFile(`${module}.service`, "services"));
    t.mock.method(require('../services/project.service'), 'getProject', async id => ({ id }));
    t.mock.method(require('../services/appType.service'), 'getAppType', async id => ({ id, project_id: 'project' }));
    const calls = [];
    t.mock.method(resource, method, async scope => { calls.push(scope); return []; });
    const app = require('fastify')({ logger: false });
    t.after(() => app.close());
    app.decorate('authenticate', async req => { req.user = { id: 'reader' }; });
    app.decorate('requirePermission', () => async () => {});
    await app.register(require(sourceFile(`${module}s.routes`, "routes")));
    const response = await app.inject(`${route}?app_type_id=app`);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(calls, [{ project_id: 'project', app_type_id: 'app' }]);
    assert.equal((await app.inject(`${route}?project_id=foreign&app_type_id=app`)).statusCode, 400);
    assert.equal(calls.length, 1);
  });
}
