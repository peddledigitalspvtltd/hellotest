const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const Fastify = require('fastify');
const flags = require('../../backend/services/featureFlag.service');
const permissionService = require('../../backend/services/permission.service');
const db = require('../../backend/src/db');
const { ROUTE_PERMISSIONS, DEFAULT_ROLE_PERMISSIONS, PERMISSIONS } = require('../../backend/src/security/permissions.catalog');

const SOURCE_FLAG = 'hellotest.automation.object_repository';
const WORKSPACE_FLAG = 'hellotest.automation.workspace';
const AGENT_FLAG = 'hellotest.ai.agentic_workflows';

function stored(t, values = {}) {
  let reads = 0;
  t.mock.method(db, 'prepare', (sql) => {
    if (/FROM project_deletion_jobs/.test(sql)) return { get: async () => ({ active: false }) };
    assert.match(sql, /SELECT value/);
    return { get: async (key) => { assert.equal(key, 'feature_flags'); reads++; return { value: { flags: values } }; } };
  });
  return () => reads;
}

test('unknown, misspelled and malformed feature requests are never enabled', async (t) => {
  stored(t);
  assert.equal(await flags.isEnabled('hellotest.ai.agnetic_workflows'), false);
  assert.equal(await flags.isEnabled('__proto__'), false);
  assert.equal(await flags.areEnabled([AGENT_FLAG, '']), false);
  assert.equal(await flags.areEnabled([AGENT_FLAG, undefined]), false);
  assert.equal(await flags.areEnabled('hellotest.ai.agentic_workflows'), false);
  assert.equal(await flags.areEnabled([]), true);
  assert.equal(await flags.areEnabled([AGENT_FLAG]), true);
});

test('a malformed persisted boolean fails closed while absent keys retain catalog defaults', async (t) => {
  stored(t, { [AGENT_FLAG]: 'true', [SOURCE_FLAG]: null });
  assert.equal(await flags.isEnabled(AGENT_FLAG), false);
  assert.equal(await flags.isEnabled(SOURCE_FLAG), false);
  assert.equal(await flags.isEnabled('hellotest.manual.test_cases'), true);
  assert.equal(await flags.isEnabled('hellotest.automation.preview'), false);
});

test('one snapshot is internally consistent and exposes effective dependency decisions', async (t) => {
  const reads = stored(t, { [WORKSPACE_FLAG]: false, [SOURCE_FLAG]: true });
  const snapshot = await flags.getSnapshot();
  assert.equal(reads(), 1);
  assert.equal(snapshot.local_flags[SOURCE_FLAG], true);
  assert.equal(snapshot.flags[SOURCE_FLAG], false);
  assert.deepEqual(snapshot.dependencies[SOURCE_FLAG], [WORKSPACE_FLAG]);
  assert.equal(snapshot.flags['hellotest.ai.agentic_workflows'], true);
});

test('Run view metadata links Gherkin and Coded to their separate permissions', async (t) => {
  stored(t);
  const snapshot = await flags.getSnapshot();
  const byKey = new Map(snapshot.groups.flatMap(group => group.features.map(feature => [feature.key, feature])));
  const gherkin = byKey.get('hellotest.manual.run_gherkin');
  const coded = byKey.get('hellotest.automation.step_code');
  assert.deepEqual(gherkin.routes, ['/executions']);
  assert.deepEqual(gherkin.permissions, ['run.gherkin.view']);
  assert.match(gherkin.description, /default Structured view/);
  assert.ok(coded.permissions.includes('automation.code.view'));
  assert.match(coded.description, /Coded view/);
  assert.equal(PERMISSIONS.find(permission => permission.code === 'run.gherkin.view').group, 'testing');
  for (const role of ['admin', 'member']) assert.ok(DEFAULT_ROLE_PERMISSIONS[role].includes('run.gherkin.view'));
});

test('disabling Gherkin preserves Structured Run access and independent Coded access', async (t) => {
  stored(t, { 'hellotest.manual.run_gherkin': false });
  assert.deepEqual(await flags.getDisabledPermissionCodes(['run.view', 'run.gherkin.view', 'automation.code.view']), ['run.gherkin.view']);
  assert.equal(await flags.isEnabled('hellotest.manual.runs'), true);
  assert.equal(await flags.isEnabled('hellotest.automation.step_code'), true);
});

