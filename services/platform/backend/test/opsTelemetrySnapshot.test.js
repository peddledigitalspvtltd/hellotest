const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { SERVICE_ERROR_CODES, serviceError } = require('../src/utils/serviceErrors');

const serviceFile = path.join(__dirname, '../../../trace/backend/services/opsTelemetry.service.js');
const serviceSource = fs.readFileSync(serviceFile, 'utf8');
const serviceRequire = createRequire(serviceFile);
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

function fixture({ integration: overrides = {}, noOpsIntegration = false, http } = {}) {
  const requests = [], lookups = [];
  const integration = {
    type: 'ops', base_url: 'https://engine.example.test/base/', api_key: 'isolated-provider-key',
    ...overrides,
    config: { project_id: 'project-a', events_path: '/api/v1/events', api_key_header: 'Authorization', api_key_prefix: 'Bearer', timeout_ms: 4000, ...overrides.config }
  };
  const module = { exports: {} };
  const db = { prepare: () => ({ get: () => assert.fail('Snapshot must not query execution records'), all: () => assert.fail('Snapshot must not query execution records') }) };
  const require = (name) => {
    if (name === '@hellotest/platform/backend/src/db' || name === '@hellotest/platform/backend/src/obsDb') return db;
    if (name === '@hellotest/platform/backend/src/domain/executionStepEvidence') return {};
    if (name === '@hellotest/integration/backend/services/integration.service') return { getActiveIntegrationByTypeForProject: async (type, projectId) => {
      lookups.push({ type, projectId });
      return type === 'ops' ? (noOpsIntegration ? null : integration) : { type: 'testengine', base_url: 'https://fallback-engine.example.test' };
    } };
    if (name === '@hellotest/platform/backend/src/utils/resilientHttpClient') return { resilientHttpRequest: async (target, init, policy) => {
      const request = { url: new URL(target), init, policy };
      requests.push(request);
      if (http) return http(request);
      if (init.method === 'DELETE') return json({ ok: true, deleted: 3, project_id: 'project-a' });
      if (request.url.pathname === '/api/v1/events') return json({ ok: true, project_id: 'project-a', items: [{ id: 'event-a', project_id: 'project-a' }], total: 1 });
      if (request.url.pathname === '/api/v1/ops-telemetry/services') return json({ ok: true, project_id: 'project-a', items: [{ service_name: 'engine', count: 1 }] });
      return json({ message: 'Route not found' }, 404);
    } };
    return serviceRequire(name);
  };
  new Function('require', 'module', 'exports', serviceSource)(require, module, module.exports);
  return { ...module.exports, requests, lookups };
}

test('dot-only project identifiers cannot normalize a scoped DELETE into the global events path', async () => {
  for (const project_id of ['.', '..', ' .. ']) {
    const view = fixture();
    await assert.rejects(view.clearTelemetryLogs({ project_id }), error => error.statusCode === 400);
    assert.equal(view.requests.length, 0);
  }
});

test('snapshot uses actual engine service path, project scope and server-side provider authentication', async () => {
  const view = fixture();
  const result = await view.getTelemetrySnapshot({ project_id: 'project-a', service_name: 'api', event_type: 'run.started', status: 'running', execution_id: 'run-a', search: 'checkout', limit: 42 });
  assert.equal(view.requests.length, 2);
  assert.deepEqual(view.requests.map(request => request.url.pathname), ['/api/v1/events', '/api/v1/ops-telemetry/services']);
  for (const request of view.requests) {
    assert.equal(request.url.origin, 'https://engine.example.test');
    assert.equal(request.url.searchParams.get('project_id'), 'project-a');
    assert.equal(request.init.headers.Authorization, 'Bearer isolated-provider-key');
    assert.equal(request.policy.deadlineMs, 4000);
    assert.equal(request.policy.maxResponseBytes, 5 * 1024 * 1024);
    assert.equal(request.policy.maxAttempts, 3);
  }
  const eventQuery = view.requests[0].url.searchParams;
  for (const [key, value] of Object.entries({ service_name: 'api', event_type: 'run.started', status: 'running', execution_id: 'run-a', search: 'checkout', limit: '42' })) assert.equal(eventQuery.get(key), value);
  assert.equal(result.events.total, 1);
  assert.equal(result.events.items[0].id, 'event-a');
  assert.equal(result.services.items[0].service_name, 'engine');
  assert.equal(result.project_id, 'project-a');
  assert.ok(Number.isFinite(Date.parse(result.checked_at)));
  assert.doesNotMatch(JSON.stringify(result), /isolated-provider-key/);
});

