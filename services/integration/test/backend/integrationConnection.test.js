const assert = require('node:assert/strict');
const test = require('node:test');
const { EventEmitter } = require('node:events');
const runtimeRequire = require('node:module').createRequire(require('node:path').resolve(__dirname, '../../../platform/backend/package.json'));
const nodemailer = runtimeRequire('nodemailer');
const service = require('../../backend/services/integration.service');
const probe = require('../../../platform/backend/src/services/integrationConnectionProbe.service');
const { resetServiceResilienceState } = require('../../../platform/backend/src/utils/resilientHttpClient');
const { INTEGRATION_TYPE_VALUES } = require('../../../platform/backend/src/domain/catalog');
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
function network(t, responses) {
  resetServiceResilienceState();
  const calls = [];
  t.mock.method(global, 'fetch', async (url, init) => {
    calls.push({ url: String(url), ...init });
    const next = responses.shift();
    if (!next) throw new Error('Unexpected request');
    return typeof next === 'function' ? next(url, init) : next;
  });
  return calls;
}
const key = 'private-test-token-not-for-output';
const fixtures = {
  llm: { input: { type: 'llm', model: 'gpt-5-test', api_key: key }, responses: [response({ choices: [{ message: { content: 'OK' } }] })], status: 'passed' },
  google_auth: { input: { type: 'google_auth', config: { client_id: '1234-test.apps.googleusercontent.com' } }, responses: [response({ issuer: 'https://accounts.google.com', jwks_uri: 'https://www.googleapis.com/oauth2/v3/certs' })], status: 'warning' },
  google_drive: { input: { type: 'google_drive', api_key: key, config: { folder_id: 'folder' } }, responses: [response({ id: 'folder', mimeType: 'application/vnd.google-apps.folder', capabilities: { canAddChildren: true } })], status: 'passed' },
  github: { input: { type: 'github', api_key: key, config: { owner: 'acme', repo: 'qa', branch: 'release/one' } }, responses: [response({ id: 2, full_name: 'acme/qa', permissions: { push: true } }), response({ object: { sha: 'commit' } })], status: 'passed' },
  jira: { input: { type: 'jira', api_key: key, username: 'qa@example.test', base_url: 'https://tracker.example/jira', project_key: 'QA' }, responses: [response({ accountId: 'qa' }), response({ id: '1', key: 'QA' })], status: 'passed' },
  testengine: { input: { type: 'testengine', base_url: 'http://engine:4301' }, responses: [response({ ok: true }), response({ runner: 'hybrid', supported_web_engines: ['playwright'] })], status: 'warning' },
  'local-desktop': { input: { type: 'local-desktop', base_url: 'http://localhost:4301' }, responses: [response({ ok: true }), response({ runner: 'local' })], status: 'warning' },
  ops: { input: { type: 'ops', base_url: 'http://engine:4301', api_key: key, config: { api_key_header: 'X-Ops-Key', api_key_prefix: '' } }, responses: [response({ ok: true }), response({ ok: true, items: [] })], status: 'warning' },
  cloudrun: { input: { type: 'cloudrun', base_url: 'https://hub-cloud.browserstack.com/wd/hub', username: 'qa', api_key: key }, responses: [response({ parallel_sessions_max_allowed: 5 }), response({ value: { ready: true } })], status: 'warning' }
};
for (const [type, fixture] of Object.entries(fixtures)) test(`${type}: performs provider checks and returns truthful bounded results`, async t => {
  const calls = network(t, fixture.responses);
  const result = await probe.testConnection(fixture.input);
  assert.equal(result.status, fixture.status, JSON.stringify(result));
  assert.equal(result.type, type);
  assert.ok(result.checks.length && result.latency_ms >= 1 && Date.parse(result.checked_at));
  assert.ok(!JSON.stringify(result).includes(key));
  assert.ok(calls.every(call => call.redirect === 'manual' && call.signal));
  assert.ok(calls.every(call => type === 'llm' ? call.method === 'POST' : !call.method || call.method === 'GET'));
  if (type === 'llm') { const body = JSON.parse(calls[0].body); assert.equal(body.max_completion_tokens, 256); assert.equal(body.model, 'gpt-5-test'); }
  if (type === 'github') { assert.match(calls[1].url, /release%2Fone$/); assert.equal(calls.length, 2, 'Repository-scoped tokens do not need a user-profile permission'); }
  if (type === 'jira') assert.match(calls[0].url, /\/jira\/rest\/api\/2\/myself$/);
  if (type === 'ops') assert.equal(calls[0].headers['X-Ops-Key'], key);
});
test('SMTP verifies credentials and closes transport without sending mail', async t => {
  let closed = 0; let verified = 0;
  t.mock.method(nodemailer, 'createTransport', options => {
    assert.equal(options.auth.pass, key); assert.equal(options.secure, true); assert.equal(options.port, 465);
    return { verify: async () => { verified++; }, close: () => { closed++; }, sendMail: () => assert.fail('No email may be sent') };
  });
  const result = await probe.testConnection({ type: 'email', username: 'qa', config: { host: 'smtp.example.test', port: 465, secure: true, password: key } });
  assert.equal(result.status, 'passed'); assert.equal(verified, 1); assert.equal(closed, 1); assert.match(result.next_step, /delivery/);
});
test('every catalog integration has a provider check', () => assert.deepEqual([...Object.keys(fixtures), 'email'].sort(), [...INTEGRATION_TYPE_VALUES].sort()));
for (const [status, body, expected] of [[401, {}, /credentials/], [403, {}, /denied/], [429, {}, /rate limiting/], [429, { error: { code: 'insufficient_quota', message: key } }, /quota/], [503, {}, /503/]]) test(`provider failure ${status} is actionable and never echoes secrets`, async t => {
  const calls = network(t, [response(body, status)]);
  const result = await probe.testConnection({ type: 'llm', model: 'test', api_key: key });
  assert.equal(result.status, 'failed'); assert.match(result.checks.at(-1).detail, expected); assert.equal(calls.length, 1);
  assert.ok(result.next_step && !JSON.stringify(result).includes(key));
});
test('LLM negotiates only explicit token-parameter rejection and proves actual generation', async t => {
  const calls = network(t, [response({ error: { message: 'max_tokens unsupported; use max_completion_tokens' } }, 400), response({ choices: [{ message: { content: 'OK' } }] })]);
  assert.equal((await probe.testConnection({ type: 'llm', model: 'custom', api_key: key })).status, 'passed');
  assert.equal(JSON.parse(calls[1].body).max_completion_tokens, 256);
});
test('accepted LLM request with no visible output is limited, not falsely passed', async t => {
  network(t, [response({ choices: [{ message: { content: '' }, finish_reason: 'length' }] })]);
  assert.equal((await probe.testConnection({ type: 'llm', model: 'custom', api_key: key })).status, 'warning');
});
test('HTML and redirect responses cannot pass or forward credentials', async t => {
  for (const next of [new Response('<html>Login</html>'), new Response(null, { status: 302, headers: { location: 'https://outside.example' } })]) {
    const calls = network(t, [next]);
    const result = await probe.testConnection({ type: 'github', api_key: key, config: { owner: 'a', repo: 'b' } });
    assert.equal(result.status, 'failed'); assert.equal(calls.length, 1);
  }
});
test('response body byte limits and overall timeout are enforced', async t => {
  network(t, [new Response('x'.repeat(140 * 1024))]);
  assert.equal((await probe.testConnection({ type: 'testengine', base_url: 'https://engine.example' })).status, 'failed');
  network(t, [(_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error(), { name: 'AbortError' })), { once: true }))]);
  const start = Date.now();
  const result = await probe.testConnection({ type: 'testengine', base_url: 'https://engine.example' }, { timeoutMs: 120 });
  assert.equal(result.status, 'failed'); assert.ok(Date.now() - start < 1000);
});
test('Drive rejects wrong resource, deleted folder and missing write permission', async t => {
  for (const payload of [{ id: 'folder', mimeType: 'text/plain' }, { id: 'folder', mimeType: 'application/vnd.google-apps.folder', trashed: true }, { id: 'folder', mimeType: 'application/vnd.google-apps.folder', capabilities: { canAddChildren: false } }]) {
    network(t, [response(payload)]);
    assert.equal((await probe.testConnection({ type: 'google_drive', api_key: key, config: { folder_id: 'folder' } })).status, 'failed');
  }
});
test('OPS paths reject cross-origin and backslash URLs before forwarding authentication', async t => {
  for (const path of ['//outside.example', '/\\outside.example', '/health?token=unsafe']) {
    const calls = network(t, []);
    await assert.rejects(probe.testConnection({ type: 'ops', base_url: 'https://ops.example', api_key: key, config: { health_path: path } }), { statusCode: 400 });
    assert.equal(calls.length, 0);
  }
});
for (const [provider, host, url, payload] of [
  ['lambdatest', 'hub.lambdatest.com', 'https://api.lambdatest.com/automation/api/v1/user-files', { Meta: { total: 0 }, data: [] }],
  ['saucelabs', 'ondemand.eu-central-1.saucelabs.com', 'https://api.eu-central-1.saucelabs.com/rest/v1/qa/jobs?limit=1', []],
  ['crossbrowser', 'hub.crossbrowsertesting.com', 'https://crossbrowsertesting.com/api/v3/account/activeTestCounts', { selenium: 0 }],
  ['other', 'grid.example.test', 'https://grid.example.test/wd/hub/status', { value: { ready: true } }]
]) test(`cloud ${provider} authenticates against its own API and explains session limits`, async t => {
  const calls = network(t, provider === 'other' ? [response(payload)] : [response(payload), response({ value: { ready: true } })]);
  const result = await probe.testConnection({ type: 'cloudrun', base_url: `https://${host}/wd/hub`, username: 'qa', api_key: key, config: { provider } });
  assert.equal(result.status, 'warning', JSON.stringify(result)); assert.equal(calls[0].url, url);
  assert.equal(calls[0].headers.Authorization, `Basic ${Buffer.from(`qa:${key}`).toString('base64')}`);
});
test('known cloud provider with unrelated hub is rejected before credential use', async t => {
  const calls = network(t, []);
  await assert.rejects(probe.testConnection({ type: 'cloudrun', base_url: 'https://unrelated.example/wd/hub', username: 'qa', api_key: key, config: { provider: 'browserstack' } }), { statusCode: 400 });
  assert.equal(calls.length, 0);
});
test('saved profiles reuse only valid stored secrets on unchanged destinations', async t => {
  const stored = { id: 'saved', type: 'llm', base_url: 'https://provider.example/v1', api_key: key, username: null, model: 'old', config: { project_id: 'a' } };
  t.mock.method(service, 'getIntegration', async id => { assert.equal(id, 'saved'); return structuredClone(stored); });
  for (const api_key of [undefined, '', '********', '••••••']) {
    const resolved = await service.resolveConnectionInput({ integration_id: 'saved', type: 'llm', api_key, model: 'new' });
    assert.equal(resolved.api_key, key); assert.equal(resolved.model, 'new'); assert.equal(stored.model, 'old');
  }
  for (const patch of [{ base_url: 'https://outside.example/v1' }, { base_url: 'https://provider.example/other-proxy' }, { username: 'other' }]) await assert.rejects(service.resolveConnectionInput({ integration_id: 'saved', type: 'llm', ...patch }), /Enter a new/);
  const replacement = await service.resolveConnectionInput({ integration_id: 'saved', type: 'llm', base_url: 'https://new.example/v1', api_key: 'replacement' });
  assert.equal(replacement.api_key, 'replacement');
  await assert.rejects(service.resolveConnectionInput({ integration_id: 'saved', type: 'github' }), /does not match/);
});
test('SMTP saved password remains server-side and cannot follow a host/port/account change', async t => {
  t.mock.method(service, 'getIntegration', async () => ({ id: 'smtp', type: 'email', username: 'qa', config: { host: 'smtp.example', port: 587, password: key } }));
  assert.equal((await service.resolveConnectionInput({ integration_id: 'smtp', type: 'email', config: { password: '********' } })).config.password, key);
  for (const patch of [{ config: { host: 'elsewhere' } }, { config: { port: 465 } }, { username: 'else' }]) await assert.rejects(service.resolveConnectionInput({ integration_id: 'smtp', type: 'email', ...patch }), /Enter a new/);
  await assert.rejects(service.resolveConnectionInput({ type: 'llm', api_key: '********' }), /masked placeholder/);
});
test('test route checks permission before reading saved credentials', async t => {
  const handlers = new Map(); const events = [];
  const fastify = { authenticate: async () => events.push('auth'), requirePermission: permission => async () => { events.push(permission); throw Object.assign(new Error('Denied'), { statusCode: 403 }); }, validate: () => events.push('validate') };
  for (const method of ['get', 'post', 'put', 'delete']) fastify[method] = (path, handler) => handlers.set(`${method} ${path}`, handler);
  t.mock.method(service, 'getIntegration', async () => { events.push('secret read'); });
  await require('../../backend/routes/integrations.routes')(fastify);
  await assert.rejects(handlers.get('post /integrations/test-connection')({ body: { type: 'llm', integration_id: 'saved' } }, {}), { statusCode: 403 });
  assert.deepEqual(events, ['auth', 'integration.manage']);
});