test('Gherkin Run view follows the parent Run feature and retains its deliberate local toggle', async (t) => {
  stored(t, { 'hellotest.manual.runs': false, 'hellotest.manual.run_gherkin': true });
  const snapshot = await flags.getSnapshot();
  assert.equal(snapshot.local_flags['hellotest.manual.run_gherkin'], true);
  assert.equal(snapshot.flags['hellotest.manual.run_gherkin'], false);
  assert.deepEqual(snapshot.dependencies['hellotest.manual.run_gherkin'], ['hellotest.manual.runs']);
  assert.deepEqual(await flags.getDisabledPermissionCodes(['run.view', 'run.gherkin.view']), ['run.view', 'run.gherkin.view']);
});

test('permission group filtering reads one snapshot for all groups', async (t) => {
  const reads = stored(t, { [AGENT_FLAG]: false, [SOURCE_FLAG]: false });
  const groups = await flags.filterPermissionGroupsByEnabledFeatures([
    { key: 'agents', permissions: [['agentic_workflow.run', 'Run agents']] },
    { key: 'repository', permissions: [{ code: 'automation.repository.manage', description: 'Manage repository' }] },
    { key: 'manual', permissions: [['testcase.view', 'Read cases']] }
  ]);
  assert.equal(reads(), 1);
  assert.deepEqual(groups.map((group) => group.key), ['manual']);
  assert.deepEqual(groups[0].permissions, [['testcase.view', 'Read cases']]);
});

test('invalid feature edits fail before persistence instead of resetting availability', async (t) => {
  t.mock.method(db, 'prepare', () => assert.fail('Invalid changes must not read or write storage'));
  for (const input of [null, [], true, { [AGENT_FLAG]: 'false' }, { unknown: true }, JSON.parse('{"__proto__": true}')]) {
    await assert.rejects(flags.updateLocalFlags(input), { statusCode: 400, code: 'INVALID_FEATURE_FLAGS' });
  }
});