test('snapshot bounds filters, requested limits, returned rows and configured deadlines', async () => {
  const view = fixture({ integration: { config: { timeout_ms: 900000 } }, http: ({ url }) => json({
    project_id: 'project-a', total: 800, items: Array.from({ length: url.pathname.endsWith('/services') ? 150 : 300 }, (_, index) => ({ id: index }))
  }) });
  const result = await view.getTelemetrySnapshot({ project_id: 'project-a', search: 'x'.repeat(350), service_name: '  api  ', limit: 90000 });
  assert.equal(view.requests[0].url.searchParams.get('limit'), '250');
  assert.equal(view.requests[0].url.searchParams.get('search').length, 200);
  assert.equal(view.requests[0].url.searchParams.get('service_name'), 'api');
  assert.ok(view.requests.every(request => request.policy.deadlineMs === 30000));
  assert.equal(result.events.items.length, 250);
  assert.equal(result.events.total, 800, 'bounded result rows must not shrink the provider total');
  assert.equal(result.services.items.length, 100);
  const minimum = fixture({ integration: { config: { timeout_ms: 100 } } });
  await minimum.getTelemetrySnapshot({ project_id: 'project-a', limit: -2 });
  assert.equal(minimum.requests[0].url.searchParams.get('limit'), '1');
  assert.equal(minimum.requests[0].policy.deadlineMs, 500);
});

test('custom provider authentication header and empty prefix are used consistently for both reads', async () => {
  const view = fixture({ integration: { config: { api_key_header: 'X-Ops-Key', api_key_prefix: '' } } });
  await view.getTelemetrySnapshot({ project_id: 'project-a' });
  for (const request of view.requests) {
    assert.equal(request.init.headers['X-Ops-Key'], 'isolated-provider-key');
    assert.equal(request.init.headers.Authorization, undefined);
  }
});

test('absent OPS host resolves the project TestEngine integration without forwarding a browser token', async () => {
  const view = fixture({ noOpsIntegration: true });
  await view.getTelemetrySnapshot({ project_id: 'project-a' });
  assert.deepEqual(view.lookups, [{ type: 'ops', projectId: 'project-a' }, { type: 'testengine', projectId: 'project-a' }]);
  assert.ok(view.requests.every(request => request.url.origin === 'https://fallback-engine.example.test'));
  assert.ok(view.requests.every(request => request.init.headers.Authorization === undefined));
});

for (const status of [401, 403, 404, 429, 503]) {
  test(`services dependency rejection ${status} remains a failure with its upstream status`, async () => {
    const view = fixture({ http: ({ url }) => url.pathname.endsWith('/services') ? json({ message: 'Private provider diagnostic' }, status) : json({ project_id: 'project-a', items: [], total: 0 }) });
    await assert.rejects(view.getTelemetrySnapshot({ project_id: 'project-a' }), error => {
      assert.equal(error.code, SERVICE_ERROR_CODES.UPSTREAM_REJECTED);
      assert.equal(error.upstreamStatus, status);
      assert.equal(error.statusCode, status === 429 || status >= 500 ? 503 : 502);
      assert.equal(error.retryable, status === 429 || status >= 500);
      assert.doesNotMatch(error.message, /Private provider diagnostic/);
      return true;
    });
  });
}

test('dependency timeout preserves the original structured error instead of returning empty evidence', async () => {
  const timeout = serviceError(SERVICE_ERROR_CODES.TIMEOUT, { dependency: 'ops-telemetry', statusCode: 504, retryable: true });
  const view = fixture({ http: async () => { throw timeout; } });
  await assert.rejects(view.getTelemetrySnapshot({ project_id: 'project-a' }), error => error === timeout);
});

test('a successful HTTP response containing invalid JSON cannot masquerade as an empty snapshot', async () => {
  const view = fixture({ http: () => new Response('not-json', { status: 200 }) });
  await assert.rejects(view.getTelemetrySnapshot({ project_id: 'project-a' }), { code: SERVICE_ERROR_CODES.INVALID_RESPONSE, statusCode: 502 });
});

for (const eventsPath of ['https://other.example.test/events', '//other.example.test/events', '/\\other.example.test/events', '/api/v1/events\r\nextra']) {
  test(`unsafe configured events path is rejected before credentials leave the service (${JSON.stringify(eventsPath)})`, async () => {
    const view = fixture({ integration: { config: { events_path: eventsPath } } });
    await assert.rejects(view.getTelemetrySnapshot({ project_id: 'project-a' }), /same-origin|configured service origin/);
    assert.equal(view.requests.length, 0);
  });
}

