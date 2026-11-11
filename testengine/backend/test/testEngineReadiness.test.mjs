import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { registerTestEngineReadiness } from '../dist/lib/testEngineReadiness.js';
import { registerAutomationPlaywrightMcp, PLAYWRIGHT_MCP_ENDPOINT } from '../dist/lib/automationPlaywrightMcp.js';
import { createPrivilegedRunGuard, resolveTestEngineSharedSecret } from '../dist/lib/testEngineSecurity.js';

const secret = 'transport-fixture-secret-with-at-least-32-characters';
const headers = { 'x-hellotest-testengine-secret': secret };
const configuration = () => resolveTestEngineSharedSecret({ NODE_ENV: 'production', TESTENGINE_SHARED_SECRET: secret });

function readiness(app, state, sharedSecret = configuration()) {
  registerTestEngineReadiness(app, {
    sharedSecret, isShuttingDown: () => state.shuttingDown === true,
    isTelemetryInitialized: () => state.telemetry !== false,
    isRuntimeInitialized: () => state.runtime !== false && app.hasDecorator('playwrightMcpRuntime'),
    getQueueHealth: () => { state.queueReads = (state.queueReads || 0) + 1; return { ready: state.queueReady !== false, status: state.queueReady === false ? 'degraded' : 'ready' }; },
    serviceName: () => 'transport-readiness-fixture'
  });
}
const invoke = (app, method, session, params = {}, id = 1) => app.inject({
  method: 'POST', url: PLAYWRIGHT_MCP_ENDPOINT,
  headers: { ...headers, ...(session ? { 'mcp-session-id': session } : {}) },
  payload: { jsonrpc: '2.0', ...(id === null ? {} : { id }), method, params }
});
const parameters = { protocolVersion: '2025-03-26', clientInfo: { name: 'transport-readiness-fixture', version: '1' },
  capabilities: {}, _meta: { hellotest: { start_url: 'https://example.test/' } } };

test('queue polling failure leaves an initialized native MCP session reachable, including authentication, capacity and DELETE', async t => {
  const app = Fastify();
  const state = { queueReady: true };
  readiness(app, state);
  await registerAutomationPlaywrightMcp(app, createPrivilegedRunGuard(configuration()), {
    validateTarget: async () => ({ address: '127.0.0.1', port: 80 }), maxSessions: 1
  });
  t.after(() => app.close());
  const initialized = await invoke(app, 'initialize', undefined, parameters);
  assert.equal(initialized.statusCode, 200);
  assert.equal(initialized.json().result.protocolVersion, '2025-03-26');
  const session = initialized.headers['mcp-session-id'];
  assert.ok(session);
  assert.equal((await invoke(app, 'notifications/initialized', session, {}, null)).statusCode, 202);
  assert.equal((await app.inject('/health/ready')).statusCode, 200);

  state.queueReady = false;
  const admission = await app.inject('/health/ready');
  assert.equal(admission.statusCode, 503);
  assert.equal(admission.json().checks.queue_worker.ready, false);
  const previousReads = state.queueReads;
  const transport = await app.inject('/health/transport');
  assert.equal(transport.statusCode, 200);
  assert.equal(transport.headers['cache-control'], 'no-store');
  assert.equal(state.queueReads, previousReads, 'Transport health must not read queue/API-dependent state');
  assert.equal(transport.json().checks.queue_worker, undefined);
  assert.doesNotMatch(transport.body, new RegExp(secret));

  assert.equal((await invoke(app, 'initialize', undefined, parameters)).statusCode, 429);
  assert.equal((await app.inject('/health/transport')).statusCode, 200, 'Busy capacity cannot withdraw existing sessions');
  assert.equal((await invoke(app, 'ping', session)).statusCode, 200);
  const tools = await invoke(app, 'tools/list', session);
  assert.ok(tools.json().result.tools.some(tool => tool.name === 'browser_click'));
  assert.equal((await app.inject({ method: 'POST', url: PLAYWRIGHT_MCP_ENDPOINT, payload: { jsonrpc: '2.0', id: 1, method: 'ping' } })).statusCode, 401);
  assert.equal((await app.inject({ method: 'DELETE', url: PLAYWRIGHT_MCP_ENDPOINT, headers: { ...headers, 'mcp-session-id': session } })).statusCode, 204);
  assert.equal((await invoke(app, 'ping', session)).statusCode, 404);
});

test('both readiness endpoints fail closed for runtime, telemetry, authentication and shutdown failures', async t => {
  for (const failure of ['runtime', 'telemetry', 'authentication', 'shutdown']) await t.test(failure, async () => {
    const app = Fastify();
    app.decorate('playwrightMcpRuntime', {});
    const state = { queueReady: true, ...(failure === 'shutdown' ? { shuttingDown: true } : { [failure]: false }) };
    readiness(app, state, failure === 'authentication' ? resolveTestEngineSharedSecret({ NODE_ENV: 'production' }) : configuration());
    try {
      for (const path of ['/health/transport', '/health/ready']) assert.equal((await app.inject(path)).statusCode, 503, `${failure}: ${path}`);
    } finally { await app.close(); }
  });
});
