const assert = require('node:assert/strict');
const test = require('node:test');
const { createReader } = require('../../backend/services/opsMonitoring.service');
const enabled = { OPS_MONITORING_ENABLED: 'true' };
const json = data => new Response(JSON.stringify(data));

test('dashboard normalizes values without inventing samples; concurrent reads are coalesced and cached', async () => {
  let calls = 0, time = 1000;
  const read = createReader({ environment: enabled, now: () => time, fetchImpl: async url => {
    calls++;
    return json({ status: 'success', data: { result: url.searchParams.get('query') === 'up'
      ? [{ metric: { job: 'hellotest-api' }, value: [1, '1'] }]
      : [{ metric: { metric: 'request_rate' }, value: [1, '2.5'] }, { metric: { metric: 'latency' }, value: [1, 'NaN'] }] } });
  } });
  const [a, b] = await Promise.all([read('dashboard'), read('dashboard')]);
  assert.equal(a, b); assert.equal(calls, 2);
  assert.equal(a.metrics[0].value, 2.5); assert.equal(a.metrics[1].value, null); assert.equal(a.metrics[4].value, null);
  assert.deepEqual(a.services, [{ name: 'hellotest-api', available: true }]);
  await read('dashboard'); assert.equal(calls, 2);
  time += 15001; await read('dashboard'); assert.equal(calls, 4);
});

test('logs are bounded, ordered and redacted, with fixed server-selected queries', async () => {
  const read = createReader({ environment: enabled, fetchImpl: async url => {
    assert.equal(url.searchParams.get('limit'), '100');
    assert.equal(url.searchParams.get('since'), '15m');
    const values = Array.from({ length: 110 }, (_, i) => [String(1700000000000000000n + BigInt(i)), 'password="sample secret" Authorization: Bearer abc.def token=hidden postgres://user:private@db/main']);
    return json({ status: 'success', data: { result: [{ stream: { container: 'hellotest-local-api' }, values }] } });
  } });
  const result = await read('logs');
  assert.equal(result.logs.length, 100);
  assert.ok(result.logs[0].timestamp > result.logs[99].timestamp);
  assert.doesNotMatch(JSON.stringify(result), /sample secret|abc\.def|hidden|private@/);
  assert.match(result.logs[0].message, /REDACTED/);
});

test('a failed or oversized source does not affect other monitoring sections or expose errors', async () => {
  const read = createReader({ environment: enabled, fetchImpl: async url => {
    if (url.hostname.includes('loki')) throw new Error('private provider credentials');
    if (url.hostname.includes('prometheus')) return new Response('{}', { headers: { 'content-length': '600000' } });
    return json([{ fingerprint: 'a', labels: { alertname: 'ServiceDown', severity: 'warning' }, status: { state: 'active' }, annotations: { summary: 'A service is unavailable' }, startsAt: '2026-01-01T00:00:00Z' }]);
  } });
  assert.equal((await read('logs')).state, 'unavailable');
  assert.equal((await read('dashboard')).state, 'unavailable');
  const alerts = await read('alerts');
  assert.equal(alerts.state, 'available'); assert.equal(alerts.alerts[0].name, 'ServiceDown');
  assert.doesNotMatch(JSON.stringify(await read('logs')), /private|credentials/);
});

test('disabled monitoring and unsupported sections never contact a backend', async () => {
  const read = createReader({ environment: {}, fetchImpl: () => assert.fail('unexpected request') });
  assert.equal((await read('logs')).state, 'not_configured');
  await assert.rejects(read('http://attacker.invalid/'), { statusCode: 400 });
});

test('infrastructure reads require workspace administrator and project access', async () => {
  const fs = require('node:fs');
  const vm = require('node:vm');
  const Fastify = require('fastify');
  let reads = 0;
  const sandbox = { module: { exports: {} }, require: name => {
    if (name.includes('projectAccess')) return { getProject: async id => { if (id !== 'allowed') { const error = new Error('Forbidden'); error.statusCode = 403; throw error; } } };
    if (name.includes('opsMonitoring.service')) return { snapshot: async () => { reads++; return { state: 'available' }; } };
    return {};
  } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../../backend/routes/opsTelemetry.routes'), 'utf8'), sandbox);
  const app = Fastify();
  app.decorate('requireAdmin', async req => {
    if (req.headers['x-test-role'] !== 'admin') { const error = new Error('Admin required'); error.statusCode = 403; throw error; }
    req.user = { id: 'admin' };
  });
  await app.register(sandbox.module.exports);
  try {
    const url = '/ops-telemetry/monitoring/logs?project_id=allowed';
    assert.equal((await app.inject({ url })).statusCode, 403);
    assert.equal((await app.inject({ url: url.replace('allowed', 'denied'), headers: { 'x-test-role': 'admin' } })).statusCode, 403);
    assert.equal(reads, 0);
    assert.equal((await app.inject({ url, headers: { 'x-test-role': 'admin' } })).statusCode, 200);
    assert.equal(reads, 1);
  } finally { await app.close(); }
});


test('shared worker telemetry requires administrator access even with project membership', async () => {
  const fs = require('node:fs');
  const vm = require('node:vm');
  const Fastify = require('fastify');
  const reads = [];
  const sandbox = { module: { exports: {} }, require: name => {
    if (name.includes('projectAccess')) return { getProject: async id => { if (id !== 'allowed') throw Object.assign(new Error('Forbidden'), { statusCode: 403 }); } };
    if (name.includes('opsTelemetry.service')) return { getTelemetrySnapshot: async query => { reads.push(query); return { ok: true }; } };
    return {};
  } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../../backend/routes/opsTelemetry.routes'), 'utf8'), sandbox);
  const app = Fastify();
  app.addHook('onRequest', async req => { req.user = { id: 'signed-in' }; });
  app.decorate('requireAdmin', async req => {
    if (req.headers['x-test-role'] !== 'admin') throw Object.assign(new Error('Admin required'), { statusCode: 403 });
  });
  await app.register(sandbox.module.exports);
  try {
    const url = '/ops-telemetry/snapshot?project_id=allowed&include_workers=true';
    assert.equal((await app.inject({ url })).statusCode, 403);
    assert.equal(reads.length, 0);
    assert.equal((await app.inject({ url, headers: { 'x-test-role': 'admin' } })).statusCode, 200);
    assert.equal(reads[0].include_workers, true);
    assert.equal((await app.inject({ url: url.replace('allowed', 'denied'), headers: { 'x-test-role': 'admin' } })).statusCode, 403);
    assert.equal((await app.inject({ url: '/ops-telemetry/snapshot?project_id=allowed' })).statusCode, 200);
    assert.equal(reads[1].include_workers, false);
  } finally { await app.close(); }
});