test('missing project is rejected for both reading and clearing before any provider request', async () => {
  const view = fixture();
  for (const value of [undefined, '', '  ']) {
    await assert.rejects(view.getTelemetrySnapshot({ project_id: value }), /project_id is required/);
    await assert.rejects(view.clearTelemetryLogs({ project_id: value }), /project_id is required/);
  }
  assert.equal(view.requests.length, 0);
  assert.equal(view.lookups.length, 0);
});

test('clear uses the dedicated project resource and provider authentication, never global DELETE', async () => {
  const view = fixture();
  const result = await view.clearTelemetryLogs({ project_id: 'project-a' });
  assert.equal(view.requests.length, 1);
  assert.equal(view.requests[0].url.pathname, '/api/v1/events/projects/project-a');
  if (view.requests[0].url.searchParams.has('project_id')) assert.equal(view.requests[0].url.searchParams.get('project_id'), 'project-a');
  assert.equal(view.requests[0].init.method, 'DELETE');
  assert.equal(view.requests[0].init.headers.Authorization, 'Bearer isolated-provider-key');
  assert.equal(result.deleted, 3);
});

for (const dependency of ['events', 'services']) {
  for (const echoedProject of [undefined, null, 'project-b']) {
    test(`${dependency} replies without an exact project echo fail closed (${String(echoedProject)})`, async () => {
      const view = fixture({ http: ({ url }) => json({
        project_id: url.pathname.endsWith(dependency === 'services' ? '/services' : '/events') ? echoedProject : 'project-a', items: [], total: 0
      }) });
      await assert.rejects(view.getTelemetrySnapshot({ project_id: 'project-a' }), { code: SERVICE_ERROR_CODES.INVALID_RESPONSE, statusCode: 502 });
    });
  }
}

test('custom events paths retain project scoping for both reads and dedicated clears', async () => {
  const projectId = 'project/a?# b';
  const view = fixture({ integration: { config: { events_path: '/custom/telemetry/events' } }, http: () => json({ project_id: projectId, items: [], total: 0, deleted: 0 }) });
  await view.getTelemetrySnapshot({ project_id: projectId });
  assert.equal(view.requests[0].url.pathname, '/custom/telemetry/events');
  assert.equal(view.requests[0].url.searchParams.get('project_id'), projectId);
  assert.equal(view.requests[1].url.pathname, '/api/v1/ops-telemetry/services');
  assert.equal(view.requests[1].url.searchParams.get('project_id'), projectId);
  await view.clearTelemetryLogs({ project_id: projectId });
  assert.equal(view.requests[2].url.pathname, `/custom/telemetry/events/projects/${encodeURIComponent(projectId)}`);
  assert.equal(view.requests[2].init.method, 'DELETE');
});

test('an older provider rejecting project DELETE cannot trigger a fallback global clear', async () => {
  const view = fixture({ http: () => json({ message: 'Route not found' }, 404) });
  await assert.rejects(view.clearTelemetryLogs({ project_id: 'project-a' }), { code: SERVICE_ERROR_CODES.UPSTREAM_REJECTED, upstreamStatus: 404 });
  assert.equal(view.requests.length, 1);
  assert.equal(view.requests[0].url.pathname, '/api/v1/events/projects/project-a');
});


test('worker telemetry is opt-in, bounded and excludes project-tagged records', async () => {
  const view = fixture({ http: ({ url }) => json({ project_id: 'project-a', items: [], total: 0,
    workers: { scope: 'workers', total: 70, items: [
      { project_id: 'project-b', event_type: 'testengine.queue.poll.failed' },
      { event_type: 'other.event' },
      ...Array.from({ length: 60 }, () => ({ project_id: null, event_type: 'testengine.queue.poll.summary' }))
    ] }
  }) });
  const plain = await view.getTelemetrySnapshot({ project_id: 'project-a' });
  assert.equal(plain.workers, undefined);
  assert.equal(view.requests[0].url.searchParams.has('include_workers'), false);
  const result = await view.getTelemetrySnapshot({ project_id: 'project-a', include_workers: true });
  assert.equal(view.requests[2].url.searchParams.get('include_workers'), 'true');
  assert.equal(result.workers.state, 'available');
  assert.equal(result.workers.items.length, 50);
  assert.ok(result.workers.items.every(event => !event.project_id && event.event_type === 'testengine.queue.poll.summary'));
});

test('older engines keep project telemetry available when worker summaries are unsupported', async () => {
  const result = await fixture().getTelemetrySnapshot({ project_id: 'project-a', include_workers: true });
  assert.equal(result.events.total, 1);
  assert.equal(result.workers.state, 'unavailable');
});
