const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const readinessFixture = (fixVersion = '  Version 1.2 ') => {
  const reads = [];
  const candidates = [
    { id: 'release-failure', test_case_id: 'linked-case', status: 'failed', project_id: 'project-a', release: 'Version 1.2', created_at: '2026-01-01' },
    { id: 'newer-other-release', test_case_id: 'linked-case', status: 'passed', project_id: 'project-a', release: 'Version 1.3', created_at: '2026-02-01' },
    { id: 'prefix-match', test_case_id: 'linked-case', status: 'passed', project_id: 'project-a', release: 'Version 1.20', created_at: '2026-03-01' },
    { id: 'foreign-project', test_case_id: 'linked-case', status: 'passed', project_id: 'project-b', release: 'Version 1.2', created_at: '2026-04-01' },
    { id: 'unlinked-case', test_case_id: 'unlinked-case', status: 'passed', project_id: 'project-a', release: 'Version 1.2', created_at: '2026-05-01' },
    { id: 'unassigned-release', test_case_id: 'linked-case', status: 'passed', project_id: 'project-a', release: '', created_at: '2026-06-01' }
  ];
  const db = {
    prepare: statement => ({ all: async (...args) => {
      const sql = statement.replace(/\s+/g, ' ').trim();
      assert.equal((sql.match(/\?/g) || []).length, args.length);
      reads.push({ sql, args });
      if (sql.startsWith('SELECT requirement_test_cases.requirement_id')) {
        assert.match(sql, /UNION SELECT test_cases.requirement_id/);
        assert.deepEqual(Array.from(args), ['story','project-a','story','project-a']);
        return [{ requirement_id: 'story', test_case_id: 'linked-case' }];
      }
      if (sql.includes('FROM execution_results er JOIN executions')) {
        assert.match(sql, /er.test_case_id IN \(\?\) AND e.project_id = \?/);
        assert.match(sql, /AND \? <> '' AND LOWER\(TRIM\(COALESCE\(e.release, ''\)\)\) = \?/);
        const [caseId, projectId, requiredToken, token] = args;
        const selected = candidates.filter(row => row.test_case_id === caseId && row.project_id === projectId && requiredToken && row.release.trim().toLowerCase() === token && ['passed','failed','blocked'].includes(row.status))
          .sort((a, b) => b.created_at.localeCompare(a.created_at));
        return selected.length ? [{ test_case_id: selected[0].test_case_id, status: selected[0].status }] : [];
      }
      if (sql.startsWith('SELECT id, automated, automation_status FROM test_cases')) return [{ id: 'linked-case', automation_status: 'ready' }];
      if (sql.includes('FROM requirement_defects')) {
        assert.match(sql, /AND feedback.project_id = \?/);
        assert.equal(args.at(-1), 'project-a');
        return [];
      }
      throw new Error(`Unexpected query: ${sql}`);
    } })
  };
  const service = {};
  vm.runInNewContext(readFileSync(path.join(__dirname, '../src/services/requirementRelease.service.js'), 'utf8'), {
    exports: service,
    require: dependency => dependency === '../db' ? db : dependency === 'crypto' ? require('node:crypto') : dependency === '../utils/finalizedCaseMetrics' ? require('../src/utils/finalizedCaseMetrics') : {}
  });
  service.getRelease = async () => ({ id: 'release-id', project_id: 'project-a', fix_version: fixVersion, requirement_ids: ['story'] });
  return { service, reads, candidates };
};

test('legacy release readiness uses the stored exact release token, project and linked-case cohort', async () => {
  const { service, reads } = readinessFixture();
  const result = await service.getReadiness('release-id');
  assert.equal(result.executed_cases, 1);
  assert.equal(result.passed_cases, 0, 'newer passing runs in another release/project and unlinked cases cannot replace this release failure');
  assert.equal(result.pass_rate_percent, 0);
  assert.equal(result.automation_coverage_percent, 100, 'canonical ready automation status is recognized');
  assert.notEqual(result.readiness_state, 'ready');
  const executionRead = reads.find(({ sql }) => sql.includes('FROM execution_results'));
  assert.deepEqual(Array.from(executionRead.args), ['linked-case', 'project-a', 'version 1.2', 'version 1.2']);
  assert.match(result.methodology.execution_scope, /stored Release fix version/);
});