test('partial updates use an atomic database merge and return the persisted result', async (t) => {
  let writes = 0;
  t.mock.method(db, 'prepare', (sql) => {
    assert.match(sql, /ON CONFLICT[\s\S]*jsonb_set\([\s\S]*\|\| \?::jsonb[\s\S]*RETURNING value/);
    return { get: async (key, initial, patch) => {
      writes++;
      assert.equal(key, 'feature_flags');
      assert.deepEqual(patch, { [SOURCE_FLAG]: false });
      assert.equal(initial.flags[SOURCE_FLAG], false);
      return { value: { flags: { [AGENT_FLAG]: false, ...patch } } };
    } };
  });
  const result = await flags.updateLocalFlags({ [SOURCE_FLAG]: false });
  assert.equal(writes, 1);
  assert.equal(result.flags[AGENT_FLAG], false);
  assert.equal(result.flags[SOURCE_FLAG], false);
});

async function accessFixture(t, { disabled = {}, allowed = true, apiKeyScope = null } = {}) {
  const reads = stored(t, disabled);
  const checked = [];
  t.mock.method(permissionService, 'hasPermission', async (user, permission, projectId) => {
    checked.push({ user, permission, projectId });
    return allowed;
  });
  const app = Fastify({ logger: false });
  t.after(() => app.close());
  await app.register(require('../../backend/src/plugins/errorHandler'));
  await app.register(require('../../backend/src/plugins/accessControl'));
  app.addHook('onRequest', async (req) => {
    if (req.headers.authorization === 'Bearer fixture') {
      req.user = { id: 'viewer', role: 'member', status: 'active' };
      if (apiKeyScope) req.apiKey = { scope: apiKeyScope };
    }
  });
  let reached = 0;
  app.get('/test-cases/automation/learning-cache', async () => { reached++; return []; });
  app.post('/agentic-workflows/:id/executions', async () => { reached++; return { accepted: true }; });
  app.post('/agentic-workflow-runs/:id/cancel', async () => { reached++; return { cancelled: true }; });
  await app.register(require('../../backend/routes/featureFlags.routes'));
  await app.ready();
  return { app, checked, reads, reached: () => reached };
}

test('disabled Object Repository rejects direct API reads despite general automation access', async (t) => {
  const { app, reached, checked } = await accessFixture(t, { disabled: { [SOURCE_FLAG]: false } });
  const response = await app.inject({ method: 'GET', url: '/test-cases/automation/learning-cache?project_id=project-a', headers: { authorization: 'Bearer fixture' } });
  assert.equal(response.statusCode, 403);
  assert.equal(response.json().code, 'FEATURE_DISABLED');
  assert.equal(reached(), 0);
  assert.equal(checked[0].projectId, 'project-a');
});

test('workspace feature denial stops a direct workflow execution before its handler', async (t) => {
  const { app, reached } = await accessFixture(t, { disabled: { [AGENT_FLAG]: false } });
  const response = await app.inject({ method: 'POST', url: '/agentic-workflows/workflow-a/executions', headers: { authorization: 'Bearer fixture' }, payload: { project_id: 'project-a' } });
  assert.equal(response.statusCode, 403);
  assert.equal(response.json().code, 'FEATURE_DISABLED');
  assert.equal(reached(), 0);
});

test('enabling a feature does not grant a viewer permission to execute it', async (t) => {
  const { app, reached, reads } = await accessFixture(t, { allowed: false });
  const response = await app.inject({ method: 'POST', url: '/agentic-workflows/workflow-a/executions', headers: { authorization: 'Bearer fixture' }, payload: { project_id: 'project-a' } });
  assert.equal(response.statusCode, 403);
  assert.equal(response.json().code, 'ACCESS_DENIED');
  assert.equal(reached(), 0);
  assert.equal(reads(), 0);
});

test('workspace feature snapshots work without a project and may not be cached by intermediaries', async (t) => {
  const { app, reads } = await accessFixture(t);
  const response = await app.inject({ method: 'GET', url: '/feature-flags', headers: { authorization: 'Bearer fixture' } });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['cache-control'], 'private, no-store');
  assert.equal(response.json().flags[AGENT_FLAG], true);
  assert.equal(reads(), 1);
});

test('new agent execution and automation-job routes have API-key permission mappings', () => {
  for (const [route, permission] of [
    ['POST /agentic-workflows/:id/executions', 'agentic_workflow.run'],
    ['GET /agentic-workflows/:id/readiness', 'agentic_workflow.view'],
    ['POST /agentic-workflow-runs/:id/cancel', 'agentic_workflow.run'],
    ['GET /test-cases/automation/jobs/:transactionId', 'automation.build']
  ]) assert.equal(ROUTE_PERMISSIONS.get(route), permission);
});

