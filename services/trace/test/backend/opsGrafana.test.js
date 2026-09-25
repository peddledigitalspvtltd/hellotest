const assert = require('node:assert/strict');
const test = require('node:test');
const { sealSession, openSession, allowedRequest, createGateway } = require('../../backend/services/opsGrafana.service');

test('Grafana browser capabilities are encrypted, scoped, tamper resistant and short lived', () => {
  const value = { authorization: 'Bearer private-browser-token', user_id: 'user', project_id: 'project', origin: 'http://localhost:8080' };
  const token = sealSession(value, 1000);
  assert.doesNotMatch(token, /private-browser-token/);
  assert.equal(openSession(token, 1001).project_id, 'project');
  assert.throws(() => openSession(token, 1000000), { statusCode: 401 });
  assert.throws(() => openSession(token.slice(0, 20) + (token[20] === 'x' ? 'y' : 'x') + token.slice(21), 1001), { statusCode: 401 });
  assert.throws(() => openSession(undefined), { statusCode: 401 });
});

test('the Grafana gateway restricts paths and methods to dashboard reads', () => {
  for (const path of ['../api/admin/users', 'public/../../api/admin/users', 'public/%2e%2e/admin', 'https://evil.test/', 'api/admin/users', 'api/datasources/proxy/1/http://evil.test']) assert.equal(allowedRequest('GET', path), false, path);
  assert.equal(allowedRequest('GET', 'public/build/grafana.js'), true);
  assert.equal(allowedRequest('GET', 'd/hellotest-runtime-overview'), true);
  assert.equal(allowedRequest('POST', 'api/ds/query'), true);
  assert.equal(allowedRequest('POST', 'api/dashboards/db'), false);
  assert.equal(allowedRequest('DELETE', 'api/dashboards/uid/hellotest-runtime-overview'), false);
});

test('Grafana provisioning coalesces and only Viewer credentials are used for forwarded requests', async () => {
  let lookups = 0, forwarded;
  const g = createGateway({ environment: { OPS_MONITORING_ENABLED: 'true', OPS_GRAFANA_PASSWORD: 'installation-secret' }, fetchImpl: async (target, options) => {
    const url = new URL(target);
    if (url.pathname.endsWith('/api/users/lookup')) { lookups++; return Response.json({ id: 5, login: 'hellotest-embedded-viewer', email: 'hellotest-embedded-viewer@localhost.invalid', isGrafanaAdmin: false }); }
    if (url.pathname.endsWith('/orgs')) return Response.json([{ orgId: 1, role: 'Viewer' }]);
    if (url.pathname.endsWith('/password')) return Response.json({ message: 'Updated' });
    forwarded = { url, options };
    return Response.json({ ok: true });
  } });
  await Promise.all([g.ready(), g.ready()]);
  assert.equal(lookups, 1);
  await g.request({ method: 'GET', path: 'api/user', query: { project_id: 'secret-project', orgId: '1' } });
  const credentials = Buffer.from(forwarded.options.headers.Authorization.slice(6), 'base64').toString();
  assert.match(credentials, /^hellotest-embedded-viewer:/);
  assert.doesNotMatch(credentials, /installation-secret/);
  assert.equal(forwarded.url.searchParams.has('project_id'), false);
  await assert.rejects(g.request({ method: 'POST', path: 'api/ds/query', body: { queries: [{ datasource: { uid: 'untrusted' } }] } }), { statusCode: 400 });
});

test('a pre-existing privileged Grafana account is never repurposed as the embedded viewer', async () => {
  const g = createGateway({ environment: { OPS_MONITORING_ENABLED: 'true', OPS_GRAFANA_PASSWORD: 'installation-secret' }, fetchImpl: async () => Response.json({ id: 1, login: 'hellotest-embedded-viewer', email: 'hellotest-embedded-viewer@localhost.invalid', isGrafanaAdmin: true }) });
  await assert.rejects(g.ready(), /could not be verified/);
});

test('Grafana cookie access rechecks administrator, project and POST origin before forwarding', async () => {
  const fs = require('node:fs'), vm = require('node:vm'), Fastify = require('fastify');
  let isAdmin = true, projectAllowed = true, calls = 0;
  const grafana = require('../../backend/services/opsGrafana.service');
  const sandbox = { module: { exports: {} }, require: name => {
    if (name === 'node:stream') return require(name);
    if (name.includes('projectAccess')) return { getProject: async () => { if (!projectAllowed) throw Object.assign(new Error('Forbidden'), { statusCode: 403 }); } };
    if (name.includes('opsGrafana.service')) return { ...grafana, gateway: { request: async () => { calls++; return Response.json({ ok: true }); } } };
    return {};
  }, setTimeout, clearTimeout, AbortController };
  vm.runInNewContext(fs.readFileSync(require.resolve('../../backend/routes/opsTelemetry.routes'), 'utf8'), sandbox);
  const app = Fastify();
  app.decorate('requireAdmin', async req => {
    if (!isAdmin || req.headers.authorization !== 'Bearer fixture-admin') throw Object.assign(new Error('Admin required'), { statusCode: 403 });
    req.user = { id: 'u1' };
  });
  await app.register(sandbox.module.exports);
  const cookie = `${grafana.COOKIE}=${sealSession({ user_id: 'u1', project_id: 'p1', authorization: 'Bearer fixture-admin', origin: 'http://localhost:8080' })}`;
  const url = '/ops-telemetry/grafana/api/user';
  try {
    assert.equal((await app.inject({ url })).statusCode, 401);
    assert.equal((await app.inject({ url, headers: { cookie } })).statusCode, 200);
    assert.equal(calls, 1);
    isAdmin = false;
    assert.equal((await app.inject({ url, headers: { cookie } })).statusCode, 403);
    isAdmin = true; projectAllowed = false;
    assert.equal((await app.inject({ url, headers: { cookie } })).statusCode, 403);
    projectAllowed = true;
    assert.equal((await app.inject({ method: 'POST', url: '/ops-telemetry/grafana/api/ds/query', headers: { cookie, origin: 'https://evil.test' }, payload: {} })).statusCode, 403);
    assert.equal(calls, 1);
  } finally { await app.close(); }
});