test('releases without their own execution evidence report no result rather than borrowing another release', async () => {
  for (const token of ['not-run', '']) {
    const { service } = readinessFixture(token);
    const result = await service.getReadiness('release-id');
    assert.equal(result.executed_cases, 0);
    assert.equal(result.passed_cases, 0);
    assert.equal(result.pass_rate_percent, null);
    assert.equal(result.readiness_score, null, 'No run evidence is not a computed readiness percentage');
  }
});

test('latest results inside the same normalized release continue to supersede older attempts', async () => {
  const { service, candidates } = readinessFixture();
  candidates.push({ id: 'current-retest', test_case_id: 'linked-case', status: 'passed', project_id: 'project-a', release: ' VERSION 1.2 ', created_at: '2026-07-01' });
  const result = await service.getReadiness('release-id');
  assert.equal(result.passed_cases, 1);
  assert.equal(result.pass_rate_percent, 100);
});

const routeFixture = async (t, denied) => {
  const service = require('../src/services/requirementRelease.service');
  const projects = require('../src/services/project.service');
  const operations = [], grants = [];
  t.mock.method(service, 'getRelease', async id => ({ id, project_id: 'project-a', fix_version: '1.2', requirement_ids: [] }));
  t.mock.method(projects, 'getProject', async id => ({ id }));
  t.mock.method(service, 'getReadiness', async () => { operations.push('readiness'); return { release_id: 'release-id' }; });
  t.mock.method(service, 'listReadiness', async () => { operations.push('list'); return []; });
  t.mock.method(service, 'generateReleaseNotes', async () => { operations.push('notes'); return { release_id: 'release-id' }; });
  const app = require('fastify')({ logger: false });
  t.after(() => app.close());
  app.decorate('authenticate', async req => { req.user = { id: 'reader', role: 'member' }; });
  app.decorate('requirePermission', (permission, { projectId }) => async () => {
    grants.push({ permission, projectId });
    if (denied === permission) throw Object.assign(new Error(`Permission required: ${permission}`), { statusCode: 403 });
  });
  await app.register(require('../src/plugins/validator'));
  await app.register(require('../src/routes/requirementReleases.routes'));
  return { app, operations, grants };
};

for (const permission of ['requirement_iteration.view', 'requirement.view', 'testcase.view', 'run.view', 'result.view', 'feedback.view']) {
  test(`legacy readiness and notes cannot bypass ${permission}`, async t => {
    const { app, operations, grants } = await routeFixture(t, permission);
    for (const request of [
      { method: 'GET', url: '/requirement-releases/readiness?project_id=project-a' },
      { method: 'GET', url: '/requirement-releases/release-id/readiness?project_id=spoofed-project' },
      { method: 'POST', url: '/requirement-releases/release-id/release-notes', payload: { project_id: 'spoofed-project' } }
    ]) {
      const response = await app.inject(request);
      assert.equal(response.statusCode, 403);
      assert.match(response.json().message, new RegExp(permission.replace('.', '\\.')));
    }
    assert.deepEqual(operations, []);
    assert.ok(grants.every(({ projectId }) => projectId === 'project-a'), 'source checks use the persisted Release project, never a forged query/body hint');
  });
}

test('authorized callers receive legacy aggregates and notes, and canonical Release context is unchanged', async t => {
  const { app, operations } = await routeFixture(t);
  for (const request of [
    { method: 'GET', url: '/requirement-releases/readiness?project_id=project-a' },
    { method: 'GET', url: '/requirement-releases/release-id/readiness' },
    { method: 'POST', url: '/requirement-releases/release-id/release-notes' },
    { method: 'GET', url: '/requirement-releases/release-id' }
  ]) assert.equal((await app.inject(request)).statusCode, 200);
  assert.deepEqual(operations, ['list', 'readiness', 'notes']);
});