test('every ordinary product API route declares a catalog permission', () => {
  // These modules use their own explicit trust boundary: signed-in auth session,
  // authenticated engine protocol, public sign-in/static files, or admin portal.
  const dedicated = new Set(['adminPortal.routes.js', 'adminUi.routes.js', 'auth.routes.js', 'automationGenerator.routes.js', 'testEngineCallbacks.routes.js', 'testEngineInternal.routes.js']);
  const engineInternal = new Set(['POST /api/engine/runs/claim', 'GET /api/engine/runs/:runId/snapshot', 'POST /api/engine/runs/:runId/heartbeat']);
  const root = path.join(__dirname, '../../backend/src/routes');
  const missing = [];
  for (const name of fs.readdirSync(root)) {
    if (dedicated.has(name) || !name.endsWith('.js')) continue;
    const source = fs.readFileSync(path.join(root, name), 'utf8');
    for (const match of source.matchAll(/fastify\.(get|post|put|delete|patch)\(["']([^"']+)["']/g)) {
      const key = `${match[1].toUpperCase()} ${match[2]}`;
      if (!ROUTE_PERMISSIONS.has(key) && !engineInternal.has(key)) missing.push(`${name}: ${key}`);
    }
  }
  assert.deepEqual(missing, [], 'Register a permission when adding a product API route');
});

test('automatic HEAD endpoints retain GET permissions and granular feature controls', async (t) => {
  const { app, reached } = await accessFixture(t, { disabled: { [SOURCE_FLAG]: false } });
  const response = await app.inject({ method: 'HEAD', url: '/test-cases/automation/learning-cache?project_id=project-a', headers: { authorization: 'Bearer fixture' } });
  assert.equal(response.statusCode, 403);
  assert.equal(reached(), 0);
});

test('an invalid application scope cannot fall back to a permission in some other project', async (t) => {
  t.mock.method(db, 'prepare', () => ({ get: async () => undefined }));
  t.mock.method(permissionService, 'hasPermission', () => assert.fail('Missing application must fail before aggregate permission lookup'));
  const app = Fastify({ logger: false });
  t.after(() => app.close());
  await app.register(require('../../backend/src/plugins/accessControl'));
  await app.ready();
  await assert.rejects(app.requirePermission('automation.build')({ user: { id: 'member', role: 'member' }, method: 'POST', body: { app_type_id: 'missing-app' } }), { statusCode: 404 });
});

test('asynchronous persisted-resource scope resolvers authorize their resolved project', async (t) => {
  const { app, checked } = await accessFixture(t);
  await app.requirePermission('agentic_workflow.run', { projectId: async () => 'persisted-project' })({ user: { id: 'member', role: 'member' }, method: 'POST', body: { project_id: 'attacker-selected-project' } });
  assert.equal(checked.at(-1).projectId, 'persisted-project');
});

test('disabled agents can still be stopped by an operator with the project grant', async (t) => {
  const { app, reached } = await accessFixture(t, { disabled: { [AGENT_FLAG]: false } });
  const response = await app.inject({ method: 'POST', url: '/agentic-workflow-runs/run-a/cancel', headers: { authorization: 'Bearer fixture' }, payload: { project_id: 'project-a' } });
  assert.equal(response.statusCode, 200);
  assert.equal(reached(), 1);
});

test('cancellation after feature disable still rejects a viewer without run authority', async (t) => {
  const { app, reached } = await accessFixture(t, { disabled: { [AGENT_FLAG]: false }, allowed: false });
  const response = await app.inject({ method: 'POST', url: '/agentic-workflow-runs/run-a/cancel', headers: { authorization: 'Bearer fixture' }, payload: { project_id: 'project-a' } });
  assert.equal(response.statusCode, 403);
  assert.equal(reached(), 0);
});


test('the cancellation exception grants neither anonymous nor read-only API-key access', async (t) => {
  const { app, reached } = await accessFixture(t, { disabled: { [AGENT_FLAG]: false }, apiKeyScope: 'read' });
  const anonymous = await app.inject({ method: 'POST', url: '/agentic-workflow-runs/run-a/cancel' });
  assert.equal(anonymous.statusCode, 401);
  const readOnly = await app.inject({ method: 'POST', url: '/agentic-workflow-runs/run-a/cancel', headers: { authorization: 'Bearer fixture' }, payload: { project_id: 'project-a' } });
  assert.equal(readOnly.statusCode, 403);
  assert.equal(reached(), 0);
});

test('feature groups cover each published capability once and the shared template library is independent of case AI', async t => {
  stored(t, { 'hellotest.ai.test_authoring': false });
  const snapshot = await flags.getSnapshot();
  const capabilities = require('../../../capabilities.json');
  assert.deepEqual(snapshot.groups.map(group => group.key).sort(), Object.keys(capabilities.dependencies).sort());
  const features = snapshot.groups.flatMap(group => group.features.map(feature => feature.key));
  assert.equal(new Set(features).size, features.length);
  for (const group of snapshot.groups) {
    for (const feature of group.features) assert.equal(capabilities.feature_owners[feature.key], group.key, `${feature.key} is grouped under its package owner`);
  }
  assert.equal(snapshot.flags['hellotest.ai.prompt_templates'], true);
  assert.deepEqual(await flags.getDisabledPermissionCodes(['testcase.ai', 'prompt_template.view', 'prompt_template.manage']), ['testcase.ai']);
  assert.ok(Object.keys(snapshot.capability_availability).length === features.length);
});
