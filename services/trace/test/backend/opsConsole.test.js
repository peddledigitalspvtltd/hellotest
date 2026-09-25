const assert = require('node:assert/strict');
const test = require('node:test');
const { createGateway, allowedPath } = require('../../backend/services/opsConsole.service');
const capability = require('../../backend/services/opsGrafana.service');

test('console gateway restricts resources, destinations and forwarded headers', async () => {
  let called;
  const g = createGateway({ environment: { OPS_MONITORING_ENABLED: 'true' }, fetchImpl: async (url, options) => { called = { url, options }; return Response.json({ data: ['hellotest-api'] }); } });
  for (const path of ['../admin', 'static/../admin', 'http://evil.test/', 'static/%2e%2e/admin', 'api/archive/123']) assert.equal(allowedPath('traces', path), false);
  assert.equal(allowedPath('alerts', 'api/v2/alerts/groups'), true);
  assert.equal(allowedPath('alerts', 'api/v2/status'), true);
  await assert.rejects(g.request({ provider: '__proto__', path: '' }), { statusCode: 404 });
  await g.request({ provider: 'alerts', path: 'api/v2/alerts', query: { project_id: 'private', filter: ['severity=critical', 'team=qa'] } });
  assert.equal(called.options.method, 'GET'); assert.equal(called.options.redirect, 'manual'); assert.equal(called.options.headers, undefined);
  assert.equal(called.url.hostname, 'hellotest-ops-alertmanager'); assert.deepEqual(called.url.searchParams.getAll('filter'), ['severity=critical', 'team=qa']); assert.equal(called.url.searchParams.has('project_id'), false);
  assert.deepEqual(await g.ready('traces'), { data: ['hellotest-api'] });
  const disabled = createGateway({ environment: {}, fetchImpl: () => assert.fail('must not fetch') });
  await assert.rejects(disabled.ready('traces'), { statusCode: 503 });
});

test('console cookies are provider scoped and authorization is rechecked; writes are unavailable', async () => {
  const Fastify = require('fastify'), vm = require('node:vm'), fs = require('node:fs');
  let admin = true, project = true, reads = 0;
  const service = require('../../backend/services/opsConsole.service');
  const sandbox = { module: { exports: {} }, require: name => {
    if (name === 'node:stream') return require(name);
    if (name.includes('projectAccess')) return { getProject: async () => { if (!project) throw Object.assign(new Error('No project access'), { statusCode: 403 }); } };
    if (name.includes('opsGrafana.service')) return capability;
    if (name.includes('opsConsole.service')) return { ...service, gateway: { ready: async () => ({ data: ['hellotest-api'] }), request: async () => { reads++; return Response.json({ ok: true }); } } };
    throw Error(name);
  }, setTimeout, clearTimeout, AbortController };
  vm.runInNewContext(fs.readFileSync(require.resolve('../../backend/routes/opsConsole.routes'), 'utf8'), sandbox);
  const app = Fastify();
  app.decorate('requireAdmin', async req => { if (!admin || req.headers.authorization !== 'Bearer fixture') throw Object.assign(new Error('No admin access'), { statusCode: 403 }); req.user = { id: 'user1' }; req.authMethod = 'session'; });
  await app.register(sandbox.module.exports);
  try {
    const created = await app.inject({ method: 'POST', url: '/ops-telemetry/console-session/traces', headers: { authorization: 'Bearer fixture' }, payload: { project_id: 'p1' } });
    assert.equal(created.statusCode, 200); assert.match(created.json().url, /service=hellotest-api/);
    const cookie = created.headers['set-cookie'].split(';')[0];
    assert.match(created.headers['set-cookie'], /HttpOnly; SameSite=Strict/);
    const url = '/ops-telemetry/console/traces/api/services';
    assert.equal((await app.inject({ url })).statusCode, 401);
    assert.equal((await app.inject({ url, headers: { cookie } })).statusCode, 200);
    assert.equal((await app.inject({ url: '/ops-telemetry/console/alerts/api/v2/status', headers: { cookie: cookie.replace('hellotest_ops_traces', 'hellotest_ops_alerts') } })).statusCode, 403);
    assert.equal((await app.inject({ url, headers: { cookie, 'sec-fetch-site': 'cross-site' } })).statusCode, 403);
    admin = false; assert.equal((await app.inject({ url, headers: { cookie } })).statusCode, 403);
    admin = true; project = false; assert.equal((await app.inject({ url, headers: { cookie } })).statusCode, 403);
    project = true;
    assert.equal((await app.inject({ method: 'POST', url: '/ops-telemetry/console/alerts/api/v2/silences', headers: { cookie }, payload: {} })).statusCode, 404);
    assert.equal(reads, 1);
  } finally { await app.close(); }
});
